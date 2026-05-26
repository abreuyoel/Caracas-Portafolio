import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

import { MatTabsModule } from '@angular/material/tabs';
import { MatDialogModule, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

import { environment } from '../../environments/environment';
import { BvcSocketService } from '../core/services/bvc-socket.service';
import { Subscription } from 'rxjs';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Goal {
  id: number;
  title: string;
  goal_type: 'porcentaje' | 'precio_objetivo' | 'monto' | 'sueno';
  stock_symbol?: string;
  target_value: number;
  current_value?: number;
  currency: 'USD' | 'Bs';
  deadline?: string;
  icon?: string;
  color?: string;
  is_achieved: boolean;
  progress_pct?: number;
  created_at?: string;
}

interface Alert {
  id: number;
  stock_symbol: string;
  alert_type: string;
  condition_type: 'above' | 'below';
  condition_value: number;
  message?: string;
  is_active?: boolean;
  created_at?: string;
}

// ─── Dialog: Create Goal ──────────────────────────────────────────────────────

@Component({
  selector: 'app-create-goal-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatDatepickerModule,
    MatNativeDateModule,
  ],
  template: `
    <div class="dialog-wrapper">
      <div class="dialog-header">
        <span class="dialog-title">🎯 Nuevo Objetivo</span>
        <button class="close-btn" (click)="ref.close()">✕</button>
      </div>

      <form [formGroup]="form" (ngSubmit)="submit()" class="dialog-form">

        <mat-form-field appearance="outline" class="full">
          <mat-label>Título del objetivo</mat-label>
          <input matInput formControlName="title" placeholder="Ej: Doblar mi inversión en APPLE">
        </mat-form-field>

        <mat-form-field appearance="outline" class="full">
          <mat-label>Tipo de objetivo</mat-label>
          <mat-select formControlName="goal_type">
            <mat-option value="porcentaje">📈 % de ganancia en acción</mat-option>
            <mat-option value="precio_objetivo">💲 Precio objetivo ($)</mat-option>
            <mat-option value="monto">💰 Monto total ($)</mat-option>
            <mat-option value="sueno">🎯 Meta personal (viaje, auto, etc.)</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full">
          <mat-label>Símbolo de acción (opcional)</mat-label>
          <input matInput formControlName="stock_symbol" placeholder="Ej: AAPL, BBVA.CA">
        </mat-form-field>

        <div class="row">
          <mat-form-field appearance="outline" class="half">
            <mat-label>Valor objetivo</mat-label>
            <input matInput type="number" formControlName="target_value">
          </mat-form-field>

          <mat-form-field appearance="outline" class="half">
            <mat-label>Moneda</mat-label>
            <mat-select formControlName="currency">
              <mat-option value="USD">🇺🇸 USD</mat-option>
              <mat-option value="Bs">🇻🇪 Bs</mat-option>
            </mat-select>
          </mat-form-field>
        </div>

        <mat-form-field appearance="outline" class="full">
          <mat-label>Fecha límite (opcional)</mat-label>
          <input matInput [matDatepicker]="picker" formControlName="deadline">
          <mat-datepicker-toggle matIconSuffix [for]="picker"></mat-datepicker-toggle>
          <mat-datepicker #picker></mat-datepicker>
        </mat-form-field>

        <div class="color-row">
          <label class="color-label">Color:</label>
          <div class="color-options">
            <div *ngFor="let c of colors"
                 class="color-dot"
                 [style.background]="c"
                 [class.active]="form.get('color')?.value === c"
                 (click)="form.patchValue({color: c})">
            </div>
          </div>
        </div>

        <div class="dialog-actions">
          <button mat-stroked-button type="button" (click)="ref.close()">Cancelar</button>
          <button mat-raised-button color="primary" type="submit" [disabled]="form.invalid">
            Crear Objetivo
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .dialog-wrapper {
      background: #0e1528;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 0;
      width: 480px;
      max-width: 100%;
    }

    .dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 24px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }

    .dialog-title {
      color: #fff;
      font-size: 1.1rem;
      font-weight: 600;
    }

    .close-btn {
      background: none;
      border: none;
      color: rgba(255,255,255,0.5);
      font-size: 1.1rem;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 6px;
      transition: all 0.2s;
      &:hover { background: rgba(255,255,255,0.08); color: #fff; }
    }

    .dialog-form {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .full { width: 100%; }

    .row {
      display: flex;
      gap: 12px;
      .half { flex: 1; }
    }

    .color-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 8px 0 16px;
    }

    .color-label {
      color: rgba(255,255,255,0.6);
      font-size: 0.85rem;
    }

    .color-options {
      display: flex;
      gap: 8px;
    }

    .color-dot {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      cursor: pointer;
      border: 2px solid transparent;
      transition: all 0.2s;
      &.active { border-color: #fff; transform: scale(1.2); }
      &:hover { transform: scale(1.1); }
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 8px;
    }

    ::ng-deep .dialog-wrapper {
      .mat-mdc-text-field-wrapper { background: rgba(255,255,255,0.05) !important; }
      .mat-mdc-form-field-label, label { color: rgba(255,255,255,0.6) !important; }
      input, .mat-mdc-select-value-text { color: #fff !important; }
      .mdc-notched-outline__leading,
      .mdc-notched-outline__notch,
      .mdc-notched-outline__trailing {
        border-color: rgba(255,255,255,0.15) !important;
      }
    }
  `]
})
export class CreateGoalDialogComponent {
  colors = ['#4c62ff', '#00e5c3', '#2dd994', '#ff4d6a', '#f59e0b', '#a78bfa', '#ec4899'];

  form: FormGroup;

  constructor(
    public ref: MatDialogRef<CreateGoalDialogComponent>,
    private fb: FormBuilder
  ) {
    this.form = this.fb.group({
      title: ['', Validators.required],
      goal_type: ['porcentaje', Validators.required],
      stock_symbol: [''],
      target_value: [null, [Validators.required, Validators.min(0)]],
      currency: ['USD', Validators.required],
      deadline: [null],
      icon: [''],
      color: ['#4c62ff']
    });
  }

  submit() {
    if (this.form.valid) {
      const val = { ...this.form.value };
      if (val.deadline) {
        val.deadline = (val.deadline as Date).toISOString().split('T')[0];
      }
      this.ref.close(val);
    }
  }
}

// ─── Dialog: Create Alert ─────────────────────────────────────────────────────

@Component({
  selector: 'app-create-alert-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="dialog-wrapper">
      <div class="dialog-header">
        <span class="dialog-title">🔔 Nueva Alerta de Precio</span>
        <button class="close-btn" (click)="ref.close()">✕</button>
      </div>

      <form [formGroup]="form" (ngSubmit)="submit()" class="dialog-form">

        <!-- Stock selector with search -->
        <mat-form-field appearance="outline" class="full">
          <mat-label>Acción</mat-label>
          <mat-select formControlName="stock_symbol" panelClass="stock-select-panel">
            <div class="stock-search-wrap">
              <input class="stock-search-input" [(ngModel)]="stockFilter" [ngModelOptions]="{standalone:true}"
                     placeholder="Buscar símbolo..." (click)="$event.stopPropagation()">
            </div>
            <div *ngIf="loadingStocks" class="stocks-loading-row">
              <mat-spinner diameter="20"></mat-spinner>
              <span>Cargando acciones...</span>
            </div>
            <mat-option *ngFor="let s of filteredStocks" [value]="s.symbol">
              <div class="stock-opt">
                <span class="so-sym">{{ s.symbol }}</span>
                <span class="so-name">{{ s.name }}</span>
              </div>
            </mat-option>
          </mat-select>
          <mat-error>Selecciona una acción</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full">
          <mat-label>Condición</mat-label>
          <mat-select formControlName="condition_type">
            <mat-option value="above">📈 Por encima de</mat-option>
            <mat-option value="below">📉 Por debajo de</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full">
          <mat-label>Precio objetivo ($)</mat-label>
          <input matInput type="number" formControlName="condition_value" step="0.01" min="0">
          <mat-error>Ingresa un precio válido</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full">
          <mat-label>Mensaje personalizado (opcional)</mat-label>
          <input matInput formControlName="message" placeholder="Ej: BPV llegó a mi precio objetivo">
        </mat-form-field>

        <div class="dialog-actions">
          <button mat-stroked-button type="button" (click)="ref.close()">Cancelar</button>
          <button mat-raised-button color="accent" type="submit" [disabled]="form.invalid">
            <mat-icon>add_alert</mat-icon>
            Crear Alerta
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .dialog-wrapper {
      background: #0e1528;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      width: 440px;
      max-width: 100%;
    }
    .dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 24px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .dialog-title { color: #fff; font-size: 1.1rem; font-weight: 600; }
    .close-btn {
      background: none; border: none; color: rgba(255,255,255,0.5);
      font-size: 1.1rem; cursor: pointer; padding: 4px 8px;
      border-radius: 6px; transition: all 0.2s;
      &:hover { background: rgba(255,255,255,0.08); color: #fff; }
    }
    .dialog-form { padding: 24px; display: flex; flex-direction: column; gap: 4px; }
    .full { width: 100%; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 8px; align-items: center; }
    .stock-search-wrap {
      padding: 8px 12px;
      position: sticky;
      top: 0;
      background: #0e1528;
      z-index: 1;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .stock-search-input {
      width: 100%;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      color: #fff;
      padding: 8px 12px;
      font-size: 0.88rem;
      outline: none;
      &::placeholder { color: rgba(255,255,255,0.35); }
      &:focus { border-color: #00e5c3; }
    }
    .stocks-loading-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      color: rgba(255,255,255,0.5);
      font-size: 0.85rem;
    }
    .stock-opt {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .so-sym {
      font-weight: 700;
      font-size: 0.92rem;
      color: #a5b4fc;
      font-family: 'JetBrains Mono', monospace;
    }
    .so-name {
      font-size: 0.76rem;
      color: rgba(255,255,255,0.45);
    }
    ::ng-deep .stock-select-panel .mat-mdc-option { min-height: 52px; }
    ::ng-deep .dialog-wrapper {
      .mat-mdc-text-field-wrapper { background: rgba(255,255,255,0.05) !important; }
      input, .mat-mdc-select-value-text { color: #fff !important; }
      .mdc-notched-outline__leading,
      .mdc-notched-outline__notch,
      .mdc-notched-outline__trailing { border-color: rgba(255,255,255,0.15) !important; }
    }
  `]
})
export class CreateAlertDialogComponent implements OnInit {
  form: FormGroup;
  stocks: { symbol: string; name: string }[] = [];
  loadingStocks = true;
  stockFilter = '';

  get filteredStocks() {
    if (!this.stockFilter) return this.stocks;
    const q = this.stockFilter.toLowerCase();
    return this.stocks.filter(s =>
      s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  }

  constructor(
    public ref: MatDialogRef<CreateAlertDialogComponent>,
    private fb: FormBuilder,
    private http: HttpClient
  ) {
    this.form = this.fb.group({
      stock_symbol: ['', Validators.required],
      alert_type: ['price'],
      condition_type: ['above', Validators.required],
      condition_value: [null, [Validators.required, Validators.min(0)]],
      message: ['']
    });
  }

  ngOnInit(): void {
    const token = localStorage.getItem('access_token');
    this.http.get<any[]>(`${environment.apiUrl}/stocks/bvc/active`, {
      headers: { Authorization: `Bearer ${token}` }
    }).subscribe({
      next: (data) => { this.stocks = data || []; this.loadingStocks = false; },
      error: () => { this.loadingStocks = false; }
    });
  }

  submit() {
    if (this.form.valid) this.ref.close(this.form.value);
  }
}

// ─── Main Goals Component ─────────────────────────────────────────────────────

@Component({
  selector: 'app-goals',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    MatTabsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatProgressBarModule,
    MatChipsModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSlideToggleModule,
  ],
  template: `
    <!-- Animated blobs background -->
    <div class="goals-bg">
      <div class="blob blob-1"></div>
      <div class="blob blob-2"></div>
      <div class="blob blob-3"></div>
    </div>

    <div class="goals-container">

      <!-- Header -->
      <div class="goals-header">
        <div class="header-left">
          <div class="header-icon">🎯</div>
          <div>
            <h1>Mis Objetivos & Alertas</h1>
            <p class="header-sub">Rastrea tus metas de inversión y alertas de precio</p>
          </div>
        </div>
        <div class="header-actions">
          <button mat-stroked-button class="push-btn" (click)="pushGranted ? unsubscribePush() : subscribePush()" [disabled]="pushLoading"
                  [matTooltip]="pushGranted ? 'Desactivar notificaciones push' : 'Activar notificaciones push'">
            <mat-icon>{{ pushGranted ? 'notifications_active' : 'notifications_off' }}</mat-icon>
            {{ pushGranted ? 'Push activo' : 'Activar push' }}
          </button>
        </div>
      </div>

      <!-- Stats row -->
      <div class="stats-row">
        <div class="stat-pill">
          <span class="stat-num">{{ goals.length }}</span>
          <span class="stat-lbl">Objetivos</span>
        </div>
        <div class="stat-pill accent">
          <span class="stat-num">{{ achievedCount }}</span>
          <span class="stat-lbl">Logrados</span>
        </div>
        <div class="stat-pill warning">
          <span class="stat-num">{{ alerts.length }}</span>
          <span class="stat-lbl">Alertas activas</span>
        </div>
      </div>

      <!-- Tabs -->
      <mat-tab-group class="goals-tabs" animationDuration="300ms">

        <!-- ── Tab 1: Mis Objetivos ── -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon class="tab-icon">flag</mat-icon>
            Mis Objetivos
          </ng-template>

          <div class="tab-content">

            <div class="tab-toolbar">
              <h2>Tus metas de inversión</h2>
              <button mat-raised-button color="primary" (click)="openCreateGoal()">
                <mat-icon>add</mat-icon>
                Nuevo Objetivo
              </button>
            </div>

            <!-- Loading -->
            <div *ngIf="goalsLoading" class="center-spinner">
              <mat-spinner diameter="48"></mat-spinner>
            </div>

            <!-- Empty state -->
            <div *ngIf="!goalsLoading && goals.length === 0" class="empty-state">
              <div class="empty-icon">🎯</div>
              <h3>Sin objetivos aún</h3>
              <p>Crea tu primer objetivo de inversión para comenzar a rastrear tu progreso</p>
              <button mat-raised-button color="primary" (click)="openCreateGoal()">
                <mat-icon>add</mat-icon>
                Crear primer objetivo
              </button>
            </div>

            <!-- Goals grid -->
            <div *ngIf="!goalsLoading && goals.length > 0" class="goals-grid">
              <div *ngFor="let goal of goals" class="goal-card" [class.achieved]="goal.is_achieved"
                   [style.--card-accent]="goal.color || '#4c62ff'">

                <!-- Card top bar -->
                <div class="card-top">
                  <div class="goal-icon" [style.background]="(goal.color || '#4c62ff') + '22'">
                    <span *ngIf="isEmoji(getIcon(goal))">{{ getIcon(goal) }}</span>
                    <mat-icon *ngIf="!isEmoji(getIcon(goal))" [style.color]="goal.color || '#4c62ff'">
                      {{ getIcon(goal) }}
                    </mat-icon>
                  </div>
                  <div class="goal-type-badge">{{ getTypeLabel(goal.goal_type) }}</div>
                  <div class="card-actions">
                    <button mat-icon-button
                            [matTooltip]="goal.is_achieved ? 'Ya logrado' : 'Marcar como logrado'"
                            (click)="markAchieved(goal)"
                            [disabled]="goal.is_achieved">
                      <mat-icon [style.color]="goal.is_achieved ? '#2dd994' : 'rgba(255,255,255,0.4)'">
                        {{ goal.is_achieved ? 'check_circle' : 'radio_button_unchecked' }}
                      </mat-icon>
                    </button>
                    <button mat-icon-button matTooltip="Eliminar" (click)="deleteGoal(goal.id)">
                      <mat-icon style="color: #ff4d6a">delete_outline</mat-icon>
                    </button>
                  </div>
                </div>

                <!-- Title & symbol -->
                <div class="goal-info">
                  <h3 class="goal-title">{{ goal.title }}</h3>
                  <span *ngIf="goal.stock_symbol" class="stock-badge">{{ goal.stock_symbol }}</span>
                </div>

                <!-- Progress bar -->
                <div class="progress-area">
                  <div class="progress-labels">
                    <span class="progress-pct">{{ (goal.progress_pct || 0) | number:'1.0-1' }}%</span>
                    <span class="progress-target">
                      Meta: {{ goal.target_value | number:'1.0-2' }} {{ goal.currency }}
                    </span>
                  </div>
                  <div class="custom-progress-bar">
                    <div class="progress-fill"
                         [style.width.%]="clamp(goal.progress_pct || 0, 0, 100)"
                         [style.background]="goal.is_achieved ? '#2dd994' : (goal.color || '#4c62ff')">
                    </div>
                  </div>
                </div>

                <!-- Deadline -->
                <div *ngIf="goal.deadline" class="deadline-row">
                  <mat-icon style="font-size:14px;width:14px;height:14px;color:rgba(255,255,255,0.4)">event</mat-icon>
                  <span>{{ goal.deadline | date:'mediumDate' }}</span>
                </div>

                <!-- Achieved badge -->
                <div *ngIf="goal.is_achieved" class="achieved-banner">
                  🏆 ¡Objetivo logrado!
                </div>

              </div>
            </div>

          </div>
        </mat-tab>

        <!-- ── Tab 2: Alertas de Precio ── -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon class="tab-icon">notifications_active</mat-icon>
            Alertas de Precio
          </ng-template>

          <div class="tab-content">

            <div class="tab-toolbar">
              <h2>Alertas de precio activas</h2>
              <button mat-raised-button color="accent" (click)="openCreateAlert()">
                <mat-icon>add_alert</mat-icon>
                Nueva Alerta
              </button>
            </div>

            <!-- Loading -->
            <div *ngIf="alertsLoading" class="center-spinner">
              <mat-spinner diameter="48"></mat-spinner>
            </div>

            <!-- Empty state -->
            <div *ngIf="!alertsLoading && alerts.length === 0" class="empty-state">
              <div class="empty-icon">🔔</div>
              <h3>Sin alertas configuradas</h3>
              <p>Crea alertas de precio para recibir notificaciones cuando una acción llegue a tu precio objetivo</p>
              <button mat-raised-button color="accent" (click)="openCreateAlert()">
                <mat-icon>add_alert</mat-icon>
                Crear primera alerta
              </button>
            </div>

            <!-- Alerts list -->
            <div *ngIf="!alertsLoading && alerts.length > 0" class="alerts-list">
              <div *ngFor="let alert of alerts" class="alert-card">
                <div class="alert-icon" [class.above]="alert.condition_type === 'above'"
                     [class.below]="alert.condition_type === 'below'">
                  <mat-icon>{{ alert.condition_type === 'above' ? 'trending_up' : 'trending_down' }}</mat-icon>
                </div>
                <div class="alert-info">
                  <div class="alert-symbol">{{ alert.stock_symbol }}</div>
                  <div class="alert-condition">
                    {{ alert.condition_type === 'above' ? 'Por encima de' : 'Por debajo de' }}
                    <strong>\${{ alert.condition_value | number:'1.2-2' }}</strong>
                  </div>
                  <div *ngIf="alert.message" class="alert-message">{{ alert.message }}</div>
                </div>
                <div class="alert-date" *ngIf="alert.created_at">
                  {{ alert.created_at | date:'shortDate' }}
                </div>
                <button mat-icon-button matTooltip="Eliminar alerta" (click)="deleteAlert(alert.id)">
                  <mat-icon style="color:#ff4d6a">delete_outline</mat-icon>
                </button>
              </div>
            </div>

          </div>
        </mat-tab>

      </mat-tab-group>

    </div>

    <!-- Support chat widget -->
    <div class="support-widget">
      <button class="fab-support" (click)="supportOpen = !supportOpen"
              [matTooltip]="supportOpen ? 'Cerrar soporte' : 'Ayuda'">
        <mat-icon>{{ supportOpen ? 'close' : 'help' }}</mat-icon>
      </button>

      <div class="support-panel" *ngIf="supportOpen">
        <div class="support-header">
          <mat-icon>support_agent</mat-icon>
          <span>Ayuda &amp; Funcionalidades</span>
        </div>
        <div class="support-messages" #supportScroll>
          <div *ngFor="let msg of supportMessages" class="sup-msg" [class.user]="msg.isUser">
            <div class="sup-bubble">{{ msg.text }}</div>
          </div>
        </div>
        <div class="support-input-row">
          <input class="sup-input" [(ngModel)]="supportMessage"
                 placeholder="Pregunta sobre la app..."
                 (keyup.enter)="sendSupportMsg()"
                 type="text">
          <button mat-icon-button (click)="sendSupportMsg()" [disabled]="!supportMessage.trim()">
            <mat-icon style="color:#00e5c3">send</mat-icon>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    /* ── Variables ─────────────────────────────────── */
    :host {
      --bg: #080d18;
      --card: rgba(255,255,255,0.04);
      --border: rgba(255,255,255,0.08);
      --primary: #4c62ff;
      --accent: #00e5c3;
      --green: #2dd994;
      --red: #ff4d6a;
      --text: #e8eaf6;
      --muted: rgba(255,255,255,0.45);
      display: block;
      min-height: 100vh;
      position: relative;
    }

    /* ── Blobs ─────────────────────────────────────── */
    .goals-bg {
      position: fixed;
      inset: 0;
      background: var(--bg);
      z-index: 0;
      overflow: hidden;
      pointer-events: none;
    }
    .blob {
      position: absolute;
      border-radius: 50%;
      filter: blur(80px);
      opacity: 0.18;
      animation: float 12s ease-in-out infinite;
    }
    .blob-1 {
      width: 500px; height: 500px;
      background: var(--primary);
      top: -120px; left: -100px;
      animation-delay: 0s;
    }
    .blob-2 {
      width: 400px; height: 400px;
      background: var(--accent);
      bottom: -80px; right: -80px;
      animation-delay: -4s;
    }
    .blob-3 {
      width: 300px; height: 300px;
      background: var(--green);
      top: 50%; left: 50%;
      transform: translate(-50%,-50%);
      animation-delay: -8s;
    }
    @keyframes float {
      0%, 100% { transform: translate(0,0) scale(1); }
      33%       { transform: translate(20px, -20px) scale(1.05); }
      66%       { transform: translate(-15px, 15px) scale(0.95); }
    }

    /* ── Container ─────────────────────────────────── */
    .goals-container {
      position: relative;
      z-index: 1;
      max-width: 1200px;
      margin: 0 auto;
      padding: 28px 24px 80px;
    }

    /* ── Header ────────────────────────────────────── */
    .goals-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 28px;
      flex-wrap: wrap;
      gap: 16px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .header-icon {
      font-size: 2.5rem;
      line-height: 1;
    }
    .goals-header h1 {
      color: #fff;
      font-size: 1.7rem;
      font-weight: 700;
      margin: 0;
    }
    .header-sub {
      color: var(--muted);
      font-size: 0.88rem;
      margin: 4px 0 0;
    }
    .push-btn {
      color: var(--accent) !important;
      border-color: var(--accent) !important;
    }

    /* ── Stats row ─────────────────────────────────── */
    .stats-row {
      display: flex;
      gap: 12px;
      margin-bottom: 28px;
      flex-wrap: wrap;
    }
    .stat-pill {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 24px;
      backdrop-filter: blur(12px);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      min-width: 110px;
    }
    .stat-pill.accent { border-color: rgba(0,229,195,0.25); }
    .stat-pill.warning { border-color: rgba(245,158,11,0.25); }
    .stat-num {
      font-size: 1.8rem;
      font-weight: 700;
      color: #fff;
    }
    .stat-pill.accent .stat-num { color: var(--accent); }
    .stat-pill.warning .stat-num { color: #f59e0b; }
    .stat-lbl {
      color: var(--muted);
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* ── Tabs ──────────────────────────────────────── */
    .goals-tabs {
      background: transparent;
    }
    ::ng-deep {
      .goals-tabs .mat-mdc-tab-header {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 14px 14px 0 0;
        backdrop-filter: blur(12px);
      }
      .goals-tabs .mat-mdc-tab-body-wrapper {
        background: var(--card);
        border: 1px solid var(--border);
        border-top: none;
        border-radius: 0 0 14px 14px;
        backdrop-filter: blur(12px);
      }
      .goals-tabs .mdc-tab__text-label { color: rgba(255,255,255,0.55) !important; }
      .goals-tabs .mdc-tab--active .mdc-tab__text-label { color: #fff !important; }
      .goals-tabs .mdc-tab-indicator__content--underline { border-color: var(--primary) !important; }
    }
    .tab-icon { margin-right: 6px; font-size: 18px; }

    /* ── Tab content ───────────────────────────────── */
    .tab-content { padding: 24px; }
    .tab-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .tab-toolbar h2 {
      color: #fff;
      font-size: 1.1rem;
      font-weight: 600;
      margin: 0;
    }

    /* ── Loading / Empty ───────────────────────────── */
    .center-spinner {
      display: flex;
      justify-content: center;
      padding: 60px 20px;
    }
    .empty-state {
      text-align: center;
      padding: 60px 24px;
      color: var(--muted);
    }
    .empty-icon { font-size: 3.5rem; margin-bottom: 16px; }
    .empty-state h3 { color: #fff; font-size: 1.1rem; margin: 0 0 8px; }
    .empty-state p { margin: 0 0 24px; font-size: 0.9rem; }

    /* ── Goals grid ────────────────────────────────── */
    .goals-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
    }

    .goal-card {
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 20px;
      position: relative;
      transition: transform 0.2s, box-shadow 0.2s;
      overflow: hidden;

      &::before {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 3px;
        background: var(--card-accent, #4c62ff);
        border-radius: 16px 16px 0 0;
      }

      &:hover {
        transform: translateY(-3px);
        box-shadow: 0 12px 40px rgba(0,0,0,0.35);
      }

      &.achieved {
        border-color: rgba(45,217,148,0.25);
        background: rgba(45,217,148,0.04);
      }
    }

    .card-top {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
    }

    .goal-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
      flex-shrink: 0;
      mat-icon { font-size: 20px; width: 20px; height: 20px; }
    }

    .goal-type-badge {
      flex: 1;
      font-size: 0.72rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .card-actions {
      display: flex;
      gap: 0;
      margin-left: auto;
    }

    .goal-info { margin-bottom: 14px; }
    .goal-title {
      color: #fff;
      font-size: 1rem;
      font-weight: 600;
      margin: 0 0 6px;
    }
    .stock-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 20px;
      background: rgba(76,98,255,0.18);
      border: 1px solid rgba(76,98,255,0.35);
      color: #a5b4fc;
      font-size: 0.78rem;
      font-weight: 600;
    }

    .progress-area { margin-bottom: 12px; }
    .progress-labels {
      display: flex;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .progress-pct {
      color: #fff;
      font-size: 0.88rem;
      font-weight: 600;
    }
    .progress-target {
      color: var(--muted);
      font-size: 0.78rem;
    }
    .custom-progress-bar {
      height: 8px;
      background: rgba(255,255,255,0.08);
      border-radius: 4px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.6s cubic-bezier(0.4,0,0.2,1);
      background: linear-gradient(90deg, #4c62ff, #00e5c3);
    }

    .deadline-row {
      display: flex;
      align-items: center;
      gap: 4px;
      color: var(--muted);
      font-size: 0.78rem;
      margin-top: 8px;
    }

    .achieved-banner {
      margin-top: 12px;
      text-align: center;
      padding: 8px;
      background: rgba(45,217,148,0.12);
      border: 1px solid rgba(45,217,148,0.3);
      border-radius: 8px;
      color: var(--green);
      font-size: 0.85rem;
      font-weight: 600;
    }

    /* ── Alerts list ───────────────────────────────── */
    .alerts-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .alert-card {
      display: flex;
      align-items: center;
      gap: 16px;
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
      transition: background 0.2s;

      &:hover { background: rgba(255,255,255,0.06); }
    }

    .alert-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      &.above {
        background: rgba(45,217,148,0.12);
        mat-icon { color: var(--green); }
      }
      &.below {
        background: rgba(255,77,106,0.12);
        mat-icon { color: var(--red); }
      }
    }

    .alert-info { flex: 1; }
    .alert-symbol {
      color: #fff;
      font-size: 1rem;
      font-weight: 700;
      margin-bottom: 2px;
    }
    .alert-condition {
      color: var(--muted);
      font-size: 0.85rem;
      strong { color: rgba(255,255,255,0.8); }
    }
    .alert-message {
      color: rgba(255,255,255,0.5);
      font-size: 0.78rem;
      margin-top: 2px;
      font-style: italic;
    }
    .alert-date {
      color: var(--muted);
      font-size: 0.75rem;
    }

    /* ── Support widget ─────────────────────────────────── */
    .support-widget {
      position: fixed;
      bottom: 28px;
      right: 28px;
      z-index: 1200;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 12px;
    }
    .fab-support {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--accent), #00b09b);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 24px rgba(0,229,195,0.35);
      transition: transform 0.2s, box-shadow 0.2s;

      mat-icon { color: #080d18; font-size: 26px; width: 26px; height: 26px; }

      &:hover {
        transform: scale(1.1) translateY(-2px);
        box-shadow: 0 14px 36px rgba(0,229,195,0.5);
      }
    }
    .support-panel {
      width: 320px;
      background: rgba(8,13,24,0.97);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      backdrop-filter: blur(24px);
      box-shadow: 0 12px 48px rgba(0,0,0,0.6);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .support-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      background: rgba(76,98,255,0.15);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      color: #fff;
      font-weight: 600;
      font-size: 0.9rem;
      mat-icon { color: #00e5c3; }
    }
    .support-messages {
      flex: 1;
      max-height: 260px;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .sup-msg { display: flex; }
    .sup-msg.user { justify-content: flex-end; }
    .sup-bubble {
      max-width: 85%;
      padding: 8px 12px;
      border-radius: 12px;
      font-size: 0.83rem;
      line-height: 1.4;
      background: rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.85);
    }
    .sup-msg.user .sup-bubble {
      background: rgba(76,98,255,0.35);
      color: #fff;
    }
    .support-input-row {
      display: flex;
      align-items: center;
      border-top: 1px solid rgba(255,255,255,0.07);
      padding: 4px 8px;
    }
    .sup-input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: #fff;
      font-size: 0.85rem;
      padding: 10px 8px;
    }
    .sup-input::placeholder { color: rgba(255,255,255,0.35); }

    /* ── Responsive ────────────────────────────────── */
    @media (max-width: 600px) {
      .goals-container { padding: 16px 12px 80px; }
      .goals-header h1 { font-size: 1.3rem; }
      .goals-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class GoalsComponent implements OnInit, OnDestroy {
  private apiUrl = environment.apiUrl;
  private token = () => localStorage.getItem('access_token');

  goals: Goal[] = [];
  alerts: Alert[] = [];
  goalsLoading = true;
  alertsLoading = true;
  pushLoading = false;
  pushGranted = false;

  supportOpen = false;
  supportMessage = '';
  supportMessages: { text: string, isUser: boolean }[] = [
    { text: '¡Hola! Soy el asistente de Caracas Portafolio 👋 ¿En qué puedo ayudarte?', isUser: false }
  ];

  // Real-time market data
  marketBoard: Record<string, any> = {};
  private wsSub: Subscription | null = null;
  private alertsTriggered = new Set<number>();

  constructor(
    private http: HttpClient,
    private dialog: MatDialog,
    private snack: MatSnackBar,
    private cdr: ChangeDetectorRef,
    private bvcSocket: BvcSocketService
  ) { }

  ngOnInit(): void {
    this.checkPushStatus();
    this.loadGoals();
    this.loadAlerts();
    this.bvcSocket.connect();
    this.wsSub = this.bvcSocket.stocksMap$.subscribe(board => {
      this.marketBoard = board;
      this.checkAlertConditions(board);
    });
  }

  ngOnDestroy(): void {
    this.wsSub?.unsubscribe();
  }

  /** Get live price for a symbol */
  livePrice(symbol: string): number | null {
    const tick = this.marketBoard[symbol];
    return tick?.PRECIO ?? null;
  }

  /** Check if live prices hit any alert conditions */
  private checkAlertConditions(board: Record<string, any>) {
    for (const alert of this.alerts) {
      if (this.alertsTriggered.has(alert.id)) continue;
      const tick = board[alert.stock_symbol];
      if (!tick?.PRECIO) continue;
      const price = tick.PRECIO;
      const bcv = 36; // approximate
      const priceUsd = price / bcv;
      
      let triggered = false;
      if (alert.condition_type === 'above' && priceUsd >= alert.condition_value) triggered = true;
      if (alert.condition_type === 'below' && priceUsd <= alert.condition_value) triggered = true;
      
      if (triggered) {
        this.alertsTriggered.add(alert.id);
        const emoji = alert.condition_type === 'above' ? '📈' : '📉';
        this.snack.open(
          `${emoji} ${alert.stock_symbol} ${alert.condition_type === 'above' ? 'superó' : 'bajó de'} $${alert.condition_value.toFixed(2)} — ${alert.message || ''}`,
          'OK',
          { duration: 8000 }
        );
      }
    }
  }

  // ── Computed ─────────────────────────────────────────────────────────────────

  get achievedCount(): number {
    return this.goals.filter(g => g.is_achieved).length;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
  }

  isEmoji(str: string): boolean {
    // Simple: if first char code > 127 it's likely emoji
    return str.length > 0 && str.charCodeAt(0) > 127;
  }

  getIcon(goal: Goal): string {
    if (goal.icon) return goal.icon;
    const map: Record<string, string> = {
      porcentaje: 'trending_up',
      precio_objetivo: 'price_check',
      monto: 'savings',
      sueno: '🎯'
    };
    return map[goal.goal_type] || 'flag';
  }

  getTypeLabel(type: string): string {
    const map: Record<string, string> = {
      porcentaje: '% de ganancia en acción',
      precio_objetivo: 'Precio objetivo ($)',
      monto: 'Monto total ($)',
      sueno: 'Meta personal'
    };
    return map[type] || type;
  }

  private headers() {
    return { Authorization: `Bearer ${this.token()}`, 'Content-Type': 'application/json' };
  }

  // ── Goals API ─────────────────────────────────────────────────────────────────

  loadGoals(): void {
    this.goalsLoading = true;
    this.http.get<Goal[]>(`${this.apiUrl}/goals/`, { headers: this.headers() })
      .subscribe({
        next: (data) => { this.goals = data; this.goalsLoading = false; this.cdr.markForCheck(); },
        error: (e) => {
          console.error('Error loading goals:', e);
          this.goalsLoading = false;
          this.goals = [];
        }
      });
  }

  openCreateGoal(): void {
    const ref = this.dialog.open(CreateGoalDialogComponent, {
      panelClass: 'dark-dialog',
      backdropClass: 'dark-backdrop'
    });
    ref.afterClosed().subscribe(result => {
      if (result) this.createGoal(result);
    });
  }

  createGoal(data: any): void {
    this.http.post<Goal>(`${this.apiUrl}/goals/`, data, { headers: this.headers() })
      .subscribe({
        next: (goal) => {
          this.goals = [goal, ...this.goals];
          this.snack.open('✅ Objetivo creado', 'Cerrar', { duration: 3000 });
        },
        error: (e) => {
          console.error('Error creating goal:', e);
          this.snack.open('Error al crear objetivo', 'Cerrar', { duration: 3000 });
        }
      });
  }

  markAchieved(goal: Goal): void {
    this.http.put<Goal>(
      `${this.apiUrl}/goals/${goal.id}`,
      { is_achieved: true },
      { headers: this.headers() }
    ).subscribe({
      next: (updated) => {
        const idx = this.goals.findIndex(g => g.id === goal.id);
        if (idx !== -1) this.goals[idx] = { ...this.goals[idx], ...updated };
        this.snack.open('🏆 ¡Objetivo marcado como logrado!', 'Cerrar', { duration: 3000 });
        this.cdr.markForCheck();
      },
      error: () => this.snack.open('Error al actualizar objetivo', 'Cerrar', { duration: 3000 })
    });
  }

  deleteGoal(id: number): void {
    if (!confirm('¿Eliminar este objetivo?')) return;
    this.http.delete(`${this.apiUrl}/goals/${id}`, { headers: this.headers() })
      .subscribe({
        next: () => {
          this.goals = this.goals.filter(g => g.id !== id);
          this.snack.open('Objetivo eliminado', 'Cerrar', { duration: 2000 });
        },
        error: () => this.snack.open('Error al eliminar objetivo', 'Cerrar', { duration: 3000 })
      });
  }

  // ── Alerts API ────────────────────────────────────────────────────────────────

  loadAlerts(): void {
    this.alertsLoading = true;
    this.http.get<Alert[]>(`${this.apiUrl}/alerts/`, { headers: this.headers() })
      .subscribe({
        next: (data) => { this.alerts = data; this.alertsLoading = false; this.cdr.markForCheck(); },
        error: (e) => {
          console.error('Error loading alerts:', e);
          this.alertsLoading = false;
          this.alerts = [];
        }
      });
  }

  openCreateAlert(): void {
    const ref = this.dialog.open(CreateAlertDialogComponent, {
      panelClass: 'dark-dialog',
      backdropClass: 'dark-backdrop'
    });
    ref.afterClosed().subscribe(result => {
      if (result) this.createAlert(result);
    });
  }

  createAlert(data: any): void {
    this.http.post<Alert>(`${this.apiUrl}/alerts/`, data, { headers: this.headers() })
      .subscribe({
        next: (alert) => {
          this.alerts = [alert, ...this.alerts];
          this.snack.open('🔔 Alerta creada', 'Cerrar', { duration: 3000 });
        },
        error: (e) => {
          console.error('Error creating alert:', e);
          this.snack.open('Error al crear alerta', 'Cerrar', { duration: 3000 });
        }
      });
  }

  deleteAlert(id: number): void {
    if (!confirm('¿Eliminar esta alerta?')) return;
    this.http.delete(`${this.apiUrl}/alerts/${id}`, { headers: this.headers() })
      .subscribe({
        next: () => {
          this.alerts = this.alerts.filter(a => a.id !== id);
          this.snack.open('Alerta eliminada', 'Cerrar', { duration: 2000 });
        },
        error: () => this.snack.open('Error al eliminar alerta', 'Cerrar', { duration: 3000 })
      });
  }

  // ── PWA Push ──────────────────────────────────────────────────────────────────

  checkPushStatus(): void {
    if ('Notification' in window) {
      this.pushGranted = Notification.permission === 'granted';
    }
  }

  async subscribePush(): Promise<void> {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      this.snack.open('Las notificaciones push no son compatibles con tu navegador', 'Cerrar', { duration: 4000 });
      return;
    }

    this.pushLoading = true;

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        this.snack.open('Permiso de notificación denegado', 'Cerrar', { duration: 3000 });
        this.pushLoading = false;
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const vapidKey = environment.vapidPublicKey;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer
      });

      await this.http.post(
        `${this.apiUrl}/alerts/push/subscribe`,
        subscription.toJSON(),
        { headers: this.headers() }
      ).toPromise();

      this.pushGranted = true;
      this.snack.open('✅ Notificaciones push activadas', 'Cerrar', { duration: 3000 });
    } catch (err) {
      console.error('Push subscription error:', err);
      this.snack.open('Error al activar notificaciones push', 'Cerrar', { duration: 3000 });
    } finally {
      this.pushLoading = false;
    }
  }

  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
  }

  // ── Support chat ──────────────────────────────────────────────────────────────

  sendSupportMsg(): void {
    const msg = this.supportMessage.trim();
    if (!msg) return;
    this.supportMessages.push({ text: msg, isUser: true });
    this.supportMessage = '';
    const lower = msg.toLowerCase();
    let reply = 'Puedo ayudarte con: gráficos, transacciones, portafolio, alertas, objetivos, perfil, IA o libros de órdenes. ¿Sobre qué quieres saber?';
    if (lower.includes('grafic') || lower.includes('chart') || lower.includes('vela')) {
      reply = 'Puedes ver los gráficos en la sección Gráficos 📊. Accede desde el menú principal para ver velas, indicadores técnicos (RSI, MACD, EMA) y análisis con IA.';
    } else if (lower.includes('transacc') || lower.includes('compra') || lower.includes('venta')) {
      reply = 'En Transacciones puedes registrar tus compras y ventas de acciones de la BVC, importar desde Excel y ver el historial completo.';
    } else if (lower.includes('portafolio') || lower.includes('cartera') || lower.includes('posicion')) {
      reply = 'El Portafolio muestra tu posición actual en cada acción, ganancia/pérdida no realizada y resumen total en USD.';
    } else if (lower.includes('alerta')) {
      reply = 'Crea alertas de precio en esta sección (pestaña Alertas de Precio) para recibir notificaciones cuando una acción llegue al precio que defines.';
    } else if (lower.includes('objetivo') || lower.includes('meta') || lower.includes('goal')) {
      reply = 'Los Objetivos te permiten definir metas de inversión: % de ganancia, precio objetivo, monto total o metas personales (vacaciones, auto, etc.).';
    } else if (lower.includes('perfil') || lower.includes('riesgo') || lower.includes('profile')) {
      reply = 'En Perfil defines tu estilo de inversión: riesgo (conservador/moderado/agresivo), sectores preferidos, horizonte temporal y más.';
    } else if (lower.includes('ia') || lower.includes('inteligencia') || lower.includes('chat') || lower.includes('gemini')) {
      reply = 'El Chat con IA en /ai-chat usa Gemini para analizar acciones de la BVC, revisar tu portafolio y darte recomendaciones personalizadas según tu perfil.';
    } else if (lower.includes('libro') || lower.includes('orden')) {
      reply = 'En Libros de Órdenes (/libros) puedes ver las ofertas de compra y venta activas para cada acción de la BVC.';
    } else if (lower.includes('notificac') || lower.includes('push')) {
      reply = 'Activa las notificaciones push con el botón "Activar push" para recibir alertas de precio en tu dispositivo, incluso sin tener la app abierta.';
    }
    setTimeout(() => {
      this.supportMessages.push({ text: reply, isUser: false });
      this.cdr.markForCheck();
    }, 400);
  }

  async unsubscribePush(): Promise<void> {
    this.pushLoading = true;
    try {
      // Unsub from browser
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
      // Remove from backend
      this.http.delete(`${this.apiUrl}/alerts/push/unsubscribe`, { headers: this.headers() })
        .subscribe({ error: (e) => console.warn('Backend unsubscribe error:', e) });

      this.pushGranted = false;
      this.snack.open('🔕 Notificaciones push desactivadas', 'Cerrar', { duration: 3000 });
      this.cdr.markForCheck();
    } catch (e) {
      this.snack.open('Error al desactivar notificaciones', 'Cerrar', { duration: 3000 });
    } finally {
      this.pushLoading = false;
    }
  }
}
