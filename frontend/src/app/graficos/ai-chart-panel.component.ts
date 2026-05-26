import {
  Component, Input, Output, EventEmitter,
  OnChanges, SimpleChanges, ViewChild, ElementRef,
  ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

export interface ChartContextInput {
  symbol: string;
  name: string;
  timeframe: string;
  chartType: string;
  currency?: string;  // "USD" | "Bs"
  usd_rate?: number | null;
  lastCandle?: { time: string; open: number; high: number; low: number; close: number; volume: number };
  recentCandles?: any[];
  totalCandles: number;
  priceChange: number;
  priceChangePct: number;
  indicators: {
    enabled: string;
    rsi14: number | null;
    rsi_slope?: number | null;
    rsi_signal?: string | null;
    ema20: number | null;
    ema50: number | null;
    ema200?: number | null;
    sma20?: number | null;
    ema20_distance?: number | null;
    ema50_distance?: number | null;
    bb_upper?: number | null;
    bb_middle?: number | null;
    bb_lower?: number | null;
    bb_width?: number | null;
    bb_position?: string | null;
    macd?: number | null;
    macd_signal?: number | null;
    macd_hist?: number | null;
    macd_momentum?: string | null;
    macd_cross?: string | null;
    vwap?: number | null;
    volume_current?: number | null;
    volume_avg20?: number | null;
    volume_ratio?: number | null;
    volume_status?: string | null;
    support20?: number | null;
    resistance20?: number | null;
    golden_cross?: boolean | null;
    death_cross?: boolean | null;
    trend?: string | null;
    // ✅ INDICADORES AVANZADOS (OBV, A/D, Aroon, ADX, Chaikin, ATR%, DMI, Stoch, MFI)
    obv?: number | null;
    adl?: number | null;
    aroon_up?: number | null;
    aroon_down?: number | null;
    adx?: number | null;
    chaikin?: number | null;
    atr_percent?: number | null;
    dmi?: number | null;
    stoch_k?: number | null;
    mfi?: number | null;
    // ── Microstructure & Valuation ──────────────────────────────────────────
    cvd_cumulative?: number | null;
    cvd_last_delta?: number | null;
    cvd_trend?: string | null;
    vp_hvn?: number | null;
    vp_lvn?: number | null;
    price_percentile252?: number | null;
    value_zone_z?: number | null;
    value_zone_label?: string | null;
    lastCandles?: any[];
    rsiHistory?: Array<{ time: string; value: number }>;
    ema20History?: Array<{ time: string; value: number }>;
    ema50History?: Array<{ time: string; value: number }>;
    macdHistory?: Array<{ time: string; value: number }>;
    volumeHistory?: Array<{ time: string; value: number }>;
  };
}

export interface ComparisonStock {
  symbol: string;
  name: string;
  context: ChartContextInput | null;
  color: string;
}

interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isTyping?: boolean;
}

interface QuickAction {
  label: string;
  icon: string;
  msg: string;
}

@Component({
  selector: 'app-ai-chart-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ai-chart-panel.component.html',
  styleUrls: ['./ai-chart-panel.component.scss']
})
export class AiChartPanelComponent implements OnChanges {

  @Input() symbol = '';
  @Input() symbolName = '';
  @Input() chartContext: ChartContextInput | null = null;
  @Input() isOpen = false;
  @Input() availableStocks: { symbol: string; name: string; is_active?: boolean }[] = [];
  @Input() showInUsd = false;
  // ✅ NUEVO: libro de órdenes de la acción principal
  @Input() orderBook: any[] = [];

  @Output() closePanel = new EventEmitter<void>();

  // Modo comparativo
  isComparisonMode = false;
  comparisonStocks: ComparisonStock[] = [];
  showStockSelector = false;
  stockSearchText = '';
  filteredAvailableStocks: { symbol: string; name: string }[] = [];
  // ✅ NUEVO: libros de órdenes de acciones en comparación { symbol: entries[] }
  comparisonOrderBooks: Record<string, any[]> = {};

  messages: AiMessage[] = [];
  inputText = '';
  loading = false;
  sessionId: number | null = null;
  private apiUrl = environment.apiUrl;
  private comparisonColors = ['#f59e0b', '#ec4899', '#22c55e'];

  quickActions: QuickAction[] = [
    { label: 'Análisis técnico completo', icon: '📈', msg: 'Dame un análisis técnico completo con TODOS los indicadores activos, incluyendo OBV, A/D, Aroon, ADX, Stoch y MFI. Narra el recorrido de cada uno y dime qué señal dan en conjunto.' },
    { label: 'Libro de órdenes', icon: '📘', msg: 'Analiza el libro de órdenes actual: profundidad de mercado, desbalance compra/venta, niveles de soporte y resistencia implícitos, y qué me dice sobre la intención del mercado.' },
    { label: 'Tendencia y momentum', icon: '🔍', msg: '¿Cuál es la tendencia actual? Analiza EMAs, MACD, ADX, DMI y Aroon para confirmar o contradecir la tendencia. ¿Hay divergencias?' },
    { label: 'Volumen y flujo de dinero', icon: '💰', msg: 'Analiza el flujo de dinero usando OBV, A/D Line, Chaikin Oscillator, MFI y el volumen reciente. ¿Los compradores o vendedores controlan el mercado?' },
    { label: 'Niveles clave', icon: '🎯', msg: 'Identifica niveles de soporte, resistencia, precio objetivo y stop loss. Considera las Bandas de Bollinger, VWAP, el libro de órdenes y los máximos/mínimos recientes.' },
    { label: 'Comprar / Mantener / Vender', icon: '💡', msg: 'Basándote en TODOS los indicadores disponibles, el libro de órdenes y el contexto del mercado venezolano, ¿es buen momento para comprar, mantener o vender? Justifica con al menos 5 indicadores.' },
  ];

  constructor(
    private http: HttpClient,
    private cd: ChangeDetectorRef,
    private sanitizer: DomSanitizer
  ) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['symbol'] && !changes['symbol'].firstChange) {
      if (changes['symbol'].previousValue !== changes['symbol'].currentValue) {
        this.messages = [];
        this.inputText = '';
        this.sessionId = null;
        if (this.isComparisonMode) {
          this.exitComparisonMode();
        }
      }
    }
    
    if (changes['availableStocks'] && this.availableStocks) {
      this.filterAvailableStocks();
    }
    
    this.cd.markForCheck();
  }

  // ========== MODO COMPARATIVO ==========

  enterComparisonMode() {
    this.isComparisonMode = true;
    this.messages = [];
    this.filterAvailableStocks();
    this.cd.markForCheck();
  }

  exitComparisonMode() {
    this.isComparisonMode = false;
    this.comparisonStocks = [];
    this.messages = [];
    this.cd.markForCheck();
  }

  openStockSelector() {
    this.showStockSelector = true;
    this.stockSearchText = '';
    this.filterAvailableStocks();
  }

  closeStockSelector() {
    this.showStockSelector = false;
  }

  filterAvailableStocks() {
    const q = this.stockSearchText.toLowerCase();
    const alreadySelected = [this.symbol, ...this.comparisonStocks.map(s => s.symbol)];
    
    this.filteredAvailableStocks = this.availableStocks
      .filter(s => s.is_active !== false)
      .filter(s => !alreadySelected.includes(s.symbol))
      .filter(s => 
        s.symbol.toLowerCase().includes(q) || 
        s.name.toLowerCase().includes(q)
      )
      .slice(0, 50); // Limitar a 50 resultados
  }

  isStockSelected(symbol: string): boolean {
    return symbol === this.symbol || this.comparisonStocks.some(s => s.symbol === symbol);
  }

  async addComparisonStock(stock: { symbol: string; name: string }) {
    if (this.comparisonStocks.length >= 3) return;
    
    this.closeStockSelector();
    
    const newStock: ComparisonStock = {
      symbol: stock.symbol,
      name: stock.name,
      context: null,
      color: this.comparisonColors[this.comparisonStocks.length]
    };
    
    this.comparisonStocks.push(newStock);
    this.loading = true;
    this.cd.markForCheck();

    // Cargar datos históricos y libro de órdenes en paralelo
    try {
      const token = localStorage.getItem('access_token') || '';
      const headers = { Authorization: `Bearer ${token}` };

      const [histResponse, obResponse] = await Promise.allSettled([
        this.http.get<any>(`${this.apiUrl}/stocks/bvc/${stock.symbol}/history`, { headers }).toPromise(),
        this.http.get<any>(`${this.apiUrl}/market/order-books/${stock.symbol}`, { headers }).toPromise()
      ]);

      // ✅ Guardar libro de órdenes de la acción comparada
      if (obResponse.status === 'fulfilled' && obResponse.value?.entries) {
        this.comparisonOrderBooks[stock.symbol] = obResponse.value.entries;
      }

      // Procesar historial de velas
      const response = histResponse.status === 'fulfilled' ? histResponse.value : null;
      const candles = response?.candles || [];

      if (candles.length > 0) {
        const last = candles[candles.length - 1];
        const prev = candles.length > 1 ? candles[candles.length - 2] : last;

        // ✅ Calcular TODOS los indicadores para la acción comparada
        const rsi14    = this.calculateRSI(candles);
        const ema20    = this.calculateEMA(candles, 20);
        const ema50    = this.calculateEMA(candles, 50);
        const ema200   = this.calculateEMA(candles, 200);
        const macdData = this.calculateMACDFull(candles);
        const bbData   = this.calculateBollingerFull(candles);
        const volRatio = this.calculateVolumeRatio(candles);
        const vwapVal  = this.calculateVWAP(candles);

        // Indicadores avanzados
        const obvVal     = this.calcOBV(candles);
        const adlVal     = this.calcADL(candles);
        const aroonData  = this.calcAroon(candles);
        const adxVal     = this.calcADX(candles);
        const chaikinVal = this.calcChaikin(candles);
        const atrPct     = this.calcATRPercent(candles);
        const dmiVal     = this.calcDMI(candles);
        const stochVal   = this.calcStochastic(candles);
        const mfiVal     = this.calcMFI(candles);

        // Tendencia
        let trend = 'NEUTRAL';
        if (ema20 && ema50 && ema200) {
          if (ema20 > ema50 && ema50 > ema200) trend = 'ALCISTA_FUERTE';
          else if (ema20 > ema50) trend = 'ALCISTA';
          else if (ema20 < ema50 && ema50 < ema200) trend = 'BAJISTA_FUERTE';
          else if (ema20 < ema50) trend = 'BAJISTA';
        }

        newStock.context = {
          symbol: stock.symbol,
          name: stock.name,
          timeframe: this.chartContext?.timeframe || 'Todo',
          chartType: 'candlestick',
          lastCandle: last,
          recentCandles: candles.slice(-5),
          totalCandles: candles.length,
          priceChange: last.close - prev.close,
          priceChangePct: ((last.close - prev.close) / prev.close) * 100,
          indicators: {
            enabled: 'RSI, EMA20, EMA50, EMA200, MACD, BB, VWAP, OBV, A/D, Aroon, ADX, Chaikin, ATR%, DMI, Stoch, MFI',
            rsi14,
            ema20,
            ema50,
            ema200,
            ema20_distance: ema20 ? ((last.close - ema20) / ema20 * 100) : null,
            ema50_distance: ema50 ? ((last.close - ema50) / ema50 * 100) : null,
            macd:          macdData?.macd      ?? null,
            macd_signal:   macdData?.signal    ?? null,
            macd_hist:     macdData?.histogram ?? null,
            macd_momentum: macdData?.momentum  ?? null,
            macd_cross:    macdData?.cross     ?? null,
            bb_upper:      bbData?.upper    ?? null,
            bb_middle:     bbData?.middle   ?? null,
            bb_lower:      bbData?.lower    ?? null,
            bb_width:      bbData?.width    ?? null,
            bb_position:   bbData?.position ?? null,
            vwap: vwapVal,
            volume_current: last.volume,
            volume_ratio: volRatio,
            volume_status: volRatio > 2 ? 'MUY_ALTO' : volRatio > 1.5 ? 'ALTO' : volRatio < 0.5 ? 'BAJO' : 'NORMAL',
            // ✅ Indicadores avanzados
            obv:         obvVal,
            adl:         adlVal,
            aroon_up:    aroonData.up,
            aroon_down:  aroonData.down,
            adx:         adxVal,
            chaikin:     chaikinVal,
            atr_percent: atrPct,
            dmi:         dmiVal,
            stoch_k:     stochVal,
            mfi:         mfiVal,
            trend,
            lastCandles: candles.slice(-10)
          }
        } as any;
      }
    } catch (e) {
      console.error('Error cargando stock:', e);
    } finally {
      this.loading = false;
      this.cd.markForCheck();
    }
  }

  removeComparisonStock(index: number) {
    const removed = this.comparisonStocks[index];
    if (removed) { delete this.comparisonOrderBooks[removed.symbol]; }
    this.comparisonStocks.splice(index, 1);
    this.comparisonStocks.forEach((s, i) => { s.color = this.comparisonColors[i]; });
    this.messages = [];
    this.cd.markForCheck();
  }

  // ── Cálculos de indicadores para acciones comparadas ──────────────────────

  private calculateRSI(candles: any[]): number | null {
    if (candles.length < 14) return null;
    const closes = candles.slice(-14).map((c: any) => c.close);
    let gains = 0, losses = 0;
    for (let i = 1; i < closes.length; i++) {
      const change = closes[i] - closes[i-1];
      if (change > 0) gains += change; else losses -= change;
    }
    const avgGain = gains / 14, avgLoss = losses / 14;
    if (avgLoss === 0) return 100;
    return Math.round(100 - (100 / (1 + avgGain / avgLoss)));
  }

  private calculateEMA(candles: any[], period: number): number | null {
    if (candles.length < period) return null;
    const closes = candles.map((c: any) => c.close);
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a: number, b: number) => a + b) / period;
    for (let i = period; i < closes.length; i++) { ema = closes[i] * k + ema * (1 - k); }
    return parseFloat(ema.toFixed(4));
  }

  private calculateMACDFull(candles: any[]): any {
    const closes = candles.map((c: any) => c.close);
    if (closes.length < 26) return null;
    const ema = (arr: number[], p: number) => {
      const k = 2 / (p + 1); let e = arr.slice(0, p).reduce((a, b) => a + b) / p;
      for (let i = p; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
      return e;
    };
    const macdLine  = ema(closes, 12) - ema(closes, 26);
    const signalLine= ema(closes.slice(-9), 9);
    const histogram = macdLine - signalLine;
    return {
      macd:      parseFloat(macdLine.toFixed(4)),
      signal:    parseFloat(signalLine.toFixed(4)),
      histogram: parseFloat(histogram.toFixed(4)),
      momentum:  histogram > 0 ? 'CRECIENTE' : 'DECRECIENTE',
      cross:     macdLine > signalLine ? 'MACD_SOBRE_SENAL' : 'MACD_BAJO_SENAL'
    };
  }

  private calculateBollingerFull(candles: any[], period = 20): any {
    if (candles.length < period) return null;
    const closes = candles.slice(-period).map((c: any) => c.close);
    const mean   = closes.reduce((a: number, b: number) => a + b) / period;
    const std    = Math.sqrt(closes.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) / period);
    const upper  = mean + 2 * std, lower = mean - 2 * std;
    const lastClose = closes[closes.length - 1];
    return {
      upper:    parseFloat(upper.toFixed(4)),
      middle:   parseFloat(mean.toFixed(4)),
      lower:    parseFloat(lower.toFixed(4)),
      width:    parseFloat(((upper - lower) / mean * 100).toFixed(2)),
      position: lastClose > upper ? 'TOCANDO_BANDA_SUPERIOR' : lastClose < lower ? 'TOCANDO_BANDA_INFERIOR' : 'ENTRE_BANDAS'
    };
  }

  private calculateVolumeRatio(candles: any[]): number {
    const vols   = candles.map((c: any) => c.volume);
    const avg20  = vols.slice(-20).reduce((a: number, b: number) => a + b) / Math.min(20, vols.length);
    const last   = vols[vols.length - 1];
    return avg20 > 0 ? parseFloat((last / avg20).toFixed(2)) : 1;
  }

  private calculateVWAP(candles: any[]): number | null {
    if (!candles.length) return null;
    let ct = 0, cv = 0;
    for (const c of candles) { ct += (c.high + c.low + c.close) / 3 * c.volume; cv += c.volume; }
    return cv > 0 ? parseFloat((ct / cv).toFixed(4)) : null;
  }

  private calcOBV(candles: any[]): number {
    let obv = 0;
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].close > candles[i-1].close) obv += candles[i].volume;
      else if (candles[i].close < candles[i-1].close) obv -= candles[i].volume;
    }
    return parseFloat(obv.toFixed(0));
  }

  private calcADL(candles: any[]): number {
    let adl = 0;
    for (const c of candles) {
      const range = c.high - c.low;
      if (range > 0) adl += ((c.close - c.low) - (c.high - c.close)) / range * c.volume;
    }
    return parseFloat(adl.toFixed(0));
  }

  private calcAroon(candles: any[], period = 25): { up: number; down: number } {
    const len = candles.length;
    if (len < period) return { up: 0, down: 0 };
    const highs = candles.map((c: any) => c.high);
    const lows  = candles.map((c: any) => c.low);
    let up = 0, down = 0;
    for (let i = 0; i < period; i++) {
      if (highs[len-1-i] === Math.max(...highs.slice(-period))) up   = period - i;
      if (lows[len-1-i]  === Math.min(...lows.slice(-period)))  down = period - i;
    }
    return { up: parseFloat(((up / period) * 100).toFixed(1)), down: parseFloat(((down / period) * 100).toFixed(1)) };
  }

  private calcADX(candles: any[], period = 14): number {
    const len = candles.length;
    if (len < period + 1) return 0;
    const tr: number[] = [], plusDM: number[] = [], minusDM: number[] = [];
    for (let i = 1; i < len; i++) {
      const h = candles[i].high, hP = candles[i-1].high;
      const l = candles[i].low,  lP = candles[i-1].low;
      const cP= candles[i-1].close;
      tr.push(Math.max(h - l, Math.abs(h - cP), Math.abs(l - cP)));
      const up = h - hP, dn = lP - l;
      plusDM.push(up > dn && up > 0 ? up : 0);
      minusDM.push(dn > up && dn > 0 ? dn : 0);
    }
    const smooth = (arr: number[]) => {
      let s = arr.slice(0, period).reduce((a,b)=>a+b,0);
      const r = [s/period];
      for (let i = period; i < arr.length; i++) { s = s - s/period + arr[i]; r.push(s/period); }
      return r;
    };
    const trs = smooth(tr), pdi = smooth(plusDM).map((v,i)=>(v/trs[i])*100),
          mdi = smooth(minusDM).map((v,i)=>(v/trs[i])*100);
    const dx  = pdi.map((p,i)=>Math.abs(p-mdi[i])/(p+mdi[i])*100);
    const adx = smooth(dx);
    return parseFloat((adx[adx.length-1] || 0).toFixed(1));
  }

  private calcChaikin(candles: any[]): number {
    if (candles.length < 10) return 0;
    const adlArr: number[] = []; let adl = 0;
    for (const c of candles) {
      const r = c.high - c.low;
      if (r > 0) adl += ((c.close - c.low) - (c.high - c.close)) / r * c.volume;
      adlArr.push(adl);
    }
    const ema = (arr: number[], p: number) => {
      const k = 2/(p+1); let e = arr.slice(0,p).reduce((a,b)=>a+b,0)/p;
      for (let i = p; i < arr.length; i++) e = arr[i]*k+e*(1-k);
      return e;
    };
    return parseFloat((ema(adlArr, 3) - ema(adlArr, 10)).toFixed(2));
  }

  private calcATRPercent(candles: any[], period = 14): number {
    const tr: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const c = candles[i], p = candles[i-1];
      tr.push(Math.max(c.high-c.low, Math.abs(c.high-p.close), Math.abs(c.low-p.close)));
    }
    const atr   = tr.slice(-period).reduce((a,b)=>a+b,0) / period;
    const price = candles[candles.length-1].close;
    return parseFloat(((atr / price) * 100).toFixed(2));
  }

  private calcDMI(candles: any[], basePeriod = 14): number {
    if (candles.length < basePeriod + 5) return 50;
    const closes  = candles.map((c:any)=>c.close);
    const times   = candles.map((c:any)=>c.time);
    const recent  = closes.slice(-5);
    const mean    = recent.reduce((a:number,b:number)=>a+b,0) / recent.length;
    const std     = Math.sqrt(recent.reduce((a:number,b:number)=>a+(b-mean)**2,0)/recent.length);
    const volPct  = mean > 0 ? (std/mean)*100 : 1;
    const dynP    = Math.max(5, Math.min(30, Math.round(basePeriod / Math.max(volPct, 0.5))));
    if (closes.length < dynP + 1) return 50;
    // Simplified RSI with dynamic period
    let g = 0, l = 0;
    for (let i = 1; i < dynP; i++) { const d = closes[i]-closes[i-1]; if(d>0) g+=d; else l-=d; }
    let ag = g/dynP, al = l/dynP;
    for (let i = dynP; i < closes.length; i++) {
      const d = closes[i]-closes[i-1];
      ag = (ag*(dynP-1)+(d>0?d:0))/dynP; al = (al*(dynP-1)+(d<0?-d:0))/dynP;
    }
    return parseFloat((100-(100/(1+(al===0?100:ag/al)))).toFixed(1));
  }

  private calcStochastic(candles: any[], period = 14): number {
    if (candles.length < period) return 50;
    const slice = candles.slice(-period);
    const hh    = Math.max(...slice.map((c:any)=>c.high));
    const ll    = Math.min(...slice.map((c:any)=>c.low));
    const last  = candles[candles.length-1].close;
    return hh === ll ? 50 : parseFloat(((last-ll)/(hh-ll)*100).toFixed(1));
  }

  private calcMFI(candles: any[], period = 14): number {
    let pos = 0, neg = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      if (i <= 0) continue;
      const tp   = (candles[i].high + candles[i].low + candles[i].close) / 3;
      const tpP  = (candles[i-1].high + candles[i-1].low + candles[i-1].close) / 3;
      const mf   = tp * candles[i].volume;
      if (tp > tpP) pos += mf; else neg += mf;
    }
    return parseFloat((100-(100/(1+pos/(neg||1)))).toFixed(1));
  }

  getPlaceholder(): string {
    if (this.isComparisonMode) {
      return this.comparisonStocks.length > 0 
        ? 'Compara estas acciones...' 
        : 'Agrega acciones para comparar';
    }
    return this.symbol 
      ? `Pregunta sobre ${this.symbol}...` 
      : 'Selecciona una acción primero';
  }

  sendQuick(msg: string) {
    this.inputText = msg;
    this.sendMessage();
  }

  sendComparisonQuick(msg: string) {
    this.inputText = msg;
    this.sendMessage();
  }

  async sendMessage() {
    const text = this.inputText.trim();
    if (!text || this.loading) return;

    if (!this.isComparisonMode && !this.chartContext) {
      this.messages.push({
        role: 'assistant',
        content: '⚠️ Por favor selecciona una acción primero.',
        timestamp: new Date()
      });
      this.scrollToBottom();
      return;
    }

    if (this.isComparisonMode && this.comparisonStocks.length === 0) {
      this.messages.push({
        role: 'assistant',
        content: '⚠️ Agrega al menos una acción para comparar.',
        timestamp: new Date()
      });
      this.scrollToBottom();
      return;
    }

    // ✅ Aviso si hay pocos indicadores activos para el análisis comparativo
    if (!this.isComparisonMode && this.chartContext) {
      const enabled = this.chartContext.indicators?.enabled || '';
      const hasRSI  = enabled.toLowerCase().includes('rsi');
      const hasMACD = enabled.toLowerCase().includes('macd');
      if (!hasRSI && !hasMACD) {
        this.messages.push({
          role: 'assistant',
          content: '💡 **Tip:** Para un análisis más completo, te recomiendo activar **RSI** y **MACD** en la barra de indicadores. Con más datos puedo darte señales más precisas. Igual analizo con los indicadores disponibles.',
          timestamp: new Date()
        });
      }
    }

    this.inputText = '';
    this.resetTextareaHeight();
    
    this.messages.push({
      role: 'user',
      content: text,
      timestamp: new Date()
    });
    
    this.loading = true;
    this.cd.markForCheck();
    this.scrollToBottom();

    try {
      const token = localStorage.getItem('access_token') || '';
      let body: any;

      const usdRate = this.chartContext?.usd_rate || 0;
      const convertBook = (book: any[]) => {
        if (!this.showInUsd || !usdRate || !book?.length) return book;
        return book.map(e => ({
          ...e,
          buy_price:  e.buy_price  ? +(e.buy_price  / usdRate).toFixed(6) : e.buy_price,
          sell_price: e.sell_price ? +(e.sell_price / usdRate).toFixed(6) : e.sell_price,
        }));
      };

      if (this.isComparisonMode) {
        const stocksContext = [
          this.chartContext,
          ...this.comparisonStocks
            .filter(s => s.context !== null)
            .map(s => s.context!)
        ];

        body = {
          message: text,
          stocks_context: stocksContext,
          comparison_mode: true,
          chat_type: 'comparative',
          order_books: this.comparisonOrderBooks,
          order_book: convertBook(this.orderBook),
          session_id: this.sessionId
        };
      } else {
        const currency = this.showInUsd ? 'USD' : 'Bs';
        body = {
          message: text,
          chart_context: this.chartContext ? { ...this.chartContext, currency } : null,
          chat_type: 'technical',
          order_book: convertBook(this.orderBook),
          session_id: this.sessionId
        };
      }

      const response: any = await this.http.post(
        `${this.apiUrl}/chat/chat`,
        body,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      ).toPromise();

      // Persist session_id for subsequent messages and chat history
      if (response.session_id) {
        this.sessionId = response.session_id;
      }

      this.messages.push({
        role: 'assistant',
        content: response.response || 'Sin respuesta.',
        timestamp: new Date()
      });

    } catch (err: any) {
      console.error('Error:', err);
      this.messages.push({
        role: 'assistant',
        content: `⚠️ Error: ${err?.message || 'No se pudo contactar el asistente.'}`,
        timestamp: new Date()
      });
    } finally {
      this.loading = false;
      this.cd.markForCheck();
      setTimeout(() => this.scrollToBottom(), 50);
    }
  }

  renderContent(raw: string): SafeHtml {
    if (!raw) return '';
    let safe = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    let formatted = safe
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
    return this.sanitizer.bypassSecurityTrustHtml(formatted);
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  autoResize(event: Event) {
    const el = event.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  resetTextareaHeight() {
    if (this.aiTextarea?.nativeElement) {
      this.aiTextarea.nativeElement.style.height = 'auto';
    }
  }

  trackMsg(_: number, msg: AiMessage) {
    return msg.timestamp.getTime();
  }

  @ViewChild('aiScroll', { static: false }) aiScroll!: ElementRef<HTMLDivElement>;
  @ViewChild('aiTextarea', { static: false }) aiTextarea!: ElementRef<HTMLTextAreaElement>;

  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.aiScroll?.nativeElement;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    }, 100);
  }
}