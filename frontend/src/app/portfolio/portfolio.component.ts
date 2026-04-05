import { Component, OnInit, ElementRef, ViewChild, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { environment } from '../../environments/environment';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

interface PerfStock {
  symbol: string;
  quantity: number;
  total_invested: number;
  current_value: number;
  unrealized_pnl: number;
  realized_pnl: number;
  total_pnl: number;
  gain_pct: number;
  buy_count: number;
  sell_count: number;
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

@Component({
  selector: 'app-portfolio',
  standalone: true,
  imports: [
    CommonModule, RouterLink,
    MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatTooltipModule
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

  loading = true;
  data: AnalyticsData | null = null;
  Math = Math;
  currentInterval: 'daily' | 'weekly' | 'monthly' = 'monthly';
  private chartInstances: Chart[] = [];

  constructor(private http: HttpClient) {}

  ngOnInit() { this.fetchAnalytics(); }

  ngOnDestroy() { this.chartInstances.forEach(c => c.destroy()); }

  setInterval(interval: 'daily' | 'weekly' | 'monthly') {
    this.currentInterval = interval;
    this.initCharts();
  }

  fetchAnalytics() {
    this.http.get<AnalyticsData>(`${environment.apiUrl}/portfolio/analytics`).subscribe({
      next: (res) => { this.data = res; this.loading = false; this.tryInitCharts(0); },
      error: ()    => { this.loading = false; }
    });
  }

  private tryInitCharts(attempt: number) {
    if (attempt > 25) return;
    setTimeout(() => {
      if (this.allocChartRef?.nativeElement) this.initCharts();
      else this.tryInitCharts(attempt + 1);
    }, 100);
  }

  /** Total P&L (realized + unrealized) */
  get totalPnl(): number {
    if (!this.data) return 0;
    return this.data.summary.total_realized_pnl + this.data.summary.total_unrealized_pnl;
  }

  get totalPnlPct(): number {
    if (!this.data || this.data.summary.total_invested_usd <= 0) return 0;
    return (this.totalPnl / this.data.summary.total_invested_usd) * 100;
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
}
