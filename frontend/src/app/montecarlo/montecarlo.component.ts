import { Component, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom, Subscription } from 'rxjs';
import { environment } from '../../environments/environment';
import { BvcSocketService } from '../core/services/bvc-socket.service';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

interface MonteCarloResult {
  initial_value_usd: number;
  total_contributed_usd: number;
  dca_monthly_usd: number;
  horizon_days: number;
  simulations: number;
  bcv_rate: number;
  bcv_annual_deval_pct?: number;
  returns_in_usd?: boolean;
  stocks: { symbol: string; weight_pct: number; mu_daily: number; sigma_daily: number }[];
  percentiles: {
    p5: number[];
    p25: number[];
    p50: number[];
    p75: number[];
    p95: number[];
  };
  error?: string;
}

@Component({
  selector: 'app-montecarlo',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink,
    MatIconModule, MatProgressSpinnerModule, MatTooltipModule,
  ],
  templateUrl: './montecarlo.component.html',
  styleUrls: ['./montecarlo.component.scss'],
})
export class MontecarloComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('mcChart') chartRef!: ElementRef<HTMLCanvasElement>;

  private api = environment.apiUrl;
  private token = () => localStorage.getItem('access_token') ?? '';
  private headers = () => ({ Authorization: `Bearer ${this.token()}` });
  private chartInstance: Chart | null = null;

  loading = false;
  result: MonteCarloResult | null = null;
  errorMsg = '';
  errorCode = '';
  livePortfolioChanged = false;
  private lastLivePrices: Record<string, number> = {};

  // Params
  horizon = 252;      // ~1 year
  simulations = 500;
  dcaMonthly = 0;     // USD monthly contribution

  horizonOptions = [
    { label: '1 mes', value: 21 },
    { label: '3 meses', value: 63 },
    { label: '6 meses', value: 126 },
    { label: '1 año', value: 252 },
    { label: '2 años', value: 504 },
    { label: '3 años', value: 756 },
  ];

  simOptions = [
    { label: '100', value: 100 },
    { label: '250', value: 250 },
    { label: '500', value: 500 },
    { label: '1000', value: 1000 },
    { label: '2000', value: 2000 },
  ];

  constructor(private http: HttpClient, private bvcSocket: BvcSocketService) {}

  private wsSub: Subscription | null = null;

  ngOnInit() { this.runSimulation(); this.connectSocket(); }
  ngAfterViewInit() {}
  ngOnDestroy() { this.chartInstance?.destroy(); this.wsSub?.unsubscribe(); }

  private connectSocket() {
    this.bvcSocket.connect();
    this.wsSub = this.bvcSocket.prices$.subscribe(prices => {
      if (!this.result?.stocks.length) return;
      let changed = false;
      for (const st of this.result.stocks) {
        const live = prices[st.symbol];
        if (live && live !== this.lastLivePrices[st.symbol]) {
          this.lastLivePrices[st.symbol] = live;
          changed = true;
        }
      }
      if (changed) this.livePortfolioChanged = true;
    });
  }

  rerunWithLiveData() {
    this.livePortfolioChanged = false;
    this.lastLivePrices = {};
    this.runSimulation();
  }

  async runSimulation() {
    this.loading = true;
    this.errorMsg = '';
    this.errorCode = '';
    try {
      const data = await firstValueFrom(
        this.http.get<MonteCarloResult>(
          `${this.api}/portfolio/montecarlo?horizon=${this.horizon}&simulations=${this.simulations}&dca_monthly_usd=${this.dcaMonthly}`,
          { headers: this.headers() }
        )
      );
      if (data.error) {
        this.errorCode = data.error;
        this.errorMsg = this.friendlyError(data.error);
        this.result = null;
      } else {
        this.result = data;
        setTimeout(() => this.buildChart(), 100);
      }
    } catch (err: any) {
      this.errorMsg = err.error?.detail || 'Error cargando la simulación';
      this.result = null;
    } finally {
      this.loading = false;
    }
  }

  private friendlyError(code: string): string {
    const map: Record<string, string> = {
      no_portfolio: 'No tienes transacciones registradas aún.',
      no_open_positions: 'No tienes posiciones abiertas actualmente.',
      no_price_data: 'Sin datos de precios históricos para simular.',
    };
    return map[code] ?? 'No se pudo ejecutar la simulación.';
  }

  private buildChart() {
    if (!this.result || !this.chartRef) return;
    this.chartInstance?.destroy();

    const { p5, p25, p50, p75, p95 } = this.result.percentiles;
    const labels = Array.from({ length: p50.length }, (_, i) => i);
    const init = this.result.initial_value_usd;
    const dca = this.result.dca_monthly_usd ?? 0;
    const hasDca = dca > 0;
    // Build capital line: starts at init, adds dca every 21 days
    const capitalLine = labels.map(day => {
      const months = Math.floor(day / 21);
      return init + months * dca;
    });

    const ctx = this.chartRef.nativeElement.getContext('2d');
    if (!ctx) return;

    this.chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'P95 (optimista)',
            data: p95,
            borderColor: 'rgba(76,175,80,0.6)',
            backgroundColor: 'rgba(76,175,80,0.08)',
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            tension: 0.3,
          },
          {
            label: 'P75',
            data: p75,
            borderColor: 'rgba(76,175,80,0.9)',
            backgroundColor: 'rgba(76,175,80,0.15)',
            borderWidth: 1.5,
            pointRadius: 0,
            fill: '0',
            tension: 0.3,
          },
          {
            label: 'P50 (mediana)',
            data: p50,
            borderColor: '#7eb8ff',
            backgroundColor: 'rgba(126,184,255,0.12)',
            borderWidth: 2.5,
            pointRadius: 0,
            fill: false,
            tension: 0.3,
          },
          {
            label: 'P25',
            data: p25,
            borderColor: 'rgba(239,83,80,0.9)',
            backgroundColor: 'rgba(239,83,80,0.10)',
            borderWidth: 1.5,
            pointRadius: 0,
            fill: '2',
            tension: 0.3,
          },
          {
            label: 'P5 (pesimista)',
            data: p5,
            borderColor: 'rgba(239,83,80,0.5)',
            backgroundColor: 'rgba(239,83,80,0.06)',
            borderWidth: 1.5,
            pointRadius: 0,
            fill: '3',
            tension: 0.3,
          },
          {
            label: hasDca ? 'Capital inicial' : 'Capital inicial',
            data: Array(p50.length).fill(init),
            borderColor: 'rgba(255,255,255,0.18)',
            borderWidth: 1,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
          } as any,
          ...(hasDca ? [{
            label: `Capital aportado (+$${dca.toLocaleString('en-US', {maximumFractionDigits:0})}/mes)`,
            data: capitalLine,
            borderColor: 'rgba(255,193,7,0.7)',
            borderWidth: 1.5,
            borderDash: [4, 3],
            pointRadius: 0,
            fill: false,
          } as any] : []),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#8090a8', boxWidth: 16, font: { size: 11 }, usePointStyle: true },
          },
          tooltip: {
            backgroundColor: '#0e1a2e',
            borderColor: '#2a3a58',
            borderWidth: 1,
            titleColor: '#c0d0e0',
            bodyColor: '#8090a8',
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed.y ?? 0;
                const diff = v - init;
                const pct = ((diff / init) * 100).toFixed(1);
                const sign = diff >= 0 ? '+' : '';
                return ` ${ctx.dataset.label}: $${v.toLocaleString('en-US', { maximumFractionDigits: 0 })} (${sign}${pct}%)`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#556070',
              maxTicksLimit: 10,
              callback: (val: any) => `Día ${val}`,
            },
            grid: { color: 'rgba(255,255,255,0.04)' },
          },
          y: {
            ticks: {
              color: '#556070',
              callback: (val: any) => '$' + Number(val).toLocaleString('en-US', { maximumFractionDigits: 0 }),
            },
            grid: { color: 'rgba(255,255,255,0.04)' },
          },
        },
      },
    });
  }

  get finalMedian(): number {
    return this.result?.percentiles.p50.at(-1) ?? 0;
  }

  get finalP5(): number {
    return this.result?.percentiles.p5.at(-1) ?? 0;
  }

  get finalP95(): number {
    return this.result?.percentiles.p95.at(-1) ?? 0;
  }

  get medianReturn(): number {
    if (!this.result) return 0;
    return ((this.finalMedian - this.result.initial_value_usd) / this.result.initial_value_usd) * 100;
  }

  formatUsd(v: number) {
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  formatPct(v: number) {
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  }

  get devalNote(): string {
    const d = this.result?.bcv_annual_deval_pct;
    if (d == null) return '';
    return `Retornos en USD real · Devaluación BCV estimada: ${d.toFixed(0)}% anual`;
  }

  horizonLabel(): string {
    return this.horizonOptions.find(h => h.value === this.horizon)?.label ?? `${this.horizon}d`;
  }
}
