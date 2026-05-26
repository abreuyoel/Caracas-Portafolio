import {
  Component, OnInit, OnDestroy,
  ViewChild, ElementRef, ChangeDetectorRef, AfterViewChecked
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormsModule } from '@angular/forms';
import { environment } from '../../environments/environment';
import { BvcSocketService } from '../core/services/bvc-socket.service';
import { Subscription } from 'rxjs';
import * as LightweightCharts from 'lightweight-charts';

interface Tick { time: number | string; value: number; }
interface IndexChartData { intraday: Tick[]; annual: Tick[]; }
interface ChartsResult {
  IBC:        IndexChartData;
  FINANCIERO: IndexChartData;
  INDUSTRIAL: IndexChartData;
  vix_proxy:  number | null;
}

const INDEX_META = [
  { key: 'IBC',        label: 'IBC',        name: 'Índice Bursátil Caracas',   color: '#4c62ff', top: 'rgba(76,98,255,0.2)'   },
  { key: 'FINANCIERO', label: 'FINANCIERO',  name: 'Índice Financiero BVC',     color: '#2dd994', top: 'rgba(45,217,148,0.15)' },
  { key: 'INDUSTRIAL', label: 'INDUSTRIAL',  name: 'Índice Industrial BVC',     color: '#f59e0b', top: 'rgba(245,158,11,0.15)' },
] as const;

type IndexKey = typeof INDEX_META[number]['key'];

@Component({
  selector: 'app-indices-bvc',
  standalone: true,
  imports: [CommonModule, RouterLink, MatIconModule, MatProgressSpinnerModule, FormsModule],
  templateUrl: './indices-bvc.component.html',
  styleUrls: ['./indices-bvc.component.scss'],
})
export class IndicesBvcComponent implements OnInit, OnDestroy, AfterViewChecked {

  @ViewChild('ibcChart')        ibcEl!:        ElementRef;
  @ViewChild('financieroChart') financieroEl!: ElementRef;
  @ViewChild('industrialChart') industrialEl!: ElementRef;

  loading  = true;
  error    = '';
  data: ChartsResult | null = null;
  viewMode: 'intraday' | 'annual' = 'intraday';

  readonly meta = INDEX_META;

  liveIbc:        number | null = null;
  liveFinanciero: number | null = null;
  liveIndustrial: number | null = null;

  private charts: any[] = [];
  private wsSub = new Subscription();
  private chartsBuilt = false;
  private pendingRebuild = false;

  private api = environment.apiUrl;
  private hdr() { return { Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}` }; }

  constructor(private http: HttpClient, private cd: ChangeDetectorRef, private bvcSocket: BvcSocketService) {}

  ngOnInit() {
    this.loadCharts();
    this.bvcSocket.connect();
    this.wsSub.add(this.bvcSocket.indices$.subscribe(data => {
      if (!data?.length) return;
      for (const item of data) {
        const sym = (item.COD_SIMB || '').trim();
        if (sym === 'IBC')             this.liveIbc        = item.PRECIO;
        else if (sym === 'I.FINANCIE') this.liveFinanciero = item.PRECIO;
        else if (sym === 'I.INDUSTR')  this.liveIndustrial = item.PRECIO;
      }
      this.cd.detectChanges();
    }));
  }

  ngAfterViewChecked() {
    if (this.pendingRebuild && this.ibcEl?.nativeElement) {
      this.pendingRebuild = false;
      this.buildCharts();
    }
  }

  ngOnDestroy() {
    this.destroyCharts();
    this.wsSub.unsubscribe();
  }

  loadCharts() {
    this.loading = true; this.error = '';
    this.destroyCharts();
    this.http.get<ChartsResult>(`${this.api}/stocks/indices/bvc-charts`, { headers: this.hdr() }).subscribe({
      next: (res) => {
        this.data = res;
        this.loading = false;
        this.chartsBuilt = false;
        this.cd.detectChanges();
        setTimeout(() => this.buildCharts(), 150);
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.detail || 'Error cargando datos de índices BVC';
        this.cd.detectChanges();
      }
    });
  }

  switchMode(mode: 'intraday' | 'annual') {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    this.destroyCharts();
    this.cd.detectChanges();
    this.pendingRebuild = true;
  }

  private destroyCharts() {
    this.charts.forEach(c => { try { c.remove(); } catch {} });
    this.charts = [];
    this.chartsBuilt = false;
  }

  private buildCharts() {
    if (!this.data || this.chartsBuilt) return;

    const elems: Array<{ el: ElementRef | undefined; key: IndexKey }> = [
      { el: this.ibcEl,        key: 'IBC'        },
      { el: this.financieroEl, key: 'FINANCIERO' },
      { el: this.industrialEl, key: 'INDUSTRIAL' },
    ];

    const isIntraday = this.viewMode === 'intraday';

    for (const cfg of elems) {
      if (!cfg.el?.nativeElement) continue;
      const raw = (this.data[cfg.key] as IndexChartData)?.[this.viewMode] ?? [];
      if (!raw.length) continue;

      const el    = cfg.el.nativeElement as HTMLElement;
      el.innerHTML = '';  // clear previous chart
      const width  = el.clientWidth || 680;
      const height = 240;
      const m      = INDEX_META.find(x => x.key === cfg.key)!;

      const chart = (LightweightCharts as any).createChart(el, {
        width, height,
        layout: { background: { color: 'transparent' }, textColor: '#8898aa' },
        grid:   { vertLines: { color: 'rgba(255,255,255,0.03)' }, horzLines: { color: 'rgba(255,255,255,0.03)' } },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)', scaleMargins: { top: 0.1, bottom: 0.1 } },
        timeScale: {
          borderColor: 'rgba(255,255,255,0.08)',
          timeVisible: isIntraday,
          secondsVisible: false,
        },
        handleScroll: true,
        handleScale: true,
      });

      const series = chart.addAreaSeries({
        lineColor:   m.color,
        topColor:    m.top,
        bottomColor: 'rgba(0,0,0,0)',
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 5,
      });

      const sorted = [...raw].sort((a, b) => {
        const at = a.time, bt = b.time;
        return (at < bt ? -1 : at > bt ? 1 : 0);
      });
      series.setData(sorted as any);
      chart.timeScale().fitContent();
      this.charts.push(chart);

      const obs = new ResizeObserver(() => {
        try { chart.applyOptions({ width: el.clientWidth }); } catch {}
      });
      obs.observe(el);
    }

    this.chartsBuilt = true;
  }

  seriesLength(key: IndexKey): number {
    return (this.data?.[key] as IndexChartData | undefined)?.[this.viewMode]?.length ?? 0;
  }

  firstTime(key: IndexKey): string {
    const v = (this.data?.[key] as IndexChartData | undefined)?.[this.viewMode]?.[0]?.time;
    return v != null ? String(v) : '';
  }

  lastTime(key: IndexKey): string {
    const arr = (this.data?.[key] as IndexChartData | undefined)?.[this.viewMode] ?? [];
    return arr.length ? String(arr[arr.length - 1].time) : '';
  }

  lastValue(key: IndexKey): number | null {
    const arr = (this.data?.[key] as IndexChartData | undefined)?.[this.viewMode] ?? [];
    return arr.length ? arr[arr.length - 1].value : null;
  }

  changePct(key: IndexKey): number | null {
    const arr = (this.data?.[key] as IndexChartData | undefined)?.[this.viewMode] ?? [];
    if (arr.length < 2) return null;
    const a = arr[0].value;
    const b = arr[arr.length - 1].value;
    if (!a) return null;
    return Math.round(((b - a) / a) * 10000) / 100;
  }

  changeClass(v: number | null): string {
    if (v === null) return '';
    return v >= 0 ? 'txt-up' : 'txt-dn';
  }

  liveFor(key: IndexKey): number | null {
    if (key === 'IBC')        return this.liveIbc;
    if (key === 'FINANCIERO') return this.liveFinanciero;
    if (key === 'INDUSTRIAL') return this.liveIndustrial;
    return null;
  }

  displayValue(key: IndexKey): number | null {
    return this.liveFor(key) ?? this.lastValue(key);
  }

  get vixProxy(): number | null { return this.data?.vix_proxy ?? null; }

  vixLevel(v: number | null): 1 | 2 | 3 | 4 {
    if (v === null || v < 18) return 1;
    if (v < 30) return 2;
    if (v < 50) return 3;
    return 4;
  }

  vixLabel(v: number | null): string {
    switch (this.vixLevel(v)) {
      case 1: return 'LETARGO / COMPLACENCIA';
      case 2: return 'ENTORNO ÓPTIMO';
      case 3: return 'TENSIÓN / INCERTIDUMBRE';
      case 4: return 'PÁNICO / EUFORIA';
    }
  }

  vixSubtitle(v: number | null): string {
    switch (this.vixLevel(v)) {
      case 1: return 'El mercado está anormalmente quieto. Rupturas técnicas poco confiables — cuidado con entradas antes de expansión de volatilidad.';
      case 2: return 'Volatilidad saludable. ATR y stops funcionan correctamente. Momento para operar según tu plan técnico.';
      case 3: return 'Riesgo de gap entre sesiones alto. No operes sin stop loss. Considera reducir tamaño de posición un 25%.';
      case 4: return 'Señal contraria: si IBC cae → zona de oportunidad a mediano plazo. Si IBC sube → FOMO/burbuja, alta probabilidad de corrección.';
    }
  }

  vixPercentile(v: number | null): string {
    switch (this.vixLevel(v)) {
      case 1: return '<20%';
      case 2: return '20–60%';
      case 3: return '60–90%';
      case 4: return '>90%';
    }
  }

  vixClass(v: number | null): string {
    switch (this.vixLevel(v)) {
      case 1: return 'txt-up';
      case 2: return 'txt-up';
      case 3: return 'txt-warn';
      case 4: return 'txt-dn';
    }
  }

  vixIcon(v: number | null): string {
    switch (this.vixLevel(v)) {
      case 1: return 'bedtime';
      case 2: return 'check_circle';
      case 3: return 'warning_amber';
      case 4: return 'local_fire_department';
    }
  }

  formatTime(t: string | number): string {
    if (typeof t === 'number') {
      return new Date(t * 1000).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
    }
    return String(t).slice(0, 10);
  }
}
