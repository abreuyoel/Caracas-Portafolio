import { Component, OnInit, ElementRef, ViewChild, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { environment } from '../../environments/environment';
import { Chart, registerables } from 'chart.js';
import { Subscription } from 'rxjs';
import { BvcSocketService } from '../core/services/bvc-socket.service';
import { PushNotificationService } from '../core/services/push-notification.service';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

Chart.register(...registerables);

interface PerfStock {
  symbol: string;
  quantity: number;
  total_invested: number;
  current_value: number;
  unit_price_usd: number;
  unrealized_pnl: number;
  realized_pnl: number;
  total_pnl: number;
  gain_pct: number;
  buy_count: number;
  sell_count: number;
  // Commission-adjusted fields
  estimated_sell_cost_usd: number;
  net_if_sold_usd: number;
  net_if_sold_pct: number;
}

interface AnalyticsData {
  summary: {
    total_buys: number;
    total_sells: number;
    total_invested_usd: number;
    total_realized_pnl: number;
    total_unrealized_pnl: number;
    request_types: { [key: string]: number };
    bcv_rate: number;
    avg_commission_rate_pct: number;
    total_net_if_sold_usd: number;
    total_estimated_sell_cost_usd: number;
  };
  allocation: {
    by_stock: { name: string; value: number }[];
    by_broker: { name: string; value: number }[];
  };
  timeline: {
    daily: { date: string; value: number }[];
    weekly: { date: string; value: number }[];
    monthly: { date: string; value: number }[];
  };
  performance_by_stock: PerfStock[];
  insights: {
    best_position:    { symbol: string; gain_usd: number }   | null;
    worst_position:   { symbol: string; loss_usd: number }   | null;
    best_day:         [string, number] | null;
    best_gain_day:    [string, number] | null;
    worst_gain_day:   [string, number] | null;
    top_holding_gain: PerfStock | null;
    top_holding_pct:  PerfStock | null;
    worst_holding:    PerfStock | null;
    best_sell:        { symbol: string; realized_pnl: number } | null;
    worst_sell:       { symbol: string; realized_pnl: number } | null;
    top_holdings:     PerfStock[];
  };
}


interface PnlPoint {
  date: string;
  value_usd: number;
  cost_usd: number;
  pnl_usd: number;
  pnl_pct: number;
}

interface PnlHistory {
  consolidated: PnlPoint[];
  per_stock: { [symbol: string]: PnlPoint[] };
}

interface RebalanceSuggestion {
  symbol: string; name: string;
  current_qty: number; current_value_usd: number; current_alloc_pct: number;
  target_alloc_pct: number; target_value_usd: number;
  diff_usd: number; shares_delta: number;
  price_bs: number; price_usd: number;
  action: 'comprar' | 'vender' | 'mantener';
}
interface RebalanceResult {
  total_portfolio_usd: number; bcv_rate: number;
  suggestions: RebalanceSuggestion[];
  note: string;
}
interface DividendRecord {
  id: number; stock_symbol: string; stock_name: string;
  shares_held: number; dividend_per_share_bs: number; dividend_per_share_usd: number;
  total_bs: number; total_usd: number; bcv_rate: number;
  ex_date: string | null; payment_date: string; notes: string | null; created_at: string;
}
interface DividendListResult {
  dividends: DividendRecord[];
  summary: { count: number; total_bs: number; total_usd: number; current_bcv: number };
}

@Component({
  selector: 'app-portfolio',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink, RouterLinkActive,
    MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatTooltipModule,
    MatMenuModule, MatSnackBarModule
  ],
  templateUrl: './portfolio.component.html',
  styleUrls: ['./portfolio.component.scss']
})
export class PortfolioComponent implements OnInit, OnDestroy {
  @ViewChild('allocChart')    allocChartRef!:    ElementRef;
  @ViewChild('timelineChart') timelineChartRef!: ElementRef;
  @ViewChild('pnlChart')      pnlChartRef!:      ElementRef;
  @ViewChild('brokerChart')   brokerChartRef!:   ElementRef;
  @ViewChild('activityChart') activityChartRef!: ElementRef;
  @ViewChild('orderChart')    orderChartRef!:    ElementRef;
  @ViewChild('pnlHistoryChart') pnlHistoryChartRef!: ElementRef;
  @ViewChild('toolsSection')  toolsSectionRef!:  ElementRef;

  loading = true;
  hideValues = false;
  data: AnalyticsData | null = null;
  flashingRows: Record<string, 'up' | 'down'> = {};
  pnlHistory: PnlHistory | null = null;
  pnlHistoryLoading = true;

  Math = Math;
  currentInterval: 'daily' | 'weekly' | 'monthly' = 'monthly';

  /** Currently selected stock for the per-stock P&L view (null = consolidated) */
  selectedPnlStock: string | null = null;

  /** Symbols that received a live price update in the last few seconds */
  liveSymbols = new Set<string>();
  private liveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private chartInstances: Chart[] = [];
  private pnlHistoryChart: Chart | null = null;
  private wsSub: Subscription | null = null;
  private _chartDebounce: any;

  // ── Portfolio Tools (Rebalanceo + Dividendos) ──────────────────────────────
  pfToolTab: 'rebalance' | 'dividends' = 'rebalance';

  private pollInterval: any;

  // Rebalanceo
  rebalStocks: { symbol: string; name: string }[] = [];
  rebalTargets: { symbol: string; target: number }[] = [];
  rebalTotalPct = 0;
  rebalLoading  = false;
  rebalError    = '';
  rebalResult: RebalanceResult | null = null;

  // Dividendos
  divLoading   = false;
  divError     = '';
  divResult: DividendListResult | null = null;
  showDivForm  = false;
  divSaving    = false;
  divSaveError = '';
  divStocks: { symbol: string; name: string }[] = [];
  divForm = { stock_symbol: '', shares_held: 0, dividend_per_share_bs: 0, payment_date: '', ex_date: '', notes: '' };

  constructor(
    private http: HttpClient,
    public bvcSocket: BvcSocketService,
    public pushSvc: PushNotificationService,
    private snackBar: MatSnackBar
  ) {}

  async togglePush(): Promise<void> {
    const granted = this.pushSvc.granted$.value;
    const result = granted ? await this.pushSvc.unsubscribe() : await this.pushSvc.subscribe();
    this.snackBar.open(result.message, 'OK', { duration: 5000, panelClass: result.ok ? ['success-snackbar'] : ['error-snackbar'] });
  }

  async testPush(): Promise<void> {
    const result = await this.pushSvc.sendTest();
    this.snackBar.open(result.message, 'OK', { duration: 5000, panelClass: result.ok ? ['success-snackbar'] : ['error-snackbar'] });
  }

  ngOnInit() {
    const savedHide = localStorage.getItem('hideValues');
    if (savedHide !== null) {
      this.hideValues = savedHide === 'true';
    }

    this.fetchAnalytics();
    this.fetchPnlHistory();
    this.bvcSocket.connect();
    this.wsSub = this.bvcSocket.stocksMap$.subscribe(board => this.handleMarketBoard(board));
    this.startPolling();
  }

  toggleHideValues(): void {
    this.hideValues = !this.hideValues;
    localStorage.setItem('hideValues', String(this.hideValues));
  }

  ngOnDestroy() {
    this.chartInstances.forEach(c => c.destroy());
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pnlHistoryChart?.destroy();
    this.wsSub?.unsubscribe();
    this.liveTimers.forEach(t => clearTimeout(t));
  }

  startPolling() {
    this.pollInterval = setInterval(() => {
      this.fetchAnalytics();
    }, 30000); // 30 seconds
  }

  // ── Data fetching ───────────────────────────────────────────────────────────

  setInterval(interval: 'daily' | 'weekly' | 'monthly') {
    this.currentInterval = interval;
    this.initCharts();
  }

  fetchAnalytics() {
    this.http.get<AnalyticsData>(`${environment.apiUrl}/portfolio/analytics`).subscribe({
      next: (res) => {
        // Trigger flash animations if values changed
        if (this.data && res.performance_by_stock) {
          res.performance_by_stock.forEach(newSt => {
            const oldSt = this.data!.performance_by_stock.find(s => s.symbol === newSt.symbol);
            if (oldSt && newSt.current_value !== oldSt.current_value) {
              this.flashingRows[newSt.symbol] = newSt.current_value > oldSt.current_value ? 'up' : 'down';
              setTimeout(() => {
                delete this.flashingRows[newSt.symbol];
              }, 2000);
            }
          });
        }

        this.data = res;
        this.loading = false;
        if (this.chartInstances.length === 0) {
          this.tryInitCharts(0);
        } else {
          this.initCharts();
        }
      },
      error: ()    => { this.loading = false; }
    });
  }

  fetchPnlHistory() {
    this.pnlHistoryLoading = true;
    this.http.get<PnlHistory>(`${environment.apiUrl}/portfolio/pnl-history`).subscribe({
      next: (res) => {
        this.pnlHistory = res;
        this.pnlHistoryLoading = false;
        this.tryInitPnlHistoryChart(0);
      },
      error: () => { this.pnlHistoryLoading = false; }
    });
  }


  // ── P&L history chart ────────────────────────────────────────────────────────

  get pnlHistorySymbols(): string[] {
    if (!this.pnlHistory) return [];
    return Object.keys(this.pnlHistory.per_stock).filter(
      sym => (this.pnlHistory!.per_stock[sym]?.length ?? 0) > 0
    );
  }

  get currentPnlPoints(): PnlPoint[] {
    if (!this.pnlHistory) return [];
    if (!this.selectedPnlStock) return this.pnlHistory.consolidated;
    return this.pnlHistory.per_stock[this.selectedPnlStock] ?? [];
  }

  get bestPnlDay(): PnlPoint | null {
    const pts = this.currentPnlPoints;
    if (!pts.length) return null;
    return pts.reduce((best, p) => p.pnl_usd > best.pnl_usd ? p : best, pts[0]);
  }

  get worstPnlDay(): PnlPoint | null {
    const pts = this.currentPnlPoints;
    if (!pts.length) return null;
    return pts.reduce((worst, p) => p.pnl_usd < worst.pnl_usd ? p : worst, pts[0]);
  }

  selectPnlStock(sym: string | null) {
    this.selectedPnlStock = sym;
    this.initPnlHistoryChart();
  }

  private tryInitPnlHistoryChart(attempt: number) {
    if (attempt > 25) return;
    setTimeout(() => {
      if (this.pnlHistoryChartRef?.nativeElement) this.initPnlHistoryChart();
      else this.tryInitPnlHistoryChart(attempt + 1);
    }, 100);
  }

  initPnlHistoryChart() {
    if (!this.pnlHistory || !this.pnlHistoryChartRef?.nativeElement) return;

    this.pnlHistoryChart?.destroy();

    const ctx    = this.pnlHistoryChartRef.nativeElement.getContext('2d');
    const points = this.currentPnlPoints;
    if (!points.length) return;

    const labels  = points.map(p => p.date);
    const pnlData = points.map(p => p.pnl_usd);
    const maxPnl  = Math.max(...pnlData);
    const minPnl  = Math.min(...pnlData);

    // Gradient: green for positive territory, red for negative
    const gradUp = ctx.createLinearGradient(0, 0, 0, 340);
    gradUp.addColorStop(0,   'rgba(45,217,148,0.45)');
    gradUp.addColorStop(0.6, 'rgba(45,217,148,0.08)');
    gradUp.addColorStop(1,   'rgba(45,217,148,0)');

    const gradDn = ctx.createLinearGradient(0, 0, 0, 340);
    gradDn.addColorStop(0,   'rgba(255,77,106,0.08)');
    gradDn.addColorStop(0.4, 'rgba(255,77,106,0.35)');
    gradDn.addColorStop(1,   'rgba(255,77,106,0.05)');

    const allPositive = minPnl >= 0;
    const allNegative = maxPnl < 0;
    const fillGrad    = allNegative ? gradDn : gradUp;
    const lineColor   = allNegative ? '#FF4D6A' : (allPositive ? '#2DD994' : '#4C62FF');

    const gridColor = 'rgba(255,255,255,0.05)';
    const tickColor = '#475569';

    this.pnlHistoryChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'P&L ($)',
            data: pnlData,
            fill: true,
            backgroundColor: fillGrad,
            borderColor: lineColor,
            borderWidth: 2.5,
            tension: 0.35,
            pointRadius: points.length > 60 ? 0 : 3,
            pointHoverRadius: 7,
            pointBackgroundColor: lineColor,
            pointBorderColor: '#fff',
            pointBorderWidth: 1.5,
          },
          {
            label: 'Costo Base ($)',
            data: points.map(p => p.cost_usd),
            fill: false,
            borderColor: 'rgba(148,163,184,0.3)',
            borderWidth: 1.5,
            borderDash: [6, 4],
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 0,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: tickColor,
              font: { size: 10 },
              maxTicksLimit: 14,
              maxRotation: 0,
            }
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: tickColor,
              font: { size: 10 },
              callback: (v) => '$' + (v as number).toFixed(0)
            }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(13,21,37,0.95)',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            titleColor: '#94a3b8',
            bodyColor: '#fff',
            padding: 12,
            callbacks: {
              label: (c) => {
                const idx   = c.dataIndex;
                const point = points[idx];
                if (c.datasetIndex === 0) {
                  const sign = point.pnl_usd >= 0 ? '+' : '';
                  return [
                    ` P&L: ${sign}$${point.pnl_usd.toFixed(2)}`,
                    ` ROI: ${sign}${point.pnl_pct.toFixed(2)}%`,
                    ` Valor: $${point.value_usd.toFixed(2)}`,
                  ];
                }
                return ` Costo Base: $${point.cost_usd.toFixed(2)}`;
              }
            }
          }
        }
      }
    });
  }

  // ── WebSocket market board updates ──────────────────────────────────────────

  private handleMarketBoard(board: Record<string, any>) {
    if (!this.data || !board || Object.keys(board).length === 0) return;

    let hasChanges = false;
    const bcv = this.data.summary.bcv_rate || 36;

    this.data.performance_by_stock.forEach(stock => {
      const tick = board[stock.symbol];
      if (!tick || !tick.PRECIO) return;

      const newPriceUsd = tick.PRECIO / bcv;
      
      // Si el precio cambió en vivo
      if (Math.abs(stock.unit_price_usd - newPriceUsd) > 0.00001) {
        hasChanges = true;
        this.flashLive(stock.symbol);

        const newValue     = newPriceUsd * stock.quantity;
        const newUnreal    = newValue - stock.total_invested;
        const newTotal     = stock.realized_pnl + newUnreal;
        const newPct       = stock.total_invested > 0
          ? (newTotal / stock.total_invested) * 100
          : 0;

        // Mutate in place so Angular's change detection picks it up
        stock.unit_price_usd  = newPriceUsd;
        stock.current_value   = newValue;
        stock.unrealized_pnl  = newUnreal;
        stock.total_pnl       = newTotal;
        stock.gain_pct        = newPct;
      }
    });

    if (hasChanges) {
      // 1. Recalculate summary totals
      const totalUnreal = this.data.performance_by_stock.reduce(
        (sum, s) => sum + (s.quantity > 0 ? s.unrealized_pnl : 0), 0
      );
      this.data.summary.total_unrealized_pnl = totalUnreal;
      
      // 2. Re-calculate dynamic insights
      const activePositions = this.data.performance_by_stock.filter(s => s.quantity > 0);
      if (activePositions.length > 0) {
        const sortedByPnlDesc = [...activePositions].sort((a,b) => b.total_pnl - a.total_pnl);
        const bestPerf = sortedByPnlDesc[0];
        const worstPerf = sortedByPnlDesc[sortedByPnlDesc.length - 1];

        this.data.insights.best_position = bestPerf.total_pnl > 0 ? { symbol: bestPerf.symbol, gain_usd: bestPerf.total_pnl } : null;
        this.data.insights.worst_position = worstPerf.total_pnl < 0 ? { symbol: worstPerf.symbol, loss_usd: Math.abs(worstPerf.total_pnl) } : null;
        
        const sortedByGainPct = [...activePositions].sort((a,b) => b.gain_pct - a.gain_pct);
        this.data.insights.top_holding_pct = sortedByGainPct[0]?.gain_pct > 0 ? sortedByGainPct[0] : null;

        const sortedByValDesc = [...activePositions].sort((a,b) => b.current_value - a.current_value);
        this.data.insights.top_holdings = sortedByValDesc.slice(0, 10);
      }

      // 3. Update PnlHistory Live Point
      if (this.pnlHistory) {
         const todayDate = new Date().toISOString().split('T')[0];
         // update consolidated
         this.updatePnlPoint(this.pnlHistory.consolidated, todayDate, this.data.summary.total_invested_usd, totalUnreal, this.data.summary.total_invested_usd > 0 ? (totalUnreal / this.data.summary.total_invested_usd)*100 : 0);
         
         // update per-stock
         this.data.performance_by_stock.forEach(s => {
           if (!this.pnlHistory!.per_stock[s.symbol]) this.pnlHistory!.per_stock[s.symbol] = [];
           this.updatePnlPoint(this.pnlHistory!.per_stock[s.symbol], todayDate, s.total_invested, s.unrealized_pnl, s.gain_pct);
         });

         // update History Chart and allocation smoothly
         this.triggerChartUpdate();
      }
    }
  }

  private updatePnlPoint(list: PnlPoint[], dayStr: string, cost: number, currentUnrealized: number, pct: number) {
    let pt = list.find(p => p.date === dayStr);
    if (!pt) {
      pt = { date: dayStr, value_usd: 0, cost_usd: 0, pnl_usd: 0, pnl_pct: 0 };
      list.push(pt);
      // keep history size reasonable horizontally
      if (list.length > 200) list.shift();
    }
    pt.cost_usd = cost;
    pt.pnl_usd = currentUnrealized;
    pt.value_usd = cost + currentUnrealized;
    pt.pnl_pct = pct;
  }

  private triggerChartUpdate() {
    if(this._chartDebounce) clearTimeout(this._chartDebounce);
    this._chartDebounce = setTimeout(() => {
      // Update allocation by stock specifically
      this.data!.allocation.by_stock = [...this.data!.performance_by_stock]
           .filter(s => s.quantity > 0)
           .map(s => ({ name: s.symbol, value: s.current_value }))
           .sort((a,b) => b.value - a.value);

      if (this.chartInstances[0] && (this.chartInstances[0].config as any).type === 'doughnut') {
         this.chartInstances[0].data.labels = this.data!.allocation.by_stock.map(s => s.name);
         this.chartInstances[0].data.datasets[0].data = this.data!.allocation.by_stock.map(s => s.value);
         this.chartInstances[0].update();
      }

      // PNL Bar Chart
      const sortedForPnl = [...this.data!.performance_by_stock].sort((a, b) => b.total_pnl - a.total_pnl);
      const pnlChart = this.chartInstances.find(c => (c.config as any).type === 'bar' && c.data.datasets?.length === 1 && c.data.datasets[0]?.backgroundColor !== '#a855f7');
      if (pnlChart) {
         pnlChart.data.labels = sortedForPnl.map(s => s.symbol);
         pnlChart.data.datasets[0].data = sortedForPnl.map(s => s.total_pnl);
         pnlChart.data.datasets[0].backgroundColor = sortedForPnl.map(s => s.total_pnl >= 0 ? 'rgba(45,217,148,0.75)' : 'rgba(255,77,106,0.75)');
         pnlChart.update();
      }

      // PNL History Line Chart
      if (this.pnlHistoryChart) {
         const points = this.currentPnlPoints;
         if (points.length) {
            const labels = points.map(p => p.date);
            const pnlData = points.map(p => p.pnl_usd);
            const maxPnl = Math.max(...pnlData);
            const minPnl = Math.min(...pnlData);
            const allNegative = maxPnl < 0; 
            const allPositive = minPnl >= 0;
            const lineColor = allNegative ? '#FF4D6A' : (allPositive ? '#2DD994' : '#4C62FF');
            this.pnlHistoryChart.data.labels = labels;
            this.pnlHistoryChart.data.datasets[0].data = pnlData;
            this.pnlHistoryChart.data.datasets[0].borderColor = lineColor;
            (this.pnlHistoryChart.data.datasets[0] as any).pointBackgroundColor = lineColor; // Cast correctly usually fine in JS but TS might complain if strictly checked, it's ok.
            this.pnlHistoryChart.data.datasets[1].data = points.map(p => p.cost_usd);
            this.pnlHistoryChart.update();
         }
      }
    }, 500);
  }

  private flashLive(symbol: string) {
    this.liveSymbols.add(symbol);
    if (this.liveTimers.has(symbol)) clearTimeout(this.liveTimers.get(symbol)!);
    const t = setTimeout(() => {
      this.liveSymbols.delete(symbol);
      this.liveTimers.delete(symbol);
    }, 3000);
    this.liveTimers.set(symbol, t);
  }

  isLive(symbol: string): boolean {
    return this.liveSymbols.has(symbol);
  }

  // ── Total P&L helpers ────────────────────────────────────────────────────────

  get totalPnl(): number {
    if (!this.data) return 0;
    return this.data.summary.total_realized_pnl + this.data.summary.total_unrealized_pnl;
  }

  get totalPnlPct(): number {
    if (!this.data || this.data.summary.total_invested_usd <= 0) return 0;
    return (this.totalPnl / this.data.summary.total_invested_usd) * 100;
  }

  // ── Chart initialisation ─────────────────────────────────────────────────────

  private tryInitCharts(attempt: number) {
    if (attempt > 25) return;
    setTimeout(() => {
      if (this.allocChartRef?.nativeElement) this.initCharts();
      else this.tryInitCharts(attempt + 1);
    }, 100);
  }

  initCharts() {
    if (!this.data) return;
    this.chartInstances.forEach(c => c.destroy());
    this.chartInstances = [];

    const pal = ['#4C62FF','#a855f7','#f472b6','#34d399','#fbbf24','#818cf8','#fb7185','#2dd4bf','#60a5fa','#c084fc'];
    const gridColor = 'rgba(255,255,255,0.05)';
    const tickColor  = '#475569';

    // ── 1. Allocation doughnut ──────────────────────────────────────────────
    if (this.allocChartRef?.nativeElement) {
      const ctx = this.allocChartRef.nativeElement.getContext('2d');
      this.chartInstances.push(new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: this.data.allocation.by_stock.map(s => s.name),
          datasets: [{
            data: this.data.allocation.by_stock.map(s => s.value),
            backgroundColor: pal,
            borderWidth: 2,
            borderColor: '#0d1525',
            hoverOffset: 12
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '72%',
          plugins: {
            legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 11 }, padding: 14, boxWidth: 12 } },
            tooltip: { callbacks: { label: (c) => ` $${(c.parsed as number).toFixed(2)}` } }
          }
        }
      }));
    }

    // ── 2. Investment timeline (cumulative area) ───────────────────────────
    if (this.timelineChartRef?.nativeElement) {
      const ctx  = this.timelineChartRef.nativeElement.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 0, 300);
      grad.addColorStop(0, 'rgba(76,98,255,0.4)');
      grad.addColorStop(1, 'rgba(76,98,255,0)');
      const raw    = this.data.timeline[this.currentInterval] || [];
      let cum = 0;
      const cumData = raw.map(t => { cum += t.value; return Math.round(cum * 100) / 100; });
      this.chartInstances.push(new Chart(ctx, {
        type: 'line',
        data: {
          labels: raw.map(t => t.date),
          datasets: [{
            label: 'Inversión acumulada ($)',
            data: cumData,
            fill: true,
            backgroundColor: grad,
            borderColor: '#4C62FF',
            borderWidth: 2.5,
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 7,
            pointBackgroundColor: '#4C62FF',
            pointBorderColor: '#fff',
            pointBorderWidth: 1.5
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            x: { grid: { display: false }, ticks: { color: tickColor, font: { size: 10 }, maxTicksLimit: 12 } },
            y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 10 }, callback: (v) => '$' + v } }
          },
          plugins: { legend: { display: false } }
        }
      }));
    }

    // ── 3. P&L by stock (horizontal bar, green/red) ────────────────────────
    if (this.pnlChartRef?.nativeElement) {
      const ctx    = this.pnlChartRef.nativeElement.getContext('2d');
      const sorted = [...this.data.performance_by_stock].sort((a, b) => b.total_pnl - a.total_pnl);
      this.chartInstances.push(new Chart(ctx, {
        type: 'bar',
        data: {
          labels: sorted.map(s => s.symbol),
          datasets: [{
            data: sorted.map(s => s.total_pnl),
            backgroundColor: sorted.map(s => s.total_pnl >= 0 ? 'rgba(45,217,148,0.75)' : 'rgba(255,77,106,0.75)'),
            borderRadius: 6,
            barThickness: 22
          }]
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          scales: {
            x: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 10 }, callback: (v) => '$' + v } },
            y: { grid: { display: false }, ticks: { color: '#e2e8f0', font: { size: 12, weight: 'bold' } } }
          },
          plugins: { legend: { display: false },
            tooltip: { callbacks: { label: (c) => ` $${(c.parsed.x as number).toFixed(2)}` } }
          }
        }
      }));
    }

    // ── 4. Broker allocation (horizontal bar) ─────────────────────────────
    if (this.brokerChartRef?.nativeElement) {
      const ctx = this.brokerChartRef.nativeElement.getContext('2d');
      this.chartInstances.push(new Chart(ctx, {
        type: 'bar',
        data: {
          labels: this.data.allocation.by_broker.map(b => b.name),
          datasets: [{
            data: this.data.allocation.by_broker.map(b => b.value),
            backgroundColor: '#a855f7',
            hoverBackgroundColor: '#c084fc',
            borderRadius: 8,
            barThickness: 24
          }]
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          scales: {
            x: { grid: { color: gridColor }, ticks: { color: tickColor, callback: (v) => '$' + v } },
            y: { grid: { display: false }, ticks: { color: '#e2e8f0', font: { size: 11, weight: 'bold' } } }
          },
          plugins: { legend: { display: false } }
        }
      }));
    }

    // ── 5. Buy / Sell counts by stock (grouped bar) ────────────────────────
    if (this.activityChartRef?.nativeElement) {
      const ctx    = this.activityChartRef.nativeElement.getContext('2d');
      const stocks = this.data.performance_by_stock;
      this.chartInstances.push(new Chart(ctx, {
        type: 'bar',
        data: {
          labels: stocks.map(s => s.symbol),
          datasets: [
            { label: 'Compras', data: stocks.map(s => s.buy_count),  backgroundColor: 'rgba(76,98,255,0.8)',  borderRadius: 5, barThickness: 16 },
            { label: 'Ventas',  data: stocks.map(s => s.sell_count), backgroundColor: 'rgba(168,85,247,0.8)', borderRadius: 5, barThickness: 16 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            x: { grid: { display: false }, ticks: { color: tickColor, font: { size: 10 } } },
            y: { grid: { color: gridColor }, ticks: { color: tickColor, precision: 0 } }
          },
          plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 10 } } }
        }
      }));
    }

    // ── 6. Order type doughnut ─────────────────────────────────────────────
    if (this.orderChartRef?.nativeElement) {
      const ctx    = this.orderChartRef.nativeElement.getContext('2d');
      const rt     = this.data.summary.request_types;
      const labels = Object.keys(rt);
      const vals   = Object.values(rt);
      this.chartInstances.push(new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{ data: vals, backgroundColor: ['#4C62FF','#a855f7','#f59e0b'], borderWidth: 2, borderColor: '#0d1525', hoverOffset: 10 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '68%',
          plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 }, padding: 12 } } }
        }
      }));
    }
  }

  // ── Rebalanceo ───────────────────────────────────────────────────────────────

  private get api() { return environment.apiUrl; }
  private get hdr() { return { Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}` }; }

  initRebal() {
    this.http.get<any[]>(`${this.api}/stocks/bvc/active`, { headers: this.hdr }).subscribe({
      next: (res) => {
        this.rebalStocks = (res || []).filter(s => s.symbol !== 'CIE').map(s => ({ symbol: s.symbol, name: s.name }));
        this.rebalTargets = this.rebalStocks.map(s => ({ symbol: s.symbol, target: 0 }));
        // Pre-fill targets from current portfolio allocation
        if (this.data) {
          const total = this.data.summary.total_invested_usd || 1;
          this.data.performance_by_stock.forEach(ps => {
            const t = this.rebalTargets.find(x => x.symbol === ps.symbol);
            if (t) t.target = Math.round(ps.total_invested / total * 100);
          });
          this.updateRebalTotal();
        }
      },
      error: () => {}
    });
  }

  updateRebalTotal() {
    this.rebalTotalPct = this.rebalTargets.reduce((s, t) => s + (t.target || 0), 0);
  }

  runRebalance() {
    const activeTargets = this.rebalTargets.filter(t => t.target > 0);
    if (!activeTargets.length) { this.rebalError = 'Asigna al menos un porcentaje mayor a 0%'; return; }
    this.rebalLoading = true; this.rebalError = ''; this.rebalResult = null;
    const targets: Record<string, number> = {};
    activeTargets.forEach(t => targets[t.symbol] = t.target);
    this.http.post<RebalanceResult>(`${this.api}/portfolio/rebalance`, { targets }, { headers: this.hdr }).subscribe({
      next: (res) => { this.rebalResult = res; this.rebalLoading = false; },
      error: (err) => { this.rebalLoading = false; this.rebalError = err.error?.detail || 'Error calculando rebalanceo'; }
    });
  }

  distributeEqually() {
    const active = this.rebalTargets.filter(t => t.target > 0);
    const pool = active.length ? active : this.rebalTargets;
    const each = Math.floor(100 / pool.length);
    let rem = 100;
    pool.forEach((t, i) => { t.target = i < pool.length - 1 ? each : rem; rem -= each; });
    this.updateRebalTotal();
  }

  clearRebalTargets() {
    this.rebalTargets.forEach(t => t.target = 0);
    this.rebalTotalPct = 0; this.rebalResult = null;
  }

  rebalActionIcon(action: string): string {
    if (action === 'comprar') return 'arrow_upward';
    if (action === 'vender')  return 'arrow_downward';
    return 'remove';
  }

  scrollToTools(tab: 'rebalance' | 'dividends') {
    this.pfToolTab = tab;
    if (tab === 'dividends') this.loadDividends();
    setTimeout(() => {
      this.toolsSectionRef?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  // ── Dividendos ───────────────────────────────────────────────────────────────

  loadDividends() {
    if (this.divLoading) return;
    this.divLoading = true; this.divError = '';
    if (!this.divStocks.length) {
      this.http.get<any[]>(`${this.api}/stocks/bvc/active`, { headers: this.hdr }).subscribe({
        next: (res) => { this.divStocks = (res || []).filter(s => s.symbol !== 'CIE').map(s => ({ symbol: s.symbol, name: s.name })); },
        error: () => {}
      });
    }
    this.http.get<DividendListResult>(`${this.api}/dividends/`, { headers: this.hdr }).subscribe({
      next: (res) => { this.divResult = res; this.divLoading = false; },
      error: (err) => { this.divLoading = false; this.divError = err.error?.detail || 'Error cargando dividendos'; }
    });
  }

  saveDividend() {
    if (!this.divForm.stock_symbol || !this.divForm.payment_date || !this.divForm.shares_held || !this.divForm.dividend_per_share_bs) {
      this.divSaveError = 'Completa todos los campos requeridos'; return;
    }
    this.divSaving = true; this.divSaveError = '';
    this.http.post<any>(`${this.api}/dividends/`, { ...this.divForm, stock_symbol: this.divForm.stock_symbol.toUpperCase(), ex_date: this.divForm.ex_date || null }, { headers: this.hdr }).subscribe({
      next: () => {
        this.divSaving = false; this.showDivForm = false;
        this.divForm = { stock_symbol: '', shares_held: 0, dividend_per_share_bs: 0, payment_date: '', ex_date: '', notes: '' };
        this.divResult = null; this.loadDividends();
      },
      error: (err) => { this.divSaving = false; this.divSaveError = err.error?.detail || 'Error guardando dividendo'; }
    });
  }

  deleteDividend(id: number) {
    this.http.delete(`${this.api}/dividends/${id}`, { headers: this.hdr }).subscribe({
      next: () => { this.divResult = null; this.loadDividends(); },
      error: () => {}
    });
  }
}
