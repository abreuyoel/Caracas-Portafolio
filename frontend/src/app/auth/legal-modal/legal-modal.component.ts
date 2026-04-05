import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';

@Component({
  selector: 'app-legal-modal',
  standalone: true,
  imports: [
    CommonModule, 
    MatDialogModule, 
    MatButtonModule, 
    MatIconModule, 
    MatDividerModule
  ],
  template: `
    <div class="legal-modal-container">
      <header class="modal-header">
        <div class="title-group">
          <mat-icon color="primary">{{ data.type === 'terms' ? 'gavel' : 'security' }}</mat-icon>
          <h2 mat-dialog-title>{{ data.type === 'terms' ? 'Términos de Servicio' : 'Política de Privacidad' }}</h2>
        </div>
        <button mat-icon-button (click)="close()" class="close-btn">
          <mat-icon>close</mat-icon>
        </button>
      </header>

      <mat-dialog-content class="modal-content custom-scrollbar">
        <!-- TÉRMINOS DE SERVICIO -->
        <div *ngIf="data.type === 'terms'" class="legal-text">
          <p class="intro">Bienvenido a la red de inversores de <strong>Caracas Portafolio</strong>. Al utilizar nuestra plataforma, aceptas cumplir con las siguientes reglas de la comunidad.</p>

          <div class="disclaimer-alert">
            <mat-icon>warning</mat-icon>
            <p><strong>Caracas Portafolio</strong> es una plataforma independiente y no está afiliada, asociada, autorizada ni respaldada oficialmente por la Bolsa de Valores de Caracas (BVC).</p>
          </div>
          
          <h3>1. Reglas de la Comunidad</h3>
          <p>Esta es una red profesional. Se prohíbe el lenguaje ofensivo, la manipulación de mercado deliberada y el spam. El contenido que compartas es tu responsabilidad.</p>
          
          <h3>2. Propiedad Intelectual</h3>
          <p>Toda la tecnología y algoritmos de análisis son propiedad de Caracas Portafolio. Tus datos de trading te pertenecen, pero nos otorgas permiso para mostrarlos según la configuración de privacidad que elijas.</p>
          
          <h3>3. Responsabilidad Financiera</h3>
          <p>Toda la información mostrada es con fines educativos e informativos. <strong>No constituye asesoría financiera</strong>. Los resultados pasados no garantizan rendimientos futuros.</p>
          
          <h3>4. Suspensión de Cuenta</h3>
          <p>Nos reservamos el derecho de suspender perfiles que violen la integridad del ecosistema o intenten vulnerar la seguridad de otros usuarios.</p>
          
          <div class="note-box">
            <p><strong>Última actualización:</strong> 4 de Abril de 2026</p>
          </div>
        </div>

        <!-- POLÍTICA DE PRIVACIDAD -->
        <div *ngIf="data.type === 'privacy'" class="legal-text">
          <div class="disclaimer-alert">
            <mat-icon>security</mat-icon>
            <p>En cumplimiento con la <strong>Constitución de la República Bolivariana de Venezuela (Art. 28 y 60)</strong>, Caracas Portafolio garantiza tu derecho a la autodeterminación informativa y Habeas Data.</p>
          </div>

          <p class="intro">Esta política describe qué información recopilamos, cómo la utilizamos y los derechos que tienes sobre tus datos personales.</p>
          
          <h3>1. Información que recopilamos</h3>
          <p><strong>1.1 Datos de cuenta:</strong> Al registrarte mediante correo electrónico o Google OAuth, recopilamos tu dirección de email, nombre para mostrar e identificador único de usuario.</p>
          <p><strong>1.2 Datos de portafolio:</strong> Si utilizas la función de portafolio, almacenamos la información que ingresas voluntariamente: Transacciones de acciones (emisora, cantidad, precio, fecha, comisiones, notas) y tenencias.</p>
          <p><strong>1.3 Analíticas:</strong> Utilizamos herramientas anónimas para mejorar la plataforma. Respetamos la cabecera "Do Not Track" de tu navegador.</p>
          
          <h3>2. Cómo utilizamos tu información</h3>
          <p>Usamos tus datos exclusivamente para autenticar tu cuenta, mostrar tu portafolio, enviar notificaciones autorizadas y mejorar la plataforma mediante analíticas anónimas. <strong>No vendemos tus datos a terceros.</strong></p>
          
          <h3>3. Seguridad y Cifrado</h3>
          <p>Tus datos se almacenan en servidores seguros. Implementamos <strong>cifrado a nivel de campo (AES-GCM)</strong> para información sensible. El acceso interno a tus transacciones personales está restringido technológicamente.</p>
          
          <h3>4. Tus Derechos (ARCO)</h3>
          <p>Tienes derecho a acceder, rectificar y solicitar la eliminación de tu cuenta y datos asociados en cualquier momento.</p>
          
          <div class="contact-box">
             <mat-icon>email</mat-icon>
             <a href="mailto:privacy@caracasportafolio.com">privacy@caracasportafolio.com</a>
          </div>

          <div class="note-box">
            <p><strong>Última actualización:</strong> 4 de Abril de 2026</p>
          </div>
        </div>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-flat-button color="primary" (click)="close()">Entendido</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .legal-modal-container {
      background: #0f172a;
      color: #f8fafc;
      padding: 16px;
      font-family: 'Space Grotesk', sans-serif;
    }

    .disclaimer-alert {
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid rgba(245, 158, 11, 0.25);
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 0.85rem;
      line-height: 1.4;
      color: #fca311;

      mat-icon { font-size: 20px; flex-shrink: 0; }
      p { margin: 0; }
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;

      .title-group {
        display: flex;
        align-items: center;
        gap: 12px;
        
        h2 { margin: 0; font-size: 1.25rem; font-weight: 600; }
        mat-icon { font-size: 24px; }
      }
    }

    .modal-content {
      max-height: 70vh;
      margin: 16px 0;
      padding-right: 12px;

      .legal-text {
        line-height: 1.6;
        font-size: 0.95rem;

        .intro { color: #94a3b8; font-size: 1rem; margin-bottom: 24px; }

        h3 { 
          color: #38bdf8; 
          font-size: 1.05rem; 
          margin: 24px 0 8px; 
          font-weight: 600;
        }

        p { margin-bottom: 16px; color: #cbd5e1; }

        .note-box {
          background: rgba(56, 189, 248, 0.1);
          border-left: 4px solid #38bdf8;
          padding: 12px 16px;
          margin-top: 32px;
          border-radius: 4px;
          p { margin: 0; font-size: 0.85rem; color: #94a3b8; }
        }

        .contact-box {
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgba(255, 255, 255, 0.05);
          padding: 12px;
          border-radius: 8px;
          margin: 16px 0;

          mat-icon { font-size: 18px; color: #38bdf8; }
          a { color: #38bdf8; text-decoration: none; font-weight: 500; }
        }
      }
    }

    .custom-scrollbar {
      &::-webkit-scrollbar { width: 6px; }
      &::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.05); }
      &::-webkit-scrollbar-thumb { background: rgba(56, 189, 248, 0.3); border-radius: 10px; }
      &::-webkit-scrollbar-thumb:hover { background: rgba(56, 189, 248, 0.5); }
    }
  `]
})
export class LegalModalComponent {
  constructor(
    public dialogRef: MatDialogRef<LegalModalComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { type: 'terms' | 'privacy' }
  ) {}

  close(): void {
    this.dialogRef.close();
  }
}
