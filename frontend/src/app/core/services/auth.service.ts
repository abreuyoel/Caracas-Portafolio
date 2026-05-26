import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { jwtDecode } from 'jwt-decode';

export interface User {
  id: string;
  email: string;
  username: string;
  full_name?: string;
  is_active: boolean;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private apiUrl = environment.apiUrl;
  private currentUserSubject: BehaviorSubject<User | null>;
  public currentUser$: Observable<User | null>;

  constructor(private http: HttpClient, private router: Router) {
    const storedUser = this.getUserFromStorage();
    this.currentUserSubject = new BehaviorSubject<User | null>(storedUser);
    this.currentUser$ = this.currentUserSubject.asObservable();
  }

  public get currentUserValue(): User | null {
    return this.currentUserSubject.value;
  }

  register(userData: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/auth/register`, userData);
  }

  login(email: string, password: string): Observable<LoginResponse> {
    const formData = new FormData();
    formData.append('username', email);
    formData.append('password', password);

    return this.http.post<LoginResponse>(`${this.apiUrl}/auth/login`, formData).pipe(
      tap(response => {
        // ✅ GUARDAR TOKENS INMEDIATAMENTE
        this.setToken(response.access_token);
        this.setRefreshToken(response.refresh_token);
        this.loadCurrentUser();
      })
    );
  }

  logout(): void {
    this.removeToken();
    this.removeRefreshToken();
    localStorage.removeItem('user');
    this.currentUserSubject.next(null);
    this.router.navigate(['/']);
  }

  refreshToken(): Observable<LoginResponse> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }
    
    return this.http.post<LoginResponse>(`${this.apiUrl}/auth/refresh`, { 
      refresh_token: refreshToken 
    }).pipe(
      tap(response => {
        // ✅ ACTUALIZAR TOKENS CON NUEVOS VALORES
        this.setToken(response.access_token);
        this.setRefreshToken(response.refresh_token);
      })
    );
  }

  isAuthenticated(): boolean {
    const token = this.getToken();
    if (!token) return false;
    
    try {
      const decoded: any = jwtDecode(token);
      return decoded.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  getToken(): string | null {
    return localStorage.getItem('access_token');
  }

  private setToken(token: string): void {
    localStorage.setItem('access_token', token);
    console.log('✅ Access token saved');
  }

  private removeToken(): void {
    localStorage.removeItem('access_token');
  }

  private setRefreshToken(token: string): void {
    localStorage.setItem('refresh_token', token);
    console.log('✅ Refresh token saved');
  }

  private getRefreshToken(): string | null {
    return localStorage.getItem('refresh_token');
  }

  private removeRefreshToken(): void {
    localStorage.removeItem('refresh_token');
  }

  private loadCurrentUser(): void {
    const token = this.getToken();
    if (token) {
      try {
        const decoded: any = jwtDecode(token);
        const user: User = {
          id: decoded.sub,
          email: decoded.email,
          username: decoded.email.split('@')[0],
          is_active: true
        };
        this.currentUserSubject.next(user);
        localStorage.setItem('user', JSON.stringify(user));
      } catch (error) {
        this.logout();
      }
    }
  }

  private getUserFromStorage(): User | null {
    try {
      const userStr = localStorage.getItem('user');
      return userStr ? JSON.parse(userStr) : null;
    } catch {
      localStorage.removeItem('user');
      return null;
    }
  }
}