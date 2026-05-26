import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom, Subscription } from 'rxjs';
import { environment } from '../../environments/environment';
import { BvcSocketService } from '../core/services/bvc-socket.service';

interface PaperPortfolio {
  virtual_balance_usd: number;
  total_invested_usd: number;
  total_current_value_usd: number;
  total_portfolio_value_usd: number;
  total_pnl_usd: number;
  total_pnl_pct: number;
  bcv_rate: number;
  holdings: Holding[];
  created_at: string;
  reset_count: number;
}

interface Holding {
  symbol: string;
  name: string;
  quantity: number;
  avg_cost_usd: number;
  current_price_usd: number;
  current_value_usd: number;
  cost_usd: number;
  pnl_usd: number;
  pnl_pct: number;
}

interface TradableStock {
  symbol: string;
  name: string;
  last_price_bs: number;
  last_price_usd: number;
}

interface PaperTx {
  id: number;
  symbol: string;
  name: string;
  order_type: 'BUY' | 'SELL';
  quantity: number;
  price_bs: number;
  price_usd: number;
  total_usd: number;
  bcv_rate: number;
  executed_at: string;
  notes: string | null;
}

@Component({
  selector: 'app-paper-trading',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink,
    MatIconModule, MatProgressSpinnerModule,
    MatSnackBarModule, MatTooltipModule,
  ],
  templateUrl: './paper-trading.component.html',
  styleUrls: ['./paper-trading.component.scss'],
})
export class PaperTradingComponent implements OnInit, OnDestroy {
  private api = environment.apiUrl;
  private token = () => localStorage.getItem('access_token') ?? '';
  private headers = () => ({ Authorization: `Bearer ${this.token()}` });

  // State
  loading = true;
  submitting = false;
  resetConfirm = false;
  showHistory = false;

  portfolio: PaperPortfolio | null = null;
  stocks: TradableStock[] = [];
  history: PaperTx[] = [];
  historyLoading = false;

  // Order form
  tradeMode: 'MARKET' | 'LIMIT' = 'MARKET';
  orderType: 'BUY' | 'SELL' = 'BUY';
  searchQuery = '';
  filteredStocks: TradableStock[] = [];
  selectedStock: TradableStock | null = null;
  orderQuantity = 1;
  orderNotes = '';
  showDropdown = false;

  STARTING_BALANCE = 10000;
  marketBoard: Record<string, any> = {};
  private wsSub: Subscription | null = null;

  constructor(private http: HttpClient, private snack: MatSnackBar, private bvcSocket: BvcSocketService) {}

  ngOnInit() {
    this.bvcSocket.connect();
    this.wsSub = this.bvcSocket.stocksMap$.subscribe(board => {
      this.marketBoard = board;
      this.recalcLivePnl(board);
    });
    this.loadAll();
  }

  ngOnDestroy() {
    if (this.wsSub) this.wsSub.unsubscribe();
  }

  /** Recalculate holdings PnL from live WS prices */
  private recalcLivePnl(board: Record<string, any>) {
    if (!this.portfolio || !this.portfolio.holdings.length) return;
    const bcv = this.portfolio.bcv_rate || 36;
    let totalValue = 0;
    let totalCost = 0;

    for (const h of this.portfolio.holdings) {
      const tick = board[h.symbol];
      if (tick?.PRECIO) {
        const priceUsd = tick.PRECIO / bcv;
        h.current_price_usd = priceUsd;
        h.current_value_usd = priceUsd * h.quantity;
      }
      h.pnl_usd = h.current_value_usd - h.cost_usd;
      h.pnl_pct = h.cost_usd > 0 ? (h.pnl_usd / h.cost_usd) * 100 : 0;
      totalValue += h.current_value_usd;
      totalCost += h.cost_usd;
    }

    this.portfolio.total_current_value_usd = totalValue;
    this.portfolio.total_portfolio_value_usd = this.portfolio.virtual_balance_usd + totalValue;
    this.portfolio.total_pnl_usd = this.portfolio.total_portfolio_value_usd - this.STARTING_BALANCE;
    this.portfolio.total_pnl_pct = (this.portfolio.total_pnl_usd / this.STARTING_BALANCE) * 100;
  }

  async loadAll() {
    this.loading = true;
    try {
      const [p, s] = await Promise.all([
        firstValueFrom(this.http.get<PaperPortfolio>(`${this.api}/paper-trading/portfolio`, { headers: this.headers() })),
        firstValueFrom(this.http.get<TradableStock[]>(`${this.api}/paper-trading/stocks`, { headers: this.headers() })),
      ]);
      this.portfolio = p;
      this.stocks = s;
      this.filteredStocks = s;
    } catch {
      this.snack.open('Error cargando portafolio simulado', 'Cerrar', { duration: 3000 });
    } finally {
      this.loading = false;
    }
  }

  filterStocks() {
    const q = this.searchQuery.toLowerCase();
    this.filteredStocks = this.stocks.filter(
      s => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
    this.showDropdown = true;
  }

  selectStock(s: TradableStock) {
    this.selectedStock = s;
    this.searchQuery = `${s.symbol} — ${s.name}`;
    this.showDropdown = false;
  }

  clearStock() {
    this.selectedStock = null;
    this.searchQuery = '';
    this.filteredStocks = this.stocks;
  }

  get orderPriceBs(): number {
    if (!this.selectedStock) return 0;
    const tick = this.marketBoard[this.selectedStock.symbol];
    if (this.tradeMode === 'MARKET') {
      return tick?.PRECIO || this.selectedStock.last_price_bs;
    } else {
      if (!tick) return this.selectedStock.last_price_bs;
      // BVC Socket returns PRECIO directly without depth in serverDataExt.
      // Use PRECIO for both LIMIT estimates unless depth available.
      return tick.PRECIO || this.selectedStock.last_price_bs;
    }
  }

  get availableLimitVolume(): number {
    if (!this.selectedStock) return 0;
    const tick = this.marketBoard[this.selectedStock.symbol];
    if (!tick) return 0;
    // BVC WS serverDataExt does not broadcast bid_vol or ask_vol
    return tick.VOLUMEN || 999999;
  }

  get orderTotal(): number {
    if (!this.selectedStock || !this.portfolio) return 0;
    const bcv = this.portfolio.bcv_rate || 36;
    const priceUsd = this.executedPriceBs / bcv;
    return priceUsd * this.orderQuantity;
  }

  /**
   * Realistic slippage estimator for the BVC market.
   *
   * BVC has thin liquidity — large orders walk the order book and pay
   * progressively worse prices. We approximate this by penalizing the
   * mid price by a function of (orderQty / avgDailyVolume).
   *
   * Penalty model:
   *   ratio = qty / max(volume, 1)
   *   slippage_pct = base_spread + impact_coef * sqrt(ratio)
   *   - base_spread = 0.10% (BVC bid/ask floor)
   *   - impact_coef = 5%   (square-root market impact)
   * Capped at 8% to avoid absurd numbers in dry symbols.
   */
  get slippagePct(): number {
    if (!this.selectedStock) return 0;
    const tick = this.marketBoard[this.selectedStock.symbol];
    const dailyVol = tick?.VOLUMEN || this.selectedStock.last_price_bs * 0 || 0;
    if (dailyVol <= 0 || this.orderQuantity <= 0) return 0.10;
    const ratio = this.orderQuantity / dailyVol;
    const raw = 0.10 + 5.0 * Math.sqrt(ratio);
    return Math.min(raw, 8.0);
  }

  /** Mid price the form displays as the "reference" price. */
  get midPriceBs(): number {
    return this.orderPriceBs;
  }

  /** Realistic execution price after slippage penalty. */
  get executedPriceBs(): number {
    const mid = this.orderPriceBs;
    if (!mid) return 0;
    const sign = this.orderType === 'BUY' ? +1 : -1;
    return mid * (1 + sign * this.slippagePct / 100);
  }

  /** Cost in USD of the slippage drift only (informational). */
  get slippageCostUsd(): number {
    if (!this.selectedStock || !this.portfolio) return 0;
    const bcv = this.portfolio.bcv_rate || 36;
    const drift = Math.abs(this.executedPriceBs - this.orderPriceBs);
    return (drift * this.orderQuantity) / bcv;
  }

  get canBuy(): boolean {
    if (!this.portfolio || !this.selectedStock) return false;
    return this.orderType === 'BUY'
      ? this.portfolio.virtual_balance_usd >= this.orderTotal
      : true;
  }

  get heldQty(): number {
    if (!this.portfolio || !this.selectedStock) return 0;
    return this.portfolio.holdings.find(h => h.symbol === this.selectedStock!.symbol)?.quantity ?? 0;
  }

  async submitOrder() {
    if (!this.selectedStock) return;
    if (this.orderQuantity < 1) {
      this.snack.open('La cantidad debe ser al menos 1', 'OK', { duration: 2000 });
      return;
    }
    if (this.tradeMode === 'LIMIT') {
      if (this.orderPriceBs === 0) {
        this.snack.open(`No hay puntas de ${this.orderType === 'BUY' ? 'Venta' : 'Compra'} en la Profundidad del Libro`, 'OK', { duration: 3000 });
        return;
      }
      if (this.orderQuantity > this.availableLimitVolume) {
        this.snack.open(`Volumen excede el límite del Libro (${this.availableLimitVolume})`, 'OK', { duration: 3000 });
        return;
      }
    }

    this.submitting = true;
    try {
      const slipNote = this.slippagePct > 0.5
        ? `Slippage simulado ${this.slippagePct.toFixed(2)}% (mid ${this.orderPriceBs.toFixed(4)} → exec ${this.executedPriceBs.toFixed(4)})`
        : null;
      const finalNotes = [this.orderNotes || null, slipNote].filter(Boolean).join(' | ') || null;
      await firstValueFrom(
        this.http.post(`${this.api}/paper-trading/order`, {
          symbol: this.selectedStock.symbol,
          order_type: this.orderType,
          quantity: this.orderQuantity,
          executed_price_bs: this.executedPriceBs,
          notes: finalNotes,
        }, { headers: this.headers() })
      );
      const action = this.orderType === 'BUY' ? 'Compra' : 'Venta';
      this.snack.open(`${action} de ${this.orderQuantity} ${this.selectedStock.symbol} ejecutada`, 'OK', { duration: 3000 });
      this.orderQuantity = 1;
      this.orderNotes = '';
      await this.loadAll();
      if (this.showHistory) this.loadHistory();
    } catch (err: any) {
      this.snack.open(err.error?.detail || 'Error ejecutando la orden', 'Cerrar', { duration: 4000 });
    } finally {
      this.submitting = false;
    }
  }

  async loadHistory() {
    this.historyLoading = true;
    try {
      this.history = await firstValueFrom(
        this.http.get<PaperTx[]>(`${this.api}/paper-trading/history`, { headers: this.headers() })
      );
    } catch {
      this.history = [];
    } finally {
      this.historyLoading = false;
    }
  }

  toggleHistory() {
    this.showHistory = !this.showHistory;
    if (this.showHistory && this.history.length === 0) this.loadHistory();
  }

  async resetPortfolio() {
    if (!this.resetConfirm) { this.resetConfirm = true; return; }
    try {
      await firstValueFrom(
        this.http.post(`${this.api}/paper-trading/reset`, {}, { headers: this.headers() })
      );
      this.resetConfirm = false;
      this.history = [];
      this.showHistory = false;
      this.snack.open('Portafolio reiniciado a $10,000', 'OK', { duration: 3000 });
      await this.loadAll();
    } catch {
      this.snack.open('Error al reiniciar', 'Cerrar', { duration: 3000 });
      this.resetConfirm = false;
    }
  }

  cancelReset() { this.resetConfirm = false; }

  pnlClass(v: number) { return v >= 0 ? 'up' : 'dn'; }

  formatPct(v: number) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }

  formatUsd(v: number) {
    return '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  progressPct(): number {
    if (!this.portfolio) return 50;
    const tv = this.portfolio.total_portfolio_value_usd;
    const ratio = tv / this.STARTING_BALANCE;
    return Math.min(Math.max(ratio * 50, 5), 95);
  }
}
