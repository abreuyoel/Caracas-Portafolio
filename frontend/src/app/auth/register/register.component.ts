import { Component } from '@angular/core';
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
import { AuthService } from '../../core/services/auth.service';
import { LegalModalComponent } from '../legal-modal/legal-modal.component';

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
export class RegisterComponent {
  registerForm: FormGroup;
  loading = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private snackBar: MatSnackBar,
    private router: Router,
    private dialog: MatDialog
  ) {
    this.registerForm = this.fb.group({
      username: ['', [Validators.required, Validators.minLength(3)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      accepted_terms: [false, [Validators.requiredTrue]]
    });
  }

  onSubmit(): void {
    if (this.registerForm.valid && !this.loading) {
      this.loading = true;

      this.authService.register(this.registerForm.value).subscribe({
        next: () => {
          this.loading = false;
          this.snackBar.open('¡Cuenta creada! Ahora inicia sesión', 'Cerrar', { duration: 3000 });
          this.router.navigate(['/auth/login']);
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