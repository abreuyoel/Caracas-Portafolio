import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../core/services/auth.service';
import { WebSocketService } from '../core/services/websocket.service';

interface PortfolioSummary {
  total_invested_usd: number;
  total_invested_bs: number;
  current_value_usd: number;
  current_value_bs: number;
  unrealized_pnl_usd: number;
  unrealized_pnl_bs: number;
  unrealized_pnl_pct: number;
  realized_pnl_usd: number;
  total_positions: number;
  total_transactions: number;
}

interface StockMover {
  symbol: string;
  name: string;
  start_price: number;
  start_date: string;
  latest_price: number;
  change_pct: number;
  last_date: string;
  volume: number;
  consecutive_up?: number;
  sessions?: number;
  total_volume?: number;
  total_amount_bs?: number;
  liquidity_score?: number;
}


interface StockOption { symbol: string; name: string; is_active: boolean; }
interface CompanyInfo {
  symbol: string; company_name: string; isin: string;
  currency: string; shares_outstanding: string; is_active: boolean;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatToolbarModule,
    MatMenuModule,
    MatSidenavModule,
    MatListModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatDividerModule,
    MatSelectModule,
    MatTabsModule,
    MatDialogModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, OnDestroy {
  sidebarOpen = false;
  loading = true;
  hideValues = false;
  supportOpen = false;
  supportMessage = '';
  sendingSupport = false;
  myTickets: any[] = [];

  // Market movers
  moversPeriod: 'weekly' | 'monthly' | 'quarterly' = 'weekly';
  showMoversInUsd = false;
  bcvRates: Record<string, number> = {};
  moversLoading = false;
  syncRunning = false;
  syncDone = 0;
  syncTotal = 0;
  private syncPollInterval: any = null;
  gainers: StockMover[] = [];
  losers: StockMover[] = [];
  stable: StockMover[] = [];
  uptrend: StockMover[] = [];
  institutional: StockMover[] = [];
  moversTotal = 0;
  moversMessage = '';

  // Company info
  stocks: StockOption[] = [];
  stocksLoading = false;
  selectedInfoSymbol = '';
  stockInfoFilter = '';
  companyInfo: CompanyInfo | null = null;
  companyInfoLoading = false;

  get filteredInfoStocks(): StockOption[] {
    const f = this.stockInfoFilter.toLowerCase().trim();
    if (!f) return this.stocks;
    return this.stocks.filter(s =>
      s.symbol.toLowerCase().includes(f) || s.name.toLowerCase().includes(f)
    );
  }

  portfolioSummary: PortfolioSummary = {
    total_invested_usd: 0,
    total_invested_bs: 0,
    current_value_usd: 0,
    current_value_bs: 0,
    unrealized_pnl_usd: 0,
    unrealized_pnl_bs: 0,
    unrealized_pnl_pct: 0,
    realized_pnl_usd: 0,
    total_positions: 0,
    total_transactions: 0
  };
  private apiUrl = environment.apiUrl;
  Math = Math;

  constructor(
    private authService: AuthService,
    private wsService: WebSocketService,
    private http: HttpClient,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    if (this.authService.isAuthenticated()) {
      this.wsService.connect();
    }
    this.loadPortfolioSummary();
    this.loadActiveStocks();
    this.loadBcvRates();
    // 1. Mostrar datos existentes inmediatamente
    this.loadMarketMovers();
    // 2. Lanzar sync en background sin bloquear
    this.triggerSyncInBackground();
  }

  ngOnDestroy(): void {
    if (this.syncPollInterval) clearInterval(this.syncPollInterval);
  }

  /** Dispara el sync de historial sin bloquear la UI y arranca el polling de estado */
  private triggerSyncInBackground(): void {
    const token = localStorage.getItem('access_token');
    this.http.post(
      `${this.apiUrl}/stocks/bvc/sync-history`, {},
      { headers: { Authorization: `Bearer ${token ?? ''}` } }
    ).subscribe({ error: () => {} });

    // Verificar estado del sync cada 10 segundos
    this.syncPollInterval = setInterval(() => this.pollSyncStatus(), 10_000);
    this.pollSyncStatus(); // primera llamada inmediata
  }

  private async pollSyncStatus(): Promise<void> {
    try {
      const token = localStorage.getItem('access_token');
      const status: any = await firstValueFrom(this.http.get(
        `${this.apiUrl}/stocks/bvc/sync-status`,
        { headers: { Authorization: `Bearer ${token}` } }
      ));
      this.syncRunning = status.running;
      this.syncDone    = status.stocks_done  ?? 0;
      this.syncTotal   = status.stocks_total ?? 0;

      // Si el sync acaba de terminar, refrescar los movers y parar el polling
      if (!status.running && status.last_completed) {
        clearInterval(this.syncPollInterval);
        this.syncPollInterval = null;
        this.loadMarketMovers();
      }
    } catch {
      // silencioso si falla
    }
  }

  async loadPortfolioSummary(): Promise<void> {
    this.loading = true;
    try {
      const token = localStorage.getItem('access_token');
      const response = await firstValueFrom(this.http.get<PortfolioSummary>(
        `${this.apiUrl}/portfolio/summary`,
        { headers: { Authorization: `Bearer ${token}` } }
      ));
      if (response) {
        this.portfolioSummary = response;
      }
    } catch (error) {
      console.error('❌ Error loading portfolio:', error);
      this.snackBar.open('Error al cargar el portafolio', 'OK', { duration: 3000 });
    } finally {
      this.loading = false;
    }
  }

  async loadMarketMovers(): Promise<void> {
    this.moversLoading = true;
    try {
      const token = localStorage.getItem('access_token');
      const data = await firstValueFrom(this.http.get<any>(
        `${this.apiUrl}/stocks/bvc/market-movers?period=${this.moversPeriod}`,
        { headers: { Authorization: `Bearer ${token}` } }
      ));
      this.gainers = data.gainers || [];
      this.losers = data.losers || [];
      this.stable = data.stable || [];
      this.uptrend = data.uptrend || [];
      this.institutional = data.institutional || [];
      this.moversTotal = data.total_analyzed || 0;
      this.moversMessage = data.message || '';
    } catch {
      this.gainers = []; this.losers = []; this.stable = []; this.uptrend = []; this.institutional = [];
    } finally {
      this.moversLoading = false;
    }
  }

  async loadActiveStocks(): Promise<void> {
    this.stocksLoading = true;
    try {
      const token = localStorage.getItem('access_token');
      this.stocks = await firstValueFrom(this.http.get<StockOption[]>(
        `${this.apiUrl}/stocks/bvc/active`,
        { headers: { Authorization: `Bearer ${token}` } }
      ));
    } catch { this.stocks = []; }
    finally { this.stocksLoading = false; }
  }

  async loadBcvRates(): Promise<void> {
    try {
      const token = localStorage.getItem('access_token');
      const rates = await firstValueFrom(this.http.get<{ date: string; rate: number }[]>(
        `${this.apiUrl}/stocks/bcv-rates`,
        { headers: { Authorization: `Bearer ${token}` } }
      ));
      this.bcvRates = {};
      for (const r of rates) this.bcvRates[r.date] = r.rate;
    } catch { this.bcvRates = {}; }
  }

  /** Finds the BCV rate for a date, falling back to the nearest prior date */
  getRateForDate(date: string): number {
    if (!date) return 0;
    if (this.bcvRates[date]) return this.bcvRates[date];
    const sorted = Object.keys(this.bcvRates).sort();
    let best = 0;
    for (const d of sorted) {
      if (d <= date) best = this.bcvRates[d];
      else break;
    }
    return best;
  }

  /** Returns the most recent BCV rate */
  get latestBcvRate(): number {
    const dates = Object.keys(this.bcvRates).sort();
    if (dates.length === 0) return 1;
    return this.bcvRates[dates[dates.length - 1]];
  }

  /** Returns the display price of a mover (USD or Bs) */
  moverPrice(price: number, date: string): number {
    if (!this.showMoversInUsd) return price;
    const rate = this.getRateForDate(date);
    return rate > 0 ? price / rate : price;
  }

  /** Returns the change % adjusted for currency devaluation when in USD mode */
  moverChangePct(m: StockMover): number {
    if (!this.showMoversInUsd) return m.change_pct;
    const rateStart  = this.getRateForDate(m.start_date || m.last_date);
    const rateLatest = this.getRateForDate(m.last_date);
    if (!rateStart || !rateLatest || rateStart === 0) return m.change_pct;
    
    // User expressly requested: restarlo al % original
    const rateIncreasePct = ((rateLatest - rateStart) / rateStart) * 100;
    return m.change_pct - rateIncreasePct;
  }

  async loadCompanyInfo(): Promise<void> {
    if (!this.selectedInfoSymbol) return;
    this.companyInfoLoading = true;
    this.companyInfo = null;
    try {
      const token = localStorage.getItem('access_token');
      this.companyInfo = await firstValueFrom(this.http.get<CompanyInfo>(
        `${this.apiUrl}/stocks/bvc/${this.selectedInfoSymbol}`,
        { headers: { Authorization: `Bearer ${token}` } }
      ));
    } catch {
      this.snackBar.open('No se pudo cargar la información', 'Cerrar', { duration: 3000 });
    } finally { this.companyInfoLoading = false; }
  }

  onMoversPeriodChange(): void {
    this.loadMarketMovers();
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
  }

  toggleSupport(): void {
    this.supportOpen = !this.supportOpen;
    if (this.supportOpen) this.loadMyTickets();
  }

  async loadMyTickets(): Promise<void> {
    try {
      const token = localStorage.getItem('access_token');
      this.myTickets = await firstValueFrom(
        this.http.get<any[]>(`${this.apiUrl}/support`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      );
    } catch { this.myTickets = []; }
  }

  async sendSupport(): Promise<void> {
    if (!this.supportMessage.trim() || this.sendingSupport) return;
    this.sendingSupport = true;
    try {
      const token = localStorage.getItem('access_token');
      await firstValueFrom(
        this.http.post(`${this.apiUrl}/support`, { message: this.supportMessage.trim() }, {
          headers: { Authorization: `Bearer ${token}` }
        })
      );
      this.snackBar.open('✅ Mensaje enviado. Te responderemos pronto.', 'Cerrar', { duration: 4000 });
      this.supportMessage = '';
      this.loadMyTickets();
    } catch {
      this.snackBar.open('Error al enviar el mensaje', 'Cerrar', { duration: 3000 });
    } finally {
      this.sendingSupport = false;
    }
  }

  logout(): void {
    this.authService.logout();
  }

  async showTerms(event: Event): Promise<void> {
    event.preventDefault();
    const { LegalModalComponent } = await import('../auth/legal-modal/legal-modal.component');
    this.dialog.open(LegalModalComponent, {
      data: { type: 'terms' },
      maxWidth: '600px',
      panelClass: 'dark-dialog-panel'
    });
  }

  async showPrivacy(event: Event): Promise<void> {
    event.preventDefault();
    const { LegalModalComponent } = await import('../auth/legal-modal/legal-modal.component');
    this.dialog.open(LegalModalComponent, {
      data: { type: 'privacy' },
      maxWidth: '600px',
      panelClass: 'dark-dialog-panel'
    });
  }
}