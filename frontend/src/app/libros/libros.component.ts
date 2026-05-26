import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { Location } from '@angular/common';
import { Subscription } from 'rxjs';

import { environment } from '../../environments/environment';
import { AuthService } from '../core/services/auth.service';
import { BvcSocketService } from '../core/services/bvc-socket.service';
import { OrderBookDialogComponent } from '../dashboard/order-book-dialog.component';

@Component({
  selector: 'app-libros',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatButtonModule,
    MatTabsModule
  ],
  templateUrl: './libros.component.html',
  styleUrls: ['./libros.component.scss']
})
export class LibrosComponent implements OnInit, OnDestroy {
  isAdmin = false;

  marketStatus: any = {};
  resumen: any = {};
  indices: any[] = [];
  stocks: any[] = [];
  cryptos: any[] = [];
  wsLogs: any[] = [];

  private readonly CRYPTO_TICKERS = new Set([
    // Short tickers (DESC_SIMB)
    'BTC', 'ETH', 'XRP', 'DOGE', 'LTC', 'ADA', 'SOL', 'BNB', 'USDT',
    'USDC', 'MATIC', 'DOT', 'AVAX', 'LINK', 'UNI', 'SHIB', 'TRX', 'ATOM',
    // Full names (COD_SIMB)
    'BITCOIN', 'ETHEREUM', 'RIPPLE', 'DOGECOIN', 'LITECOIN', 'CARDANO',
    'SOLANA', 'BINANCE', 'TETHER', 'POLKADOT', 'AVALANCHE', 'CHAINLINK',
    'UNISWAP', 'SHIBA', 'TRON', 'COSMOS', 'BINANCECOIN',
  ]);

  get cryptosOnly(): any[] {
    return this.cryptos.filter(c => {
      const cod  = (c?.simbolo?.COD_SIMB  ?? '').trim();
      const desc = (c?.simbolo?.DESC_SIMB ?? '').trim();
      return this.CRYPTO_TICKERS.has(cod) || this.CRYPTO_TICKERS.has(desc);
    });
  }
  
  ibcVal: number = 0;
  indFin: number = 0;
  indInd: number = 0;

  get titulos() {
    let up = 0, down = 0, flat = 0;
    for (const s of this.stocks) {
      const v = s?.VAR_REL ?? s?.simbolo?.VAR_REL ?? null;
      if (v == null) { flat++; continue; }
      if (v > 0) up++;
      else if (v < 0) down++;
      else flat++;
    }
    return { up, down, flat };
  }

  // ── Stock Screener ─────────────────────────────────────────────────────────
  showScreener = false;
  scrFilter: 'ALL' | 'GAINERS' | 'LOSERS' = 'ALL';
  scrSymbol = '';
  scrMinVarRel: number | null = null;
  scrMaxVarRel: number | null = null;
  scrMinVolume: number | null = null;
  scrMinPrice: number | null = null;
  scrMaxPrice: number | null = null;
  scrSort: 'VAR_REL_DESC' | 'VAR_REL_ASC' | 'VOLUMEN_DESC' | 'PRECIO_DESC' = 'VAR_REL_DESC';

  toggleScreener() { this.showScreener = !this.showScreener; }

  resetScreener() {
    this.scrFilter = 'ALL';
    this.scrSymbol = '';
    this.scrMinVarRel = null;
    this.scrMaxVarRel = null;
    this.scrMinVolume = null;
    this.scrMinPrice = null;
    this.scrMaxPrice = null;
    this.scrSort = 'VAR_REL_DESC';
  }

  get screenedStocks(): any[] {
    const q = (this.scrSymbol || '').toUpperCase().trim();
    const out = this.stocks.filter(s => {
      const sim = s?.simbolo || s;
      const sym = (sim?.COD_SIMB ?? '').toUpperCase();
      const name = (sim?.DESC_SIMB ?? '').toUpperCase();
      const v   = Number(s?.VAR_REL  ?? sim?.VAR_REL  ?? 0);
      const vol = Number(s?.VOLUMEN  ?? sim?.VOLUMEN  ?? 0);
      const px  = Number(s?.PRECIO   ?? sim?.PRECIO   ?? 0);

      if (this.scrFilter === 'GAINERS' && v <= 0) return false;
      if (this.scrFilter === 'LOSERS'  && v >= 0) return false;
      if (q && !sym.includes(q) && !name.includes(q)) return false;
      if (this.scrMinVarRel != null && v < this.scrMinVarRel) return false;
      if (this.scrMaxVarRel != null && v > this.scrMaxVarRel) return false;
      if (this.scrMinVolume != null && vol < this.scrMinVolume) return false;
      if (this.scrMinPrice  != null && px  < this.scrMinPrice)  return false;
      if (this.scrMaxPrice  != null && px  > this.scrMaxPrice)  return false;
      return true;
    });

    const sortKey = (a: any, k: string) => {
      const sim = a?.simbolo || a;
      return Number(a?.[k] ?? sim?.[k] ?? 0);
    };
    switch (this.scrSort) {
      case 'VAR_REL_DESC': out.sort((a, b) => sortKey(b, 'VAR_REL') - sortKey(a, 'VAR_REL')); break;
      case 'VAR_REL_ASC':  out.sort((a, b) => sortKey(a, 'VAR_REL') - sortKey(b, 'VAR_REL')); break;
      case 'VOLUMEN_DESC': out.sort((a, b) => sortKey(b, 'VOLUMEN') - sortKey(a, 'VOLUMEN')); break;
      case 'PRECIO_DESC':  out.sort((a, b) => sortKey(b, 'PRECIO')  - sortKey(a, 'PRECIO')); break;
    }
    return out;
  }

  private sub: Subscription = new Subscription();
  private apiUrl = environment.apiUrl;

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    public bvcSocket: BvcSocketService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef,
    private location: Location
  ) {}

  ngOnInit(): void {
    this.sub.add(this.authService.currentUser$.subscribe(user => {
      this.isAdmin = user?.email === 'abreuyoel22@gmail.com';
    }));

    // Conectar a los streams globales
    this.sub.add(this.bvcSocket.marketStatus$.subscribe(data => {
      this.marketStatus = data;
      this.cdr.detectChanges();
    }));

    this.sub.add(this.bvcSocket.resumen$.subscribe(data => {
      this.resumen = data;
      this.cdr.detectChanges();
    }));

    this.sub.add(this.bvcSocket.indices$.subscribe(data => {
      this.indices = data;
      const ibc = data.find((x: any) => x.COD_SIMB.trim() === 'IBC');
      const fin = data.find((x: any) => x.COD_SIMB.trim() === 'I.FINANCIE');
      const ind = data.find((x: any) => x.COD_SIMB.trim() === 'I.INDUSTR');
      if (ibc) this.ibcVal = ibc.PRECIO;
      if (fin) this.indFin = fin.PRECIO;
      if (ind) this.indInd = ind.PRECIO;
      this.cdr.detectChanges();
    }));

    this.sub.add(this.bvcSocket.stocksArray$.subscribe(data => {
      this.stocks = data;
      this.cdr.detectChanges();
    }));

    this.sub.add(this.bvcSocket.cryptos$.subscribe(data => {
      this.cryptos = data;
      this.cdr.detectChanges();
    }));

    this.sub.add(this.bvcSocket.logs$.subscribe(data => {
      this.wsLogs = data;
      this.cdr.detectChanges();
    }));
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }

  goBack(): void {
    this.location.back();
  }

  viewOrderBook(symbol: string): void {
    const token = localStorage.getItem('access_token');
    this.http.get<{ symbol: string; entries: any[] }>(
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