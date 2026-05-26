import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { environment } from '../../environments/environment';
import { BvcSocketService } from '../core/services/bvc-socket.service';
import { Subscription } from 'rxjs';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

interface SeasonMonth {
  month: number;
  month_name: string;
  avg_return_pct: number | null;
  positive_years: number;
  negative_years: number;
  total_years: number;
  win_rate: number | null;
  best_year_pct?: number;
  worst_year_pct?: number;
}

interface SeasonalityResult {
  symbol: string;
  name: string;
  data_years: number;
  seasonality: SeasonMonth[];
  best_month: SeasonMonth;
  worst_month: SeasonMonth;
}

interface BacktestChartPoint {
  date: string;
  price: number;
}

interface BacktestResult {
  symbol: string; name: string; entry_date: string; exit_date: string;
  entry_price_bs: number; exit_price_bs: number; shares_bought: number;
  invested_bs: number; current_value_bs: number; gain_bs: number; return_pct: number;
  invested_usd: number; current_value_usd: number; gain_usd: number; return_usd_pct: number;
  bcv_entry: number; bcv_exit: number; chart_series: BacktestChartPoint[];
}

interface LiquidityStock {
  symbol: string; name: string; avg_volume: number; max_volume: number;
  trading_days_90d: number; last_price_bs: number | null;
  last_date: string | null; liquidity_score: number;
}

interface LiquidityResult {
  stocks: LiquidityStock[];
  total: number;
}

interface CorrelationResult {
  symbols: {symbol: string, name: string}[];
  matrix: (number | null)[][];
  common_months: number;
  note: string;
}

interface SharpeSym {
  symbol: string; weight_pct: number; avg_monthly_return_pct: number;
  annualized_return_pct: number; annualized_volatility_pct: number;
  sharpe_usd: number | null;
}
interface SharpeResult {
  months_used: number; mean_monthly_return_pct: number;
  annualized_return_pct: number; annualized_volatility_pct: number;
  sharpe_usd: number | null; sharpe_bs_inflation: number | null;
  risk_free_usd_pct: number; risk_free_bs_pct: number;
  per_stock: SharpeSym[];
  monthly_chart: { month: string; return_pct: number }[];
  interpretation: string;
  error?: string;
}

interface AdvancedMetrics {
  symbol: string; name: string; data_years: number;
  total_return_pct: number; cagr_pct: number;
  max_drawdown_pct: number; max_drawdown_peak_date: string; max_drawdown_trough_date: string;
  vol_monthly_pct: number; vol_annual_pct: number;
  sortino_ratio: number | null; calmar_ratio: number | null;
  var_95_monthly_pct: number;
  monthly_returns: { month: string; return_pct: number }[];
  heatmap: { year: number; months: { month: string; return_pct: number | null }[] }[];
  heatmap_months: string[];
  first_date: string; last_date: string;
  first_price_bs: number; last_price_bs: number;
}

interface CandleHeatmapDay {
  dow: number;
  dow_name: string;
  candle_count: number;
  avg_return_pct: number;
  win_rate: number;
  avg_range_pct: number;
  avg_volume: number;
  is_best_return: boolean;
  is_worst_return: boolean;
}

interface CandleHeatmapResult {
  symbol: string;
  name: string;
  total_candles: number;
  data_years: number;
  days: CandleHeatmapDay[];
}

interface CointPair {
  sym_a: string; name_a: string;
  sym_b: string; name_b: string;
  hedge_ratio: number;
  adf_t_stat: number;
  z_score: number;
  half_life_months: number | null;
  common_months: number;
  signal: string;
  signal_strength: number;
}
interface CointResult {
  pairs: CointPair[];
  total_pairs_tested: number;
  cointegrated_found: number;
  note: string;
}

interface WFWindow {
  window: number;
  train_start: string; train_end: string;
  val_start: string;   val_end: string;
  in_sample:  { total_return_pct: number; trades: number; win_rate: number };
  out_sample: { total_return_pct: number; trades: number; win_rate: number };
  bh_train_pct: number; bh_val_pct: number;
  efficiency_ratio: number;
}
interface WFResult {
  symbol: string; name: string;
  strategy: string; train_months: number; val_months: number;
  windows: WFWindow[];
  summary: {
    avg_in_sample_pct: number; avg_out_sample_pct: number;
    avg_efficiency: number; verdict: string; verdict_note: string;
    total_windows: number;
  };
}

// ── Rolling Correlation ────────────────────────────────────────────────────
interface RollingCorrPair {
  sym_a: string; name_a: string;
  sym_b: string; name_b: string;
  corr_short: number | null;
  corr_long:  number | null;
  window_short: number; window_long: number;
  divergence: number | null;
  signal: string | null;
}
interface RollingCorrResult {
  window_short: number; window_long: number;
  pairs: RollingCorrPair[];
  note: string;
}

// ── Smart Beta ─────────────────────────────────────────────────────────────
interface SmartBetaStock {
  symbol: string; name: string;
  current_weight_pct: number;
  minvol_weight_pct: number;
  momentum_weight_pct: number;
  annualized_vol_pct: number;
  '6m_return_pct': number;
}
interface SmartBetaSuggestion {
  symbol: string; name: string;
  current_pct: number; minvol_pct: number; delta_pct: number;
  action: string; rationale: string;
}
interface SmartBetaResult {
  total_value_bs: number;
  stocks: SmartBetaStock[];
  portfolio_var_95: { current_pct: number; minvol_pct: number; momentum_pct: number };
  var_reduction_if_minvol_pct: number;
  rebalancing_suggestions: SmartBetaSuggestion[];
  note: string;
}

// ── Stress Test ────────────────────────────────────────────────────────────
interface StressPoint { date: string; value: number; }
interface StressStockImpact {
  symbol: string; name: string;
  weight_pct: number; period_return_pct: number; contribution_pct: number;
}
interface StressResult {
  scenario: string; scenario_name: string; scenario_description: string;
  period_start: string; period_end: string; trading_days: number;
  total_return_pct: number; max_drawdown_pct: number; final_value: number;
  equity_curve: StressPoint[];
  per_stock_impact: StressStockImpact[];
  note: string;
}

// ── WTI Correlation ────────────────────────────────────────────────────────
interface WtiStock {
  symbol: string; name: string;
  corr_full: number; corr_90d: number | null;
  common_days: number; label: string;
}
interface WtiResult {
  wti_data_points: number; wti_latest_date: string | null;
  stocks: WtiStock[];
  note: string;
}

// ── GARCH(1,1) ─────────────────────────────────────────────────────────────────
interface GarchResult {
  symbol: string; name: string; model: string; data_points: number;
  omega: number; alpha: number; beta: number;
  persistence: number; half_life_days: number | null;
  long_run_vol_pct: number; current_vol_pct: number;
  forecast_1d_vol_pct: number; forecast_5d_vol_pct: number; forecast_22d_vol_pct: number;
  vol_regime: string; interpretation: string;
  vol_series_60d: number[]; vol_series_dates: string[];
  note: string;
}

// ── ML Prediction ──────────────────────────────────────────────────────────────
interface MlWFWindow {
  train_size: number; val_size: number;
  in_sample_acc_pct: number; out_sample_acc_pct: number;
}
interface MlFeatureImportance {
  feature: string; weight: number; importance_pct: number;
}
interface MlPredictResult {
  symbol: string; name: string; model: string;
  features: string[]; data_points: number;
  prediction: {
    direction: string; prob_up: number; prob_down: number;
    confidence_pct: number; last_close: number; last_date: string;
  };
  walk_forward: MlWFWindow[];
  avg_oos_accuracy_pct: number;
  recent_30d_accuracy_pct: number;
  is_usable: boolean; warning: string;
  feature_importance: MlFeatureImportance[];
  note: string;
}

// ── Efficient Frontier ────────────────────────────────────────────────────────
interface EFScatterPoint { vol: number; ret: number; sharpe: number; }
interface EFFrontierPoint { vol: number; ret: number; }
interface EFWeight { symbol: string; name: string; weight_pct: number; }
interface EFKeyPort {
  label: string; vol_pct: number; ret_pct: number; sharpe: number; weights: EFWeight[];
}
interface EFResult {
  symbols: { symbol: string; name: string }[];
  scatter: EFScatterPoint[];
  frontier: EFFrontierPoint[];
  key_portfolios: { current: EFKeyPort; min_vol: EFKeyPort; max_sharpe: EFKeyPort };
  n_portfolios: number; note: string;
}

// ── CVaR / Expected Shortfall ─────────────────────────────────────────────────
interface CvarDistribution {
  mean_daily_pct: number; std_daily_pct: number;
  ann_vol_pct: number; ann_return_pct: number;
  skewness: number; excess_kurtosis: number; is_fat_tailed: boolean;
}
interface CvarContrib {
  symbol: string; name: string; weight_pct: number; cvar_contribution_pct: number;
}
interface CvarResult {
  confidence_pct: number; data_days: number;
  date_range: { from: string; to: string };
  var_pct: number; cvar_pct: number; cvar_usd: number | null;
  tail_observations: number; tail_label: string;
  distribution: CvarDistribution;
  stock_cvar_contributions: CvarContrib[];
  histogram: { bucket: number }[];
  note: string;
}

@Component({
  selector: 'app-analisis',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink,
    MatIconModule, MatProgressSpinnerModule, MatTooltipModule,
  ],
  templateUrl: './analisis.component.html',
  styleUrls: ['./analisis.component.scss'],
})
export class AnalisisComponent implements OnInit, OnDestroy {
  @ViewChild('seasonChart')  seasonChartRef!:  ElementRef<HTMLCanvasElement>;
  @ViewChild('btChart')      btChartRef!:      ElementRef<HTMLCanvasElement>;
  @ViewChild('sharpeChart')  sharpeChartRef!:  ElementRef<HTMLCanvasElement>;
  @ViewChild('advChart')     advChartRef!:     ElementRef<HTMLCanvasElement>;
  @ViewChild('ddChart')      ddChartRef!:      ElementRef<HTMLCanvasElement>;

  private api = environment.apiUrl;
  private headers() { return { Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}` }; }
  private seasonChart: Chart | null = null;
  private btChart:     Chart | null = null;
  private sharpeChart: Chart | null = null;
  private advChart:    Chart | null = null;
  private ddChart:     Chart | null = null;

  Math = Math;

  activeTab: 'season' | 'backtest' | 'liquidity' | 'correlation' | 'sharpe' | 'advanced' | 'heatmap' | 'cointeg' | 'walkfwd' | 'rollingcorr' | 'smartbeta' | 'stress' | 'wti' | 'garch' | 'mlpredict' | 'frontier' | 'cvar' | 'cape' | 'monthend' | 'breakout' | 'whatif' | 'bias' | 'patterns' = 'season';

  // ── Liquidity ───────────────────────────────────────────────────────────────
  liqLoading = false;
  liqError   = '';
  liqResult: LiquidityResult | null = null;

  // ── Correlation ─────────────────────────────────────────────────────────────
  corrMonths  = 0;
  corrLoading = false;
  corrError   = '';
  corrResult: CorrelationResult | null = null;

  // ── Sharpe ──────────────────────────────────────────────────────────────────
  sharpeLoading = false;
  sharpeError   = '';
  sharpeResult: SharpeResult | null = null;

  // ── Seasonality ─────────────────────────────────────────────────────────────
  seasonSymbol = '';
  seasonLoading = false;
  seasonError   = '';
  seasonResult: SeasonalityResult | null = null;

  // ── Backtest ────────────────────────────────────────────────────────────────
  btSymbol  = '';
  btMonths  = 12;
  btAmount  = 10000;
  btLoading = false;
  btError   = '';
  btResult: BacktestResult | null = null;

  // ── Advanced Metrics ────────────────────────────────────────────────────────
  advSymbol  = '';
  advLoading = false;
  advError   = '';
  advResult: AdvancedMetrics | null = null;
  showHeatmap = false;

  // ── Candle Heatmap ──────────────────────────────────────────────────────────
  hmSymbol  = '';
  hmLoading = false;
  hmError   = '';
  hmResult: CandleHeatmapResult | null = null;

  // ── Cointegration ───────────────────────────────────────────────────────────
  cointLoading = false;
  cointError   = '';
  cointResult: CointResult | null = null;
  cointMinMonths = 18;

  // ── Walk-Forward ────────────────────────────────────────────────────────────
  wfSymbol    = '';
  wfStrategy  = 'ma_cross';
  wfTrain     = 36;
  wfVal       = 12;
  wfLoading   = false;
  wfError     = '';
  wfResult: WFResult | null = null;

  // ── Rolling Correlation ─────────────────────────────────────────────────────
  rcLoading = false;
  rcError   = '';
  rcResult: RollingCorrResult | null = null;
  rcWindow  = 30;

  // ── Smart Beta ──────────────────────────────────────────────────────────────
  sbLoading = false;
  sbError   = '';
  sbResult: SmartBetaResult | null = null;

  // ── Stress Test ─────────────────────────────────────────────────────────────
  stLoading  = false;
  stError    = '';
  stResult: StressResult | null = null;
  stScenario = 'hyperinflation_2021';
  stCustomStart = '';
  stCustomEnd   = '';
  stScenarios = [
    { key: 'hyperinflation_2021', label: '⚡ Hiper-Bache Venezuela (Jul–Sep 2021)' },
    { key: 'covid_2020',          label: '🦠 Crash COVID-19 (Feb–Abr 2020)' },
    { key: 'petro_crash_2015',    label: '🛢 Desplome Petróleo (Sep 2014–Mar 2015)' },
    { key: 'bvc_recovery_2022',   label: '📈 Rally BVC (Ene–Jun 2022)' },
    { key: 'custom',              label: '📅 Personalizado' },
  ];
  private stChart: Chart | null = null;
  @ViewChild('stChart') stChartRef!: ElementRef<HTMLCanvasElement>;

  // ── WTI Correlation ─────────────────────────────────────────────────────────
  wtiLoading = false;
  wtiError   = '';
  wtiResult: WtiResult | null = null;
  wtiDays    = 0;

  // ── GARCH(1,1) ───────────────────────────────────────────────────────────────
  garchSymbol  = '';
  garchLoading = false;
  garchError   = '';
  garchResult: GarchResult | null = null;
  @ViewChild('garchChart') garchChartRef!: ElementRef<HTMLCanvasElement>;
  private garchChart: Chart | null = null;

  // ── ML Prediction ────────────────────────────────────────────────────────────
  mlSymbol  = '';
  mlLoading = false;
  mlError   = '';
  mlResult: MlPredictResult | null = null;

  // ── Efficient Frontier ───────────────────────────────────────────────────────
  efLoading = false;
  efError   = '';
  efResult: EFResult | null = null;
  efSelectedPort: 'current' | 'min_vol' | 'max_sharpe' = 'current';
  @ViewChild('efChart') efChartRef!: ElementRef<HTMLCanvasElement>;
  private efChart: Chart | null = null;

  // ── CVaR ─────────────────────────────────────────────────────────────────────
  cvarConfidence = 0.95;
  cvarLoading    = false;
  cvarError      = '';
  cvarResult: CvarResult | null = null;
  @ViewChild('cvarChart') cvarChartRef!: ElementRef<HTMLCanvasElement>;
  private cvarChart: Chart | null = null;

  // ── CAPE / PE Relativo ───────────────────────────────────────────────────────
  capeSymbol = '';
  capeLoading = false;
  capeError = '';
  capeResult: any = null;

  // ── Month-End Effect ─────────────────────────────────────────────────────────
  meSymbol = '';
  meLoading = false;
  meError = '';
  meResult: any = null;

  // ── Breakout Scanner ─────────────────────────────────────────────────────────
  brLoading = false;
  brError = '';
  brResult: any = null;
  brWindow = 20;

  // ── What-If Portfolio Comparator ─────────────────────────────────────────────
  wifLoading = false;
  wifError = '';
  wifResult: any = null;
  wifWeights: { symbol: string; weight: number }[] = [];
  wifMonths = 12;

  // ── Confirmation Bias (counter-arguments) ────────────────────────────────────
  cbSymbol = '';
  cbLoading = false;
  cbError = '';
  cbResult: any = null;

  // ── Algorithmic Candle Patterns ──────────────────────────────────────────────
  patSymbol = '';
  patLoading = false;
  patError = '';
  patResult: any = null;
  patLookback = 60;

  // ── Available stocks ────────────────────────────────────────────────────────
  stocks: { symbol: string; name: string }[] = [];
  marketBoard: Record<string, any> = {};
  private wsSub: Subscription | null = null;

  constructor(private http: HttpClient, private bvcSocket: BvcSocketService) {}

  ngOnInit() {
    this.bvcSocket.connect();
    this.wsSub = this.bvcSocket.stocksMap$.subscribe(board => this.marketBoard = board);
    this.http.get<any[]>(`${this.api}/stocks/bvc/active`, { headers: this.headers() }).subscribe({
      next: (res) => {
        this.stocks = res
          .filter(s => s.symbol !== 'CIE')
          .map(s => ({ symbol: s.symbol, name: s.name }));
      },
      error: () => {}
    });
  }

  ngOnDestroy() {
    this.wsSub?.unsubscribe();
    this.seasonChart?.destroy();
    this.btChart?.destroy();
    this.sharpeChart?.destroy();
    this.advChart?.destroy();
    this.ddChart?.destroy();
    this.stChart?.destroy();
    this.garchChart?.destroy();
    this.efChart?.destroy();
    this.cvarChart?.destroy();
  }

  /** Get live price for a symbol from the WS feed */
  livePrice(symbol: string): number | null {
    const tick = this.marketBoard[symbol];
    return tick?.PRECIO ?? null;
  }

  /** Live intraday % change for a symbol */
  liveVarRel(symbol: string): number | null {
    return this.marketBoard[symbol]?.VAR_REL ?? null;
  }

  /** Compute live backtest value using current WS price */
  get liveBtValue(): { priceBS: number; valueBs: number; valueUsd: number; gainBs: number; gainUsd: number; returnPct: number } | null {
    if (!this.btResult) return null;
    const tick = this.marketBoard[this.btResult.symbol];
    if (!tick?.PRECIO) return null;
    const livePrice = tick.PRECIO as number;
    const bcv = this.btResult.bcv_exit || 36;
    const valueBs  = this.btResult.shares_bought * livePrice;
    const valueUsd = valueBs / bcv;
    const gainBs   = valueBs - this.btResult.invested_bs;
    const gainUsd  = valueUsd - this.btResult.invested_usd;
    const returnPct = this.btResult.invested_bs > 0 ? (gainBs / this.btResult.invested_bs) * 100 : 0;
    return { priceBS: livePrice, valueBs, valueUsd, gainBs, gainUsd, returnPct };
  }

  onTabChange(tab: typeof this.activeTab) {
    this.activeTab = tab;
    if (tab === 'liquidity'   && !this.liqResult    && !this.liqLoading)    this.runLiquidity();
    if (tab === 'correlation' && !this.corrResult   && !this.corrLoading)   this.runCorrelation();
    if (tab === 'sharpe'      && !this.sharpeResult && !this.sharpeLoading) this.runSharpe();
    if (tab === 'cointeg'     && !this.cointResult  && !this.cointLoading)  this.runCointegration();
    if (tab === 'rollingcorr' && !this.rcResult     && !this.rcLoading)     this.runRollingCorr();
    if (tab === 'smartbeta'   && !this.sbResult     && !this.sbLoading)     this.runSmartBeta();
    if (tab === 'stress'      && !this.stResult     && !this.stLoading)     this.runStressTest();
    if (tab === 'wti'         && !this.wtiResult    && !this.wtiLoading)    this.runWtiCorrelation();
    if (tab === 'frontier'    && !this.efResult     && !this.efLoading)     this.runEfficientFrontier();
    if (tab === 'cvar'        && !this.cvarResult   && !this.cvarLoading)   this.runCvar();
  }

  // ── Rolling Correlation ────────────────────────────────────────────────────
  runRollingCorr() {
    this.rcLoading = true; this.rcError = ''; this.rcResult = null;
    this.http.get<RollingCorrResult>(
      `${this.api}/portfolio/rolling-correlation?window=${this.rcWindow}`,
      { headers: this.headers() }
    ).subscribe({
      next: (res) => { this.rcResult = res; this.rcLoading = false; },
      error: (err) => { this.rcLoading = false; this.rcError = err.error?.detail || 'Error calculando correlación rodante'; },
    });
  }

  // ── Smart Beta ─────────────────────────────────────────────────────────────
  runSmartBeta() {
    this.sbLoading = true; this.sbError = ''; this.sbResult = null;
    this.http.get<SmartBetaResult>(`${this.api}/portfolio/smart-beta`, { headers: this.headers() }).subscribe({
      next: (res) => { this.sbResult = res; this.sbLoading = false; },
      error: (err) => { this.sbLoading = false; this.sbError = err.error?.detail || 'Error calculando Smart Beta'; },
    });
  }

  // ── Stress Test ────────────────────────────────────────────────────────────
  runStressTest() {
    this.stLoading = true; this.stError = ''; this.stResult = null;
    this.stChart?.destroy(); this.stChart = null;
    const custom = this.stScenario === 'custom';
    const params = custom
      ? `scenario=hyperinflation_2021&custom_start=${this.stCustomStart}&custom_end=${this.stCustomEnd}`
      : `scenario=${this.stScenario}`;
    this.http.get<StressResult>(`${this.api}/portfolio/stress-test?${params}`, { headers: this.headers() }).subscribe({
      next: (res) => {
        this.stResult = res;
        this.stLoading = false;
        setTimeout(() => this.drawStressChart(), 100);
      },
      error: (err) => { this.stLoading = false; this.stError = err.error?.detail || 'Error ejecutando stress test'; },
    });
  }

  private drawStressChart() {
    const el = this.stChartRef?.nativeElement;
    if (!el || !this.stResult) return;
    this.stChart?.destroy();
    const curve = this.stResult.equity_curve;
    const isUp  = this.stResult.total_return_pct >= 0;
    const solid = isUp ? '#2dd994' : '#ff4d6a';
    const fill  = isUp ? 'rgba(45,217,148,0.15)' : 'rgba(255,77,106,0.15)';
    const grid  = 'rgba(255,255,255,0.06)';
    const tick  = 'rgba(255,255,255,0.38)';
    this.stChart = new Chart(el, {
      type: 'line',
      data: {
        labels: curve.map(p => p.date),
        datasets: [{
          label: 'Valor del Portafolio (base 100)',
          data: curve.map(p => p.value),
          borderColor: solid,
          backgroundColor: fill,
          borderWidth: 2,
          fill: true,
          pointRadius: 0,
          tension: 0.3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(13,21,37,0.92)',
            borderColor: 'rgba(255,255,255,0.12)',
            borderWidth: 1,
            titleColor: '#fff',
            bodyColor: 'rgba(255,255,255,0.65)',
            callbacks: {
              label: (c: any) => ` Valor: ${Number(c.raw).toFixed(2)}`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: tick, maxTicksLimit: 8, font: { size: 11 } },
            grid: { color: grid },
            border: { color: grid },
          },
          y: {
            ticks: { color: tick, font: { size: 11 }, callback: (v: any) => v.toFixed(0) },
            grid: { color: grid },
            border: { color: grid },
          },
        },
      },
    });
  }

  // ── WTI Correlation ────────────────────────────────────────────────────────
  runWtiCorrelation() {
    this.wtiLoading = true; this.wtiError = ''; this.wtiResult = null;
    const daysParam = this.wtiDays > 0 ? `?days=${this.wtiDays}` : '';
    this.http.get<WtiResult>(`${this.api}/stocks/correlate-wti${daysParam}`, { headers: this.headers() }).subscribe({
      next: (res) => { this.wtiResult = res; this.wtiLoading = false; },
      error: (err) => { this.wtiLoading = false; this.wtiError = err.error?.detail || 'Error calculando correlación WTI'; },
    });
  }

  wtiCorrColor(corr: number): string {
    if (corr >= 0.5)  return '#3fb950';
    if (corr >= 0.25) return '#a371f7';
    if (corr <= -0.5) return '#f85149';
    if (corr <= -0.25) return '#ffa657';
    return '#8b949e';
  }

  // ── Liquidity ────────────────────────────────────────────────────────────────

  runLiquidity() {
    if (this.liqLoading) return;
    this.liqLoading = true;
    this.liqError   = '';
    this.liqResult  = null;
    this.http.get<LiquidityResult>(`${this.api}/portfolio/liquidity`, { headers: this.headers() }).subscribe({
      next: (res) => { this.liqResult = res; this.liqLoading = false; },
      error: (err) => { this.liqLoading = false; this.liqError = err.error?.detail || 'Error cargando liquidez'; }
    });
  }

  scoreColor(score: number): string {
    if (score >= 70) return 'score-high';
    if (score >= 35) return 'score-mid';
    return 'score-low';
  }

  scoreLabel(score: number): string {
    if (score >= 70) return 'Alta';
    if (score >= 35) return 'Media';
    return 'Baja';
  }

  // ── Correlation ───────────────────────────────────────────────────────────────

  runCorrelation() {
    if (this.corrLoading) return;
    this.corrLoading = true;
    this.corrError   = '';
    this.corrResult  = null;
    this.http.get<CorrelationResult>(`${this.api}/portfolio/correlation?months=${this.corrMonths}`, { headers: this.headers() }).subscribe({
      next: (res) => { this.corrResult = res; this.corrLoading = false; },
      error: (err) => { this.corrLoading = false; this.corrError = err.error?.detail || 'Error calculando correlaciones'; }
    });
  }

  corrCell(val: number | null): string {
    if (val === null) return '—';
    return val.toFixed(2);
  }

  corrClass(val: number | null): string {
    if (val === null || val === 1) return 'corr-diag';
    if (val >=  0.7) return 'corr-high-pos';
    if (val >=  0.3) return 'corr-mid-pos';
    if (val <= -0.7) return 'corr-high-neg';
    if (val <= -0.3) return 'corr-mid-neg';
    return 'corr-neutral';
  }

  // ── Sharpe ────────────────────────────────────────────────────────────────────

  runSharpe() {
    if (this.sharpeLoading) return;
    this.sharpeLoading = true;
    this.sharpeError   = '';
    this.sharpeResult  = null;
    this.sharpeChart?.destroy();
    this.http.get<SharpeResult>(`${this.api}/portfolio/sharpe`, { headers: this.headers() }).subscribe({
      next: (res) => {
        this.sharpeResult  = res;
        this.sharpeLoading = false;
        setTimeout(() => this.drawSharpeChart(), 80);
      },
      error: (err) => { this.sharpeLoading = false; this.sharpeError = err.error?.detail || 'Error calculando Sharpe'; }
    });
  }

  sharpeLabel(val: number | null): string {
    if (val === null) return 'N/D';
    if (val >= 2)  return '★★★ Excelente';
    if (val >= 1)  return '★★☆ Bueno';
    if (val >= 0)  return '★☆☆ Aceptable';
    return '✗ Negativo';
  }

  sharpeClass(val: number | null): string {
    if (val === null)  return '';
    if (val >= 1)  return 'txt-up';
    if (val >= 0)  return 'txt-warn';
    return 'txt-dn';
  }

  private drawSharpeChart() {
    if (!this.sharpeChartRef?.nativeElement || !this.sharpeResult) return;
    this.sharpeChart?.destroy();
    const ctx  = this.sharpeChartRef.nativeElement.getContext('2d')!;
    const data = this.sharpeResult.monthly_chart;
    const colors = data.map(d => d.return_pct >= 0 ? 'rgba(45,217,148,0.8)' : 'rgba(255,77,106,0.8)');

    this.sharpeChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map(d => d.month),
        datasets: [{ label: 'Retorno portafolio (%)', data: data.map(d => d.return_pct), backgroundColor: colors, borderRadius: 4, borderSkipped: false }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${(c.raw as number).toFixed(2)}%` } } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8898aa', maxTicksLimit: 12 } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8898aa', callback: (v) => v + '%' } }
        }
      }
    });
  }

  // ── Seasonality ─────────────────────────────────────────────────────────────

  runSeasonality() {
    if (!this.seasonSymbol || this.seasonLoading) return;
    this.seasonLoading = true;
    this.seasonError   = '';
    this.seasonResult  = null;
    this.seasonChart?.destroy();

    this.http.get<SeasonalityResult>(
      `${this.api}/portfolio/seasonality?symbol=${encodeURIComponent(this.seasonSymbol)}`,
      { headers: this.headers() }
    ).subscribe({
      next: (res) => {
        this.seasonResult  = res;
        this.seasonLoading = false;
        setTimeout(() => this.drawSeasonChart(), 80);
      },
      error: (err) => {
        this.seasonLoading = false;
        this.seasonError = err.error?.detail || 'Error obteniendo datos de estacionalidad';
      }
    });
  }

  private drawSeasonChart() {
    if (!this.seasonChartRef?.nativeElement || !this.seasonResult) return;
    this.seasonChart?.destroy();
    const ctx    = this.seasonChartRef.nativeElement.getContext('2d')!;
    const months = this.seasonResult.seasonality;
    const labels = months.map(m => m.month_name);
    const data   = months.map(m => m.avg_return_pct ?? 0);
    const colors = data.map(v => v >= 0 ? 'rgba(45,217,148,0.85)' : 'rgba(255,77,106,0.85)');

    this.seasonChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: 'Retorno promedio mensual (%)', data, backgroundColor: colors, borderRadius: 6, borderSkipped: false }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const m = months[ctx.dataIndex];
                const v = m.avg_return_pct;
                const wr = m.win_rate;
                return [
                  `Retorno: ${v != null ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%' : 'N/D'}`,
                  `Win rate: ${wr != null ? wr.toFixed(0) + '%' : 'N/D'} (${m.positive_years}↑ ${m.negative_years}↓)`,
                ];
              }
            }
          }
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8898aa' } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8898aa', callback: (v) => v + '%' } }
        }
      }
    });
  }

  seasonColor(val: number | null): string {
    if (val == null) return '';
    return val >= 0 ? 'txt-up' : 'txt-dn';
  }

  barWidth(val: number | null, max: number): number {
    if (val == null || max === 0) return 0;
    return Math.min(100, Math.abs(val) / max * 100);
  }

  get seasonMax(): number {
    if (!this.seasonResult) return 1;
    return Math.max(...this.seasonResult.seasonality.map(m => Math.abs(m.avg_return_pct ?? 0)), 0.01);
  }

  // ── Backtest ────────────────────────────────────────────────────────────────

  runBacktest() {
    if (!this.btSymbol || this.btLoading) return;
    this.btLoading = true;
    this.btError   = '';
    this.btResult  = null;
    this.btChart?.destroy();

    const url = `${this.api}/portfolio/backtest?symbol=${encodeURIComponent(this.btSymbol)}&months_ago=${this.btMonths}&amount_bs=${this.btAmount}`;
    this.http.get<BacktestResult>(url, { headers: this.headers() }).subscribe({
      next: (res) => {
        this.btResult  = res;
        this.btLoading = false;
        setTimeout(() => this.drawBtChart(), 80);
      },
      error: (err) => {
        this.btLoading = false;
        this.btError = err.error?.detail || 'Error ejecutando backtesting';
      }
    });
  }

  private drawBtChart() {
    if (!this.btChartRef?.nativeElement || !this.btResult) return;
    this.btChart?.destroy();
    const ctx    = this.btChartRef.nativeElement.getContext('2d')!;
    const series = this.btResult.chart_series;
    const isUp   = this.btResult.return_pct >= 0;
    const grad   = ctx.createLinearGradient(0, 0, 0, 280);
    if (isUp) { grad.addColorStop(0, 'rgba(45,217,148,0.4)'); grad.addColorStop(1, 'rgba(45,217,148,0)'); }
    else       { grad.addColorStop(0, 'rgba(255,77,106,0.4)');  grad.addColorStop(1, 'rgba(255,77,106,0)'); }

    this.btChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: series.map(p => p.date),
        datasets: [{ label: `${this.btResult.symbol} Bs`, data: series.map(p => p.price), borderColor: isUp ? '#2dd994' : '#FF4D6A', borderWidth: 2, pointRadius: 0, fill: true, backgroundColor: grad, tension: 0.3 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `Bs ${(ctx.raw as number).toFixed(4)}` } } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8898aa', maxTicksLimit: 8 } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8898aa' } }
        }
      }
    });
  }

  // ── Advanced Metrics ─────────────────────────────────────────────────────────

  runAdvancedMetrics() {
    if (!this.advSymbol || this.advLoading) return;
    this.advLoading = true;
    this.advError   = '';
    this.advResult  = null;
    this.showHeatmap = false;
    this.advChart?.destroy();
    this.ddChart?.destroy();

    this.http.get<AdvancedMetrics>(
      `${this.api}/portfolio/advanced-metrics?symbol=${encodeURIComponent(this.advSymbol)}`,
      { headers: this.headers() }
    ).subscribe({
      next: (res) => {
        this.advResult  = res;
        this.advLoading = false;
        setTimeout(() => this.drawAdvCharts(), 80);
      },
      error: (err) => {
        this.advLoading = false;
        this.advError = err.error?.detail || 'Error obteniendo métricas avanzadas';
      }
    });
  }

  private drawAdvCharts() {
    this.drawAdvMonthlyChart();
    this.loadAndDrawDrawdown();
  }

  private drawAdvMonthlyChart() {
    if (!this.advChartRef?.nativeElement || !this.advResult) return;
    this.advChart?.destroy();
    const ctx  = this.advChartRef.nativeElement.getContext('2d')!;
    const data = this.advResult.monthly_returns;
    const colors = data.map(d => d.return_pct >= 0 ? 'rgba(45,217,148,0.8)' : 'rgba(255,77,106,0.8)');

    this.advChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map(d => d.month),
        datasets: [{ label: 'Retorno mensual (%)', data: data.map(d => d.return_pct), backgroundColor: colors, borderRadius: 4, borderSkipped: false }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${(c.raw as number).toFixed(2)}%` } } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8898aa', maxTicksLimit: 16 } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8898aa', callback: (v) => v + '%' } }
        }
      }
    });
  }

  private loadAndDrawDrawdown() {
    if (!this.advSymbol) return;
    this.http.get<any>(
      `${this.api}/portfolio/drawdown-history?symbol=${encodeURIComponent(this.advSymbol)}`,
      { headers: this.headers() }
    ).subscribe({
      next: (res) => {
        if (this.ddChartRef?.nativeElement && res.series) {
          this.ddChart?.destroy();
          const ctx = this.ddChartRef.nativeElement.getContext('2d')!;
          const series = res.series as { date: string; drawdown_pct: number }[];
          const grad = ctx.createLinearGradient(0, 0, 0, 200);
          grad.addColorStop(0, 'rgba(255,77,106,0.4)');
          grad.addColorStop(1, 'rgba(255,77,106,0)');

          this.ddChart = new Chart(ctx, {
            type: 'line',
            data: {
              labels: series.map(p => p.date),
              datasets: [{ label: 'Drawdown (%)', data: series.map(p => p.drawdown_pct), borderColor: '#ff4d6a', borderWidth: 1.5, pointRadius: 0, fill: true, backgroundColor: grad, tension: 0.2 }]
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${(c.raw as number).toFixed(2)}%` } } },
              scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8898aa', maxTicksLimit: 8 } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8898aa', callback: (v) => v + '%' }, max: 0 }
              }
            }
          });
        }
      },
      error: () => {}
    });
  }

  advMetricClass(val: number | null, positiveIsGood: boolean = true): string {
    if (val === null) return '';
    return (val >= 0) === positiveIsGood ? 'txt-up' : 'txt-dn';
  }

  sortinoLabel(val: number | null): string {
    if (val === null) return 'N/D';
    if (val >= 2) return '★★★ Excelente';
    if (val >= 1) return '★★☆ Bueno';
    if (val >= 0) return '★☆☆ Aceptable';
    return '✗ Negativo';
  }

  heatmapColor(val: number | null): string {
    if (val === null) return 'hm-null';
    if (val >= 10)  return 'hm-strong-up';
    if (val >= 3)   return 'hm-up';
    if (val >= 0)   return 'hm-weak-up';
    if (val >= -3)  return 'hm-weak-dn';
    if (val >= -10) return 'hm-dn';
    return 'hm-strong-dn';
  }

  // ── Candle Heatmap ────────────────────────────────────────────────────────────

  runCandleHeatmap() {
    if (!this.hmSymbol || this.hmLoading) return;
    this.hmLoading = true;
    this.hmError   = '';
    this.hmResult  = null;
    this.http.get<CandleHeatmapResult>(
      `${this.api}/portfolio/candle-heatmap?symbol=${encodeURIComponent(this.hmSymbol)}`,
      { headers: this.headers() }
    ).subscribe({
      next: (res) => { this.hmResult = res; this.hmLoading = false; },
      error: (err) => { this.hmLoading = false; this.hmError = err.error?.detail || 'Error calculando heatmap de velas'; }
    });
  }

  hmDayBarWidth(ret: number): number {
    if (!this.hmResult) return 0;
    const maxAbs = Math.max(...this.hmResult.days.map(d => Math.abs(d.avg_return_pct)), 0.01);
    return Math.min(100, Math.abs(ret) / maxAbs * 100);
  }

  // ── Cointegration ───────────────────────────────────────────────────────────

  runCointegration() {
    if (this.cointLoading) return;
    this.cointLoading = true;
    this.cointError   = '';
    this.cointResult  = null;
    this.http.get<CointResult>(
      `${this.api}/stocks/analysis/cointegration?min_months=${this.cointMinMonths}`,
      { headers: this.headers() }
    ).subscribe({
      next: (res) => { this.cointResult = res; this.cointLoading = false; },
      error: (err) => { this.cointLoading = false; this.cointError = err.error?.detail || 'Error calculando cointegración'; }
    });
  }

  cointSignalClass(signal: string): string {
    if (signal === 'LONG A / SHORT B') return 'sig-long';
    if (signal === 'SHORT A / LONG B') return 'sig-short';
    return 'sig-neutral';
  }

  // ── Walk-Forward ────────────────────────────────────────────────────────────

  runWalkForward() {
    if (!this.wfSymbol || this.wfLoading) return;
    this.wfLoading = true;
    this.wfError   = '';
    this.wfResult  = null;
    this.http.get<WFResult>(
      `${this.api}/stocks/analysis/walk-forward?symbol=${this.wfSymbol}&strategy=${this.wfStrategy}&train_months=${this.wfTrain}&val_months=${this.wfVal}`,
      { headers: this.headers() }
    ).subscribe({
      next: (res) => { this.wfResult = res; this.wfLoading = false; },
      error: (err) => { this.wfLoading = false; this.wfError = err.error?.detail || 'Error en walk-forward'; }
    });
  }

  wfVerdictClass(verdict: string): string {
    const map: Record<string, string> = {
      'SOBREAJUSTADO': 'verdict-bad',
      'SOSPECHOSO':    'verdict-warn',
      'ACEPTABLE':     'verdict-ok',
      'ROBUSTO':       'verdict-good',
    };
    return map[verdict] ?? '';
  }

  wfEffClass(eff: number): string {
    if (eff < 0.2) return 'txt-dn';
    if (eff < 0.5) return 'txt-warn';
    if (eff < 0.8) return 'txt-mid';
    return 'txt-up';
  }

  // ── GARCH(1,1) ────────────────────────────────────────────────────────────
  runGarch() {
    if (!this.garchSymbol || this.garchLoading) return;
    this.garchLoading = true; this.garchError = ''; this.garchResult = null;
    this.garchChart?.destroy(); this.garchChart = null;
    this.http.get<GarchResult>(
      `${this.api}/stocks/garch/${encodeURIComponent(this.garchSymbol)}`,
      { headers: this.headers() }
    ).subscribe({
      next: (res) => {
        this.garchResult = res; this.garchLoading = false;
        setTimeout(() => this.drawGarchChart(), 80);
      },
      error: (err) => { this.garchLoading = false; this.garchError = err.error?.detail || 'Error ajustando GARCH'; },
    });
  }

  private drawGarchChart() {
    const el = this.garchChartRef?.nativeElement;
    if (!el || !this.garchResult) return;
    this.garchChart?.destroy();
    const series = this.garchResult.vol_series_60d;
    const labels = this.garchResult.vol_series_dates;
    const curVol = this.garchResult.current_vol_pct;
    const lrVol  = this.garchResult.long_run_vol_pct;
    this.garchChart = new Chart(el, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Vol. Condicional (%)',
            data: series,
            backgroundColor: series.map(v => v > curVol * 1.3 ? 'rgba(248,81,73,0.75)' : v > lrVol ? 'rgba(255,166,87,0.75)' : 'rgba(76,98,255,0.65)'),
            borderRadius: 3, borderSkipped: false,
          },
          {
            label: 'Largo Plazo',
            data: Array(series.length).fill(lrVol),
            type: 'line' as any,
            borderColor: '#2dd994', borderDash: [4, 4], borderWidth: 1.5,
            pointRadius: 0, fill: false,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#8b949e', font: { size: 11 } } },
          tooltip: { callbacks: { label: (c: any) => `${(c.raw as number).toFixed(2)}%` } },
        },
        scales: {
          x: { ticks: { color: '#8b949e', maxTicksLimit: 10 }, grid: { color: '#21262d' } },
          y: { ticks: { color: '#8b949e', callback: (v: any) => v + '%' }, grid: { color: '#21262d' } },
        },
      },
    });
  }

  garchRegimeClass(regime: string): string {
    const map: Record<string, string> = {
      ALTA_VOLATILIDAD:    'regime-high',
      VOLATILIDAD_CRECIENTE: 'regime-rising',
      BAJA_VOLATILIDAD:    'regime-low',
      NORMAL:              'regime-normal',
    };
    return map[regime] ?? '';
  }

  // ── ML Prediction ─────────────────────────────────────────────────────────
  runMlPredict() {
    if (!this.mlSymbol || this.mlLoading) return;
    this.mlLoading = true; this.mlError = ''; this.mlResult = null;
    this.http.get<MlPredictResult>(
      `${this.api}/stocks/ml-predict/${encodeURIComponent(this.mlSymbol)}`,
      { headers: this.headers() }
    ).subscribe({
      next: (res) => { this.mlResult = res; this.mlLoading = false; },
      error: (err) => { this.mlLoading = false; this.mlError = err.error?.detail || 'Error en predicción ML'; },
    });
  }

  mlDirClass(dir: string): string { return dir === 'ALZA' ? 'txt-up' : 'txt-dn'; }
  mlOosClass(acc: number): string {
    if (acc >= 56) return 'txt-up';
    if (acc >= 52) return 'txt-warn';
    return 'txt-dn';
  }

  // ── Efficient Frontier ────────────────────────────────────────────────────
  runEfficientFrontier() {
    this.efLoading = true; this.efError = ''; this.efResult = null;
    this.efChart?.destroy(); this.efChart = null;
    this.http.get<EFResult>(`${this.api}/portfolio/efficient-frontier`, { headers: this.headers() }).subscribe({
      next: (res) => {
        this.efResult = res; this.efLoading = false;
        setTimeout(() => this.drawFrontierChart(), 100);
      },
      error: (err) => { this.efLoading = false; this.efError = err.error?.detail || 'Error calculando frontera eficiente'; },
    });
  }

  private drawFrontierChart() {
    const el = this.efChartRef?.nativeElement;
    if (!el || !this.efResult) return;
    this.efChart?.destroy();
    const r = this.efResult;
    this.efChart = new Chart(el, {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: 'Portafolios Monte Carlo',
            data: r.scatter.map(p => ({ x: p.vol, y: p.ret })),
            backgroundColor: 'rgba(76,98,255,0.18)',
            pointRadius: 2, pointHoverRadius: 4,
          },
          {
            label: 'Frontera Eficiente',
            data: r.frontier.map(p => ({ x: p.vol, y: p.ret })),
            backgroundColor: 'transparent',
            borderColor: '#ffa657',
            type: 'line' as any,
            pointRadius: 0, borderWidth: 2.5, fill: false, tension: 0.3,
          },
          {
            label: r.key_portfolios.current.label,
            data: [{ x: r.key_portfolios.current.vol_pct, y: r.key_portfolios.current.ret_pct }],
            backgroundColor: '#f85149', pointRadius: 9, pointHoverRadius: 12,
          },
          {
            label: r.key_portfolios.min_vol.label,
            data: [{ x: r.key_portfolios.min_vol.vol_pct, y: r.key_portfolios.min_vol.ret_pct }],
            backgroundColor: '#2dd994', pointRadius: 9, pointHoverRadius: 12,
          },
          {
            label: r.key_portfolios.max_sharpe.label,
            data: [{ x: r.key_portfolios.max_sharpe.vol_pct, y: r.key_portfolios.max_sharpe.ret_pct }],
            backgroundColor: '#a371f7', pointRadius: 9, pointHoverRadius: 12,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#8b949e', font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (c: any) => {
                const pt = c.raw as { x: number; y: number };
                return `${c.dataset.label}: Vol ${pt.x.toFixed(1)}% | Ret ${pt.y.toFixed(1)}%`;
              },
            },
          },
        },
        scales: {
          x: { title: { display: true, text: 'Volatilidad Anual (%)', color: '#8b949e' }, ticks: { color: '#8b949e' }, grid: { color: '#21262d' } },
          y: { title: { display: true, text: 'Retorno Esperado Anual (%)', color: '#8b949e' }, ticks: { color: '#8b949e' }, grid: { color: '#21262d' } },
        },
      },
    });
  }

  // ── CVaR ──────────────────────────────────────────────────────────────────
  runCvar() {
    this.cvarLoading = true; this.cvarError = ''; this.cvarResult = null;
    this.cvarChart?.destroy(); this.cvarChart = null;
    this.http.get<CvarResult>(`${this.api}/portfolio/cvar?confidence=${this.cvarConfidence}`, { headers: this.headers() }).subscribe({
      next: (res) => {
        this.cvarResult = res; this.cvarLoading = false;
        setTimeout(() => this.drawCvarHistogram(), 80);
      },
      error: (err) => { this.cvarLoading = false; this.cvarError = err.error?.detail || 'Error calculando CVaR'; },
    });
  }

  private drawCvarHistogram() {
    const el = this.cvarChartRef?.nativeElement;
    if (!el || !this.cvarResult) return;
    this.cvarChart?.destroy();
    const buckets = this.cvarResult.histogram.map(h => h.bucket);
    const varPct  = this.cvarResult.var_pct;
    this.cvarChart = new Chart(el, {
      type: 'bar',
      data: {
        labels: buckets.map(b => b.toFixed(2) + '%'),
        datasets: [{
          label: 'Retornos diarios (%)',
          data: buckets,
          backgroundColor: buckets.map(b => b < varPct ? 'rgba(248,81,73,0.75)' : 'rgba(76,98,255,0.5)'),
          borderRadius: 2, borderSkipped: false,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `${(c.raw as number).toFixed(3)}%` } },
        },
        scales: {
          x: { ticks: { color: '#8b949e', maxTicksLimit: 10 }, grid: { display: false } },
          y: { display: false },
        },
      },
    });
  }

  cvarTailClass(label: string): string {
    if (label.includes('EXTREMO')) return 'regime-high';
    if (label.includes('ALTO'))    return 'regime-rising';
    if (label.includes('MODERADO')) return 'regime-normal';
    return 'regime-low';
  }

  // ── CAPE / PE Relativo ─────────────────────────────────────────────────────
  loadCape() {
    if (!this.capeSymbol) { this.capeError = 'Selecciona un símbolo'; return; }
    this.capeLoading = true; this.capeError = ''; this.capeResult = null;
    this.http.get(`${this.api}/stocks/cape/${this.capeSymbol}`, { headers: this.headers() }).subscribe({
      next: (r: any) => { this.capeResult = r; this.capeLoading = false; },
      error: (e) => { this.capeError = e?.error?.detail || 'Error CAPE'; this.capeLoading = false; },
    });
  }

  capeVerdictClass(v: string): string {
    if (v === 'BURBUJA' || v === 'CARO') return 'regime-high';
    if (v === 'JUSTO')                   return 'regime-normal';
    if (v === 'BARATO' || v === 'MUY_BARATO') return 'regime-low';
    return '';
  }

  // ── Month-End Effect ────────────────────────────────────────────────────────
  loadMonthEnd() {
    if (!this.meSymbol) { this.meError = 'Selecciona un símbolo'; return; }
    this.meLoading = true; this.meError = ''; this.meResult = null;
    this.http.get(`${this.api}/stocks/month-end-effect/${this.meSymbol}`, { headers: this.headers() }).subscribe({
      next: (r: any) => { this.meResult = r; this.meLoading = false; },
      error: (e) => { this.meError = e?.error?.detail || 'Error month-end'; this.meLoading = false; },
    });
  }

  // ── Breakout Scanner ────────────────────────────────────────────────────────
  loadBreakout() {
    this.brLoading = true; this.brError = ''; this.brResult = null;
    this.http.get(`${this.api}/stocks/breakout-scanner?window=${this.brWindow}`, { headers: this.headers() }).subscribe({
      next: (r: any) => { this.brResult = r; this.brLoading = false; },
      error: (e) => { this.brError = e?.error?.detail || 'Error breakout'; this.brLoading = false; },
    });
  }

  // ── What-If Portfolio Comparator ────────────────────────────────────────────
  addWifWeight() {
    this.wifWeights.push({ symbol: this.stocks[0]?.symbol || '', weight: 25 });
  }
  removeWifWeight(i: number) { this.wifWeights.splice(i, 1); }

  loadWhatIf() {
    if (!this.wifWeights.length) { this.wifError = 'Agrega al menos una posición'; return; }
    const totalW = this.wifWeights.reduce((s, w) => s + (Number(w.weight) || 0), 0);
    if (Math.abs(totalW - 100) > 0.01) { this.wifError = `Pesos suman ${totalW.toFixed(1)}%, deben sumar 100%`; return; }
    this.wifLoading = true; this.wifError = ''; this.wifResult = null;
    const body = {
      months: this.wifMonths,
      weights: this.wifWeights.map(w => ({ symbol: w.symbol, weight: Number(w.weight) / 100 })),
    };
    this.http.post(`${this.api}/stocks/what-if-portfolio`, body, { headers: this.headers() }).subscribe({
      next: (r: any) => { this.wifResult = r; this.wifLoading = false; },
      error: (e) => { this.wifError = e?.error?.detail || 'Error what-if'; this.wifLoading = false; },
    });
  }

  // ── Confirmation Bias ───────────────────────────────────────────────────────
  loadConfirmationBias() {
    if (!this.cbSymbol) { this.cbError = 'Selecciona un símbolo'; return; }
    this.cbLoading = true; this.cbError = ''; this.cbResult = null;
    this.http.post(`${this.api}/stocks/confirmation-bias`, { symbol: this.cbSymbol }, { headers: this.headers() }).subscribe({
      next: (r: any) => { this.cbResult = r; this.cbLoading = false; },
      error: (e) => { this.cbError = e?.error?.detail || 'Error sesgo'; this.cbLoading = false; },
    });
  }

  // ── Candle Patterns ─────────────────────────────────────────────────────────
  loadCandlePatterns() {
    if (!this.patSymbol) { this.patError = 'Selecciona un símbolo'; return; }
    this.patLoading = true; this.patError = ''; this.patResult = null;
    this.http.get(
      `${this.api}/stocks/candle-patterns/${this.patSymbol}?lookback=${this.patLookback}`,
      { headers: this.headers() }
    ).subscribe({
      next: (r: any) => { this.patResult = r; this.patLoading = false; },
      error: (e) => { this.patError = e?.error?.detail || 'Error patterns'; this.patLoading = false; },
    });
  }

  patBiasClass(b: string): string {
    if (b === 'bullish') return 'regime-low';
    if (b === 'bearish') return 'regime-high';
    return 'regime-normal';
  }
}
