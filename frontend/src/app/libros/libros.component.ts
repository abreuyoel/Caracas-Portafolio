import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { environment } from '../../environments/environment';
import { AuthService } from '../core/services/auth.service';
import { OrderBookDialogComponent, OrderBookEntry } from '../dashboard/order-book-dialog.component';

interface StockInfo {
  symbol: string;
  name: string;
  is_active: boolean;
  currency: string;
}

@Component({
  selector: 'app-libros',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatDialogModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatButtonModule
  ],
  templateUrl: './libros.component.html',
  styleUrls: ['./libros.component.scss']
})
export class LibrosComponent implements OnInit {
  loading = false;
  stocks: StockInfo[] = [];
  private apiUrl = environment.apiUrl;

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.loadActiveStocks();
  }

  loadActiveStocks(): void {
    this.loading = true;
    const token = localStorage.getItem('access_token');
    this.http.get<StockInfo[]>(
      `${this.apiUrl}/stocks/bvc/active`,
      { headers: { Authorization: `Bearer ${token}` } }
    ).subscribe({
      next: (stocks) => {
        this.stocks = stocks;
        this.loading = false;
        this.snackBar.open(`✅ ${stocks.length} acciones activas disponibles`, 'OK', { duration: 3000 });
      },
      error: (err) => {
        console.error('❌ Error loading active stocks:', err);
        this.snackBar.open('❌ Error al cargar acciones activas', 'OK', { duration: 4000 });
        this.loading = false;
      }
    });
  }

  viewOrderBook(symbol: string): void {
    const token = localStorage.getItem('access_token');
    this.http.get<{ symbol: string; entries: OrderBookEntry[] }>(
      `${this.apiUrl}/market/order-books/${symbol}`,
      { headers: { Authorization: `Bearer ${token}` } }
    ).subscribe({
      next: (res) => {
        this.dialog.open(OrderBookDialogComponent, {
          data: { symbol: res.symbol, entries: res.entries },
          width: '700px',
          maxWidth: '90vw'
        });
      },
      error: (err) => {
        console.error(err);
        this.snackBar.open(`Error al cargar libro de ${symbol}`, 'OK', { duration: 3000 });
      }
    });
  }
}