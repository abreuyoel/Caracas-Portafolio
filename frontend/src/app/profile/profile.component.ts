import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss']
})
export class ProfileComponent implements OnInit {
  profileForm: FormGroup;
  loading = false;
  profileLoaded = false;
  hasProfile = false;
  isEditMode = false;   // true cuando el usuario está editando un perfil existente
  profile: any = null;
  private apiUrl = environment.apiUrl;

  expectedReturnOptions = [
    { value: 10,  emoji: '🛡️', label: '10% anual',   sub: 'Conservador' },
    { value: 20,  emoji: '⚖️', label: '20% anual',   sub: 'Moderado' },
    { value: 40,  emoji: '📈', label: '40% anual',   sub: 'Crecimiento' },
    { value: 70,  emoji: '🚀', label: '70% anual',   sub: 'Agresivo' },
    { value: 100, emoji: '⚡', label: '100%+ anual', sub: 'Especulativo' },
  ];

  dropReactionOptions = [
    { value: 'vender_todo',    emoji: '😱', label: 'Vendo todo inmediatamente' },
    { value: 'vender_parcial', emoji: '😰', label: 'Vendo una parte para protegerme' },
    { value: 'mantener',       emoji: '😐', label: 'Mantengo y espero recuperación' },
    { value: 'comprar_mas',    emoji: '😎', label: 'Compro más aprovechando el precio bajo' },
    { value: 'apalancarme',    emoji: '🚀', label: 'Me apalanco y compro con margen' },
  ];

  sectorOptions = [
    { value: 'banca',            label: '🏦 Banca' },
    { value: 'manufactura',      label: '🏭 Manufactura' },
    { value: 'petroleo',         label: '⛽ Petróleo y Gas' },
    { value: 'telecomunicaciones', label: '📡 Telecomunicaciones' },
    { value: 'alimentos',        label: '🍽️ Alimentos y Bebidas' },
    { value: 'seguros',          label: '🛡️ Seguros y Fondos' },
    { value: 'quimica',          label: '🧪 Química e Industria' },
    { value: 'todos',            label: '✅ Todos los sectores' },
  ];

  selectedPreferred: Set<string> = new Set();
  selectedAvoided:   Set<string> = new Set();

  isSectorSelected(value: string, type: 'preferred' | 'avoided'): boolean {
    return type === 'preferred'
      ? this.selectedPreferred.has(value)
      : this.selectedAvoided.has(value);
  }

  toggleSector(value: string, type: 'preferred' | 'avoided'): void {
    const set = type === 'preferred' ? this.selectedPreferred : this.selectedAvoided;
    if (value === 'todos' && type === 'preferred') {
      set.clear();
      set.add('todos');
    } else if (value === 'ninguno' && type === 'avoided') {
      set.clear();
      set.add('ninguno');
    } else {
      set.delete(type === 'preferred' ? 'todos' : 'ninguno');
      if (set.has(value)) set.delete(value);
      else set.add(value);
    }
    const joined = Array.from(set).join(',');
    this.profileForm.patchValue(
      type === 'preferred' ? { preferred_sectors: joined } : { avoided_sectors: joined }
    );
  }

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private snackBar: MatSnackBar
  ) {
    this.profileForm = this.fb.group({
      risk_profile: ['moderado', Validators.required],
      investment_goal: ['crecimiento_moderado', Validators.required],
      time_horizon: ['mediano_plazo', Validators.required],
      experience_level: [5, [Validators.required, Validators.min(1), Validators.max(10)]],
      max_loss_tolerance: [10, [Validators.required, Validators.min(0), Validators.max(100)]],
      expected_return: [15, [Validators.required, Validators.min(0), Validators.max(200)]],
      available_capital: [0, [Validators.required, Validators.min(0)]],
      portfolio_drop_reaction: ['mantener', Validators.required],
      allows_volatile_stocks: [true],
      allows_margin_trading: [false],
      preferred_sectors: [''],
      avoided_sectors: [''],
      daily_notifications: [true],
      opportunity_alerts: [true],
      risk_alerts: [true],
      notification_frequency: ['daily']
    });
  }

  ngOnInit(): void {
    this.loadProfile();
  }

  async loadProfile(): Promise<void> {
    try {
      const token = localStorage.getItem('access_token');
      const response = await this.http.get<any>(
        `${this.apiUrl}/user-profile`,
        { headers: { Authorization: `Bearer ${token}` } }
      ).toPromise();

      this.profileLoaded = true;
      this.hasProfile = !!response;
      this.isEditMode = false;

      if (response) {
        this.profile = response;
        this.profileForm.patchValue(response);
        if (response.preferred_sectors) {
          this.selectedPreferred = new Set(response.preferred_sectors.split(',').map((s: string) => s.trim()).filter(Boolean));
        }
        if (response.avoided_sectors) {
          this.selectedAvoided = new Set(response.avoided_sectors.split(',').map((s: string) => s.trim()).filter(Boolean));
        }
      }
    } catch (error) {
      console.error('❌ Error loading profile:', error);
      this.profileLoaded = true;
      this.hasProfile = false;
    }
  }

  async submitProfile(): Promise<void> {
    if (this.profileForm.invalid || this.loading) return;

    this.loading = true;

    try {
      const token = localStorage.getItem('access_token');
      // Usar PUT si ya existe perfil (ya sea nuevo o editando uno existente)
      const method = (this.hasProfile || this.isEditMode) ? 'put' : 'post';

      await this.http.request(method,
        `${this.apiUrl}/user-profile`,
        {
          body: this.profileForm.value,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
        }
      ).toPromise();

      this.loading = false;
      this.snackBar.open('✅ Perfil guardado exitosamente', 'Cerrar', { duration: 3000 });
      this.loadProfile();
    } catch (error) {
      this.loading = false;
      console.error('❌ Error saving profile:', error);
      this.snackBar.open('Error al guardar perfil', 'Cerrar', { duration: 3000 });
    }
  }

  async updateNotifications(field: string, value: boolean): Promise<void> {
    try {
      const token = localStorage.getItem('access_token');
      await this.http.put(
        `${this.apiUrl}/user-profile`,
        { [field]: value },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      ).toPromise();
      this.snackBar.open('✅ Preferencia actualizada', 'Cerrar', { duration: 2000 });
      // Actualizar perfil localmente
      if (this.profile) {
        this.profile[field] = value;
      }
    } catch (error) {
      console.error('❌ Error updating notifications:', error);
      this.snackBar.open('Error al actualizar', 'Cerrar', { duration: 3000 });
    }
  }

  editProfile(): void {
    this.isEditMode = true;
    this.hasProfile = false;  // oculta el display y muestra el form
  }

  formatInvestmentGoal(goal: string): string {
    if (!goal) return '';
    return goal.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }
}