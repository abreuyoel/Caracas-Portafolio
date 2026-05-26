import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
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
import { jwtDecode } from 'jwt-decode';
import { environment } from '../../environments/environment';
import { AuthService } from '../core/services/auth.service';
import { BvcSocketService } from '../core/services/bvc-socket.service';
import { PushNotificationService } from '../core/services/push-notification.service';
import { ThemeService } from '../core/services/theme.service';
import { Subscription } from 'rxjs';
import { PortfolioHeatmapComponent, HeatmapItem } from '../shared/portfolio-heatmap/portfolio-heatmap.component';
import { PdfExportService } from '../core/services/pdf-export.service';

interface PortfolioSummary {
  total_invested_usd: number;      // all buy transactions ever
  cost_basis_current_usd: number;  // WAC cost basis of currently-held shares only
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

interface EmisorInfo {
  symbol: string; isin: string | null; name: string; sector: string | null;
  shares_outstanding: string | null; currency: string | null; status: string | null;
  total_records: number;
  history: { fecha: string; apertura: any; maximo: any; minimo: any; cierre: any; volumen: any; monto: any }[];
}

import { trigger, transition, style, animate } from '@angular/animations';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    RouterLinkActive,
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
    MatDialogModule,
    PortfolioHeatmapComponent
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  animations: [
    trigger('fadeSlideInOut', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(-20px)' }),
        animate('0.4s cubic-bezier(0.16, 1, 0.3, 1)', style({ opacity: 1, transform: 'translateY(0)' }))
      ]),
      transition(':leave', [
        animate('0.3s ease-in', style({ opacity: 0, transform: 'translateY(-20px)' }))
      ])
    ])
  ]
})
export class DashboardComponent implements OnInit, OnDestroy {
  sidebarOpen = false;
  loading = true;
  hideValues = localStorage.getItem('dashboard_hide_values') === 'true';
  supportOpen = false;
  supportMessage = '';
  sendingSupport = false;
  myTickets: any[] = [];
  showReleaseBanner = false;

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
  emisorData: EmisorInfo | null = null;
  emisorLoading = false;
  emisorError = '';

  get filteredInfoStocks(): StockOption[] {
    const f = this.stockInfoFilter.toLowerCase().trim();
    if (!f) return this.stocks;
    return this.stocks.filter(s =>
      s.symbol.toLowerCase().includes(f) || s.name.toLowerCase().includes(f)
    );
  }

  portfolioSummary: PortfolioSummary = {
    total_invested_usd: 0,
    cost_basis_current_usd: 0,
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
  
  // Real-Time Analytics KPIs
  intradayPnlUsd: number = 0;
  intradayPnlPct: number = 0;
  concentrationIndex: number = 0;
  marketLiquidityUsd: number = 0;
  
  // Analytics data for real-time recalculation
  analyticsData: any = null;
  private wsSub: Subscription | null = null;

  private apiUrl = environment.apiUrl;
  Math = Math;

  // ── Admin ────────────────────────────────────────────────────────────────────
  readonly ADMIN_EMAIL = 'abreuyoel22@gmail.com';
  get isAdmin(): boolean {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) return false;
      const decoded: any = jwtDecode(token);
      return decoded.email?.toLowerCase() === this.ADMIN_EMAIL;
    } catch {
      return false;
    }
  }
  adminLoading    = false;
  adminSending    = false;
  adminPreviewData: any = null;
  adminResult: any     = null;

  bcvMismatchLoading = false;
  bcvMismatchSending = false;
  bcvMismatchData: any = null;
  bcvMismatchResult: any = null;

  registerSymbol = '';
  registerLoading = false;
  registerResult: any = null;

  private adminHeaders() { return { Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}` }; }

  async registerBvcSymbol(): Promise<void> {
    if (!this.registerSymbol.trim()) return;
    this.registerLoading = true;
    this.registerResult = null;
    try {
      const res = await firstValueFrom(
        this.http.post<any>(
          `${this.apiUrl}/stocks/bvc/register-symbol?symbol=${this.registerSymbol.trim().toUpperCase()}`,
          {},
          { headers: this.adminHeaders() }
        )
      );
      this.registerResult = { ...res, error: false };
      // Bust the graficos stocks cache so the new symbol appears immediately
      localStorage.removeItem('bvc_stocks_cache');
      localStorage.removeItem('bvc_stocks_cache_ts');
      localStorage.removeItem('bvc_stocks_cache_date');
      this.snackBar.open(`✅ ${res.symbol} registrado. ${res.sessions_inserted} sesiones nuevas.`, 'OK', { duration: 5000 });
    } catch (err: any) {
      this.registerResult = { error: true, message: err?.error?.detail || 'Error al registrar símbolo' };
    } finally {
      this.registerLoading = false;
    }
  }

  async adminPreview() {
    this.adminLoading = true;
    try {
      this.adminPreviewData = await firstValueFrom(
        this.http.get<any>(`${this.apiUrl}/admin/big-investors/preview`, { headers: this.adminHeaders() })
      );
    } catch (e: any) {
      this.snackBar.open(e?.error?.detail || 'Error al obtener vista previa', 'Cerrar', { duration: 4000 });
    } finally { this.adminLoading = false; }
  }

  async adminSendEmails() {
    if (!confirm(`¿Enviar correos a ${this.adminPreviewData?.count ?? 0} usuarios?`)) return;
    this.adminSending = true;
    this.adminResult  = null;
    try {
      this.adminResult = await firstValueFrom(
        this.http.post<any>(`${this.apiUrl}/admin/big-investors/send-emails`, {}, { headers: this.adminHeaders() })
      );
      this.snackBar.open(`✅ ${this.adminResult.sent} correos enviados`, 'OK', { duration: 5000 });
    } catch (e: any) {
      this.snackBar.open(e?.error?.detail || 'Error al enviar correos', 'Cerrar', { duration: 4000 });
    } finally { this.adminSending = false; }
  }

  async bcvMismatchPreview() {
    this.bcvMismatchLoading = true;
    try {
      this.bcvMismatchData = await firstValueFrom(
        this.http.get<any>(`${this.apiUrl}/admin/bcv-rate-mismatch/preview`, { headers: this.adminHeaders() })
      );
    } catch (e: any) {
      this.snackBar.open(e?.error?.detail || 'Error al analizar tasas BCV', 'Cerrar', { duration: 4000 });
    } finally { this.bcvMismatchLoading = false; }
  }

  async bcvMismatchSendEmails() {
    if (!confirm(`¿Enviar alertas de tasa BCV a ${this.bcvMismatchData?.count ?? 0} usuarios?`)) return;
    this.bcvMismatchSending = true;
    this.bcvMismatchResult  = null;
    try {
      this.bcvMismatchResult = await firstValueFrom(
        this.http.post<any>(`${this.apiUrl}/admin/bcv-rate-mismatch/send-emails`, {}, { headers: this.adminHeaders() })
      );
      this.snackBar.open(`✅ ${this.bcvMismatchResult.sent} alertas enviadas`, 'OK', { duration: 5000 });
    } catch (e: any) {
      this.snackBar.open(e?.error?.detail || 'Error al enviar alertas', 'Cerrar', { duration: 4000 });
    } finally { this.bcvMismatchSending = false; }
  }

  constructor(
    private authService: AuthService,
    public bvcSocket: BvcSocketService,
    private http: HttpClient,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    public pushSvc: PushNotificationService,
    public themeSvc: ThemeService,
    private pdfSvc: PdfExportService,
  ) {}

  async togglePush(): Promise<void> {
    const granted = this.pushSvc.granted$.value;
    const result  = granted ? await this.pushSvc.unsubscribe() : await this.pushSvc.subscribe();
    this.snackBar.open(result.message, 'OK', { duration: 5000, panelClass: result.ok ? ['success-snackbar'] : ['error-snackbar'] });
  }

  async testPush(): Promise<void> {
    const result = await this.pushSvc.sendTest();
    this.snackBar.open(result.message, 'OK', { duration: 5000, panelClass: result.ok ? ['success-snackbar'] : ['error-snackbar'] });
  }

  toggleHideValues(): void {
    this.hideValues = !this.hideValues;
    localStorage.setItem('dashboard_hide_values', String(this.hideValues));
  }

  ngOnInit(): void {
    const savedHide = localStorage.getItem('hideValues');
    if (savedHide !== null) {
      this.hideValues = savedHide === 'true';
    }
    if (this.authService.isAuthenticated()) {
      this.bvcSocket.connect();
      this.wsSub = this.bvcSocket.stocksMap$.subscribe(board => this.handleMarketBoard(board));
    }
    this.loadPortfolioSummary();
    this.loadActiveStocks();
    this.loadBcvRates();
    // 1. Mostrar datos existentes inmediatamente
    this.loadMarketMovers();
    // 2. Lanzar sync en background sin bloquear
    this.triggerSyncInBackground();

    // 3. Release Notes Banner
    const seen = localStorage.getItem('release_notes_seen_v2');
    if (!seen) {
      setTimeout(() => this.showReleaseBanner = true, 1500);
    }
  }

  ngOnDestroy(): void {
    if (this.syncPollInterval) clearInterval(this.syncPollInterval);
    if (this.wsSub) this.wsSub.unsubscribe();
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
      // Fetch completo de analytics para tener las posiciones (necesario para el cálculo en TR)
      const data = await firstValueFrom(this.http.get<any>(
        `${this.apiUrl}/portfolio/analytics`,
        { headers: { Authorization: `Bearer ${token}` } }
      ));
      if (data) {
        this.analyticsData = data;
        
        // cost_basis_current = WAC cost of shares still held (< total_invested when sells occurred)
        const costBasis = data.summary.total_cost_basis_usd ?? data.summary.total_invested_usd ?? 0;
        const unrealizedPnl = data.summary.total_unrealized_pnl || 0;

        this.portfolioSummary = {
           total_invested_usd:      data.summary.total_invested_usd || 0,
           cost_basis_current_usd:  costBasis,
           total_invested_bs: 0,
           current_value_usd:       costBasis + unrealizedPnl,
           current_value_bs: 0,
           unrealized_pnl_usd:      unrealizedPnl,
           unrealized_pnl_bs: 0,
           unrealized_pnl_pct:      costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0,
           realized_pnl_usd:        data.summary.total_realized_pnl || 0,
           total_positions:         data.performance_by_stock ? data.performance_by_stock.length : 0,
           total_transactions:      data.summary.total_buys + data.summary.total_sells
        };
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

  /** WebSocket Real-Time Logic (Native BVC) */
  /** Latest socket snapshot — used by the heatmap getter to color tiles. */
  private currentBoard: Record<string, any> = {};

  private handleMarketBoard(board: Record<string, any>): void {
    if (!board || Object.keys(board).length === 0) return;
    this.currentBoard = board;

    // 1. Actulizar Movers (Ganadoras/Perdedoras en pantalla)
    const todayStr = new Date().toISOString().split('T')[0];
    const updateMover = (m: StockMover) => {
      const tick = board[m.symbol];
      if (tick && tick.PRECIO) {
        m.latest_price = tick.PRECIO;
        m.last_date = todayStr; // ensures USD calculation uses today's BCV
        const start = m.start_price || tick.PRECIO;
        m.change_pct = start > 0 ? ((tick.PRECIO - start) / start) * 100 : 0;
      }
    };
    this.gainers.forEach(updateMover);
    this.losers.forEach(updateMover);
    this.stable.forEach(updateMover);
    this.uptrend.forEach(updateMover);

    // 2. Re-calcular Portfolio USD (Ganancia/Valor Total)
    if (this.analyticsData && this.analyticsData.performance_by_stock) {
       const bcv = this.getRateForDate(''); // Last available rate or simply the summary's rate
       const activeBcv = this.analyticsData.summary.bcv_rate || bcv || 36;
       
       let totalValueUsd = 0;
       
       this.analyticsData.performance_by_stock.forEach((stock: any) => {
          const tick = board[stock.symbol];
          if (tick && tick.PRECIO) {
             const pxUsd = tick.PRECIO / activeBcv;
             totalValueUsd += (pxUsd * stock.quantity);
          } else if (stock.unit_price_usd) {
             totalValueUsd += (stock.unit_price_usd * stock.quantity);
          }
       });

       // Use WAC cost basis of current holdings — NOT total_invested_usd which includes sold positions
       const costBasis = this.portfolioSummary.cost_basis_current_usd || this.portfolioSummary.total_invested_usd;
       const unrealized = totalValueUsd - costBasis;

       // Mutate safely
       this.portfolioSummary = {
          ...this.portfolioSummary,
          current_value_usd:  totalValueUsd,
          unrealized_pnl_usd: unrealized,
          unrealized_pnl_pct: costBasis > 0 ? (unrealized / costBasis) * 100 : 0
       };

       // 3. New Live Analytics KPIs
       let marketLiquidity = 0;
       Object.values(board).forEach(tick => {
          if (tick.MONTO_EFECTIVO) marketLiquidity += tick.MONTO_EFECTIVO;
       });
       if (marketLiquidity > 0) {
          this.marketLiquidityUsd = marketLiquidity / activeBcv;
       }
   
       let openingPortfolioUsd = 0;
       this.analyticsData.performance_by_stock.forEach((stock: any) => {
           const tick = board[stock.symbol];
           if (tick) {
               // Aprox apertura asumiendo variación abs
               const startPx = tick.PRECIO - (tick.VAR_ABS || 0);
               openingPortfolioUsd += (startPx / activeBcv) * stock.quantity;
           } else {
               openingPortfolioUsd += (stock.unit_price_usd * stock.quantity);
           }
       });
       
       if (openingPortfolioUsd > 0) {
           this.intradayPnlUsd = totalValueUsd - openingPortfolioUsd;
           this.intradayPnlPct = (this.intradayPnlUsd / openingPortfolioUsd) * 100;
       }
   
       const activePos = this.analyticsData.performance_by_stock.filter((s:any) => s.quantity > 0).map((s:any) => {
           const tick = board[s.symbol];
           const pxUsd = tick && tick.PRECIO ? tick.PRECIO / activeBcv : s.unit_price_usd;
           return pxUsd * s.quantity;
       }).sort((a:number,b:number) => b - a);
   
       if (totalValueUsd > 0 && activePos.length > 0) {
           const top2 = (activePos[0] || 0) + (activePos[1] || 0);
           this.concentrationIndex = (top2 / totalValueUsd) * 100;
       }
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
    const token = localStorage.getItem('access_token');
    const headers = { Authorization: `Bearer ${token}` };

    this.companyInfoLoading = true;
    this.companyInfo = null;
    this.emisorData = null;
    this.emisorError = '';

    try {
      this.companyInfo = await firstValueFrom(this.http.get<CompanyInfo>(
        `${this.apiUrl}/stocks/bvc/${this.selectedInfoSymbol}`,
        { headers }
      ));
    } catch {
      this.snackBar.open('No se pudo cargar la información', 'Cerrar', { duration: 3000 });
    } finally { this.companyInfoLoading = false; }

    // Cargar datos BVC (ISIN + histórico) en paralelo
    this.emisorLoading = true;
    try {
      this.emisorData = await firstValueFrom(this.http.get<EmisorInfo>(
        `${this.apiUrl}/stocks/bvc/${this.selectedInfoSymbol}/emisor`,
        { headers }
      ));
      // Usar ISIN de BVC si no vino en companyInfo
      if (this.emisorData?.isin && this.companyInfo && !this.companyInfo.isin) {
        this.companyInfo = { ...this.companyInfo, isin: this.emisorData.isin };
      }
    } catch (err: any) {
      this.emisorError = err?.error?.detail || 'No se encontraron datos históricos en BVC';
    } finally { this.emisorLoading = false; }
  }

  onMoversPeriodChange(): void {
    this.loadMarketMovers();
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
  }

  toggleHideValues(): void {
    this.hideValues = !this.hideValues;
    localStorage.setItem('hideValues', String(this.hideValues));
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

  dismissReleaseNotes(): void {
    this.showReleaseBanner = false;
    localStorage.setItem('release_notes_seen_v2', 'true');
  }

  /**
   * Export the current dashboard as a downloadable PDF report using
   * jsPDF + jspdf-autotable. One click → real .pdf file (not a print dialog).
   */
  exportDashboardToPdf(): void {
    try {
      const ps: any = this.portfolioSummary || {};
      const board = this.currentBoard || {};
      const bcv   = this.activeBcvRate || ps.bcv_rate || 36;

      const positions = (this.analyticsData?.performance_by_stock || [])
        .filter((s: any) => s.quantity > 0)
        .map((s: any) => {
          const tick = board[s.symbol];
          const curPxBs  = tick?.PRECIO ?? (s.unit_price_usd * bcv);
          const curPxUsd = curPxBs / bcv;
          const valueUsd = curPxUsd * s.quantity;
          const pnlUsd   = valueUsd - (s.unit_price_usd * s.quantity);
          const pnlPct   = s.unit_price_usd ? (pnlUsd / (s.unit_price_usd * s.quantity)) * 100 : 0;
          return {
            symbol: s.symbol,
            name: s.name,
            quantity: s.quantity,
            avg_price_usd: s.unit_price_usd,
            current_price_usd: curPxUsd,
            value_usd: valueUsd,
            pnl_usd: pnlUsd,
            pnl_pct: pnlPct,
          };
        });

      let userEmail: string | undefined;
      try {
        const tk = localStorage.getItem('access_token');
        if (tk) userEmail = (jwtDecode(tk) as any)?.email;
      } catch { /* ignore */ }

      this.pdfSvc.exportDashboard({
        user_email: userEmail,
        generated_at: new Date(),
        summary: {
          total_invested_usd: ps.total_invested_usd ?? 0,
          cost_basis_current_usd: ps.cost_basis_current_usd ?? ps.total_invested_usd ?? 0,
          current_value_usd: ps.current_value_usd ?? 0,
          total_pnl_usd: ps.unrealized_pnl_usd ?? 0,
          total_pnl_pct: ps.unrealized_pnl_pct ?? 0,
          total_positions: ps.total_positions ?? positions.length,
          bcv_rate: bcv,
        },
        positions,
        metrics: {
          intraday_pnl_usd: this.intradayPnlUsd,
          intraday_pnl_pct: this.intradayPnlPct,
          concentration_index: this.concentrationIndex,
        },
      });
      this.snackBar.open('✅ PDF descargado', 'OK', { duration: 2500 });
    } catch (e) {
      console.error('PDF export error:', e);
      this.snackBar.open('Error al generar PDF. Verifica que jspdf esté instalado.', 'Cerrar', { duration: 4000 });
    }
  }

  /**
   * Heatmap data: each open position becomes a tile, sized by USD value
   * and colored by today's VAR_REL from the live socket.
   */
  get heatmapItems(): HeatmapItem[] {
    const perf = this.analyticsData?.performance_by_stock;
    if (!perf || !perf.length) return [];
    const board = this.currentBoard || {};
    const bcv = this.activeBcvRate || 36;

    let totalValue = 0;
    const rawItems: (HeatmapItem & { value: number })[] = [];
    for (const s of perf) {
      if (!s || s.quantity <= 0) continue;
      const tick = board[s.symbol];
      const px   = (tick && tick.PRECIO) ? tick.PRECIO : (s.unit_price_usd * bcv);
      const valUsd = (px / bcv) * s.quantity;
      const varRel = (tick && typeof tick.VAR_REL === 'number') ? tick.VAR_REL
                  : (typeof s.var_rel === 'number' ? s.var_rel : 0);
      if (valUsd <= 0) continue;
      rawItems.push({
        symbol: s.symbol,
        name: s.name || s.symbol,
        weight: valUsd,
        varRel: varRel,
        price: px,
        value: valUsd,
      });
      totalValue += valUsd;
    }
    if (totalValue <= 0) return [];
    return rawItems.map(i => ({ ...i, weight: i.value / totalValue }));
  }

  get activeBcvRate(): number {
    const today = new Date().toISOString().split('T')[0];
    if (this.bcvRates[today]) return this.bcvRates[today];
    const dates = Object.keys(this.bcvRates).sort();
    return dates.length ? this.bcvRates[dates[dates.length - 1]] : 36;
  }
}