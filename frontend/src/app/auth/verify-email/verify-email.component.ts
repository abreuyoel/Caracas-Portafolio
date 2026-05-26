import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, RouterLink, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="verify-container">
      <div class="bg-blob blob-1"></div>
      <div class="bg-blob blob-2"></div>
      <div class="verify-card">
        <div class="logo">
          <span class="logo-icon">📊</span>
          <span class="logo-text">Caracas <span class="accent">Portafolio</span></span>
        </div>

        @if (loading) {
          <div class="state state--loading">
            <mat-spinner diameter="48" strokeWidth="3"></mat-spinner>
            <p>Verificando tu cuenta…</p>
          </div>
        }

        @if (!loading && success) {
          <div class="state state--success">
            <div class="icon-circle icon-circle--success">
              <mat-icon>check_circle</mat-icon>
            </div>
            <h2>¡Cuenta verificada!</h2>
            <p>Tu correo ha sido confirmado. Ya puedes iniciar sesión y gestionar tu portafolio.</p>
            <a class="btn-primary" routerLink="/auth/login">Iniciar sesión</a>
          </div>
        }

        @if (!loading && !success && errorMsg) {
          <div class="state state--error">
            <div class="icon-circle icon-circle--error">
              <mat-icon>error_outline</mat-icon>
            </div>
            <h2>No se pudo verificar</h2>
            <p>{{ errorMsg }}</p>
            <a class="btn-secondary" routerLink="/auth/login">Ir al inicio de sesión</a>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .verify-container {
      min-height: 100vh;
      background: #080d18;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      position: relative;
      overflow: hidden;
    }
    .bg-blob { position: fixed; border-radius: 50%; filter: blur(80px); pointer-events: none; opacity: 0.25; }
    .blob-1 { width: 420px; height: 420px; background: radial-gradient(circle, #4C62FF 0%, transparent 70%); top: -120px; left: -100px; }
    .blob-2 { width: 320px; height: 320px; background: radial-gradient(circle, #8b5cf6 0%, transparent 70%); bottom: -80px; right: -80px; }
    .verify-card {
      background: #0d1525;
      border: 1px solid #1e2a40;
      border-radius: 20px;
      padding: 40px;
      width: 100%;
      max-width: 440px;
      text-align: center;
      position: relative;
      z-index: 1;
    }
    .logo { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 32px; font-size: 1.2rem; font-weight: 700; color: #fff; }
    .logo-icon { font-size: 1.6rem; }
    .accent { color: #4C62FF; }
    .state { display: flex; flex-direction: column; align-items: center; gap: 16px; }
    .state p { color: #8090a8; font-size: 0.9rem; line-height: 1.6; margin: 0; max-width: 320px; }
    .state h2 { color: #e0e6f0; margin: 0; font-size: 1.3rem; }
    .icon-circle { width: 72px; height: 72px; border-radius: 50%; display: flex; align-items: center; justify-content: center; mat-icon { font-size: 40px; width: 40px; height: 40px; } }
    .icon-circle--success { background: rgba(45,217,148,0.12); border: 2px solid rgba(45,217,148,0.3); mat-icon { color: #2dd994; } }
    .icon-circle--error { background: rgba(239,83,80,0.12); border: 2px solid rgba(239,83,80,0.3); mat-icon { color: #ef5350; } }
    .btn-primary, .btn-secondary {
      display: inline-block; margin-top: 8px; padding: 12px 28px; border-radius: 10px; font-size: 0.9rem; font-weight: 700; text-decoration: none; cursor: pointer;
    }
    .btn-primary { background: linear-gradient(135deg, #3a60a0, #5040c0); color: #fff; }
    .btn-secondary { background: #1a2540; color: #7eb8ff; border: 1px solid #2a3a58; }
  `]
})
export class VerifyEmailComponent implements OnInit {
  loading = true;
  success = false;
  errorMsg = '';

  constructor(private route: ActivatedRoute, private http: HttpClient) {}

  ngOnInit() {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.loading = false;
      this.errorMsg = 'Token de verificación no encontrado en el enlace.';
      return;
    }
    this.http.get<any>(`${environment.apiUrl}/auth/verify-email?token=${token}`).subscribe({
      next: () => {
        this.loading = false;
        this.success = true;
      },
      error: (err) => {
        this.loading = false;
        this.errorMsg = err.error?.detail || 'No se pudo verificar el correo.';
      }
    });
  }
}
