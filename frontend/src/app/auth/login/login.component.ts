import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import { WebSocketService } from '../../core/services/websocket.service';
import { environment } from '../../../environments/environment';

declare const google: any;

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSnackBarModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {
  loginForm: FormGroup;
  loading = false;
  notVerifiedEmail = '';
  resendLoading = false;
  googleClientId = environment.googleClientId;

  // Forgot password flow
  forgotStep: 'none' | 'email' | 'code' = 'none';
  forgotEmail = '';
  forgotCode = '';
  forgotNewPassword = '';
  forgotLoading = false;
  forgotError = '';
  forgotSuccess = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private wsService: WebSocketService,
    private snackBar: MatSnackBar,
    private router: Router,
    private http: HttpClient
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  ngOnInit(): void {
    if (this.googleClientId) {
      this.loadGoogleScript();
    }
  }

  private loadGoogleScript(): void {
    if (document.getElementById('google-gsi-script')) {
      this.initGoogleButton();
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => this.initGoogleButton();
    document.head.appendChild(script);
  }

  private initGoogleButton(): void {
    setTimeout(() => {
      if (typeof google === 'undefined') return;
      google.accounts.id.initialize({
        client_id: this.googleClientId,
        callback: (response: any) => this.handleGoogleCredential(response.credential),
      });
      const btn = document.getElementById('google-signin-btn');
      if (btn) {
        google.accounts.id.renderButton(btn, {
          theme: 'filled_black',
          size: 'large',
          width: btn.offsetWidth || 360,
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
        });
      }
    }, 200);
  }

  handleGoogleCredential(credential: string): void {
    this.loading = true;
    this.http.post<any>(`${environment.apiUrl}/auth/google`, { credential }).subscribe({
      next: (response) => {
        this.loading = false;
        localStorage.setItem('access_token', response.access_token);
        localStorage.setItem('refresh_token', response.refresh_token);
        this.wsService.connect();
        this.snackBar.open('¡Bienvenido! 🎉', 'Cerrar', { duration: 3000, panelClass: ['success-snackbar'] });
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.loading = false;
        this.snackBar.open(err.error?.detail || 'Error al iniciar sesión con Google', 'Cerrar', { duration: 5000, panelClass: ['error-snackbar'] });
      }
    });
  }

  onAppleLogin(): void {
    this.snackBar.open('Apple Sign-In requiere configuración en Apple Developer — próximamente', 'OK', { duration: 4000 });
  }

  onSubmit(): void {
    if (this.loginForm.valid && !this.loading) {
      this.loading = true;
      const { email, password } = this.loginForm.value;

      this.authService.login(email, password).subscribe({
        next: (response) => {
          this.loading = false;
          this.wsService.connect();
          this.snackBar.open('¡Bienvenido! 🎉', 'Cerrar', {
            duration: 3000,
            panelClass: ['success-snackbar']
          });
          this.router.navigate(['/dashboard']);
        },
        error: (error) => {
          this.loading = false;
          if (error.error?.detail === 'email_not_verified') {
            this.notVerifiedEmail = this.loginForm.value.email;
          } else {
            this.notVerifiedEmail = '';
            this.snackBar.open(
              error.error?.detail || 'Credenciales inválidas',
              'Cerrar',
              { duration: 5000, panelClass: ['error-snackbar'] }
            );
          }
        }
      });
    }
  }

  resendVerification(): void {
    if (this.resendLoading || !this.notVerifiedEmail) return;
    this.resendLoading = true;
    this.http.post(`${environment.apiUrl}/auth/resend-verification`, { email: this.notVerifiedEmail }).subscribe({
      next: () => {
        this.resendLoading = false;
        this.snackBar.open('Correo de verificación reenviado. Revisa tu bandeja.', 'OK', { duration: 4000 });
      },
      error: () => {
        this.resendLoading = false;
        this.snackBar.open('No se pudo reenviar. Intenta más tarde.', 'OK', { duration: 4000 });
      }
    });
  }

  // ── Forgot password ──────────────────────────────────────────────────────────

  openForgot(): void {
    this.forgotStep = 'email';
    this.forgotEmail = this.loginForm.value.email || '';
    this.forgotError = '';
    this.forgotSuccess = false;
  }

  closeForgot(): void {
    this.forgotStep = 'none';
    this.forgotCode = '';
    this.forgotNewPassword = '';
    this.forgotError = '';
  }

  sendResetCode(): void {
    if (!this.forgotEmail || this.forgotLoading) return;
    this.forgotLoading = true;
    this.forgotError = '';
    this.http.post(`${environment.apiUrl}/auth/forgot-password`, { email: this.forgotEmail }).subscribe({
      next: () => {
        this.forgotLoading = false;
        this.forgotStep = 'code';
      },
      error: () => {
        this.forgotLoading = false;
        this.forgotError = 'Error enviando el código. Intenta de nuevo.';
      }
    });
  }

  confirmReset(): void {
    if (!this.forgotCode || !this.forgotNewPassword || this.forgotLoading) return;
    if (this.forgotNewPassword.length < 8) {
      this.forgotError = 'La contraseña debe tener al menos 8 caracteres.';
      return;
    }
    this.forgotLoading = true;
    this.forgotError = '';
    this.http.post(`${environment.apiUrl}/auth/reset-password`, {
      email: this.forgotEmail,
      code: this.forgotCode,
      new_password: this.forgotNewPassword,
    }).subscribe({
      next: () => {
        this.forgotLoading = false;
        this.forgotSuccess = true;
        setTimeout(() => this.closeForgot(), 2500);
      },
      error: (err) => {
        this.forgotLoading = false;
        this.forgotError = err.error?.detail || 'Código inválido o expirado.';
      }
    });
  }
}