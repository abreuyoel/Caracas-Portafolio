import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-confirm-delete-dialog',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatDialogModule],
  template: `
    <div class="confirm-dialog">
      <div class="dialog-icon">
        <mat-icon>delete_forever</mat-icon>
      </div>
      <h2 class="dialog-title">Eliminar Transacción</h2>
      <p class="dialog-msg">Esta acción no se puede deshacer. La transacción será eliminada permanentemente.</p>
      <div class="dialog-actions">
        <button mat-stroked-button (click)="ref.close(false)" class="cancel-btn">
          <mat-icon>close</mat-icon> Cancelar
        </button>
        <button mat-raised-button (click)="ref.close(true)" class="delete-btn">
          <mat-icon>delete_forever</mat-icon> Eliminar
        </button>
      </div>
    </div>
  `,
  styles: [`
    .confirm-dialog {
      background: #10172a;
      padding: 32px 28px 24px;
      border-radius: 16px;
      text-align: center;
      min-width: 300px;
      max-width: 380px;
    }
    .dialog-icon {
      width: 64px; height: 64px;
      background: rgba(255,77,106,0.15);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 20px;
      mat-icon { font-size: 32px; width: 32px; height: 32px; color: #ff4d6a; }
    }
    .dialog-title { color: #fff; font-size: 1.25rem; font-weight: 700; margin: 0 0 12px; }
    .dialog-msg { color: rgba(255,255,255,0.6); font-size: 0.9rem; margin: 0 0 28px; line-height: 1.5; }
    .dialog-actions { display: flex; gap: 12px; justify-content: center; }
    .cancel-btn { color: rgba(255,255,255,0.7) !important; border-color: rgba(255,255,255,0.2) !important; border-radius: 8px !important; }
    .delete-btn { background: linear-gradient(135deg, #ff4d6a, #c0392b) !important; color: #fff !important; border-radius: 8px !important; }
  `]
})
export class ConfirmDeleteDialogComponent {
  constructor(public ref: MatDialogRef<ConfirmDeleteDialogComponent>) {}
}

interface Transaction {
  id: number;
  stock_symbol: string;
  order_type: string;
  quantity: number;
  avg_price: number;
  amount_usd: number;
  transaction_date: string;
}

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatCardModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    MatDialogModule
  ],
  template: `
    <div class="transactions-container">
      <mat-toolbar color="primary" class="main-toolbar">
        <button mat-icon-button routerLink="/dashboard">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <span class="toolbar-title">Mis Transacciones</span>
        <span class="spacer"></span>
        
        <button mat-button [matMenuTriggerFor]="importMenu" class="import-btn">
          <mat-icon>file_upload</mat-icon>
          <span class="btn-text">Importar / Plantilla</span>
        </button>
        <mat-menu #importMenu="matMenu">
          <button mat-menu-item (click)="downloadTemplate()">
            <mat-icon>download</mat-icon>
            <span>Descargar Plantilla</span>
          </button>
          <button mat-menu-item (click)="fileInput.click()">
            <mat-icon>upload_file</mat-icon>
            <span>Subir Archivo Excel</span>
          </button>
          <input #fileInput type="file" accept=".xlsx" style="display:none" (change)="onFileSelected($event)">
        </mat-menu>
        
        <button mat-flat-button class="export-data-btn" (click)="exportToExcel()">
          <mat-icon>sim_card_download</mat-icon>
          <span class="btn-text">Exportar Mis Datos</span>
        </button>
 
        <button mat-raised-button color="accent" routerLink="/transactions/new" class="new-btn">
          <mat-icon>add</mat-icon>
          <span class="btn-text">Nueva</span>
        </button>
      </mat-toolbar>

      <div class="content">
        <mat-card class="table-card">
          <mat-card-header>
            <mat-card-title>📋 Historial de Transacciones</mat-card-title>
          </mat-card-header>

          <mat-card-content>
            @if (loading) {
              <div class="loading">
                <mat-spinner diameter="40"></mat-spinner>
                <p>Cargando transacciones...</p>
              </div>
            } @else if (transactions.length === 0) {
              <div class="empty-state">
                <mat-icon>inbox</mat-icon>
                <h3>No hay transacciones</h3>
                <p>Comienza agregando tu primera compra o venta</p>
                <button mat-raised-button color="primary" routerLink="/transactions/new">
                  <mat-icon>add</mat-icon>
                  Nueva Transacción
                </button>
              </div>
            } @else {
              <div class="table-responsive">
                <table mat-table [dataSource]="transactions" class="mat-elevation-z8">
                  <ng-container matColumnDef="date">
                    <th mat-header-cell *matHeaderCellDef> Fecha </th>
                    <td mat-cell *matCellDef="let element"> {{element.transaction_date | date:'dd/MM/yyyy'}} </td>
                  </ng-container>

                  <ng-container matColumnDef="symbol">
                    <th mat-header-cell *matHeaderCellDef> Acción </th>
                    <td mat-cell *matCellDef="let element">
                      <span class="symbol-chip">{{element.stock_symbol || '—'}}</span>
                    </td>
                  </ng-container>

                  <ng-container matColumnDef="type">
                    <th mat-header-cell *matHeaderCellDef> Tipo </th>
                    <td mat-cell *matCellDef="let element">
                      <span class="badge" [class.buy]="element.order_type === 'Compra'" [class.sell]="element.order_type === 'Venta'">
                        {{ element.order_type === 'Compra' ? '▲' : '▼' }} {{element.order_type}}
                      </span>
                    </td>
                  </ng-container>

                  <ng-container matColumnDef="quantity">
                    <th mat-header-cell *matHeaderCellDef> Cantidad </th>
                    <td mat-cell *matCellDef="let element"> {{element.quantity | number}} </td>
                  </ng-container>

                  <ng-container matColumnDef="price">
                    <th mat-header-cell *matHeaderCellDef> Precio Prom. </th>
                    <td mat-cell *matCellDef="let element"> Bs. {{element.avg_price | number:'1.2-4'}} </td>
                  </ng-container>

                  <ng-container matColumnDef="total">
                    <th mat-header-cell *matHeaderCellDef> Total (USD) </th>
                    <td mat-cell *matCellDef="let element">
                      <span class="usd-amount">{{element.amount_usd | currency:'USD':'symbol':'1.2-2'}}</span>
                    </td>
                  </ng-container>

                  <ng-container matColumnDef="actions">
                    <th mat-header-cell *matHeaderCellDef> Acciones </th>
                    <td mat-cell *matCellDef="let element">
                      <button mat-icon-button [matMenuTriggerFor]="menu">
                        <mat-icon>more_vert</mat-icon>
                      </button>
                      <mat-menu #menu="matMenu">
                        <button mat-menu-item (click)="editTransaction(element.id)">
                          <mat-icon>edit</mat-icon>
                          <span>Editar</span>
                        </button>
                        <button mat-menu-item (click)="deleteTransaction(element.id)" class="delete-option">
                          <mat-icon class="delete-icon">delete</mat-icon>
                          <span class="delete-text">Eliminar</span>
                        </button>
                      </mat-menu>
                    </td>
                  </ng-container>

                  <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
                  <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
                </table>
              </div>
            }
          </mat-card-content>
        </mat-card>
      </div>
    </div>
  `,
  styles: [`
    :host {
      --bg-deep: #080d18;
      --surface: rgba(255,255,255,0.04);
      --surface-h: rgba(255,255,255,0.07);
      --border: rgba(255,255,255,0.08);
      --primary: #6366f1;
      --primary-glow: rgba(99,102,241,0.25);
      --text: #e8eaf6;
      --text-muted: rgba(232,234,246,0.55);
    }

    .transactions-container {
      min-height: 100vh;
      background: var(--bg-deep);
      background-image:
        radial-gradient(ellipse 60% 40% at 15% 10%, rgba(99,102,241,0.12) 0%, transparent 60%),
        radial-gradient(ellipse 50% 35% at 85% 80%, rgba(139,92,246,0.10) 0%, transparent 60%);
    }

    /* ── Toolbar ─────────────────────────────────────────────── */
    .main-toolbar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(8,13,24,0.85) !important;
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
      height: 64px;
      padding: 0 20px;
    }

    .toolbar-title {
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--text) !important;
      letter-spacing: 0.02em;
    }

    .spacer { flex: 1 1 auto; }

    .import-btn { color: var(--text-muted) !important; margin-right: 8px; }
 
    .export-data-btn {
      background: rgba(16,185,129,0.1) !important;
      color: #34d399 !important;
      border: 1px solid rgba(16,185,129,0.3) !important;
      border-radius: 10px !important;
      font-weight: 600;
      margin-right: 12px;
    }
    .export-data-btn:hover { background: rgba(16,185,129,0.2) !important; }

    .new-btn {
      background: linear-gradient(135deg, var(--primary), #8b5cf6) !important;
      color: #fff !important;
      border-radius: 10px !important;
      font-weight: 600;
      box-shadow: 0 4px 15px rgba(99,102,241,0.3) !important;
    }
 
    .btn-text { margin-left: 4px; }
    @media (max-width: 600px) { .btn-text { display: none; } }

    /* ── Layout ──────────────────────────────────────────────── */
    .content {
      padding: 28px 24px;
      max-width: 1300px;
      margin: 0 auto;
    }
    @media (max-width: 600px) { .content { padding: 16px 12px; } }

    /* ── Card ────────────────────────────────────────────────── */
    .table-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 4px 32px rgba(0,0,0,0.35);
    }

    ::ng-deep .table-card mat-card-header {
      padding: 20px 24px 16px;
      border-bottom: 1px solid var(--border);
      background: rgba(99,102,241,0.06);
    }

    ::ng-deep .table-card mat-card-title {
      color: var(--text) !important;
      font-size: 1.15rem !important;
      font-weight: 700 !important;
    }

    ::ng-deep .table-card mat-card-content {
      padding: 0 !important;
    }

    /* ── Table ───────────────────────────────────────────────── */
    .table-responsive {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }

    ::ng-deep .mat-mdc-table {
      width: 100%;
      min-width: 680px;
      background: transparent !important;
    }

    ::ng-deep .mat-mdc-header-row {
      background: rgba(99,102,241,0.18) !important;
    }

    ::ng-deep .mat-mdc-header-cell {
      color: #c7d2fe !important;
      font-weight: 700 !important;
      font-size: 0.78rem !important;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      border-bottom: 1px solid rgba(255,255,255,0.1) !important;
      padding: 16px !important;
      white-space: nowrap;
    }

    ::ng-deep .mat-mdc-row {
      background: transparent !important;
      transition: background 0.18s ease;
    }

    ::ng-deep .mat-mdc-row:hover {
      background: rgba(99,102,241,0.10) !important;
    }

    ::ng-deep .mat-mdc-cell {
      color: var(--text) !important;
      border-bottom: 1px solid var(--border) !important;
      padding: 14px 16px !important;
      font-size: 0.93rem !important;
      white-space: nowrap;
    }

    ::ng-deep .mat-mdc-cell strong {
      color: #ffffff !important;
      font-weight: 600;
    }

    /* ── Badges ──────────────────────────────────────────────── */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 14px;
      border-radius: 20px;
      font-size: 0.82rem;
      font-weight: 700;
      min-width: 84px;
      justify-content: center;
    }

    .badge.buy {
      background: rgba(16,185,129,0.18);
      color: #34d399 !important;
      border: 1px solid rgba(16,185,129,0.4);
    }

    .badge.sell {
      background: rgba(239,68,68,0.18);
      color: #f87171 !important;
      border: 1px solid rgba(239,68,68,0.4);
    }

    /* ── Symbol chip ─────────────────────────────────────────── */
    .symbol-chip {
      display: inline-block;
      background: rgba(99,102,241,0.2);
      color: #a5b4fc !important;
      border: 1px solid rgba(99,102,241,0.35);
      border-radius: 8px;
      padding: 3px 10px;
      font-weight: 700;
      font-size: 0.88rem;
      letter-spacing: 0.04em;
    }

    /* ── USD total ───────────────────────────────────────────── */
    .usd-amount {
      color: #67e8f9 !important;
      font-weight: 600;
    }

    /* ── Brokerage cell ──────────────────────────────────────── */
    .brokerage-cell {
      color: var(--text-muted) !important;
      font-size: 0.82rem !important;
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ── States ──────────────────────────────────────────────── */
    .loading, .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 80px 20px;
      gap: 20px;
      text-align: center;
    }

    .loading p, .empty-state p {
      color: var(--text-muted);
      margin: 0;
    }

    .empty-state mat-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      color: rgba(99,102,241,0.4);
    }

    .empty-state h3 {
      color: var(--text);
      margin: 0;
      font-size: 1.2rem;
    }

    /* ── Actions menu ────────────────────────────────────────── */
    ::ng-deep .mat-mdc-menu-panel {
      background: #0f1729 !important;
      border: 1px solid var(--border) !important;
      border-radius: 12px !important;
    }

    ::ng-deep .mat-mdc-menu-item {
      color: var(--text) !important;
    }

    ::ng-deep .mat-mdc-menu-item:hover {
      background: rgba(99,102,241,0.12) !important;
    }

    .delete-option { color: #f87171 !important; }
    .delete-option ::ng-deep mat-icon, .delete-option ::ng-deep span { color: #f87171 !important; }

    @media (max-width: 600px) {
      ::ng-deep .mat-mdc-header-cell,
      ::ng-deep .mat-mdc-cell { padding: 10px 10px !important; font-size: 0.82rem !important; }
    }
  `]
})
export class TransactionsComponent implements OnInit {
  displayedColumns: string[] = ['date', 'symbol', 'type', 'quantity', 'price', 'total', 'actions'];
  transactions: Transaction[] = [];
  loading = true;
  uploading = false;
  
  private apiUrl = environment.apiUrl;

  constructor(
    private http: HttpClient,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadTransactions();
  }

  async loadTransactions(): Promise<void> {
    this.loading = true;
    try {
      const token = localStorage.getItem('access_token');
      
      const response = await this.http.get<Transaction[]>(
        `${this.apiUrl}/transactions`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      ).toPromise();

      this.transactions = response || [];
      console.log('📊 Transacciones cargadas:', this.transactions.length);
    } catch (error) {
      console.error('❌ Error cargando transacciones:', error);
      this.snackBar.open('Error al cargar transacciones', 'Cerrar', { duration: 3000 });
    } finally {
      this.loading = false;
    }
  }

  downloadTemplate(): void {
  const token = localStorage.getItem('access_token');
  if (!token) {
    this.snackBar.open('No hay token de autenticación', 'Cerrar', { duration: 3000 });
    return;
  }

  this.http.get(
    `${this.apiUrl}/transactions/template`,
    {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'blob'
    }
  ).subscribe({
    next: (blob) => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'plantilla_transacciones.xlsx';
      link.click();
      window.URL.revokeObjectURL(url);
      this.snackBar.open('✅ Plantilla descargada', 'Cerrar', { duration: 3000 });
    },
    error: (error) => {
      console.error('❌ Error downloading template:', error);
      
      // Si es un error 422, intenta leer el cuerpo como texto (porque responseType es blob)
      if (error.status === 422 && error.error instanceof Blob) {
        const reader = new FileReader();
        reader.onload = () => {
          const errorText = reader.result as string;
          console.error('Detalle del error 422:', errorText);
          try {
            const errorJson = JSON.parse(errorText);
            this.snackBar.open(`Error: ${errorJson.detail?.[0]?.msg || 'Validación fallida'}`, 'Cerrar', { duration: 8000 });
          } catch {
            this.snackBar.open(`Error 422: ${errorText}`, 'Cerrar', { duration: 8000 });
          }
        };
        reader.readAsText(error.error);
      } else {
        this.snackBar.open('Error al descargar plantilla: ' + (error.status || 'Error desconocido'), 'Cerrar', { duration: 5000 });
      }
    }
  });
}

  exportToExcel(): void {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    this.snackBar.open('Generando archivo de exportación...', 'Cerrar', { duration: 2000 });
    
    this.http.get(
      `${this.apiUrl}/transactions/export`,
      {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob'
      }
    ).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `mis_transacciones_${new Date().toISOString().split('T')[0]}.xlsx`;
        link.click();
        window.URL.revokeObjectURL(url);
        this.snackBar.open('✅ Exportación completada', 'Cerrar', { duration: 3000 });
      },
      error: (error) => {
        console.error('Error exporting:', error);
        this.snackBar.open('Error al exportar datos', 'Cerrar', { duration: 3000 });
      }
    });
  }

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (!file) return;
    
    const confirmed = confirm(
      `¿Estás seguro de subir el archivo "${file.name}"?\n\n` +
      `Se importarán todas las transacciones válidas del archivo.`
    );
    
    if (!confirmed) {
      event.target.value = '';
      return;
    }
    
    this.uploadFile(file);
    event.target.value = '';
  }

  uploadFile(file: File): void {
    this.uploading = true;
    
    try {
      const token = localStorage.getItem('access_token');
      const formData = new FormData();
      formData.append('file', file);
      
      this.http.post<any>(
        `${this.apiUrl}/transactions/import`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      ).subscribe({
        next: (response) => {
          this.uploading = false;
          
          if (response.success) {
            this.snackBar.open(
              `✅ ${response.imported_count} transacciones importadas`,
              'Cerrar',
              { duration: 5000 }
            );
            
            if (response.errors && response.errors.length > 0) {
              const errorCount = response.errors.length;
              this.snackBar.open(
                `⚠️ ${errorCount} filas con errores`,
                'Ver',
                { duration: 10000 }
              ).onAction().subscribe(() => {
                console.error('Errores de importación:', response.errors);
                alert('Errores:\n' + response.errors.map((e: any) => `Fila ${e.row}: ${e.error}`).join('\n'));
              });
            }
            
            this.loadTransactions();
          } else {
            this.snackBar.open(
              '❌ No se pudieron importar transacciones',
              'Cerrar',
              { duration: 5000 }
            );
          }
        },
        error: (error) => {
          this.uploading = false;
          console.error('❌ Error uploading file:', error);
          
          let errorMessage = 'Error al importar archivo';
          if (error.error?.detail) {
            errorMessage = error.error.detail;
          }
          
          this.snackBar.open(errorMessage, 'Cerrar', { duration: 5000 });
        }
      });
    } catch (error) {
      this.uploading = false;
      console.error('❌ Error:', error);
      this.snackBar.open('Error al importar archivo', 'Cerrar', { duration: 3000 });
    }
  }

  editTransaction(id: number): void {
    this.router.navigate(['/transactions/new'], { queryParams: { edit: id } });
  }

  async deleteTransaction(id: number): Promise<void> {
    const ref = this.dialog.open(ConfirmDeleteDialogComponent, {
      panelClass: 'dark-dialog-panel',
      backdropClass: 'dark-backdrop'
    });
    const confirmed = await ref.afterClosed().toPromise();
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('access_token');
      
      await this.http.delete(
        `${this.apiUrl}/transactions/${id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      ).toPromise();

      this.snackBar.open('✅ Transacción eliminada', 'Cerrar', { duration: 3000 });
      this.loadTransactions();
    } catch (error) {
      console.error('❌ Error eliminando transacción:', error);
      this.snackBar.open('Error al eliminar transacción', 'Cerrar', { duration: 3000 });
    }
  }
}