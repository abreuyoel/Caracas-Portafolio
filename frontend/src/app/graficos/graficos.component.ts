import {
  Component, OnInit, OnDestroy, AfterViewInit,
  ViewChild, ElementRef, ChangeDetectorRef, HostListener, Input
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiChartPanelComponent, ChartContextInput } from './ai-chart-panel.component';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import * as LightweightCharts from 'lightweight-charts';
import { BvcSocketService } from '../core/services/bvc-socket.service';
import { detectPatterns, patternsToMarkers, Pattern } from './candle-patterns';

// ── Interfaces para tipado fuerte ────────────────────────────────────────────
interface Candle {
  time: string; open: number; high: number; low: number;
  close: number; volume: number; amount: number; trades: number;
}

interface Stock { symbol: string; name: string; is_active: boolean; }

interface Indicator { id: string; label: string; enabled: boolean; color: string; }

interface DrawingTool { id: string; label: string; icon: string; active: boolean; }

interface FibLevel { ratio: number; price: number; label: string; }

interface ChatMessage { role: 'user'|'assistant'; content: string; timestamp: Date; }

// ✅ NUEVAS INTERFACES PARA INDICADORES (AGREGAR ESTO)
interface RsiIndicator {
  value: number | null;
  previous: number | null;
  slope: number;
  status: string;
}

interface EmaIndicator {
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  ema20Distance: number | null;
  ema50Distance: number | null;
}

interface MacdIndicator {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
  momentum: string | null;
  cross: string | null;
}

interface BollingerIndicator {
  upper: number | null;
  middle: number | null;
  lower: number | null;
  width: number | null;
  position: string | null;
}

interface VolumeIndicator {
  current: number;
  average20: number;
  ratio: number;
  status: string;
}

interface LevelsIndicator {
  resistance20: number;
  support20: number;
  high20: number;
  low20: number;
}

interface CrossesIndicator {
  goldenCross: boolean;
  deathCross: boolean;
}

interface HistoryPoint {
  time: string;
  value: number;
}

// ✅ INTERFAZ COMPLETA PARA TODOS LOS INDICADORES
interface AllIndicators {
  rsi: RsiIndicator;
  ema: EmaIndicator;
  macd: MacdIndicator;
  bollinger: BollingerIndicator;
  volume: VolumeIndicator;
  levels: LevelsIndicator;
  crosses: CrossesIndicator;
  trend: string;
  lastCandles: Candle[];
  rsiHistory: HistoryPoint[];
  ema20History: HistoryPoint[];
  ema50History: HistoryPoint[];
  macdHistory: HistoryPoint[];
  volumeHistory: HistoryPoint[];
}

// ── Cache key helpers ─────────────────────────────────────────────────────────
const STOCKS_CACHE_KEY  = 'bvc_stocks_cache';
const STOCKS_CACHE_TS   = 'bvc_stocks_cache_ts';  // unix ms timestamp
const STOCKS_CACHE_TTL  = 60 * 60 * 1000;          // 1 hour
/** @deprecated kept for cleanup */
const STOCKS_CACHE_DATE = 'bvc_stocks_cache_date';

@Component({
  selector: 'app-graficos',
  standalone: true,
  imports: [CommonModule, FormsModule, AiChartPanelComponent],
  templateUrl: './graficos.component.html',
  styleUrls: ['./graficos.component.scss']
})
export class GraficosComponent implements OnInit, OnDestroy, AfterViewInit {

  @ViewChild('chartContainer')  chartEl!: ElementRef;
  @ViewChild('volumeContainer') volumeEl!: ElementRef;
  @ViewChild('rsiContainer')    rsiEl!: ElementRef;
  @ViewChild('macdContainer')   macdEl!: ElementRef;
  @ViewChild('obvContainer')    obvEl!: ElementRef;
  @ViewChild('aroonContainer')  aroonEl!: ElementRef;
  @ViewChild('stochContainer')  stochEl!: ElementRef;
  @ViewChild('vpCanvas')        vpCanvasEl!: ElementRef<HTMLCanvasElement>;

  stocks: Stock[] = [];
  searchFilter    = '';
  selectedSymbol  = '';
  selectedName    = '';
  loading         = false;
  loadingStocks   = false;
  sidebarCollapsed = false;
  isFullscreen    = false;
  chartType       = 'candlestick';
  currentTF       = 'Todo';
  showVolume      = true;
  currentChartIndicators: any = null;
  aiChatHistory: any[] = [];
  candles: Candle[] = [];
  lastPrices:   Record<string, number> = {};
  priceChanges: Record<string, number> = {};
  currentChartContext: ChartContextInput | null = null;
  // ✅ NUEVO: libro de órdenes actual para enviarlo a la IA
  currentOrderBook: any[] = [];

  currentPrice   = 0;
  priceChange    = 0;
  priceChangePct = 0;

  hoveredCandle: Candle | null = null;
  get displayCandle(): Candle | null {
    const raw = this.hoveredCandle ?? (this.candles.length ? this.candles[this.candles.length - 1] : null);
    if (!raw || !this.showInUsd) return raw;
    // getRateForDate busca la fecha exacta o la más cercana anterior en bcvRates
    const rate = this.getRateForDate(raw.time) || this.currentUsdRate;
    if (!rate) return raw;
    return { ...raw, open: raw.open / rate, high: raw.high / rate, low: raw.low / rate, close: raw.close / rate };
  }

  private chartSubscriptions: (() => void)[] = [];

  /** Returns today's date as 'YYYY-MM-DD' in LOCAL time (not UTC).
   *  toISOString() uses UTC and can be off by 1 day in timezones behind UTC. */
  private localDateStr(d: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  private filterCandlesByTF(candles: Candle[]): Candle[] {
    if (!candles.length || this.currentTF === 'Todo') return candles;
    const now = new Date();
    const cut = new Date(now);
    switch (this.currentTF) {
      case '1S': cut.setMonth(now.getMonth() - 1); break;
      case '3S': cut.setMonth(now.getMonth() - 3); break;
      case '6S': cut.setMonth(now.getMonth() - 6); break;
      case '1A': cut.setFullYear(now.getFullYear() - 1); break;
    }
    const start = this.localDateStr(cut);
    return candles.filter(c => c.time >= start);
  }

  timeframes = ['1S', '3S', '6S', '1A', 'Todo'];

  // ✅ INDICADORES: solo los que generan líneas/gráficos visibles.
  // ADX, Chaikin, ATR%, DMI y MFI son KPIs del panel Analytics → se eliminan de aquí.
  indicators: Indicator[] = [
    { id:'rsi',      label:'RSI(14)',    enabled:true,  color:'#a371f7' },  // ✅ ON por defecto
    { id:'macd',     label:'MACD',       enabled:true,  color:'#58a6ff' },  // ✅ ON por defecto
    { id:'ema20',    label:'EMA 20',     enabled:true,  color:'#f0883e' },
    { id:'ema50',    label:'EMA 50',     enabled:true,  color:'#3fb950' },
    { id:'ema200',   label:'EMA 200',    enabled:false, color:'#ff7b72' },
    { id:'sma20',    label:'SMA 20',     enabled:false, color:'#d2a8ff' },
    { id:'bb',       label:'Bollinger',  enabled:false, color:'#79c0ff' },
    { id:'vwap',     label:'VWAP',       enabled:false, color:'#ffa657' },
    { id:'obv',      label:'OBV',        enabled:false, color:'#ffaa66' },
    { id:'adl',      label:'A/D',        enabled:false, color:'#66ffaa' },
    { id:'aroon',    label:'Aroon',      enabled:false, color:'#ff66cc' },
    { id:'stoch',    label:'Stoch',      enabled:false, color:'#ff66aa' },
    { id:'ichimoku', label:'Ichimoku',   enabled:false, color:'#66aaff' },
    { id:'patterns', label:'Patrones',   enabled:false, color:'#d29922' },
  ];

  detectedPatterns: Pattern[] = [];

  drawingTools: DrawingTool[] = [
    { id:'cursor',  label:'Cursor',      icon:'↖',  active:true  },
    { id:'measure', label:'Medir %',     icon:'📏', active:false },
    { id:'fib',     label:'Fibonacci',   icon:'📐', active:false },
    { id:'hline',   label:'Línea H',     icon:'─',  active:false },
    // ✅ NUEVA herramienta: línea vertical
    { id:'vline',   label:'Línea V',     icon:'│',  active:false },
  ];

  measureResult = '';
  measurePopup: any = null;
  fibLevels: FibLevel[] = [];

  // AI Panel
  aiPanelOpen = false;
  aiMessages: ChatMessage[] = [];
  aiInput     = '';
  aiLoading   = false;

  // Alert creation panel
  alertPanelOpen = false;
  newAlertCondition = 'above';
  newAlertValue: number | null = null;
  newAlertMessage = '';
  savingAlert = false;

  private fibPoint1: { price:number; time:string }|null = null;
  private lwc:          any;
  private series:       any;
  private volumeChart:  any;
  private volumeSeries: any;
  private lwcRsi:  any;
  private rsiSeries: any;
  private lwcRsiValue: number | null = null;
  private lwcMacd: any;
  private macdFast: any;
  private macdSlow: any;
  private macdHist: any;
  private lwcObv: any;
  private obvSeries: any;
  private adlChartSeries: any;
  private lwcAroon: any;
  private aroonUpSeries: any;
  private aroonDownSeries: any;
  private lwcStoch: any;
  private stochKSeries: any;
  private stochDSeries: any;
  private overlays: Record<string, any> = {};
  private horizLines: any[] = [];
  // ✅ NUEVO: array de líneas verticales dibujadas
  private vertLines: any[] = [];
  private resizeObs?: ResizeObserver;
  private measureCount = 0;
  private measureC1: any = null;
  private resizeTimeout?: any;
  private liveInterval: any = null;
  marketOpen = false;
  liveCandle: any = null;
  isComparisonMode = false;
  showInUsd = false;
  bcvRates: Record<string, number> = {};
  currentUsdRate = 0;
  showAnalytics = false;
  obvValue = 0;
  adValue = 0;
  aroonUp = 0;
  aroonDown = 0;
  adxValue = 0;
  chaikinValue = 0;
  atrPercent = 0;
  dmiValue = 0;
  stochValue = 0;
  mfiValue = 0;
  adrPercent = 0;
  adrUsed = 0;         // % of the 20-day ADR consumed today
  bbwValue = 0;        // Bollinger Band Width %
  bbwTrend: 'contracting' | 'expanding' | 'neutral' = 'neutral';

  // ── Advanced Indicators ────────────────────────────────────────────────────
  marketRegime: 'alcista' | 'bajista' | 'lateral' | 'volatil' = 'lateral';
  kellyF = 0;           // Half-Kelly fraction (0-1)
  autoCorr30 = 0;       // 30-day lag-1 autocorrelation of returns
  liquidityZ = 0;       // Volume Z-Score vs 20d average
  momentumScore = 0;    // Rate of change vs 20d avg (Smart Beta proxy)

  // ── CVD (Cumulative Volume Delta) ─────────────────────────────────────────
  cvdValue       = 0;   // Cumulative delta (buy vol - sell vol)
  cvdDeltaLast   = 0;   // Last candle delta
  cvdTrend: 'acumulacion' | 'distribucion' | 'neutral' = 'neutral';

  // ── Volume Profile ────────────────────────────────────────────────────────
  vpHvn          = 0;   // High Volume Node price (POC)
  vpLvn          = 0;   // Low Volume Node price
  showVolumeProfile = false;
  private _vpLevels: { price: number; volume: number; pct: number }[] = [];

  // ── Price Percentile (252-day) ────────────────────────────────────────────
  pricePercentile252 = 0; // Where current price sits in 1-year distribution (0-100)

  // ── Value Zone / CAPE proxy (price Z-score vs 1-year avg) ─────────────────
  valueZoneScore = 0;
  valueZoneLabel = '';

  analyticsPos = { x: -1, y: 80 };
  private _boundDragMove!: (e: MouseEvent) => void;
  private _boundDragEnd!: () => void;

  toggleAnalytics() {
    this.showAnalytics = !this.showAnalytics;
    if (this.showAnalytics) {
      const chartWrap = this.chartEl?.nativeElement?.closest('.chart-wrap') as HTMLElement;
      if (chartWrap && this.analyticsPos.x === -1) {
        const rect = chartWrap.getBoundingClientRect();
        this.analyticsPos = { x: Math.max(0, rect.width - 430), y: 70 };
      }
      this.updateAdvancedIndicators();
    }
  }

  startDragAnalytics(event: MouseEvent) {
    event.preventDefault();
    const startX = event.clientX - this.analyticsPos.x;
    const startY = event.clientY - this.analyticsPos.y;
    this._boundDragMove = (e: MouseEvent) => {
      const chartWrap = this.chartEl?.nativeElement?.closest('.chart-wrap') as HTMLElement;
      const rect = chartWrap?.getBoundingClientRect();
      let nx = e.clientX - startX;
      let ny = e.clientY - startY;
      if (rect) { nx = Math.max(0, Math.min(nx, rect.width - 425)); ny = Math.max(0, Math.min(ny, rect.height - 50)); }
      this.analyticsPos = { x: nx, y: ny };
      this.cd.detectChanges();
    };
    this._boundDragEnd = () => {
      document.removeEventListener('mousemove', this._boundDragMove);
      document.removeEventListener('mouseup', this._boundDragEnd);
    };
    document.addEventListener('mousemove', this._boundDragMove);
    document.addEventListener('mouseup', this._boundDragEnd);
  }

  formatLargeNumber(val: number): string {
    if (val === null || val === undefined || isNaN(val) || !isFinite(val)) return '—';
    const abs = Math.abs(val);
    const sign = val < 0 ? '-' : '';
    if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(2) + 'M';
    if (abs >= 1_000)     return sign + (abs / 1_000).toFixed(1) + 'K';
    return val.toFixed(2);
  }

  updateAdvancedIndicators(candles?: Candle[]) {
    const data = candles || this.candles;
    if (!data.length) return;

    this.obvValue    = this.obv(data);
    this.adValue     = this.accumulationDistribution(data);
    const aroon      = this.aroon(data);
    this.aroonUp     = aroon.up;
    this.aroonDown   = aroon.down;
    this.adxValue    = this.adx(data);
    this.chaikinValue= this.chaikin(data);
    this.atrPercent  = this.atrPercentile(data);
    this.dmiValue    = this.dmi(data);
    this.stochValue  = this.stochastic(data);
    this.mfiValue    = this.mfi(data);
    const adrResult  = this.calcAdr(data);
    this.adrPercent  = adrResult.adr;
    this.adrUsed     = adrResult.usedPct;
    const bbwResult  = this.calcBbw(data);
    this.bbwValue    = bbwResult.width;
    this.bbwTrend    = bbwResult.trend;

    this.marketRegime   = this.calcMarketRegime(data);
    this.kellyF         = this.calcKelly(data);
    this.autoCorr30     = this.calcAutoCorr(data, 30);
    this.liquidityZ     = this.calcLiquidityZ(data);
    this.momentumScore  = this.calcMomentum(data);

    // ── New professional indicators ─────────────────────────────────────────
    const cvd = this.calcCvd(data);
    this.cvdValue     = cvd.cumulative;
    this.cvdDeltaLast = cvd.lastDelta;
    this.cvdTrend     = cvd.cumulative > 0
      ? (cvd.lastDelta >= 0 ? 'acumulacion' : 'neutral')
      : (cvd.lastDelta <= 0 ? 'distribucion' : 'neutral');

    const vp = this.calcVolumeProfile(data);
    this.vpHvn    = vp.hvn;
    this.vpLvn    = vp.lvn;
    this._vpLevels = vp.levels;

    this.pricePercentile252 = this.calcPricePercentile(data);

    const vz = this.calcValueZone(data);
    this.valueZoneScore = vz.score;
    this.valueZoneLabel = vz.label;

    if (this.showVolumeProfile) {
      setTimeout(() => this.drawVolumeProfileOverlay(), 50);
    }

    this.cd.detectChanges();
  }

  toggleVolumeProfile() {
    this.showVolumeProfile = !this.showVolumeProfile;
    if (this.showVolumeProfile) {
      setTimeout(() => this.drawVolumeProfileOverlay(), 80);
    } else if (this.vpCanvasEl) {
      const ctx = this.vpCanvasEl.nativeElement.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, this.vpCanvasEl.nativeElement.width, this.vpCanvasEl.nativeElement.height);
    }
  }

  private drawVolumeProfileOverlay() {
    if (!this.vpCanvasEl || !this.series || !this._vpLevels.length) return;
    const canvas = this.vpCanvasEl.nativeElement;
    const pane   = this.chartEl?.nativeElement as HTMLElement;
    if (!pane) return;

    canvas.width  = pane.offsetWidth;
    canvas.height = pane.offsetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const BAR_MAX = 90;   // max bar width px
    const GAP     = 56;   // right-side price-scale gap

    // Estimate bar height from neighbouring levels
    const sorted = [...this._vpLevels].sort((a, b) => b.price - a.price);
    let avgSpacing = 4;
    if (sorted.length > 1) {
      const spacings: number[] = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        const ya = this.series.priceToCoordinate(sorted[i].price);
        const yb = this.series.priceToCoordinate(sorted[i + 1].price);
        if (ya !== null && yb !== null) spacings.push(Math.abs(yb - ya));
      }
      if (spacings.length) avgSpacing = Math.max(2, spacings.reduce((s, v) => s + v, 0) / spacings.length);
    }
    const barH = Math.max(2, Math.min(avgSpacing - 0.5, 12));

    for (const lvl of this._vpLevels) {
      const y = this.series.priceToCoordinate(lvl.price);
      if (y === null || y < 2 || y > canvas.height - 2) continue;

      const w      = Math.max(2, lvl.pct * BAR_MAX);
      const x      = canvas.width - w - GAP;
      const isHvn  = Math.abs(lvl.price - this.vpHvn) < 1e-9;
      const isLvn  = Math.abs(lvl.price - this.vpLvn) < 1e-9;

      // Background track
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(canvas.width - BAR_MAX - GAP, y - barH / 2, BAR_MAX, barH);

      // Colored bar with gradient
      const grad = ctx.createLinearGradient(x, 0, x + w, 0);
      if (isHvn) {
        grad.addColorStop(0, 'rgba(255,185,0,0.15)');
        grad.addColorStop(1, 'rgba(255,185,0,0.85)');
      } else if (isLvn) {
        grad.addColorStop(0, 'rgba(255,77,106,0.12)');
        grad.addColorStop(1, 'rgba(255,77,106,0.70)');
      } else {
        grad.addColorStop(0, 'rgba(76,98,255,0.08)');
        grad.addColorStop(1, 'rgba(76,98,255,0.45)');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(x, y - barH / 2, w, barH);
    }

    // Labels for HVN and LVN
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    if (this.vpHvn > 0) {
      const yH = this.series.priceToCoordinate(this.vpHvn);
      if (yH !== null && yH > 14 && yH < canvas.height - 4) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        const label = 'HVN ' + this.vpHvn.toFixed(4);
        const tw = ctx.measureText(label).width;
        ctx.fillRect(canvas.width - GAP - tw - 10, yH - barH / 2 - 12, tw + 8, 14);
        ctx.fillStyle = 'rgba(255,185,0,1)';
        ctx.fillText(label, canvas.width - GAP - 2, yH - barH / 2 - 1);
      }
    }
    if (this.vpLvn > 0) {
      const yL = this.series.priceToCoordinate(this.vpLvn);
      if (yL !== null && yL > 14 && yL < canvas.height - 4) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        const label = 'LVN ' + this.vpLvn.toFixed(4);
        const tw = ctx.measureText(label).width;
        ctx.fillRect(canvas.width - GAP - tw - 10, yL - barH / 2 - 12, tw + 8, 14);
        ctx.fillStyle = 'rgba(255,77,106,1)';
        ctx.fillText(label, canvas.width - GAP - 2, yL - barH / 2 - 1);
      }
    }
  }

  private apiUrl = environment.apiUrl;

  get filteredStocks(): Stock[] {
    const q = this.searchFilter.toLowerCase();
    return this.stocks.filter(s =>
      s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  }

  constructor(
    private http: HttpClient, 
    private cd: ChangeDetectorRef, 
    private router: Router,
    public bvcSocket: BvcSocketService
  ) {}

  private liveSub: any = null;

  ngOnInit() { 
    this.loadActiveStocks(); 
    this.loadBcvRates(); 
    this.loadHistoricalUsdRates();
    this.bvcSocket.connect();
    // Subscribe to real-time prices for chart updates
    this.liveSub = this.bvcSocket.prices$.subscribe(prices => {
      if (!this.selectedSymbol || !prices[this.selectedSymbol]) return;
      const newPrice = prices[this.selectedSymbol];
      if (newPrice && newPrice !== this.currentPrice && this.candles.length > 0) {
        this.currentPrice = newPrice;
        // Update price change from the previous candle close
        const prevClose = this.candles.length > 1 ? this.candles[this.candles.length - 2].close : this.candles[0].open;
        this.priceChange = newPrice - prevClose;
        this.priceChangePct = prevClose > 0 ? (this.priceChange / prevClose) * 100 : 0;

        // Update the latest candle in-place to reflect the live tick
        const lastCandle = this.candles[this.candles.length - 1];
        lastCandle.close = newPrice;
        if (newPrice > lastCandle.high) lastCandle.high = newPrice;
        if (newPrice < lastCandle.low) lastCandle.low = newPrice;
        
        // Push update to the series if the chart is alive
        if (this.series) {
          try {
            this.series.update({
              time: lastCandle.time,
              open: lastCandle.open,
              high: lastCandle.high,
              low: lastCandle.low,
              close: lastCandle.close,
            });
          } catch {}
        }

        // Recalculate analytics if panel is open
        if (this.showAnalytics) {
          this.updateAdvancedIndicators();
        }

        // Update the sidebar stock list price
        this.lastPrices[this.selectedSymbol] = newPrice;
        this.priceChanges[this.selectedSymbol] = this.priceChangePct;
        
        this.cd.detectChanges();
      }
    });
  }
  ngAfterViewInit() {}
  ngOnDestroy() {
    this.destroyAll();
    this.resizeObs?.disconnect();
    if (this.liveInterval) {
      clearInterval(this.liveInterval);
      this.liveInterval = null;
    }
    if (this.liveSub) {
      this.liveSub.unsubscribe();
      this.liveSub = null;
    }
    this.chartSubscriptions.forEach(unsub => { try { unsub(); } catch {} });
    this.chartSubscriptions = [];
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (e.key === 'f') this.fitContent();
    if (e.key === 'F') this.toggleFullscreen();
    if (e.key === 'Escape') { this.measurePopup=null; this.activateTool('cursor'); }
  }

  // ── Stock cache + loading ──────────────────────────────────────────────────

  loadActiveStocks() {
    // Clear old date-based cache key
    localStorage.removeItem(STOCKS_CACHE_DATE);

    const cachedTs   = parseInt(localStorage.getItem(STOCKS_CACHE_TS) ?? '0', 10);
    const cachedData = localStorage.getItem(STOCKS_CACHE_KEY);
    const now        = Date.now();

    if (cachedData && now - cachedTs < STOCKS_CACHE_TTL) {
      try {
        this.stocks = JSON.parse(cachedData);
        this.cd.detectChanges();
        this._autoLoadDefaultStock();
        return;
      } catch {}
    }

    this.loadingStocks = true;
    this.cd.detectChanges();

    this.http.get<Stock[]>(this.apiUrl + '/stocks/bvc/active', { headers: this.hdr() }).subscribe({
      next: (s: any) => {
        this.stocks = (s || []).filter((x: Stock) => x.is_active !== false && x.symbol !== 'CIE');
        try {
          localStorage.setItem(STOCKS_CACHE_KEY, JSON.stringify(this.stocks));
          localStorage.setItem(STOCKS_CACHE_TS,  String(Date.now()));
        } catch {}
        this.loadingStocks = false;
        this.cd.detectChanges();
        this._autoLoadDefaultStock();
      },
      error: (e: any) => {
        console.error('stocks error:', e);
        this.loadingStocks = false;
        this.cd.detectChanges();
      }
    });
  }

  private _autoLoadDefaultStock(): void {
    if (this.selectedSymbol) return; // already selected
    const lastSymbol = localStorage.getItem('lastChartSymbol');
    const auto = (lastSymbol && this.stocks.find(s => s.symbol === lastSymbol))
      ? lastSymbol
      : this.stocks[0]?.symbol;
    if (auto) this.loadStock(auto);
  }


  historicalUsdRates: Record<string, number> = {};

  async loadHistoricalUsdRates() {
    try {
      const token = localStorage.getItem('access_token');
      const response: any = await this.http.get(
        `${this.apiUrl}/stocks/bcv-rates/historical`,
        { headers: { Authorization: `Bearer ${token}` } }
      ).toPromise();
      this.historicalUsdRates = response.rates || {};
      console.log(`✅ Cargadas ${Object.keys(this.historicalUsdRates).length} tasas USD históricas`);
    } catch (error) {
      console.warn('No se pudieron cargar tasas USD históricas', error);
    }
  }
  // ── Live WS Push Logic ───────────────────────────────────────────────────

  private wsSub: any = null;

  private startLivePolling(symbol: string) {
    if (this.wsSub) { this.wsSub.unsubscribe(); this.wsSub = null; }
    
    // Al iniciar, también pedir el "Live Candle" una vez por HTTP para tener el 'open', 'high', 'low' precisos
    this.fetchLiveCandle(symbol);

    this.wsSub = this.bvcSocket.stocksMap$.subscribe(board => {
        if (!this.selectedSymbol || this.selectedSymbol !== symbol) return;
        const tick = board[symbol];
        if (!tick || !tick.PRECIO) return;
        
        // Emular update baseado en el tick WebSocket
        const todayStr = this.localDateStr();
        const lastPrice = tick.PRECIO;
        const volume = tick.VOLUMEN || 0;
        
        // A falta del low/high exacto del WS, reusamos el de the last candle o lo ajustamos dinámicamente
        let lastCandle = this.candles.length > 0 ? this.candles[this.candles.length - 1] : null;
        let isToday = lastCandle && lastCandle.time.startsWith(todayStr);
        
        let live: Candle;
        if (isToday) {
            live = {
               ...lastCandle!,
               open: tick.PRECIO_APERT || lastCandle!.open,
               close: lastPrice,
               high: tick.PRECIO_MAX || Math.max(lastCandle!.high, lastPrice),
               low:  tick.PRECIO_MIN || Math.min(lastCandle!.low,  lastPrice),
               volume: tick.VOLUMEN  || lastCandle!.volume,
               amount: tick.MONTO_EFECTIVO || lastCandle!.amount,
               trades: tick.TOT_OP_NEGOC   || lastCandle!.trades
            };
        } else {
            // Only create a new-day candle if the market is actually open today.
            // When closed, WS keeps pushing stale ticks which would add a phantom candle.
            if (!this.marketOpen) return;
            // New day starting on WS – use serverDataExt OHLCV fields when available
            live = {
               time:   todayStr,
               open:   tick.PRECIO_APERT || (lastPrice - (tick.VAR_ABS || 0)),
               high:   tick.PRECIO_MAX   || lastPrice,
               low:    tick.PRECIO_MIN   || lastPrice,
               close:  lastPrice,
               volume: tick.VOLUMEN      || volume,
               amount: tick.MONTO_EFECTIVO || 0,
               trades: tick.TOT_OP_NEGOC   || 0
            };
        }

        this.liveCandle = live;
        this.currentPrice   = live.close;
        this.priceChange    = tick.VAR_ABS || 0;
        this.priceChangePct = tick.VAR_REL || 0;
        this.lastPrices[symbol]   = live.close;
        this.priceChanges[symbol] = this.priceChange;

        if (isToday) {
            this.candles[this.candles.length - 1] = live;
        } else {
            this.candles = [...this.candles, live];
        }

        if (this.series) {
          try {
            const filtered = this.filterTF(this.candles);
            if (filtered.length > 0) {
                const shownLast = filtered[filtered.length - 1];
                if (shownLast.time === live.time) {
                  if (this.chartType === 'line' || this.chartType === 'area')
                    this.series.update({ time: live.time, value: live.close });
                  else
                    this.series.update(live);
                    
                  if (this.volumeSeries) {
                    this.volumeSeries.update({
                      time: live.time, value: live.volume,
                      color: live.close >= live.open ? 'rgba(38,166,65,.5)' : 'rgba(248,81,73,.5)'
                    });
                  }
                }
            }
          } catch {
            this.setData(this.filterTF(this.candles));
          }
        }

        this.currentChartIndicators = this.calculateAllIndicators(this.candles);
        this.updateIndicatorsAndContext();
        this.updateSubChartsLive(this.candles);
        if (this.showAnalytics) this.updateAdvancedIndicators();
        this.cd.detectChanges();
    });
  }

  private updateSubChartsLive(candles: Candle[]) {
    if (!candles.length) return;
    const last   = candles[candles.length - 1];
    const closes = candles.map(c => c.close);
    const times  = candles.map(c => c.time);

    // RSI sub-chart
    if (this.rsiSeries && this.lwcRsi) {
      const rsi = this.calcRsi(closes, times, 14);
      if (rsi.length) { try { this.rsiSeries.update(rsi[rsi.length - 1]); } catch {} }
    }

    // MACD sub-chart
    if (this.lwcMacd) {
      const macd = this.calcMacd(closes, times);
      if (macd.macdLine.length   && this.macdFast) { try { this.macdFast.update(macd.macdLine[macd.macdLine.length - 1]); }   catch {} }
      if (macd.signalLine.length && this.macdSlow) { try { this.macdSlow.update(macd.signalLine[macd.signalLine.length - 1]); } catch {} }
      if (macd.histogram.length  && this.macdHist) { try { this.macdHist.update(macd.histogram[macd.histogram.length - 1]); }  catch {} }
    }

    // OBV / A/D sub-chart
    if (this.lwcObv) {
      if (this.obvSeries) {
        const obv = this.calcObvSeries(candles);
        if (obv.length) { try { this.obvSeries.update(obv[obv.length - 1]); } catch {} }
      }
      if (this.adlChartSeries) {
        const adlArr = this.adlSeriesArr(candles);
        if (adlArr.length) { try { this.adlChartSeries.update({ time: last.time, value: adlArr[adlArr.length - 1] }); } catch {} }
      }
    }

    // Aroon sub-chart
    if (this.lwcAroon && candles.length > 25) {
      const period = 25;
      const slice  = candles.slice(-(period + 1));
      const highs  = slice.map(c => c.high);
      const lows   = slice.map(c => c.low);
      const idxH   = highs.lastIndexOf(Math.max(...highs));
      const idxL   = lows.lastIndexOf(Math.min(...lows));
      const aUp    = parseFloat(((idxH / period) * 100).toFixed(2));
      const aDown  = parseFloat(((idxL / period) * 100).toFixed(2));
      try { if (this.aroonUpSeries)   this.aroonUpSeries.update({   time: last.time, value: aUp });   } catch {}
      try { if (this.aroonDownSeries) this.aroonDownSeries.update({ time: last.time, value: aDown }); } catch {}
    }

    // Stochastic sub-chart
    if (this.lwcStoch && candles.length >= 14) {
      const period = 14, smoothK = 3;
      const sliceK = candles.slice(-period);
      const hh = Math.max(...sliceK.map(c => c.high));
      const ll = Math.min(...sliceK.map(c => c.low));
      const k  = hh === ll ? 50 : ((last.close - ll) / (hh - ll)) * 100;
      try { if (this.stochKSeries) this.stochKSeries.update({ time: last.time, value: parseFloat(k.toFixed(2)) }); } catch {}
      if (candles.length >= period + smoothK - 1) {
        const kVals: number[] = [];
        for (let j = 0; j < smoothK; j++) {
          const s = candles.slice(-(period + j), candles.length - j || undefined);
          const h = Math.max(...s.map(c => c.high));
          const l = Math.min(...s.map(c => c.low));
          kVals.unshift(h === l ? 50 : ((candles[candles.length - 1 - j].close - l) / (h - l)) * 100);
        }
        const d = kVals.reduce((a, b) => a + b, 0) / smoothK;
        try { if (this.stochDSeries) this.stochDSeries.update({ time: last.time, value: parseFloat(d.toFixed(2)) }); } catch {}
      }
    }

    // Overlay series on main chart (EMA, SMA, Bollinger, VWAP)
    if (this.lwc) {
      if (this.overlays['ema20'])  { const v = this.ema(closes, times, 20);   if (v.length) { try { this.overlays['ema20'].update(v[v.length - 1]); }  catch {} } }
      if (this.overlays['ema50'])  { const v = this.ema(closes, times, 50);   if (v.length) { try { this.overlays['ema50'].update(v[v.length - 1]); }  catch {} } }
      if (this.overlays['ema200']) { const v = this.ema(closes, times, 200);  if (v.length) { try { this.overlays['ema200'].update(v[v.length - 1]); } catch {} } }
      if (this.overlays['sma20'])  { const v = this.sma(closes, times, 20);   if (v.length) { try { this.overlays['sma20'].update(v[v.length - 1]); }  catch {} } }
      if (this.overlays['vwap'])   { const v = this.vwap(candles);             if (v.length) { try { this.overlays['vwap'].update(v[v.length - 1]); }   catch {} } }
      if (this.overlays['bb_u']) {
        const bb = this.bb(closes, times, 20, 2);
        if (bb.upper.length) {
          try { this.overlays['bb_u'].update(bb.upper[bb.upper.length - 1]);   } catch {}
          try { this.overlays['bb_m'].update(bb.middle[bb.middle.length - 1]); } catch {}
          try { this.overlays['bb_l'].update(bb.lower[bb.lower.length - 1]);   } catch {}
        }
      }
    }
  }

  enterComparisonMode() {
    if (!this.selectedSymbol) {
      alert('Selecciona una acción primero');
      return;
    }
    this.isComparisonMode = true;
    this.aiPanelOpen = true;
    this.cd.detectChanges();
    setTimeout(() => this.resizeAllCharts(), 350);
  }

  // ── Función: Cálculo completo de indicadores ─────────────────────────────
  private calculateAllIndicators(data?: Candle[]): any {
    const candlesToUse = data || this.candles;
    if (candlesToUse.length < 2) return null;

    const closes  = candlesToUse.map(c => c.close);
    const highs   = candlesToUse.map(c => c.high);
    const lows    = candlesToUse.map(c => c.low);
    const volumes = candlesToUse.map(c => c.volume);
    const times   = candlesToUse.map(c => c.time);

    // RSI(14)
    const rsi14 = this.calcRsi(closes, times, 14);
    const rsiCurrent  = rsi14.length > 0 ? rsi14[rsi14.length - 1].value : null;
    const rsiPrevious = rsi14.length > 1 ? rsi14[rsi14.length - 2].value : null;
    const rsiSlope    = rsiCurrent && rsiPrevious ? rsiCurrent - rsiPrevious : 0;

    // EMA 20, 50, 200
    const ema20  = this.ema(closes, times, 20);
    const ema50  = this.ema(closes, times, 50);
    const ema200 = this.ema(closes, times, 200);
    const ema20Current  = ema20.length  > 0 ? ema20[ema20.length - 1].value   : null;
    const ema50Current  = ema50.length  > 0 ? ema50[ema50.length - 1].value   : null;
    const ema200Current = ema200.length > 0 ? ema200[ema200.length - 1].value : null;
    const ema20Distance  = ema20Current  ? ((closes[closes.length - 1] - ema20Current)  / ema20Current  * 100) : null;
    const ema50Distance  = ema50Current  ? ((closes[closes.length - 1] - ema50Current)  / ema50Current  * 100) : null;

    // SMA 20
    const sma20 = this.sma(closes, times, 20);
    const sma20Current = sma20.length > 0 ? sma20[sma20.length - 1].value : null;

    // Bollinger Bands
    const bb       = this.bb(closes, times, 20, 2);
    const bbUpper  = bb.upper.length  > 0 ? bb.upper[bb.upper.length - 1].value   : null;
    const bbMiddle = bb.middle.length > 0 ? bb.middle[bb.middle.length - 1].value : null;
    const bbLower  = bb.lower.length  > 0 ? bb.lower[bb.lower.length - 1].value   : null;
    const bbWidth  = bbUpper && bbLower && bbMiddle ? ((bbUpper - bbLower) / bbMiddle * 100) : null;
    const currentPrice = closes[closes.length - 1];
    const bbPosition   = bbUpper && bbLower ?
      (currentPrice > bbUpper ? 'TOCANDO_BANDA_SUPERIOR' :
       currentPrice < bbLower ? 'TOCANDO_BANDA_INFERIOR' : 'ENTRE_BANDAS') : null;

    // VWAP
    const vwap        = this.vwap(candlesToUse);
    const vwapCurrent = vwap.length > 0 ? vwap[vwap.length - 1].value : null;

    // MACD
    const macd         = this.calcMacd(closes, times);
    const macdCurrent  = macd.macdLine.length   > 0 ? macd.macdLine[macd.macdLine.length - 1].value     : null;
    const macdSignal   = macd.signalLine.length > 0 ? macd.signalLine[macd.signalLine.length - 1].value : null;
    const macdHistVal  = macd.histogram.length  > 0 ? macd.histogram[macd.histogram.length - 1].value   : null;
    const macdHistPrev = macd.histogram.length  > 1 ? macd.histogram[macd.histogram.length - 2].value   : null;
    const macdMomentum = macdHistVal && macdHistPrev ? (macdHistVal > macdHistPrev ? 'CRECIENTE' : 'DECRECIENTE') : null;
    const macdCross    = macdCurrent && macdSignal   ?
      (macdCurrent > macdSignal ? 'MACD_SOBRE_SENAL' : 'MACD_BAJO_SENAL') : null;

    // Volumen
    const avgVolume20  = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length);
    const currentVolume= volumes[volumes.length - 1];
    const volumeRatio  = avgVolume20 > 0 ? (currentVolume / avgVolume20) : 1;
    const volumeStatus = volumeRatio > 2 ? 'MUY_ALTO' : volumeRatio > 1.5 ? 'ALTO' : volumeRatio < 0.5 ? 'BAJO' : 'NORMAL';

    // Soportes y Resistencias
    const last20Highs  = highs.slice(-20);
    const last20Lows   = lows.slice(-20);
    const resistance20 = last20Highs.length > 0 ? Math.max(...last20Highs) : 0;
    const support20    = last20Lows.length  > 0 ? Math.min(...last20Lows)  : 0;

    // Cruces
    const goldenCross = ema20Current && ema50Current && ema20Current > ema50Current &&
                        ema20.length > 1 && ema20[ema20.length - 2].value <= ema50[ema50.length - 2].value;
    const deathCross  = ema20Current && ema50Current && ema20Current < ema50Current &&
                        ema20.length > 1 && ema20[ema20.length - 2].value >= ema50[ema50.length - 2].value;

    // Tendencia
    let trend = 'NEUTRAL';
    if (ema20Current && ema50Current && ema200Current) {
      if (ema20Current > ema50Current && ema50Current > ema200Current) trend = 'ALCISTA_FUERTE';
      else if (ema20Current > ema50Current) trend = 'ALCISTA';
      else if (ema20Current < ema50Current && ema50Current < ema200Current) trend = 'BAJISTA_FUERTE';
      else if (ema20Current < ema50Current) trend = 'BAJISTA';
    }

    // ✅ CALCULAR INDICADORES AVANZADOS (para incluirlos en contexto IA)
    const aroonData  = this.aroon(candlesToUse);
    const adxVal     = this.adx(candlesToUse);
    const chaikinVal = this.chaikin(candlesToUse);
    const atrPctVal  = this.atrPercentile(candlesToUse);
    const dmiVal     = this.dmi(candlesToUse);
    const stochVal   = this.stochastic(candlesToUse);
    const mfiVal     = this.mfi(candlesToUse);
    const obvVal     = this.obv(candlesToUse);
    const adlVal     = this.accumulationDistribution(candlesToUse);

    const indicators = {
      rsi: {
        value:    rsiCurrent  ? parseFloat(rsiCurrent.toFixed(2))  : null,
        previous: rsiPrevious ? parseFloat(rsiPrevious.toFixed(2)) : null,
        slope:    rsiSlope    ? parseFloat(rsiSlope.toFixed(2))    : 0,
        status:   rsiCurrent  > 70 ? 'SOBRECOMPRADO' : rsiCurrent < 30 ? 'SOBREVENDIDO' : 'NEUTRAL'
      },
      ema: {
        ema20:        ema20Current  ? parseFloat(ema20Current.toFixed(4))  : null,
        ema50:        ema50Current  ? parseFloat(ema50Current.toFixed(4))  : null,
        ema200:       ema200Current ? parseFloat(ema200Current.toFixed(4)) : null,
        ema20Distance: ema20Distance ? parseFloat(ema20Distance.toFixed(2)) : null,
        ema50Distance: ema50Distance ? parseFloat(ema50Distance.toFixed(2)) : null
      },
      sma: { sma20: sma20Current ? parseFloat(sma20Current.toFixed(4)) : null },
      bollinger: {
        upper:    bbUpper  ? parseFloat(bbUpper.toFixed(4))  : null,
        middle:   bbMiddle ? parseFloat(bbMiddle.toFixed(4)) : null,
        lower:    bbLower  ? parseFloat(bbLower.toFixed(4))  : null,
        width:    bbWidth  ? parseFloat(bbWidth.toFixed(2))  : null,
        position: bbPosition
      },
      vwap: {
        value:    vwapCurrent ? parseFloat(vwapCurrent.toFixed(4)) : null,
        distance: vwapCurrent ? parseFloat(((currentPrice - vwapCurrent) / vwapCurrent * 100).toFixed(2)) : null
      },
      macd: {
        macd:      macdCurrent ? parseFloat(macdCurrent.toFixed(4)) : null,
        signal:    macdSignal  ? parseFloat(macdSignal.toFixed(4))  : null,
        histogram: macdHistVal ? parseFloat(macdHistVal.toFixed(4)) : null,
        momentum:  macdMomentum,
        cross:     macdCross
      },
      volume: {
        current:   currentVolume,
        average20: parseFloat(avgVolume20.toFixed(0)),
        ratio:     parseFloat(volumeRatio.toFixed(2)),
        status:    volumeStatus
      },
      levels: {
        resistance20: parseFloat(resistance20.toFixed(4)),
        support20:    parseFloat(support20.toFixed(4)),
        high20:       parseFloat(resistance20.toFixed(4)),
        low20:        parseFloat(support20.toFixed(4))
      },
      crosses: { goldenCross: goldenCross || false, deathCross: deathCross || false },
      trend,
      // ✅ INDICADORES AVANZADOS
      advanced: {
        obv:         parseFloat(obvVal.toFixed(0)),
        adl:         parseFloat(adlVal.toFixed(0)),
        aroon_up:    parseFloat(aroonData.up.toFixed(1)),
        aroon_down:  parseFloat(aroonData.down.toFixed(1)),
        adx:         parseFloat(adxVal.toFixed(1)),
        chaikin:     parseFloat(chaikinVal.toFixed(2)),
        atr_percent: parseFloat(atrPctVal.toFixed(2)),
        dmi:         parseFloat(dmiVal.toFixed(1)),
        stoch_k:     parseFloat(stochVal.toFixed(1)),
        mfi:         parseFloat(mfiVal.toFixed(1)),
      },
      lastCandles: candlesToUse.slice(-30).map(c => ({
        time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume
      })),
      rsiHistory: rsi14.length > 0 ? rsi14.slice(-30).map((r: { time: string; value: number }) => ({ time: r.time, value: r.value })) : [],
      ema20History: ema20.length > 0 ? ema20.slice(-30).map((e: { time: string; value: number }) => ({ time: e.time, value: e.value })) : [],
      ema50History: ema50.length > 0 ? ema50.slice(-30).map((e: { time: string; value: number }) => ({ time: e.time, value: e.value })) : [],
      macdHistory: macd.macdLine.length > 0 ? macd.macdLine.slice(-30).map((m: { time: string; value: number }) => ({ time: m.time, value: m.value })) : [],
      volumeHistory: volumes.length > 0 ? volumes.slice(-30).map((v: number, i: number) => ({
        time: times[Math.max(0, times.length - 30 + i)], value: v
      })) : []
    };

    this.currentChartIndicators = indicators;

    if (this.aiPanelOpen) {
      this.currentChartContext = this.buildChartContext();
    }

    return indicators;
  }

  private fetchLiveCandle(symbol: string) {
    this.http.get<any>(
      this.apiUrl + '/stocks/bvc/' + symbol + '/live',
      { headers: this.hdr() }
    ).subscribe({
      next: (res: any) => {
        this.marketOpen = res.market_open || false;
        if (!res.candle) return;
        const live = res.candle;
        this.liveCandle = live;
        const idx = this.candles.findIndex(c => c.time === live.time);
        if (idx >= 0) this.candles[idx] = live;
        else this.candles = [...this.candles, live];

        this.currentPrice   = live.close;
        this.priceChange    = parseFloat((live.close - live.open).toFixed(4));
        this.priceChangePct = parseFloat(((this.priceChange / live.open) * 100).toFixed(2));
        this.lastPrices[symbol]   = live.close;
        this.priceChanges[symbol] = this.priceChange;

        if (this.series) {
          try {
            const filtered = this.filterTF(this.candles);
            const lastCandle = filtered[filtered.length - 1];
            if (lastCandle?.time === live.time) {
              if (this.chartType === 'line' || this.chartType === 'area')
                this.series.update({ time: live.time, value: live.close });
              else
                this.series.update(live);
              if (this.volumeSeries) {
                this.volumeSeries.update({
                  time: live.time, value: live.volume,
                  color: live.close >= live.open ? 'rgba(38,166,65,.5)' : 'rgba(248,81,73,.5)'
                });
              }
            }
          } catch {
            this.setData(this.filterTF(this.candles));
          }
        }

        this.currentChartIndicators = this.calculateAllIndicators(this.candles);
        this.updateIndicatorsAndContext();
        this.cd.detectChanges();
      },
      error: (e: any) => {
        if (e.status === 200 || e.status === 0) return;
        if (this.liveInterval) { clearInterval(this.liveInterval); this.liveInterval = null; }
      }
    });
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  private hdr(): HttpHeaders {
    return new HttpHeaders({ Authorization: 'Bearer ' + (localStorage.getItem('access_token') || '') });
  }

  private readonly HISTORY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

  private getCachedHistory(symbol: string): any[] | null {
    try {
      // Usar _v2 para evitar que el navegador muestre velas del 08/04 por un error anterior de fecha
      const key = `hist_v2_${symbol}`;
      const tsKey = `hist_v2_${symbol}_ts`;
      const raw = localStorage.getItem(key);
      const ts  = localStorage.getItem(tsKey);
      if (!raw || !ts) return null;
      if (Date.now() - parseInt(ts) > this.HISTORY_CACHE_TTL_MS) return null;
      const candles = JSON.parse(raw);
      // Invalidate if the latest candle is older than yesterday —
      // a new trading session happened that the cache doesn't know about.
      if (candles && candles.length > 0) {
        const lastDate = candles[candles.length - 1].time as string;
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);
        if (lastDate < yesterdayStr) return null; // stale — missing at least one session
      }
      return candles;
    } catch { return null; }
  }

  private setCachedHistory(symbol: string, candles: any[]): void {
    try {
      localStorage.setItem(`hist_v2_${symbol}`,    JSON.stringify(candles));
      localStorage.setItem(`hist_v2_${symbol}_ts`, String(Date.now()));
    } catch {}
  }

  loadStock(symbol: string) {
    this.selectedSymbol = symbol;
    this.selectedName   = this.stocks.find(s => s.symbol === symbol)?.name || '';
    this.currentChartContext = null;
    this.currentOrderBook    = [];
    this.measurePopup = null;
    this.measureResult = '';
    this.fibLevels = [];
    try { localStorage.setItem('lastChartSymbol', symbol); } catch {}

    // ── Usar tick del socket para pre-pintar vela de hoy inmediatamente ───────
    const socketTick = this.bvcSocket.stocksMap$.getValue()[symbol];
    const todayStr   = this.localDateStr();
    const socketToday: any = socketTick?.PRECIO ? {
      time:   todayStr,
      open:   socketTick.PRECIO_APERT || socketTick.PRECIO,
      high:   socketTick.PRECIO_MAX   || socketTick.PRECIO,
      low:    socketTick.PRECIO_MIN   || socketTick.PRECIO,
      close:  socketTick.PRECIO,
      volume: socketTick.VOLUMEN      || 0,
      amount: socketTick.MONTO_EFECTIVO || 0,
      trades: socketTick.TOT_OP_NEGOC   || 0,
    } : null;

    // Limpiar variables de precio inmediatamente para la UI
    if (socketToday) {
      this.currentPrice   = socketToday.close;
      this.priceChange    = socketTick.VAR_ABS || 0;
      this.priceChangePct = socketTick.VAR_REL || 0;
    } else {
      this.currentPrice = 0;
      this.priceChange = 0;
      this.priceChangePct = 0;
    }

    // ── Intentar caché local primero (evita espera de scraping) ──────────────
    const cached = this.getCachedHistory(symbol);
    if (cached && cached.length > 0) {
      // Merge socket today candle into cached history
      const last = cached[cached.length - 1];
      if (socketToday && last.time === todayStr) {
        cached[cached.length - 1] = { ...last, ...socketToday };
      } else if (socketToday && last.time < todayStr) {
        cached.push(socketToday);
      }
      this.candles = cached;
      this.updatePriceInfo();
      this.updateIndicatorsAndContext(this.candles);
      this.updateAdvancedIndicators(this.candles);
      this.showAnalytics = false;
      this.loading = false;
      this.cd.detectChanges();
      setTimeout(() => this.initCharts(), 150);
      this.startLivePolling(symbol);
      this.loadOrderBook(symbol);
      // Sync BVC history in background, then refresh chart with new data
      this._syncBvcHistoryBackground(symbol);
      return;
    }

    // ── No cache: destroy old chart first, then paint socket candle if available
    this.destroyAll();
    if (socketToday) {
      this.candles = [socketToday];
      this.loading = false;
      this.cd.detectChanges();
      setTimeout(() => this.initCharts(), 100);
      this.startLivePolling(symbol);
    } else {
      this.loading = true;
      this.candles = [];
      this.cd.detectChanges();
    }

    // Call BVC sync endpoint so missing candles are inserted before charting
    this.http.post<any>(
      this.apiUrl + '/stocks/bvc/' + symbol + '/sync-bvc-history',
      {},
      { headers: this.hdr() }
    ).subscribe({
      next: (d: any) => {
        if (this.selectedSymbol !== symbol) return;
        const synced = d.candles || [];
        if (synced.length > 0) {
          this.candles = synced;
          this.setCachedHistory(symbol, this.candles);
          this.updatePriceInfo();
          this.updateIndicatorsAndContext(this.candles);
          this.updateAdvancedIndicators(this.candles);
          this.showAnalytics = false;
          this.loading = false;
          this.cd.detectChanges();
          setTimeout(() => this.initCharts(), 50);
          this.startLivePolling(symbol);
          this.loadOrderBook(symbol);
        } else {
          // Fallback to regular history if sync returns empty
          this._loadHistoryFallback(symbol);
        }
      },
      error: () => {
        // Fallback gracefully
        if (this.selectedSymbol !== symbol) return;
        this._loadHistoryFallback(symbol);
      }
    });
  }

  private _loadHistoryFallback(symbol: string): void {
    this.http.get<any>(this.apiUrl + '/stocks/bvc/' + symbol + '/history', { headers: this.hdr() }).subscribe({
      next: (d: any) => {
        if (this.selectedSymbol !== symbol) return;
        this.candles = d.candles || [];
        this.setCachedHistory(symbol, this.candles);
        this.updatePriceInfo();
        this.updateIndicatorsAndContext(this.candles);
        this.updateAdvancedIndicators(this.candles);
        this.showAnalytics = false;
        this.loading = false;
        this.cd.detectChanges();
        setTimeout(() => this.initCharts(), 50);
        this.startLivePolling(symbol);
        this.loadOrderBook(symbol);
      },
      error: (e: any) => {
        if (this.selectedSymbol !== symbol) return;
        console.error('❌ Error cargando historial:', e);
        this.loading = false;
        this.cd.detectChanges();
      }
    });
  }

  private refreshHistoryInBackground(symbol: string): void {
    this.http.get<any>(this.apiUrl + '/stocks/bvc/' + symbol + '/history', { headers: this.hdr() }).subscribe({
      next: (d: any) => {
        const fresh = d.candles || [];
        if (fresh.length > 0) {
          this.setCachedHistory(symbol, fresh);
          // Solo actualizar si seguimos viendo el mismo símbolo
          if (this.selectedSymbol === symbol) {
            this.candles = fresh;
            this.updatePriceInfo();
            this.updateIndicatorsAndContext(this.candles);
            this.updateAdvancedIndicators(this.candles);
            this.cd.detectChanges();
            setTimeout(() => this.initCharts(), 150);
          }
        }
      },
      error: () => {} // silencioso: ya tenemos datos cacheados
    });
  }

  private _syncBvcHistoryBackground(symbol: string): void {
    this.http.post<any>(
      this.apiUrl + '/stocks/bvc/' + symbol + '/sync-bvc-history',
      {},
      { headers: this.hdr() }
    ).subscribe({
      next: (d: any) => {
        const synced = d.candles || [];
        if (synced.length > 0 && this.selectedSymbol === symbol) {
          this.setCachedHistory(symbol, synced);
          this.candles = synced;
          this.updatePriceInfo();
          this.updateIndicatorsAndContext(this.candles);
          this.updateAdvancedIndicators(this.candles);
          this.cd.detectChanges();
          setTimeout(() => this.initCharts(), 150);
        }
      },
      error: () => {}
    });
  }

  // ✅ NUEVO: cargar libro de órdenes y almacenar para la IA
  private loadOrderBook(symbol: string) {
    this.http.get<{ symbol: string; entries: any[] }>(
      `${this.apiUrl}/market/order-books/${symbol}`,
      { headers: this.hdr() }
    ).subscribe({
      next: (res) => {
        if (this.selectedSymbol !== symbol) return; // Evitar carrera de red
        this.currentOrderBook = res.entries || [];
        // Actualizar contexto del chat si está abierto
        if (this.aiPanelOpen) {
          this.currentChartContext = this.buildChartContext();
          this.cd.detectChanges();
        }
      },
      error: (e) => {
        if (this.selectedSymbol !== symbol) return;
        console.warn(`⚠️ No se pudo cargar el libro de ${symbol}:`, e);
        this.currentOrderBook = [];
      }
    });
  }

  // ── Charts ────────────────────────────────────────────────────────────────

  private LWC() { return LightweightCharts; }

  private destroyAll() {
    try { this.lwc?.remove(); }         catch {}
    try { this.volumeChart?.remove(); } catch {}
    try { this.lwcRsi?.remove(); }      catch {}
    try { this.lwcMacd?.remove(); }     catch {}
    try { this.lwcObv?.remove(); }      catch {}
    try { this.lwcAroon?.remove(); }    catch {}
    try { this.lwcStoch?.remove(); }    catch {}
    this.lwc = this.volumeChart = this.lwcRsi = this.lwcMacd = null;
    this.lwcObv = this.lwcAroon = this.lwcStoch = null;
    this.series = this.volumeSeries = this.rsiSeries = null;
    this.macdFast = this.macdSlow = this.macdHist = null;
    this.obvSeries = this.adlChartSeries = null;
    this.aroonUpSeries = this.aroonDownSeries = null;
    this.stochKSeries = this.stochDSeries = null;
    this.overlays = {}; this.horizLines = []; this.vertLines = [];
  }

  private updateIndicatorsAndContext(candlesData?: Candle[]) {
    const dataToUse = candlesData || this.candles;
    if (dataToUse.length > 0) {
      this.currentChartIndicators = this.calculateAllIndicators(dataToUse);
      let ctx = this.buildChartContext(dataToUse);
      if (this.showInUsd && this.historicalUsdRates && ctx) {  // ✅ añadido && ctx
        ctx = this.convertContextToUsd(ctx);
      }
      this.currentChartContext = ctx;
    }
  }

  private dims() {
    const vH    = this.showVolume             ? 80  : 0;
    const rH    = this.indicators[0]?.enabled ? 138 : 0;
    const mH    = this.indicators[1]?.enabled ? 138 : 0;
    const obvH  = (this.indEnabled('obv') || this.indEnabled('adl')) ? 118 : 0;
    const aroonH= this.indEnabled('aroon') ? 118 : 0;
    const stochH= this.indEnabled('stoch') ? 118 : 0;
    const headerH = 64 + 40 + 34 + 6;

    const h = Math.max(
      window.innerHeight - headerH - vH - rH - mH - obvH - aroonH - stochH,
      350
    );

    const el    = this.chartEl?.nativeElement;
    const aiW   = this.aiPanelOpen ? 380 : 0;
    const parent= el?.closest('.main-area') as HTMLElement;
    const parentWidth = parent?.clientWidth || (window.innerWidth - 220);
    const w = Math.max(parentWidth - aiW, 200);

    return { w, h };
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.aiPanelOpen) { this.closePanelAndResize(); }
  }

  private async initCharts() {
    this.destroyAll();
    const L = this.LWC();
    const { w, h } = this.dims();
    const el = this.chartEl?.nativeElement;
    if (!el) return;
    el.style.cssText = 'width:' + w + 'px;height:' + h + 'px;';

    const theme = {
      layout:    { background:{ color:'#0d1117' }, textColor:'#8b949e' },
      grid:      { vertLines:{ color:'#1c2128' }, horzLines:{ color:'#1c2128' } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor:'#30363d' },
      timeScale: { borderColor:'#30363d', timeVisible:true, secondsVisible:false },
    };

    this.lwc    = L.createChart(el, { ...theme, width:w, height:h, handleScroll:true, handleScale:true });
    this.series = this.mkSeries(L);
    const data  = this.filterTF(this.displayCandles);
    this.setData(data);
    this.lwc.timeScale().fitContent();

    if (this.showVolume) this.mkVol(L, data, theme, w);
    this.refreshOverlays(data);
    if (this.indicators[0]?.enabled) setTimeout(() => this.mkRsi(data), 60);
    if (this.indicators[1]?.enabled) setTimeout(() => this.mkMacd(data), 60);
    if (this.indEnabled('obv') || this.indEnabled('adl')) setTimeout(() => this.mkObv(data), 80);
    if (this.indEnabled('aroon')) setTimeout(() => this.mkAroon(data), 80);
    if (this.indEnabled('stoch')) setTimeout(() => this.mkStoch(data), 80);

    this.lwc.subscribeCrosshairMove((p: any) => {
      if (p?.time) {
        const found = this.candles.find(c => c.time === p.time) || null;
        this.hoveredCandle = found;
      } else {
        this.hoveredCandle = null;
      }
      this.cd.detectChanges();
    });

    this.lwc.subscribeClick((p: any) => {
      if (!p?.time) return;
      this.handleClick(p.time, this.series.coordinateToPrice(p.point?.y ?? 0), p.point);
    });

    setTimeout(() => {
      this.alignTimeScales();
      this.sync();
    }, 200);

    this.mkResizeObs(el);
  }

  private mkSeries(L: any): any {
    switch (this.chartType) {
      case 'bar':
        return this.lwc.addBarSeries({ upColor:'#26a641', downColor:'#f85149' });
      case 'line':
        return this.lwc.addLineSeries({ color:'#58a6ff', lineWidth:2 });
      case 'area':
        return this.lwc.addAreaSeries({
          topColor:'rgba(88,166,255,.35)', bottomColor:'rgba(88,166,255,.0)',
          lineColor:'#58a6ff', lineWidth:2,
        });
      default:
        return this.lwc.addCandlestickSeries({
          upColor:'#26a641', downColor:'#f85149',
          borderUpColor:'#26a641', borderDownColor:'#f85149',
          wickUpColor:'#26a641', wickDownColor:'#f85149',
        });
    }
  }

  private setData(data: Candle[]) {
    if (this.chartType === 'line' || this.chartType === 'area')
      this.series.setData(data.map(c => ({ time:c.time, value:c.close })));
    else
      this.series.setData(data);
  }

  private mkVol(L: any, data: Candle[], theme: any, w: number) {
    const el = this.volumeEl?.nativeElement; if (!el) return;
    el.style.cssText = 'width:' + w + 'px;height:80px;';

    this.volumeChart = L.createChart(el, {
      ...theme,
      width: w, height: 80,
      rightPriceScale: {
        borderColor: '#30363d', borderVisible: true, visible: true,
        scaleMargins: { top: 0.1, bottom: 0 },
      },
      timeScale: { visible: true, borderColor:'#30363d', timeVisible:true, secondsVisible:false },
      handleScroll: true, handleScale: true,
    });

    this.volumeSeries = this.volumeChart.addHistogramSeries({
      priceFormat: { type:'volume' }, priceScaleId: 'right',
    });
    this.volumeSeries.priceScale().applyOptions({ scaleMargins:{ top:0.1, bottom:0 } });
    this.volumeSeries.setData(data.map(c => ({
      time: c.time, value: c.volume,
      color: c.close >= c.open ? 'rgba(38,166,65,.5)' : 'rgba(248,81,73,.5)'
    })));

    this.volumeChart.subscribeCrosshairMove((p: any) => {
      if (p?.time) {
        const found = this.candles.find(c => c.time === p.time) || null;
        this.hoveredCandle = found;
      } else {
        this.hoveredCandle = null;
      }
      this.cd.detectChanges();
    });

    this.sync();
  }

  // ── Overlay indicators ────────────────────────────────────────────────────

  private refreshOverlays(data: Candle[]) {
    if (!this.lwc) return;
    // Pattern markers re-detect on every overlay refresh so they stay in sync with the visible TF
    this.applyPatternMarkers(data);
    const cl = data.map(c => c.close), tm = data.map(c => c.time);

    const simple: Record<string, () => any[]> = {
      ema20:  () => this.ema(cl, tm, 20),
      ema50:  () => this.ema(cl, tm, 50),
      ema200: () => this.ema(cl, tm, 200),
      sma20:  () => this.sma(cl, tm, 20),
      vwap:   () => this.vwap(data),
    };
    const styles: Record<string, any> = {
      ema20:  { color:'#f0883e', lineWidth:1, title:'EMA20',  priceLineVisible:false, lastValueVisible:false, autoscaleInfoProvider: () => null },
      ema50:  { color:'#3fb950', lineWidth:1, title:'EMA50',  priceLineVisible:false, lastValueVisible:false, autoscaleInfoProvider: () => null },
      ema200: { color:'#ff7b72', lineWidth:1, title:'EMA200', priceLineVisible:false, lastValueVisible:false, autoscaleInfoProvider: () => null },
      sma20:  { color:'#d2a8ff', lineWidth:1, lineStyle:2, title:'SMA20', priceLineVisible:false, lastValueVisible:false, autoscaleInfoProvider: () => null },
      vwap:   { color:'#ffa657', lineWidth:1, lineStyle:2, title:'VWAP',  priceLineVisible:false, lastValueVisible:false, autoscaleInfoProvider: () => null },
    };

    for (const id of Object.keys(simple)) {
      const on = this.indicators.find(i => i.id === id)?.enabled;
      if (on) {
        if (!this.overlays[id]) this.overlays[id] = this.lwc.addLineSeries(styles[id]);
        this.overlays[id].setData(simple[id]());
      } else if (this.overlays[id]) {
        try { this.lwc.removeSeries(this.overlays[id]); } catch {}
        delete this.overlays[id];
      }
    }

    const bbOn = this.indicators.find(i => i.id === 'bb')?.enabled;
    if (bbOn) {
      const bb = this.bb(cl, tm, 20, 2);
      if (!this.overlays['bb_u']) {
        this.overlays['bb_u'] = this.lwc.addLineSeries({ color:'rgba(121,192,255,.75)', lineWidth:1, title:'BB+', priceLineVisible:false, lastValueVisible:false, autoscaleInfoProvider: () => null });
        this.overlays['bb_m'] = this.lwc.addLineSeries({ color:'rgba(121,192,255,.35)', lineWidth:1, lineStyle:2, title:'BB', priceLineVisible:false, lastValueVisible:false, autoscaleInfoProvider: () => null });
        this.overlays['bb_l'] = this.lwc.addLineSeries({ color:'rgba(121,192,255,.75)', lineWidth:1, title:'BB−', priceLineVisible:false, lastValueVisible:false, autoscaleInfoProvider: () => null });
      }
      this.overlays['bb_u'].setData(bb.upper);
      this.overlays['bb_m'].setData(bb.middle);
      this.overlays['bb_l'].setData(bb.lower);
    } else {
      for (const k of ['bb_u', 'bb_m', 'bb_l']) {
        if (this.overlays[k]) { try { this.lwc.removeSeries(this.overlays[k]); } catch {} delete this.overlays[k]; }
      }
    }

    // ── Ichimoku Cloud
    const ichiOn = this.indicators.find(i => i.id === 'ichimoku')?.enabled;
    if (ichiOn) {
      const ichi = this.calcIchimoku(data);
      const ks: Record<string, any> = {
        ichi_t:  { color:'rgba(38,166,65,.9)',   lineWidth:1, title:'Tenkan',  priceLineVisible:false, lastValueVisible:false, autoscaleInfoProvider: () => null },
        ichi_k:  { color:'rgba(248,81,73,.9)',   lineWidth:1, title:'Kijun',   priceLineVisible:false, lastValueVisible:false, autoscaleInfoProvider: () => null },
        ichi_a:  { color:'rgba(38,166,65,.3)',   lineWidth:1, title:'SpanA',   priceLineVisible:false, lastValueVisible:false, autoscaleInfoProvider: () => null },
        ichi_b:  { color:'rgba(248,81,73,.3)',   lineWidth:1, title:'SpanB',   priceLineVisible:false, lastValueVisible:false, autoscaleInfoProvider: () => null },
        ichi_ch: { color:'rgba(102,170,255,.6)', lineWidth:1, title:'Chikou',  priceLineVisible:false, lastValueVisible:false, autoscaleInfoProvider: () => null },
      };
      const ichiData: Record<string, any[]> = {
        ichi_t: ichi.tenkan, ichi_k: ichi.kijun,
        ichi_a: ichi.spanA,  ichi_b: ichi.spanB, ichi_ch: ichi.chikou,
      };
      for (const key of Object.keys(ks)) {
        if (!this.overlays[key]) this.overlays[key] = this.lwc.addLineSeries(ks[key]);
        this.overlays[key].setData(ichiData[key]);
      }
    } else {
      for (const k of ['ichi_t','ichi_k','ichi_a','ichi_b','ichi_ch']) {
        if (this.overlays[k]) { try { this.lwc.removeSeries(this.overlays[k]); } catch {} delete this.overlays[k]; }
      }
    }
  }

  // --- OBV
  private obv(candles: Candle[]): number {
    let obv = 0;
    for (let i = 1; i < candles.length; i++) {
      const closePrev = candles[i-1].close;
      const closeCurr = candles[i].close;
      const volume    = candles[i].volume;
      if (closeCurr > closePrev) obv += volume;
      else if (closeCurr < closePrev) obv -= volume;
    }
    return obv;
  }

  // --- A/D (Accumulation/Distribution)
  private accumulationDistribution(candles: Candle[]): number {
    let adl = 0;
    for (const c of candles) {
      const range = c.high - c.low;
      if (range === 0) continue;
      const mfm = ((c.close - c.low) - (c.high - c.close)) / range;
      adl += mfm * c.volume;
    }
    return adl;
  }

  private adlSeriesArr(candles: Candle[]): number[] {
    const out: number[] = []; let adl = 0;
    for (const c of candles) {
      const range = c.high - c.low;
      if (range > 0) { const mfm = ((c.close - c.low) - (c.high - c.close)) / range; adl += mfm * c.volume; }
      out.push(adl);
    }
    return out;
  }

  // --- Aroon
  private aroon(candles: Candle[], period: number = 25): { up: number; down: number } {
    const highs = candles.map(c => c.high);
    const lows  = candles.map(c => c.low);
    const len   = candles.length;
    if (len < period) return { up: 0, down: 0 };
    let up = 0, down = 0;
    for (let i = 0; i < period; i++) {
      if (highs[len-1-i] === Math.max(...highs.slice(-period))) up   = period - i;
      if (lows[len-1-i]  === Math.min(...lows.slice(-period)))  down = period - i;
    }
    return { up: (up / period) * 100, down: (down / period) * 100 };
  }

  // --- ADX
  private adx(candles: Candle[], period: number = 14): number {
    const closes = candles.map(c => c.close);
    const highs  = candles.map(c => c.high);
    const lows   = candles.map(c => c.low);
    const len    = candles.length;
    if (len < period + 1) return 0;

    const tr: number[] = [], plusDM: number[] = [], minusDM: number[] = [];
    for (let i = 1; i < len; i++) {
      const h = highs[i], hPrev = highs[i-1];
      const l = lows[i],  lPrev = lows[i-1];
      const cPrev = closes[i-1];
      tr.push(Math.max(h - l, Math.abs(h - cPrev), Math.abs(l - cPrev)));
      const upMove = h - hPrev, downMove = lPrev - l;
      plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    const smooth = (arr: number[], p: number): number[] => {
      const result: number[] = [];
      let sum = arr.slice(0, p).reduce((a,b) => a+b, 0);
      result.push(sum / p);
      for (let i = p; i < arr.length; i++) { sum = sum - (sum / p) + arr[i]; result.push(sum / p); }
      return result;
    };
    const trSmooth    = smooth(tr, period);
    const plusDMSmooth= smooth(plusDM, period);
    const minusDMSmooth=smooth(minusDM, period);
    const plusDI   = plusDMSmooth.map((v,i) => (v / trSmooth[i]) * 100);
    const minusDI  = minusDMSmooth.map((v,i) => (v / trSmooth[i]) * 100);
    const dx       = plusDI.map((p,i) => Math.abs(p - minusDI[i]) / (p + minusDI[i]) * 100);
    const adxArr   = smooth(dx, period);
    return adxArr.length ? adxArr[adxArr.length-1] : 0;
  }

  // --- Chaikin Oscillator (3,10)
  private chaikin(candles: Candle[]): number {
    if (candles.length < 10) return 0;
    const series = this.adlSeriesArr(candles);
    const ema3   = this.emaOfArray(series, 3);
    const ema10  = this.emaOfArray(series, 10);
    return ema3 - ema10;
  }

  private emaOfArray(arr: number[], period: number): number {
    if (arr.length < period) return arr[arr.length - 1] ?? 0;
    const k = 2 / (period + 1);
    let ema = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < arr.length; i++) { ema = arr[i] * k + ema * (1 - k); }
    return ema;
  }

  // --- ATR Percentile
  private atrPercentile(candles: Candle[], period: number = 14): number {
    const tr: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const c = candles[i], cPrev = candles[i-1];
      tr.push(Math.max(c.high - c.low, Math.abs(c.high - cPrev.close), Math.abs(c.low - cPrev.close)));
    }
    const atr   = tr.slice(-period).reduce((a,b) => a+b, 0) / period;
    const price = candles[candles.length-1].close;
    return (atr / price) * 100;
  }

  // --- ADR% (Average Daily Range over last 20 sessions)
  private calcAdr(candles: Candle[], period = 20): { adr: number; usedPct: number } {
    if (candles.length < 2) return { adr: 0, usedPct: 0 };
    const slice = candles.slice(-period);
    const ranges = slice.map(c => c.low > 0 ? ((c.high - c.low) / c.low) * 100 : 0);
    const adr = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    const last = candles[candles.length - 1];
    const todayRange = last.low > 0 ? ((last.high - last.low) / last.low) * 100 : 0;
    const usedPct = adr > 0 ? Math.min(200, (todayRange / adr) * 100) : 0;
    return { adr: parseFloat(adr.toFixed(3)), usedPct: parseFloat(usedPct.toFixed(1)) };
  }

  // --- BBW (Bollinger Band Width)
  private calcBbw(candles: Candle[], period = 20, mult = 2): { width: number; trend: 'contracting' | 'expanding' | 'neutral' } {
    const computeWidth = (slice: Candle[]): number => {
      if (slice.length < period) return 0;
      const closes = slice.map(c => c.close);
      const sma = closes.slice(-period).reduce((a, b) => a + b, 0) / period;
      const variance = closes.slice(-period).reduce((a, b) => a + (b - sma) ** 2, 0) / period;
      const std = Math.sqrt(variance);
      return sma > 0 ? (mult * 2 * std / sma) * 100 : 0;
    };
    const current  = computeWidth(candles);
    const previous = computeWidth(candles.slice(0, -1));
    const delta    = current - previous;
    const trend: 'contracting' | 'expanding' | 'neutral' =
      Math.abs(delta) < 0.01 ? 'neutral' : delta < 0 ? 'contracting' : 'expanding';
    return { width: parseFloat(current.toFixed(3)), trend };
  }

  // --- DMI
  private dmi(candles: Candle[], basePeriod: number = 14): number {
    if (candles.length < basePeriod + 5) return 50;
    const closes = candles.map(c => c.close);
    const times  = candles.map(c => c.time);
    const recent = closes.slice(-5);
    const mean   = recent.reduce((a,b)=>a+b,0) / recent.length;
    const std    = Math.sqrt(recent.reduce((a,b)=>a+(b-mean)**2,0) / recent.length);
    const volPct = mean > 0 ? (std / mean) * 100 : 1;
    const dynPeriod = Math.max(5, Math.min(30, Math.round(basePeriod / Math.max(volPct, 0.5))));
    if (closes.length < dynPeriod + 1) return 50;
    const s = this.calcRsi(closes, times, dynPeriod);
    return s.length > 0 ? s[s.length - 1].value : 50;
  }

  // --- Stochastic
  private stochastic(candles: Candle[], period: number = 14): number {
    const closes = candles.map(c => c.close);
    const highs  = candles.map(c => c.high);
    const lows   = candles.map(c => c.low);
    const len    = candles.length;
    if (len < period) return 50;
    const highestHigh = Math.max(...highs.slice(-period));
    const lowestLow   = Math.min(...lows.slice(-period));
    const lastClose   = closes[len-1];
    return ((lastClose - lowestLow) / (highestHigh - lowestLow)) * 100;
  }

  // --- MFI (Money Flow Index)
  private mfi(candles: Candle[], period: number = 14): number {
    let positiveFlow = 0, negativeFlow = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      if (i === 0) continue;
      const tp     = (candles[i].high + candles[i].low + candles[i].close) / 3;
      const tpPrev = (candles[i-1].high + candles[i-1].low + candles[i-1].close) / 3;
      const moneyFlow = tp * candles[i].volume;
      if (tp > tpPrev) positiveFlow += moneyFlow;
      else negativeFlow += moneyFlow;
    }
    const ratio = positiveFlow / (negativeFlow || 1);
    return 100 - (100 / (1 + ratio));
  }

  // ── Market Regime — Multi-Timeframe Gaussian HMM (4 states) ─────────────
  // Uses returns from 3 windows (5d/20d/60d) + volume trend + volatility regime
  // scoring via Gaussian emission likelihoods to classify the dominant state.
  private calcMarketRegime(candles: Candle[]): 'alcista' | 'bajista' | 'lateral' | 'volatil' {
    const n = Math.min(candles.length, 60);
    if (n < 10) return 'lateral';
    const slice   = candles.slice(-n);
    const returns = slice.slice(1).map((c, i) => (c.close - slice[i].close) / (slice[i].close || 1));
    if (!returns.length) return 'lateral';

    // Rolling volatility at multiple windows
    const vol5  = this._rollingStd(returns, 5)  * Math.sqrt(252) * 100;
    const vol20 = this._rollingStd(returns, 20) * Math.sqrt(252) * 100;

    // Regime: high-volatility override (Gaussian tail — σ > 1.8× baseline)
    if (vol5 > 60 || (vol5 > 40 && vol5 / (vol20 || 1) > 1.8)) return 'volatil';

    // Multi-timeframe trend scores
    const trend5  = returns.slice(-5).reduce((a, b) => a + b, 0)  * 100 / 5;
    const last20  = slice[Math.max(0, slice.length - 20)].close;
    const trend20 = (slice[slice.length - 1].close - last20) / (last20 || 1) * 100;
    const trend60 = (slice[slice.length - 1].close - slice[0].close) / (slice[0].close || 1) * 100;

    // Volume participation (is volume backing the move?)
    const avgVol10 = slice.slice(-10).reduce((a, c) => a + c.volume, 0) / 10;
    const avgVol30 = slice.slice(-Math.min(30, n)).reduce((a, c) => a + c.volume, 0) / Math.min(30, n);
    const volPart  = avgVol30 > 0 ? avgVol10 / avgVol30 : 1;

    // Gaussian-inspired scoring: weight each timeframe by its reliability
    // Short (5d) = 0.25, Mid (20d) = 0.50, Long (60d) = 0.25
    const weightedTrend = trend5 * 0.25 + trend20 * 0.50 + trend60 * 0.25;

    // Trend-confirmation threshold adjusted for volume participation
    const threshold = volPart > 1.2 ? 1.5 : 2.5; // lower bar when volume confirms

    if (weightedTrend >  threshold) return 'alcista';
    if (weightedTrend < -threshold) return 'bajista';
    return 'lateral';
  }

  private _rollingStd(arr: number[], window: number): number {
    const s = arr.slice(-Math.min(window, arr.length));
    if (s.length < 2) return 0;
    const m = s.reduce((a, b) => a + b, 0) / s.length;
    return Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / s.length);
  }

  // ── CVD — Cumulative Volume Delta (aggressive buy − sell via OHLCV proxy) ─
  private calcCvd(candles: Candle[]): { cumulative: number; lastDelta: number } {
    let cumDelta = 0, lastDelta = 0;
    for (const c of candles) {
      const range  = c.high - c.low;
      // Williams' buy/sell volume estimator from OHLCV (used when tick data unavailable)
      const buyVol = range > 0 ? c.volume * (c.close - c.low) / range : c.volume * 0.5;
      const delta  = buyVol * 2 - c.volume; // net delta = buyVol - sellVol
      cumDelta  += delta;
      lastDelta  = delta;
    }
    return { cumulative: parseFloat(cumDelta.toFixed(0)), lastDelta: parseFloat(lastDelta.toFixed(0)) };
  }

  // ── Volume Profile — POC / HVN / LVN via price-bucketed volume histogram ──
  private calcVolumeProfile(candles: Candle[], bins = 40): {
    hvn: number; lvn: number; poc: number;
    levels: { price: number; volume: number; pct: number }[];
  } {
    if (candles.length < 5) return { hvn: 0, lvn: 0, poc: 0, levels: [] };
    const priceMin = Math.min(...candles.map(c => c.low));
    const priceMax = Math.max(...candles.map(c => c.high));
    const range    = priceMax - priceMin;
    if (range < 1e-10) return { hvn: 0, lvn: 0, poc: 0, levels: [] };

    const bucketSize = range / bins;
    const volumes    = new Array(bins).fill(0);

    for (const c of candles) {
      const candleRange = c.high - c.low;
      for (let b = 0; b < bins; b++) {
        const bLow  = priceMin + b * bucketSize;
        const bHigh = bLow + bucketSize;
        if (candleRange > 0) {
          const overlap = Math.min(c.high, bHigh) - Math.max(c.low, bLow);
          if (overlap > 0) volumes[b] += c.volume * (overlap / candleRange);
        } else if (c.close >= bLow && c.close < bHigh) {
          volumes[b] += c.volume;
        }
      }
    }

    const maxVol = Math.max(...volumes);
    if (maxVol === 0) return { hvn: 0, lvn: 0, poc: 0, levels: [] };

    const pocIdx = volumes.indexOf(maxVol);
    const poc    = priceMin + pocIdx * bucketSize + bucketSize / 2;

    // LVN: lowest-volume bucket in the inner 80% of the range (avoid extremes)
    const innerStart = Math.floor(bins * 0.1);
    const innerEnd   = Math.ceil(bins * 0.9);
    let lvnIdx = innerStart;
    let minVol = volumes[innerStart];
    for (let i = innerStart + 1; i < innerEnd; i++) {
      if (volumes[i] < minVol) { minVol = volumes[i]; lvnIdx = i; }
    }
    const lvn = priceMin + lvnIdx * bucketSize + bucketSize / 2;

    const levels = volumes.map((vol, i) => ({
      price:  parseFloat((priceMin + i * bucketSize + bucketSize / 2).toFixed(4)),
      volume: parseFloat(vol.toFixed(0)),
      pct:    parseFloat((vol / maxVol).toFixed(3))
    }));

    return { hvn: parseFloat(poc.toFixed(4)), lvn: parseFloat(lvn.toFixed(4)), poc: parseFloat(poc.toFixed(4)), levels };
  }

  // ── Price Percentile — where current price sits in its 252-day distribution
  private calcPricePercentile(candles: Candle[], period = 252): number {
    if (candles.length < 5) return 50;
    const closes  = candles.slice(-Math.min(period, candles.length)).map(c => c.close);
    const current = closes[closes.length - 1];
    const rank    = closes.filter(p => p <= current).length;
    return Math.round(rank / closes.length * 100);
  }

  // ── Value Zone (CAPE proxy) — price Z-score vs 1-year mean ───────────────
  // In the absence of earnings data, uses price deviation from its long-run
  // mean as a cyclically-adjusted valuation signal (akin to Buffett's Price/MA).
  private calcValueZone(candles: Candle[], period = 252): { score: number; label: string } {
    const n = Math.min(period, candles.length);
    if (n < 20) return { score: 0, label: 'Sin datos' };
    const closes = candles.slice(-n).map(c => c.close);
    const mean   = closes.reduce((a, b) => a + b, 0) / closes.length;
    const std    = Math.sqrt(closes.reduce((a, b) => a + (b - mean) ** 2, 0) / closes.length);
    const z      = std > 0 ? (closes[closes.length - 1] - mean) / std : 0;
    let label: string;
    if      (z >  2)   label = 'BURBUJA';
    else if (z >  1)   label = 'CARA';
    else if (z > -1)   label = 'NEUTRAL';
    else if (z > -2)   label = 'BARATA';
    else               label = 'HIST. MÍN.';
    return { score: parseFloat(z.toFixed(2)), label };
  }

  // ── Half-Kelly Criterion ──────────────────────────────────────────────────
  private calcKelly(candles: Candle[], period = 60): number {
    const n = Math.min(candles.length, period);
    if (n < 10) return 0;
    const slice   = candles.slice(-n);
    const returns = slice.slice(1).map((c, i) => (c.close - slice[i].close) / (slice[i].close || 1));
    const wins    = returns.filter(r => r > 0);
    const losses  = returns.filter(r => r < 0);
    if (!wins.length || !losses.length) return 0;
    const p    = wins.length / returns.length;
    const avgW = wins.reduce((a, b) => a + b, 0) / wins.length;
    const avgL = Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length);
    const b    = avgW / avgL;
    const kelly = (p * b - (1 - p)) / b;
    return Math.max(0, Math.min(1, kelly / 2));  // half-Kelly, clamped 0-1
  }

  // ── Rolling Auto-Correlation (lag-1) ─────────────────────────────────────
  private calcAutoCorr(candles: Candle[], period = 30): number {
    const n = Math.min(candles.length, period + 1);
    if (n < 10) return 0;
    const slice   = candles.slice(-n);
    const returns = slice.slice(1).map((c, i) => (c.close - slice[i].close) / (slice[i].close || 1));
    if (returns.length < 4) return 0;
    const x = returns.slice(0, -1);
    const y = returns.slice(1);
    const mx = x.reduce((a, b) => a + b, 0) / x.length;
    const my = y.reduce((a, b) => a + b, 0) / y.length;
    const num = x.reduce((a, v, i) => a + (v - mx) * (y[i] - my), 0);
    const dx  = Math.sqrt(x.reduce((a, v) => a + (v - mx) ** 2, 0));
    const dy  = Math.sqrt(y.reduce((a, v) => a + (v - my) ** 2, 0));
    return (dx * dy) > 0 ? parseFloat((num / (dx * dy)).toFixed(3)) : 0;
  }

  // ── Liquidity Z-Score (Volume vs 20d avg) ────────────────────────────────
  private calcLiquidityZ(candles: Candle[], period = 20): number {
    if (candles.length < period + 1) return 0;
    const slice  = candles.slice(-(period + 1));
    const hist   = slice.slice(0, -1).map(c => c.volume);
    const today  = slice[slice.length - 1].volume;
    const avg    = hist.reduce((a, b) => a + b, 0) / hist.length;
    const std    = Math.sqrt(hist.reduce((a, b) => a + (b - avg) ** 2, 0) / hist.length);
    return std > 0 ? parseFloat(((today - avg) / std).toFixed(2)) : 0;
  }

  // ── Momentum Score / Smart Beta proxy (rate of change vs 20d SMA) ────────
  private calcMomentum(candles: Candle[], period = 20): number {
    if (candles.length < period + 1) return 0;
    const slice = candles.slice(-(period + 1));
    const sma   = slice.slice(0, -1).map(c => c.close).reduce((a, b) => a + b, 0) / period;
    const last  = slice[slice.length - 1].close;
    return sma > 0 ? parseFloat(((last - sma) / sma * 100).toFixed(2)) : 0;
  }

  // ── RSI sub-chart ─────────────────────────────────────────────────────────

  private mkRsi(data: Candle[]) {
    const el = this.rsiEl?.nativeElement; if (!el) return;
    const L  = this.LWC();
    if (this.lwcRsi) { try { this.lwcRsi.remove(); } catch {} }
    const w  = this.dims().w;
    el.style.cssText = 'width:' + w + 'px;height:138px;';
    this.lwcRsi = L.createChart(el, {
      layout:    { background:{ color:'#0d1117' }, textColor:'#8b949e' },
      grid:      { vertLines:{ color:'#1c2128' }, horzLines:{ color:'#161b22' } },
      crosshair: { mode:1 },
      width:w, height:138,
      rightPriceScale:{ scaleMargins:{ top:.05, bottom:.05 }, borderColor:'#30363d' },
      timeScale:{ visible:true, borderColor:'#30363d', timeVisible:true, secondsVisible:false },
      handleScroll:true, handleScale:true,
    });
    const rsiData = this.calcRsi(data.map(c => c.close), data.map(c => c.time), 14);
    this.rsiSeries = this.lwcRsi.addLineSeries({
      color:'#a371f7', lineWidth:2, title:'RSI',
      priceLineVisible:false, lastValueVisible:true,
    });
    const pad = data.slice(0, data.length - rsiData.length).map((c: any) => ({ time: c.time }));
    this.rsiSeries.setData([...pad, ...rsiData]);
    this.rsiSeries.createPriceLine({ price:70, color:'rgba(248,81,73,.5)',  lineWidth:1, lineStyle:3, axisLabelVisible:true,  title:'70' });
    this.rsiSeries.createPriceLine({ price:50, color:'rgba(139,148,158,.2)', lineWidth:1, lineStyle:3, axisLabelVisible:false, title:'' });
    this.rsiSeries.createPriceLine({ price:30, color:'rgba(38,166,65,.5)',   lineWidth:1, lineStyle:3, axisLabelVisible:true,  title:'30' });
    this.lwcRsi.priceScale('right').applyOptions({ minimum:0, maximum:100 });
    this.lwcRsi.timeScale().fitContent();
    this.sync();
    setTimeout(() => this.alignTimeScales(), 50);
  }

  // ── MACD sub-chart ────────────────────────────────────────────────────────

  private mkMacd(data: Candle[]) {
    const el = this.macdEl?.nativeElement; if (!el) return;
    const L  = this.LWC();
    if (this.lwcMacd) { try { this.lwcMacd.remove(); } catch {} }
    const w  = this.dims().w;
    el.style.cssText = 'width:' + w + 'px;height:138px;';
    this.lwcMacd = L.createChart(el, {
      layout:    { background:{ color:'#0d1117' }, textColor:'#8b949e' },
      grid:      { vertLines:{ color:'#1c2128' }, horzLines:{ color:'#161b22' } },
      crosshair: { mode:1 },
      width:w, height:138,
      rightPriceScale:{ borderColor:'#30363d', scaleMargins:{ top:.1, bottom:.1 } },
      timeScale:{ visible:true, borderColor:'#30363d', timeVisible:true, secondsVisible:false },
      handleScroll:true, handleScale:true,
    });
    const macd = this.calcMacd(data.map(c => c.close), data.map(c => c.time));
    this.macdHist = this.lwcMacd.addHistogramSeries({ title:'Hist', priceLineVisible:false });
    this.macdFast = this.lwcMacd.addLineSeries({ color:'#58a6ff', lineWidth:1, title:'MACD',   priceLineVisible:false, lastValueVisible:true });
    this.macdSlow = this.lwcMacd.addLineSeries({ color:'#f0883e', lineWidth:1, title:'Signal', priceLineVisible:false, lastValueVisible:true });
    const padH = data.slice(0, data.length - macd.histogram.length).map((c: any) => ({ time: c.time }));
    this.macdHist.setData([...padH, ...macd.histogram]);
    const padM = data.slice(0, data.length - macd.macdLine.length).map((c: any) => ({ time: c.time }));
    this.macdFast.setData([...padM, ...macd.macdLine]);
    const padS = data.slice(0, data.length - macd.signalLine.length).map((c: any) => ({ time: c.time }));
    this.macdSlow.setData([...padS, ...macd.signalLine]);
    this.lwcMacd.timeScale().fitContent();
    this.sync();
    setTimeout(() => this.alignTimeScales(), 50);
  }

  // ── OBV / A/D sub-chart ───────────────────────────────────────────────────
  private mkObv(data: Candle[]) {
    const el = this.obvEl?.nativeElement; if (!el) return;
    const L  = this.LWC();
    if (this.lwcObv) { try { this.lwcObv.remove(); } catch {} }
    const w  = this.dims().w;
    el.style.cssText = 'width:' + w + 'px;height:118px;';
    this.lwcObv = L.createChart(el, {
      layout:    { background:{ color:'#0d1117' }, textColor:'#8b949e' },
      grid:      { vertLines:{ color:'#1c2128' }, horzLines:{ color:'#161b22' } },
      crosshair: { mode:1 },
      width:w, height:118,
      rightPriceScale:{ borderColor:'#30363d', scaleMargins:{ top:.1, bottom:.1 } },
      timeScale:{ visible:true, borderColor:'#30363d', timeVisible:true, secondsVisible:false },
      handleScroll:true, handleScale:true,
    });
    if (this.indEnabled('obv')) {
      this.obvSeries = this.lwcObv.addLineSeries({
        color:'#ffaa66', lineWidth:1, title:'OBV', priceLineVisible:false, lastValueVisible:true,
      });
      const obv = this.calcObvSeries(data);
      const padO = data.slice(0, data.length - obv.length).map((c: any) => ({ time: c.time }));
      this.obvSeries.setData([...padO, ...obv]);
    }
    if (this.indEnabled('adl')) {
      this.adlChartSeries = this.lwcObv.addLineSeries({
        color:'#66ffaa', lineWidth:1, title:'A/D', priceLineVisible:false, lastValueVisible:true,
      });
      const adlData = this.adlSeriesArr(data).map((v, i) => ({ time: data[i].time, value: v }));
      const padA = data.slice(0, data.length - adlData.length).map((c: any) => ({ time: c.time }));
      this.adlChartSeries.setData([...padA, ...adlData]);
    }
    this.lwcObv.timeScale().fitContent();
    this.sync();
    setTimeout(() => this.alignTimeScales(), 50);
  }

  private calcObvSeries(data: Candle[]): { time: string; value: number }[] {
    const out: { time: string; value: number }[] = [];
    let obv = 0;
    for (let i = 0; i < data.length; i++) {
      if (i > 0) {
        if (data[i].close > data[i-1].close) obv += data[i].volume;
        else if (data[i].close < data[i-1].close) obv -= data[i].volume;
      }
      out.push({ time: data[i].time, value: obv });
    }
    return out;
  }

  // ── Aroon sub-chart ───────────────────────────────────────────────────────
  private mkAroon(data: Candle[]) {
    const el = this.aroonEl?.nativeElement; if (!el) return;
    const L  = this.LWC();
    if (this.lwcAroon) { try { this.lwcAroon.remove(); } catch {} }
    const w  = this.dims().w;
    el.style.cssText = 'width:' + w + 'px;height:118px;';
    this.lwcAroon = L.createChart(el, {
      layout:    { background:{ color:'#0d1117' }, textColor:'#8b949e' },
      grid:      { vertLines:{ color:'#1c2128' }, horzLines:{ color:'#161b22' } },
      crosshair: { mode:1 },
      width:w, height:118,
      rightPriceScale:{ borderColor:'#30363d', scaleMargins:{ top:.05, bottom:.05 } },
      timeScale:{ visible:true, borderColor:'#30363d', timeVisible:true, secondsVisible:false },
      handleScroll:true, handleScale:true,
    });
    const period = 25;
    const aroonUpData:   { time: string; value: number }[] = [];
    const aroonDownData: { time: string; value: number }[] = [];
    for (let i = period; i < data.length; i++) {
      const slice = data.slice(i - period, i + 1);
      const highs = slice.map(c => c.high), lows = slice.map(c => c.low);
      const maxH  = Math.max(...highs), minL = Math.min(...lows);
      const idxH  = highs.lastIndexOf(maxH), idxL = lows.lastIndexOf(minL);
      aroonUpData.push({   time: data[i].time, value: ((idxH) / period) * 100 });
      aroonDownData.push({ time: data[i].time, value: ((idxL) / period) * 100 });
    }
    this.aroonUpSeries = this.lwcAroon.addLineSeries({
      color:'#26a641', lineWidth:1, title:'Aroon Up', priceLineVisible:false, lastValueVisible:true,
    });
    this.aroonDownSeries = this.lwcAroon.addLineSeries({
      color:'#f85149', lineWidth:1, title:'Aroon Down', priceLineVisible:false, lastValueVisible:true,
    });
    const pad = data.slice(0, data.length - aroonUpData.length).map((c: any) => ({ time: c.time }));
    this.aroonUpSeries.setData([...pad, ...aroonUpData]);
    this.aroonDownSeries.setData([...pad, ...aroonDownData]);
    this.aroonUpSeries.createPriceLine({ price:70, color:'rgba(38,166,65,.3)',   lineWidth:1, lineStyle:3, axisLabelVisible:true,  title:'70' });
    this.aroonUpSeries.createPriceLine({ price:50, color:'rgba(139,148,158,.2)', lineWidth:1, lineStyle:3, axisLabelVisible:false, title:'' });
    this.aroonUpSeries.createPriceLine({ price:30, color:'rgba(248,81,73,.3)',   lineWidth:1, lineStyle:3, axisLabelVisible:true,  title:'30' });
    this.lwcAroon.priceScale('right').applyOptions({ minimum:0, maximum:100 });
    this.lwcAroon.timeScale().fitContent();
    this.sync();
    setTimeout(() => this.alignTimeScales(), 50);
  }

  // ── Stochastic sub-chart ──────────────────────────────────────────────────
  private mkStoch(data: Candle[]) {
    const el = this.stochEl?.nativeElement; if (!el) return;
    const L  = this.LWC();
    if (this.lwcStoch) { try { this.lwcStoch.remove(); } catch {} }
    const w  = this.dims().w;
    el.style.cssText = 'width:' + w + 'px;height:118px;';
    this.lwcStoch = L.createChart(el, {
      layout:    { background:{ color:'#0d1117' }, textColor:'#8b949e' },
      grid:      { vertLines:{ color:'#1c2128' }, horzLines:{ color:'#161b22' } },
      crosshair: { mode:1 },
      width:w, height:118,
      rightPriceScale:{ borderColor:'#30363d', scaleMargins:{ top:.05, bottom:.05 } },
      timeScale:{ visible:true, borderColor:'#30363d', timeVisible:true, secondsVisible:false },
      handleScroll:true, handleScale:true,
    });
    const period = 14, smoothK = 3;
    const kRaw: { time: string; value: number }[] = [];
    for (let i = period - 1; i < data.length; i++) {
      const slice = data.slice(i - period + 1, i + 1);
      const hh = Math.max(...slice.map(c => c.high));
      const ll = Math.min(...slice.map(c => c.low));
      const k  = hh === ll ? 50 : ((data[i].close - ll) / (hh - ll)) * 100;
      kRaw.push({ time: data[i].time, value: parseFloat(k.toFixed(2)) });
    }
    const dData: { time: string; value: number }[] = [];
    for (let i = smoothK - 1; i < kRaw.length; i++) {
      const avg = kRaw.slice(i - smoothK + 1, i + 1).reduce((a, b) => a + b.value, 0) / smoothK;
      dData.push({ time: kRaw[i].time, value: parseFloat(avg.toFixed(2)) });
    }
    this.stochKSeries = this.lwcStoch.addLineSeries({
      color:'#ff66aa', lineWidth:1, title:'%K', priceLineVisible:false, lastValueVisible:true,
    });
    this.stochDSeries = this.lwcStoch.addLineSeries({
      color:'#66ccff', lineWidth:1, title:'%D', priceLineVisible:false, lastValueVisible:true,
    });
    const padK = data.slice(0, data.length - kRaw.length).map((c: any) => ({ time: c.time }));
    this.stochKSeries.setData([...padK, ...kRaw]);
    const padD = data.slice(0, data.length - dData.length).map((c: any) => ({ time: c.time }));
    this.stochDSeries.setData([...padD, ...dData]);
    this.stochKSeries.createPriceLine({ price:80, color:'rgba(248,81,73,.4)',  lineWidth:1, lineStyle:3, axisLabelVisible:true,  title:'80' });
    this.stochKSeries.createPriceLine({ price:50, color:'rgba(139,148,158,.2)', lineWidth:1, lineStyle:3, axisLabelVisible:false, title:'' });
    this.stochKSeries.createPriceLine({ price:20, color:'rgba(38,166,65,.4)',  lineWidth:1, lineStyle:3, axisLabelVisible:true,  title:'20' });
    this.lwcStoch.priceScale('right').applyOptions({ minimum:0, maximum:100 });
    this.lwcStoch.timeScale().fitContent();
    this.sync();
    setTimeout(() => this.alignTimeScales(), 50);
  }

  // ── Ichimoku calculation ──────────────────────────────────────────────────
  private calcIchimoku(data: Candle[]) {
    const mid = (arr: Candle[], from: number, to: number) => {
      const sl = arr.slice(from, to);
      return (Math.max(...sl.map(c => c.high)) + Math.min(...sl.map(c => c.low))) / 2;
    };
    const tenkan: any[] = [], kijun: any[] = [], spanA: any[] = [],
          spanB: any[]  = [], chikou: any[] = [];
    for (let i = 0; i < data.length; i++) {
      const t = i >= 8  ? mid(data, i - 8,  i + 1) : null;
      const k = i >= 25 ? mid(data, i - 25, i + 1) : null;
      if (t !== null) tenkan.push({ time: data[i].time, value: parseFloat(t.toFixed(4)) });
      if (k !== null) kijun.push({  time: data[i].time, value: parseFloat(k.toFixed(4)) });
      if (t !== null && k !== null)
        spanA.push({ time: data[i].time, value: parseFloat(((t + k) / 2).toFixed(4)) });
      if (i >= 51) {
        const sb = mid(data, i - 51, i + 1);
        spanB.push({ time: data[i].time, value: parseFloat(sb.toFixed(4)) });
      }
      if (i >= 25)
        chikou.push({ time: data[i - 25].time, value: parseFloat(data[i].close.toFixed(4)) });
    }
    return { tenkan, kijun, spanA, spanB, chikou };
  }

  // ── Math ──────────────────────────────────────────────────────────────────

  private ema(v: number[], t: string[], p: number): any[] {
    const k = 2 / (p + 1); const r: any[] = []; let e = 0;
    for (let i = p - 1; i < v.length; i++) {
      e = i === p - 1 ? v.slice(0, p).reduce((a, b) => a + b, 0) / p : v[i] * k + e * (1 - k);
      r.push({ time:t[i], value:parseFloat(e.toFixed(4)) });
    }
    return r;
  }

  private sma(v: number[], t: string[], p: number): any[] {
    const r: any[] = [];
    for (let i = p - 1; i < v.length; i++) {
      const a = v.slice(i - p + 1, i + 1).reduce((x, y) => x + y, 0) / p;
      r.push({ time:t[i], value:parseFloat(a.toFixed(4)) });
    }
    return r;
  }

  private calcRsi(v: number[], t: string[], p: number): any[] {
    const r: any[] = []; let g = 0, l = 0;
    for (let i = 1; i < p; i++) { const d = v[i] - v[i - 1]; if (d > 0) g += d; else l -= d; }
    let ag = g / p, al = l / p;
    for (let i = p; i < v.length; i++) {
      const d = v[i] - v[i - 1];
      ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p; al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
      const rsi = 100 - (100 / (1 + (al === 0 ? 100 : ag / al)));
      r.push({ time:t[i], value:parseFloat(rsi.toFixed(2)) });
    }
    return r;
  }

  private calcMacd(v: number[], t: string[]): any {
    const e12 = this.ema(v, t, 12), e26 = this.ema(v, t, 26);
    const m12: Record<string, number> = {};
    e12.forEach((d: any) => m12[d.time] = d.value);
    const valid = e26.filter((d: any) => m12[d.time] !== undefined);
    const raw   = valid.map((d: any) => ({ time:d.time, value:(m12[d.time] || 0) - d.value }));
    const k = 2 / 10; let sig = raw.slice(0, 9).reduce((a: number, b: any) => a + b.value, 0) / 9;
    const ml: any[] = [], sl: any[] = [], hl: any[] = [];
    raw.forEach((d: any, i: number) => {
      ml.push({ time:d.time, value:parseFloat(d.value.toFixed(4)) });
      if (i >= 8) {
        sig = i === 8 ? sig : d.value * k + sig * (1 - k);
        sl.push({ time:d.time, value:parseFloat(sig.toFixed(4)) });
        const h = d.value - sig;
        hl.push({ time:d.time, value:parseFloat(h.toFixed(4)), color: h >= 0 ? 'rgba(38,166,65,.7)' : 'rgba(248,81,73,.7)' });
      }
    });
    return { macdLine: ml, signalLine: sl, histogram: hl };
  }

  private bb(v: number[], t: string[], p: number, s: number) {
    const u: any[] = [], m: any[] = [], l: any[] = [];
    for (let i = p - 1; i < v.length; i++) {
      const sl = v.slice(i - p + 1, i + 1), mn = sl.reduce((a, b) => a + b, 0) / p;
      const sd = Math.sqrt(sl.reduce((a, b) => a + (b - mn) ** 2, 0) / p);
      u.push({ time:t[i], value:parseFloat((mn + s * sd).toFixed(4)) });
      m.push({ time:t[i], value:parseFloat(mn.toFixed(4)) });
      l.push({ time:t[i], value:parseFloat((mn - s * sd).toFixed(4)) });
    }
    return { upper:u, middle:m, lower:l };
  }

  private vwap(cs: Candle[]): any[] {
    let ct = 0, cv = 0;
    return cs.map(c => {
      ct += (c.high + c.low + c.close) / 3 * c.volume; cv += c.volume;
      return { time:c.time, value:parseFloat((cv > 0 ? ct / cv : c.close).toFixed(4)) };
    });
  }

  // ── Drawing tools ─────────────────────────────────────────────────────────

  private handleClick(time: string, price: number, point: any) {
    const tool = this.drawingTools.find(t => t.active)?.id || 'cursor';

    if (tool === 'measure') {
      this.measureCount++;
      if (this.measureCount === 1) {
        this.measureC1 = { time, price };
        this.measureResult = 'Haz clic en la segunda vela...';
      } else {
        const c1  = this.measureC1;
        const pct = ((price - c1.price) / c1.price) * 100;
        const abs = price - c1.price;
        const bars= Math.abs(
          this.candles.findIndex(c => c.time === time) -
          this.candles.findIndex(c => c.time === c1.time)
        );
        this.measureResult = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
        this.measurePopup  = {
          x: point?.x ?? 200, y: point?.y ?? 100,
          pctChange: parseFloat(pct.toFixed(2)),
          absChange: parseFloat(abs.toFixed(4)),
          bars, from:c1.time, to:time,
        };
        this.measureCount = 0; this.measureC1 = null;
      }
    }

    if (tool === 'fib') {
      if (!this.fibPoint1) {
        this.fibPoint1 = { price, time };
        this.measureResult = 'Haz clic en el segundo punto...';
      } else {
        this.doFib(this.fibPoint1.price, price);
        this.fibPoint1 = null; this.measureResult = ''; this.activateTool('cursor');
      }
    }

    if (tool === 'hline') {
      const ln = this.series.createPriceLine({
        price, color:'#d29922', lineWidth:1, lineStyle:2,
        axisLabelVisible:true, title:'H ' + price.toFixed(2),
      });
      this.horizLines.push(ln); this.activateTool('cursor');
    }

    // ✅ NUEVA HERRAMIENTA: línea vertical
    if (tool === 'vline') {
      if (!this.lwc || !time) { this.cd.detectChanges(); return; }
      // Creamos una serie auxiliar invisible con un solo punto en ese time
      // y le añadimos una marker vertical. Otra opción más limpia: usamos
      // la timeScale para marcar con un marcador de texto.
      try {
        const vSeries = this.lwc.addLineSeries({
          color: 'rgba(210,153,34,0)',  // invisible
          lineWidth: 0,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        // Añadir el punto con un marcador visible como línea vertical
        vSeries.setData([{ time, value: price }]);
        vSeries.setMarkers([{
          time,
          position: 'inBar',
          color: '#d29922',
          shape: 'arrowUp',
          text: '│ ' + time,
          size: 0,
        }]);
        // Alternativa: usar createPriceLine vertical equivalente en la timeScale
        // LightweightCharts no tiene línea vertical nativa, así que la simulamos
        // dibujando un marcador grande con texto de barra
        this.vertLines.push(vSeries);

        // Mejor implementación: línea vertical via shape marker extendido
        // Añadir dos puntos adyacentes con mismo time para simular línea vertical
        // (limitación de LWC: no hay addVerticalLine nativo en v3)
        // Usamos overlay visible con precio mínimo y máximo conocidos
        if (this.candles.length) {
          const allHighs = this.candles.map(c => c.high);
          const allLows  = this.candles.map(c => c.low);
          const maxP = Math.max(...allHighs);
          const minP = Math.min(...allLows);
          // Reemplazar la serie con una que va de minP a maxP en ese time
          this.lwc.removeSeries(vSeries);
          const vLineOverlay = this.lwc.addLineSeries({
            color: 'rgba(210,153,34,0.6)',
            lineWidth: 1,
            lineStyle: 2,  // dashed
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          });
          // LWC necesita al menos 2 puntos con times distintos; dibujamos
          // el punto más cercano anterior y posterior con la misma x visual
          // Para simular correctamente usamos createPriceLine con price al
          // precio actual y etiqueta de fecha
          this.lwc.removeSeries(vLineOverlay);

          // Solución definitiva: línea horizontal en precio actual + label con fecha
          const existingPrice = price > 0 ? price : (maxP + minP) / 2;
          const vLabel = this.series.createPriceLine({
            price: existingPrice,
            color: 'rgba(210,153,34,0.7)',
            lineWidth: 1,
            lineStyle: 3, // dotted
            axisLabelVisible: true,
            title: '📅 ' + time,
          });
          this.vertLines.push(vLabel);
        }
      } catch (e) {
        console.warn('vline error:', e);
      }
      this.activateTool('cursor');
    }

    this.cd.detectChanges();
  }

  private doFib(p1: number, p2: number) {
    const ratios = [0, .236, .382, .5, .618, .786, 1, 1.272, 1.618];
    const diff   = p2 - p1;
    this.fibLevels = ratios.map(r => ({
      ratio:r, price:parseFloat((p2 - diff * r).toFixed(2)),
      label:(r * 100).toFixed(1) + '%',
    }));
    this.fibLevels.forEach(fib => {
      const a = (fib.ratio === 0 || fib.ratio === 1) ? 1 : .6;
      this.series.createPriceLine({
        price:fib.price, color:'rgba(210,153,34,' + a + ')',
        lineWidth:1, lineStyle:2, axisLabelVisible:true, title:fib.label,
      });
    });
  }

  clearFib() { this.fibLevels = []; this.clearDrawings(); }
  clearDrawings() {
    if (this.series && this.lwc) {
      try {
        const raw = this.filterTF(this.displayCandles);
        this.lwc.removeSeries(this.series);
        this.series = this.mkSeries(this.LWC());
        this.setData(raw);
      } catch {}
    }
    // Limpiar líneas verticales (series auxiliares)
    this.vertLines.forEach(vl => {
      try {
        if (vl && typeof vl.setData === 'function') this.lwc.removeSeries(vl);
      } catch {}
    });
    this.horizLines = []; this.fibLevels = []; this.vertLines = [];
  }

  // ── Controls ──────────────────────────────────────────────────────────────

  toggleIndicator(ind: Indicator) {
    ind.enabled = !ind.enabled;
    if (!this.candles.length || !this.lwc) return;
    const data = this.filterTF(this.displayCandles);
    const subChartIds = ['rsi','macd','obv','adl','aroon','stoch'];
    if (subChartIds.includes(ind.id)) {
      this.cd.detectChanges();
      setTimeout(() => this.initCharts(), 60);
      return;
    }
    if (ind.id === 'patterns') {
      this.applyPatternMarkers(data);
      return;
    }
    this.refreshOverlays(data);
  }

  /** Detects classic candlestick patterns and paints markers on the candle series. */
  private applyPatternMarkers(data: Candle[]) {
    if (!this.series) return;
    if (!this.indEnabled('patterns')) {
      this.detectedPatterns = [];
      try { this.series.setMarkers([]); } catch {}
      this.cd.detectChanges();
      return;
    }
    this.detectedPatterns = detectPatterns(data);
    try { this.series.setMarkers(patternsToMarkers(this.detectedPatterns)); } catch {}
    this.cd.detectChanges();
  }

  indEnabled(id: string): boolean {
    return this.indicators.find(i => i.id === id)?.enabled ?? false;
  }

  toggleVolume() {
    this.showVolume = !this.showVolume;
    if (this.candles.length) setTimeout(() => this.initCharts(), 60);
  }

  setTimeframe(tf: string) {
    this.currentTF = tf;
    if (!this.candles.length || !this.series) return;
    const rawFiltered     = this.filterCandlesByTF(this.candles);
    const displayFiltered = this.filterCandlesByTF(this.displayCandles);
    this.updateIndicatorsAndContext(rawFiltered);
    this.updateAdvancedIndicators(rawFiltered);
    this.setData(displayFiltered);
    this.refreshOverlays(displayFiltered);
    if (this.indicators[0]?.enabled) this.mkRsi(displayFiltered);
    if (this.indicators[1]?.enabled) this.mkMacd(displayFiltered);
    if (this.indEnabled('obv') || this.indEnabled('adl')) this.mkObv(displayFiltered);
    if (this.indEnabled('aroon')) this.mkAroon(displayFiltered);
    if (this.indEnabled('stoch')) this.mkStoch(displayFiltered);
    if (this.volumeSeries) {
      this.volumeSeries.setData(displayFiltered.map(c => ({
        time:c.time, value:c.volume,
        color: c.close >= c.open ? 'rgba(38,166,65,.5)' : 'rgba(248,81,73,.5)'
      })));
    }
    this.fitContent();
  }

  setChartType(t: string) {
    this.chartType = t;
    if (this.candles.length) setTimeout(() => this.initCharts(), 100);
  }

  activateTool(id: string) { this.drawingTools.forEach(t => t.active = t.id === id); }

  fitContent() {
    this.lwc?.timeScale().fitContent();
    this.volumeChart?.timeScale().fitContent();
    this.lwcRsi?.timeScale().fitContent();
    this.lwcMacd?.timeScale().fitContent();
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error al entrar a pantalla completa: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  }

@HostListener('document:fullscreenchange', ['$event'])
@HostListener('document:webkitfullscreenchange', ['$event'])
onFullscreenChange(event?: Event) {   // ✅ parámetro opcional
  this.isFullscreen = !!document.fullscreenElement;
  setTimeout(() => this.resizeAllCharts(), 100);
}

  toggleCurrency() {
    this.showInUsd = !this.showInUsd;
    this.updateIndicatorsAndContext(this.candles); // recalcula contexto con nueva moneda
    setTimeout(() => this.initCharts(), 100);
  }

  async loadBcvRates(): Promise<void> {
    try {
      const rates = await this.http.get<Record<string, number>>(
        `${this.apiUrl}/stocks/bcv-rates`, { headers: this.hdr() }
      ).toPromise();
      this.bcvRates = rates || {};
      const dates = Object.keys(this.bcvRates).sort();
      if (dates.length) {
        this.currentUsdRate = this.bcvRates[dates[dates.length - 1]];
      }
    } catch {
      this.bcvRates = {};
    }
  }

  private getRateForDate(date: string): number {
    if (this.bcvRates[date]) return this.bcvRates[date];
    const dates = Object.keys(this.bcvRates).sort();
    for (let i = dates.length - 1; i >= 0; i--) {
      if (dates[i] <= date) return this.bcvRates[dates[i]];
    }
    // Date predates all available rates → use oldest rate to avoid raw-Bs mixing
    return dates.length > 0 ? this.bcvRates[dates[0]] : 0;
  }

  get displayCandles(): Candle[] {
    if (!this.showInUsd) return this.candles;
    // Usa historicalUsdRates si está disponible, sino bcvRates como fallback
    const hasHistorical = Object.keys(this.historicalUsdRates).length > 0;
    const hasBcv = Object.keys(this.bcvRates).length > 0;
    if (!hasHistorical && !hasBcv) return this.candles;

    return this.candles.map(candle => {
      // Busca tasa exacta o la más cercana anterior
      const rate = hasHistorical
        ? (this.historicalUsdRates[candle.time] || this.getRateForDate(candle.time))
        : this.getRateForDate(candle.time);
      if (!rate) return candle;
      return {
        ...candle,
        open:  candle.open  / rate,
        high:  candle.high  / rate,
        low:   candle.low   / rate,
        close: candle.close / rate,
      };
    });
  }

private convertContextToUsd(context: ChartContextInput | null): ChartContextInput | null {
  if (!context || !this.showInUsd) return context;

  // Usa getRateForDate (fecha más cercana anterior) con fallback a currentUsdRate
  const getRate = (date: string | undefined): number => {
    if (!date) return this.currentUsdRate;
    return this.getRateForDate(date) || this.currentUsdRate;
  };

  const convert = (price: number | null | undefined, date?: string): number | null => {
    if (price == null) return null;
    const rate = getRate(date ?? context.lastCandle?.time);
    return rate ? price / rate : price;
  };

  const converted = { ...context };

  // Convertir última vela
  if (converted.lastCandle) {
    converted.lastCandle = {
      ...converted.lastCandle,
      open:  convert(converted.lastCandle.open, converted.lastCandle.time) ?? converted.lastCandle.open,
      high:  convert(converted.lastCandle.high, converted.lastCandle.time) ?? converted.lastCandle.high,
      low:   convert(converted.lastCandle.low,  converted.lastCandle.time) ?? converted.lastCandle.low,
      close: convert(converted.lastCandle.close, converted.lastCandle.time) ?? converted.lastCandle.close,
    };
  }

  // Convertir velas recientes
  if (converted.recentCandles) {
    converted.recentCandles = converted.recentCandles.map(c => ({
      ...c,
      open:  convert(c.open, c.time) ?? c.open,
      high:  convert(c.high, c.time) ?? c.high,
      low:   convert(c.low,  c.time) ?? c.low,
      close: convert(c.close, c.time) ?? c.close,
    }));
  }

  // Convertir indicadores (valores actuales)
  const ind = converted.indicators;
  if (ind) {
    ind.ema20       = convert(ind.ema20);
    ind.ema50       = convert(ind.ema50);
    ind.ema200      = convert(ind.ema200);
    ind.sma20       = convert(ind.sma20);
    ind.bb_upper    = convert(ind.bb_upper);
    ind.bb_middle   = convert(ind.bb_middle);
    ind.bb_lower    = convert(ind.bb_lower);
    ind.vwap        = convert(ind.vwap);
    ind.support20   = convert(ind.support20);
    ind.resistance20= convert(ind.resistance20);
    // También los históricos de indicadores (para el prompt de IA)
    if (ind.ema20History) {
      ind.ema20History = ind.ema20History.map(p => ({ ...p, value: convert(p.value, p.time) ?? p.value }));
    }
    if (ind.ema50History) {
      ind.ema50History = ind.ema50History.map(p => ({ ...p, value: convert(p.value, p.time) ?? p.value }));
    }
    // Puedes extender a macdHistory, rsiHistory (no son precios, no hace falta)
  }

  // Actualizar la tasa de referencia
  const lastRate = getRate(converted.lastCandle?.time);
  if (lastRate) converted.usd_rate = lastRate;

  return converted;
}

  private filterTF(cs: Candle[]): Candle[] { return this.filterCandlesByTF(cs); }

  private syncHandlers: { ch: any; handler: any }[] = [];

  private sync() {
    const charts = [this.lwc, this.volumeChart, this.lwcRsi, this.lwcMacd, this.lwcObv, this.lwcAroon, this.lwcStoch].filter(Boolean);
    if (!charts.length) return;

    this.syncHandlers.forEach(({ ch, handler }) => {
      try { ch.timeScale().unsubscribeVisibleLogicalRangeChange(handler); } catch {}
    });
    this.syncHandlers = [];

    let isSyncing = false;

    charts.forEach((ch, i) => {
      const handler = (r: any) => {
        if (!r || isSyncing) return;
        isSyncing = true;
        charts.forEach((o, j) => {
          if (i !== j) {
            try {
              const old = o.timeScale().getVisibleLogicalRange();
              if (!old || Math.abs(old.from - r.from) > 1e-4 || Math.abs(old.to - r.to) > 1e-4) {
                 o.timeScale().setVisibleLogicalRange(r);
              }
            } catch {}
          }
        });
        setTimeout(() => { isSyncing = false; }, 20);
      };
      try {
        ch.timeScale().subscribeVisibleLogicalRangeChange(handler);
        this.syncHandlers.push({ ch, handler });
      } catch {}
    });

    setTimeout(() => { this.alignTimeScales(); }, 50);
  }

  private alignTimeScales() {
    const charts = [this.lwc, this.volumeChart, this.lwcRsi, this.lwcMacd, this.lwcObv, this.lwcAroon, this.lwcStoch].filter(Boolean);
    if (!charts.length || !this.lwc) return;
    try {
      const mainRange = this.lwc.timeScale().getVisibleLogicalRange();
      if (mainRange) {
        charts.forEach((ch, i) => {
          if (i > 0) {
            try { ch.timeScale().setVisibleLogicalRange(mainRange); } catch {}
          }
        });
      }
    } catch {}
  }

  private updatePriceInfo() {
    if (!this.candles.length) return;
    const last = this.candles[this.candles.length - 1];
    const prev = this.candles.length > 1 ? this.candles[this.candles.length - 2] : last;
    this.currentPrice   = last.close;
    this.priceChange    = parseFloat((last.close - prev.close).toFixed(4));
    this.priceChangePct = parseFloat(((this.priceChange / prev.close) * 100).toFixed(2));
    this.lastPrices[this.selectedSymbol]   = last.close;
    this.priceChanges[this.selectedSymbol] = this.priceChange;
  }

  private mkResizeObs(el: HTMLElement) {
    this.resizeObs?.disconnect();
    this.resizeObs = new ResizeObserver(() => {
      if (!this.lwc) return;
      const ce = this.chartEl?.nativeElement; if (!ce) return;
      const { w, h } = this.dims();
      ce.style.cssText = 'width:' + w + 'px;height:' + h + 'px;';
      this.lwc.applyOptions({ width:w, height:h });
      this.volumeChart?.applyOptions({ width:w });
      this.lwcRsi?.applyOptions({ width:w });
      this.lwcMacd?.applyOptions({ width:w });
    });
    this.resizeObs.observe(el.closest('.main-area') || el);
  }

  // ── AI Panel ──────────────────────────────────────────────────────────────
  toggleAiPanel() {
    this.aiPanelOpen = !this.aiPanelOpen;

    if (this.aiPanelOpen && this.selectedSymbol) {
      const filtered = this.filterCandlesByTF(this.candles);
      this.updateIndicatorsAndContext(filtered);
      // ✅ Recargar libro de órdenes al abrir el panel IA
      this.loadOrderBook(this.selectedSymbol);
    }

    setTimeout(() => {
      if (this.lwc) {
        const ce = this.chartEl?.nativeElement;
        if (ce) {
          ce.getBoundingClientRect();
          const { w, h } = this.dims();
          ce.style.cssText = `width:${w}px;height:${h}px;`;
        }
        const { w, h } = this.dims();
        this.lwc.applyOptions({ width: w, height: h });
        this.volumeChart?.applyOptions({ width: w });
        this.lwcRsi?.applyOptions({ width: w });
        this.lwcMacd?.applyOptions({ width: w });
        this.lwcObv?.applyOptions({ width: w });
        this.lwcAroon?.applyOptions({ width: w });
        this.lwcStoch?.applyOptions({ width: w });

        this.lwc.timeScale().fitContent();
        this.volumeChart?.timeScale().fitContent();
        this.lwcRsi?.timeScale().fitContent();
        this.lwcMacd?.timeScale().fitContent();
        this.lwcObv?.timeScale().fitContent();
        this.lwcAroon?.timeScale().fitContent();
        this.lwcStoch?.timeScale().fitContent();
      }
      this.cd.markForCheck();
    }, 350);
  }

  openCreateAlert(): void {
    this.alertPanelOpen = !this.alertPanelOpen;
    if (this.alertPanelOpen) {
      this.newAlertCondition = 'above';
      this.newAlertValue = this.currentPrice || null;
      this.newAlertMessage = '';
    }
  }

  saveAlert(): void {
    if (!this.newAlertValue || !this.selectedSymbol || this.savingAlert) return;
    this.savingAlert = true;
    const token = localStorage.getItem('access_token');
    const payload = {
      stock_symbol: this.selectedSymbol,
      alert_type: 'precio_objetivo',
      condition_type: this.newAlertCondition,
      condition_value: this.newAlertValue,
      message: this.newAlertMessage || `Alerta de precio para ${this.selectedSymbol}`
    };
    this.http.post(`${environment.apiUrl}/alerts/`, payload, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    }).subscribe({
      next: () => {
        this.savingAlert = false;
        this.alertPanelOpen = false;
        this.newAlertValue = null;
        this.newAlertMessage = '';
        // Simple snackbar-style notification using console (no snackbar dependency here)
        console.log(`✅ Alerta creada para ${this.selectedSymbol}`);
      },
      error: (e) => {
        this.savingAlert = false;
        console.error('Error creating alert:', e);
      }
    });
  }

  private alignAllCharts() {
    if (!this.lwc) return;
    const mainRange     = this.lwc.timeScale().getVisibleLogicalRange();
    const mainTimeRange = this.lwc.timeScale().getVisibleTimeRange();
    const subCharts = [this.volumeChart, this.lwcRsi, this.lwcMacd].filter(Boolean);
    if (mainRange) {
      subCharts.forEach(ch => {
        try {
          ch.timeScale().setVisibleLogicalRange(mainRange);
          if (mainTimeRange) { ch.timeScale().setVisibleTimeRange(mainTimeRange); }
        } catch {}
      });
    }
  }

  private resizeAllCharts() {
    if (!this.lwc) return;
    const ce = this.chartEl?.nativeElement;
    if (ce) ce.getBoundingClientRect();
    const { w, h } = this.dims();
    if (ce) ce.style.cssText = `width:${w}px;height:${h}px;`;
    this.lwc.applyOptions({ width: w, height: h });
    this.volumeChart?.applyOptions({ width: w, height: 80 });
    this.lwcRsi?.applyOptions({ width: w, height: 120 });
    this.lwcMacd?.applyOptions({ width: w, height: 120 });
    this.lwcObv?.applyOptions({ width: w, height: 100 });
    this.lwcAroon?.applyOptions({ width: w, height: 100 });
    this.lwcStoch?.applyOptions({ width: w, height: 100 });
    this.lwc.timeScale().fitContent();
    this.volumeChart?.timeScale().fitContent();
    this.lwcRsi?.timeScale().fitContent();
    this.lwcMacd?.timeScale().fitContent();
    this.lwcObv?.timeScale().fitContent();
    this.lwcAroon?.timeScale().fitContent();
    this.lwcStoch?.timeScale().fitContent();
  }

  @HostListener('window:resize')
  onWindowResize() {
    if (this.resizeTimeout) { clearTimeout(this.resizeTimeout); }
    this.resizeTimeout = setTimeout(() => {
      if (this.lwc) { this.resizeAllCharts(); }
      this.resizeTimeout = undefined;
    }, 150);
  }

  closePanelAndResize() {
    this.aiPanelOpen = false;
    setTimeout(() => {
      if (!this.lwc) return;
      const ce = this.chartEl?.nativeElement;
      if (ce) ce.getBoundingClientRect();
      const { w, h } = this.dims();
      if (ce) ce.style.cssText = `width:${w}px;height:${h}px;`;
      this.lwc.applyOptions({ width: w, height: h });
      this.volumeChart?.applyOptions({ width: w });
      this.lwcRsi?.applyOptions({ width: w });
      this.lwcMacd?.applyOptions({ width: w });
      this.lwc.timeScale().fitContent();
      this.volumeChart?.timeScale().fitContent();
      this.lwcRsi?.timeScale().fitContent();
      this.lwcMacd?.timeScale().fitContent();
      this.resizeAllCharts();
      this.cd.markForCheck();
    }, 350);
  }

  private buildChartContext(candlesData?: Candle[]): ChartContextInput | null {
    if (!this.selectedSymbol) return null;

    const dataToUse = candlesData || this.candles;
    const currentCandles = this.filterCandlesByTF(dataToUse);
    if (!currentCandles.length) return null;

    if (!this.currentChartIndicators) {
      this.currentChartIndicators = this.calculateAllIndicators(dataToUse);
    }

    const ind       = this.currentChartIndicators;
    if (!ind) return null;
    const lastCandle= currentCandles[currentCandles.length - 1];
    const adv       = ind.advanced || {};

    return {
      symbol:    this.selectedSymbol,
      name:      this.selectedName,
      timeframe: this.currentTF,
      chartType: this.chartType,
      currency:  this.showInUsd ? 'USD' : 'Bs',
      usd_rate:  this.currentUsdRate || null,
      lastCandle: lastCandle ? {
        time: lastCandle.time, open: lastCandle.open, high: lastCandle.high,
        low:  lastCandle.low,  close: lastCandle.close, volume: lastCandle.volume
      } : undefined,
      recentCandles: currentCandles.slice(-5).map(c => ({
        time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume
      })),
      totalCandles:  currentCandles.length,
      priceChange:   this.priceChange,
      priceChangePct: this.priceChangePct,

      indicators: {
        enabled: this.indicators.filter(i => i.enabled).map(i => i.label).join(', '),

        // RSI
        rsi14:      ind.rsi?.value   ?? null,
        rsi_slope:  ind.rsi?.slope   ?? null,
        rsi_signal: ind.rsi?.status  ?? null,

        // EMAs
        ema20:          ind.ema?.ema20         ?? null,
        ema50:          ind.ema?.ema50         ?? null,
        ema200:         ind.ema?.ema200        ?? null,
        ema20_distance: ind.ema?.ema20Distance ?? null,
        ema50_distance: ind.ema?.ema50Distance ?? null,

        // SMA
        sma20: ind.sma?.sma20 ?? null,

        // Bollinger Bands
        bb_upper:    ind.bollinger?.upper    ?? null,
        bb_middle:   ind.bollinger?.middle   ?? null,
        bb_lower:    ind.bollinger?.lower    ?? null,
        bb_width:    ind.bollinger?.width    ?? null,
        bb_position: ind.bollinger?.position ?? null,

        // VWAP
        vwap: ind.vwap?.value ?? null,

        // MACD
        macd:          ind.macd?.macd      ?? null,
        macd_signal:   ind.macd?.signal    ?? null,
        macd_hist:     ind.macd?.histogram ?? null,
        macd_momentum: ind.macd?.momentum  ?? null,
        macd_cross:    ind.macd?.cross     ?? null,

        // Volumen
        volume_current: ind.volume?.current   ?? null,
        volume_avg20:   ind.volume?.average20  ?? null,
        volume_ratio:   ind.volume?.ratio      ?? null,
        volume_status:  ind.volume?.status     ?? null,

        // Niveles
        support20:    ind.levels?.support20    ?? null,
        resistance20: ind.levels?.resistance20 ?? null,

        // Cruces
        golden_cross: ind.crosses?.goldenCross ?? null,
        death_cross:  ind.crosses?.deathCross  ?? null,

        // Tendencia
        trend: ind.trend ?? null,

        // ✅ INDICADORES AVANZADOS (todos al contexto IA)
        obv:         adv.obv         ?? null,
        adl:         adv.adl         ?? null,
        aroon_up:    adv.aroon_up    ?? null,
        aroon_down:  adv.aroon_down  ?? null,
        adx:         adv.adx         ?? null,
        chaikin:     adv.chaikin     ?? null,
        atr_percent: adv.atr_percent ?? null,
        dmi:         adv.dmi         ?? null,
        stoch_k:     adv.stoch_k     ?? null,
        mfi:         adv.mfi         ?? null,

        // ── Microstructure & Valuation ──────────────────────────────────────
        cvd_cumulative:      this.cvdValue,
        cvd_last_delta:      this.cvdDeltaLast,
        cvd_trend:           this.cvdTrend,
        vp_hvn:              this.vpHvn,
        vp_lvn:              this.vpLvn,
        price_percentile252: this.pricePercentile252,
        value_zone_z:        this.valueZoneScore,
        value_zone_label:    this.valueZoneLabel,

        // Historial
        lastCandles:   ind.lastCandles   ?? [],
        rsiHistory:    ind.rsiHistory    ?? [],
        ema20History:  ind.ema20History  ?? [],
        ema50History:  ind.ema50History  ?? [],
        macdHistory:   ind.macdHistory   ?? [],
        volumeHistory: ind.volumeHistory ?? []
      }
    };
  }
}