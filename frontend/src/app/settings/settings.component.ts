import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatCardModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule
  ],
  template: `
    <div class="settings-container">
      <mat-toolbar color="primary">
        <button mat-icon-button routerLink="/dashboard">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <span>Configuración</span>
      </mat-toolbar>

      <div class="content">
        <mat-card class="info-card">
          <mat-card-header>
            <mat-card-title>⚙️ Configuración</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <p>Opciones de configuración próximamente.</p>
          </mat-card-content>
        </mat-card>
      </div>
    </div>
  `,
  styles: [`
    .settings-container {
      min-height: 100vh;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    }
    .content {
      padding: 24px;
      max-width: 1400px;
      margin: 0 auto;
    }
    .info-card {
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
    }
    .info-card p {
      color: rgba(255, 255, 255, 0.8);
      margin: 16px 0;
    }
  `]
})
export class SettingsComponent {}