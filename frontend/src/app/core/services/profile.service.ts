import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Observable } from 'rxjs';

export interface UserProfile {
  user_id: string;
  risk_profile: string;
  investment_goal: string;
  time_horizon: string;
  experience_level: number;
  max_loss_tolerance: number;
  expected_return: number;
  available_capital: number;
  allows_volatile_stocks: boolean;
  allows_margin_trading: boolean;
  preferred_sectors: string | null;
  avoided_sectors: string | null;
  daily_notifications: boolean;
  opportunity_alerts: boolean;
  risk_alerts: boolean;
  notification_frequency: string;
  profile_updated_at: string;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private apiUrl = environment.apiUrl + '/user-profile';

  constructor(private http: HttpClient) {}

  getProfile(): Observable<UserProfile> {
    return this.http.get<UserProfile>(this.apiUrl);
  }

  createProfile(data: any): Observable<UserProfile> {
    return this.http.post<UserProfile>(this.apiUrl, data);
  }

  updateProfile(data: any): Observable<UserProfile> {
    return this.http.put<UserProfile>(this.apiUrl, data);
  }

  getQuestionnaire(): Observable<any> {
    return this.http.get(this.apiUrl + '/questionnaire');
  }

  calculateProfile(answers: any): Observable<any> {
    return this.http.post(this.apiUrl + '/calculate-profile', answers);
  }

  getRecommendations(): Observable<any> {
    return this.http.get(this.apiUrl + '/recommendations');
  }
}