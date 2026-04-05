import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export interface OrderBookEntry {
  buy_volume: number;
  buy_price: number;
  sell_price: number;
  sell_volume: number;
}

@Component({
  selector: 'app-order-book-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>📖 Libro de Órdenes — <span style="color:#4c62ff">{{ data.symbol }}</span></h2>
    <mat-dialog-content>
      <div class="table-responsive" *ngIf="data.entries && data.entries.length > 0; else empty">
        <table class="order-book-table">
          <thead>
            <tr>
              <th>VOL. COMPRA</th>
              <th>PRECIO COMPRA</th>
              <th>PRECIO VENTA</th>
              <th>VOL. VENTA</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let entry of data.entries">
              <td class="buy-vol">{{ entry.buy_volume | number }}</td>
              <td class="buy-price">{{ entry.buy_price | number:'1.4-4' }}</td>
              <td class="sell-price">{{ entry.sell_price | number:'1.4-4' }}</td>
              <td class="sell-vol">{{ entry.sell_volume | number }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ng-template #empty>
        <div class="empty-state">Sin órdenes activas para {{ data.symbol }}</div>
      </ng-template>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cerrar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    h2[mat-dialog-title] { color: #fff; background: #080d18; margin: 0; padding: 20px 24px 16px; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 1.1rem; }
    mat-dialog-content { background: #080d18; padding: 16px 24px; }
    mat-dialog-actions { background: #080d18; border-top: 1px solid rgba(255,255,255,0.08); }
    mat-dialog-actions button { color: rgba(255,255,255,0.6); }
    .table-responsive { overflow-x: auto; }
    .order-book-table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; font-family: 'JetBrains Mono', monospace; }
    .order-book-table th, .order-book-table td { padding: 10px 12px; text-align: right; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 0.875rem; }
    .order-book-table th { background: rgba(255,255,255,0.04); font-weight: 600; text-align: center; color: rgba(255,255,255,0.55); font-size: 0.75rem; letter-spacing: 0.05em; text-transform: uppercase; }
    .order-book-table tr:hover td { background: rgba(255,255,255,0.03); }
    .buy-vol, .buy-price { background: rgba(29, 120, 70, 0.15); color: #2dd994; }
    .sell-price, .sell-vol { background: rgba(180, 40, 60, 0.15); color: #ff4d6a; }
    .empty-state { text-align: center; padding: 32px; color: rgba(255,255,255,0.38); font-size: 0.9rem; }
  `]
})
export class OrderBookDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<OrderBookDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { symbol: string; entries: OrderBookEntry[] }
  ) {}
}