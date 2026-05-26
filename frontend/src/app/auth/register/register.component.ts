import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import { LegalModalComponent } from '../legal-modal/legal-modal.component';
import { environment } from '../../../environments/environment';

declare const google: any;

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSnackBarModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatCheckboxModule,
    MatDialogModule
  ],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss']
})
export class RegisterComponent implements OnInit {
  registerForm: FormGroup;
  loading = false;
  emailSent = false;
  registeredEmail = '';
  resendLoading = false;
  googleClientId = environment.googleClientId;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private snackBar: MatSnackBar,
    private router: Router,
    private dialog: MatDialog,
    private http: HttpClient
  ) {
    this.registerForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      accepted_terms: [false, [Validators.requiredTrue]]
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
      const btn = document.getElementById('google-signup-btn');
      if (btn) {
        google.accounts.id.renderButton(btn, {
          theme: 'filled_black',
          size: 'large',
          width: btn.offsetWidth || 360,
          text: 'signup_with',
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
        this.snackBar.open('¡Cuenta creada con Google! 🎉', 'Cerrar', { duration: 3000 });
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.loading = false;
        this.snackBar.open(err.error?.detail || 'Error con Google Sign-In', 'Cerrar', { duration: 5000 });
      }
    });
  }

  onAppleLogin(): void {
    this.snackBar.open('Apple Sign-In requiere configuración en Apple Developer — próximamente', 'OK', { duration: 4000 });
  }

  onSubmit(): void {
    if (this.registerForm.valid && !this.loading) {
      this.loading = true;
      this.registeredEmail = this.registerForm.value.email;

      this.authService.register(this.registerForm.value).subscribe({
        next: () => {
          this.loading = false;
          this.emailSent = true;
        },
        error: (error) => {
          this.loading = false;
          this.snackBar.open(
            'Error: ' + (error.error?.detail || 'No se pudo crear la cuenta'),
            'Cerrar',
            { duration: 5000 }
          );
        }
      });
    }
  }

  resendVerification(): void {
    if (this.resendLoading || !this.registeredEmail) return;
    this.resendLoading = true;
    this.http.post(`${environment.apiUrl}/auth/resend-verification`, { email: this.registeredEmail }).subscribe({
      next: () => {
        this.resendLoading = false;
        this.snackBar.open('Correo reenviado. Revisa tu bandeja de entrada.', 'OK', { duration: 4000 });
      },
      error: () => {
        this.resendLoading = false;
        this.snackBar.open('No se pudo reenviar. Intenta más tarde.', 'OK', { duration: 4000 });
      }
    });
  }

  showTerms(event: Event): void {
    event.preventDefault();
    this.dialog.open(LegalModalComponent, {
      data: { type: 'terms' },
      maxWidth: '600px',
      panelClass: 'dark-dialog-panel'
    });
  }

  showPrivacy(event: Event): void {
    event.preventDefault();
    this.dialog.open(LegalModalComponent, {
      data: { type: 'privacy' },
      maxWidth: '600px',
      panelClass: 'dark-dialog-panel'
    });
  }
}