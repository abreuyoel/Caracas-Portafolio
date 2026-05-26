import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';

export interface HeatmapItem {
  symbol: string;
  name?: string;
  weight: number;       // > 0  (relative size)
  varRel: number;       // %    (color)
  price?: number;
  value?: number;       // position market value (for tooltip)
}

interface LaidTile extends HeatmapItem {
  x: number; y: number; w: number; h: number;
}

/**
 * Portfolio heatmap (squarified treemap).
 *
 * Color = signed daily return (`varRel`, %)
 *   < -3%  red
 *   -3..-1 light red
 *   -1..+1 gray
 *   +1..+3 light green
 *   > +3%  green
 *
 * Area = position weight in the portfolio (`weight`)
 *
 * Pure SVG, no third-party charting library.
 */
@Component({
  selector: 'app-portfolio-heatmap',
  standalone: true,
  imports: [CommonModule, MatTooltipModule],
  template: `
    <div class="ph-wrap" [style.height.px]="height">
      <div class="ph-title" *ngIf="title">{{ title }}</div>
      <svg [attr.width]="width" [attr.height]="height - 30" *ngIf="tiles.length">
        <g *ngFor="let t of tiles">
          <rect [attr.x]="t.x" [attr.y]="t.y"
                [attr.width]="t.w" [attr.height]="t.h"
                [attr.fill]="colorFor(t.varRel)"
                stroke="#0d1117" stroke-width="1"
                [matTooltip]="tipFor(t)"
                matTooltipPosition="above"
                style="cursor:pointer;">
          </rect>
          <text *ngIf="t.w > 50 && t.h > 22"
                [attr.x]="t.x + t.w / 2"
                [attr.y]="t.y + t.h / 2 - 2"
                text-anchor="middle"
                font-size="13" font-weight="700"
                fill="#fff" pointer-events="none">{{ t.symbol }}</text>
          <text *ngIf="t.w > 60 && t.h > 38"
                [attr.x]="t.x + t.w / 2"
                [attr.y]="t.y + t.h / 2 + 14"
                text-anchor="middle"
                font-size="11"
                fill="rgba(255,255,255,0.85)" pointer-events="none">
            {{ t.varRel >= 0 ? '+' : '' }}{{ t.varRel.toFixed(2) }}%
          </text>
        </g>
      </svg>
      <div class="ph-empty" *ngIf="!tiles.length">Sin posiciones para mostrar.</div>
      <div class="ph-legend">
        <span class="ph-leg ph-leg--down">≤ -3%</span>
        <span class="ph-leg ph-leg--down-soft">-1%</span>
        <span class="ph-leg ph-leg--flat">0%</span>
        <span class="ph-leg ph-leg--up-soft">+1%</span>
        <span class="ph-leg ph-leg--up">≥ +3%</span>
      </div>
    </div>
  `,
  styles: [`
    .ph-wrap { position: relative; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 12px; }
    .ph-title { color: #c9d1d9; font-weight: 600; margin-bottom: 8px; font-size: 14px; }
    .ph-empty { color: #8b949e; padding: 24px; text-align: center; font-style: italic; }
    .ph-legend { display: flex; gap: 6px; margin-top: 8px; font-size: 11px; color: #8b949e; }
    .ph-leg { padding: 2px 8px; border-radius: 3px; color: #fff; }
    .ph-leg--down       { background: #b22424; }
    .ph-leg--down-soft  { background: #8a3a3a; }
    .ph-leg--flat       { background: #4d5862; }
    .ph-leg--up-soft    { background: #2c6939; }
    .ph-leg--up         { background: #1f8a3c; }
  `]
})
export class PortfolioHeatmapComponent implements OnChanges {
  @Input() items: HeatmapItem[] = [];
  @Input() width = 720;
  @Input() height = 460;
  @Input() title = 'Mapa de Calor del Portafolio';

  tiles: LaidTile[] = [];

  ngOnChanges(_: SimpleChanges) { this.layout(); }

  colorFor(v: number): string {
    if (v <= -3) return '#b22424';
    if (v <= -1) return '#8a3a3a';
    if (v <  1)  return '#4d5862';
    if (v <  3)  return '#2c6939';
    return '#1f8a3c';
  }

  tipFor(t: HeatmapItem): string {
    const value = t.value ? ` · valor ${t.value.toFixed(2)}` : '';
    return `${t.symbol}${t.name ? ' — ' + t.name : ''}\n${t.varRel >= 0 ? '+' : ''}${t.varRel.toFixed(2)}% · peso ${(t.weight * 100).toFixed(1)}%${value}`;
  }

  // ─── Squarified treemap (Bruls, Huijing, van Wijk 1999) ────────────────────
  private layout() {
    if (!this.items?.length) { this.tiles = []; return; }
    const totalW = sum(this.items.map(i => Math.max(i.weight, 0)));
    if (totalW <= 0) { this.tiles = []; return; }
    const W = this.width, H = this.height - 60;   // leave room for title+legend
    const total = W * H;
    const items = [...this.items]
      .filter(i => i.weight > 0)
      .map(i => ({ ...i, area: (i.weight / totalW) * total }))
      .sort((a, b) => b.area - a.area);

    const out: LaidTile[] = [];
    squarify(items, [], { x: 0, y: 0, w: W, h: H }, out);
    this.tiles = out;
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

interface Rect { x: number; y: number; w: number; h: number; }
type Item = HeatmapItem & { area: number };

function squarify(items: Item[], row: Item[], rect: Rect, out: LaidTile[]) {
  if (!items.length && !row.length) return;
  if (!items.length) { layoutRow(row, rect, out); return; }

  const next = items[0];
  const newRow = [...row, next];
  const w = Math.min(rect.w, rect.h);
  if (row.length === 0 || worst(row, w) >= worst(newRow, w)) {
    squarify(items.slice(1), newRow, rect, out);
  } else {
    const newRect = layoutRow(row, rect, out);
    squarify(items, [], newRect, out);
  }
}

function worst(row: Item[], w: number): number {
  if (!row.length) return Infinity;
  const s = sum(row.map(i => i.area));
  const rMax = Math.max(...row.map(i => i.area));
  const rMin = Math.min(...row.map(i => i.area));
  const w2s = (w * w) * s;
  return Math.max(w2s / Math.max((s * s), 1e-9) / Math.max(rMin, 1e-9) * rMax,
                  Math.max(rMin, 1e-9) * (s * s) / Math.max(w2s, 1e-9));
}

function layoutRow(row: Item[], rect: Rect, out: LaidTile[]): Rect {
  if (!row.length) return rect;
  const s = sum(row.map(i => i.area));
  const horizontal = rect.w >= rect.h;
  if (horizontal) {
    const rowH = s / Math.max(rect.w, 1e-9);
    let x = rect.x;
    for (const it of row) {
      const tileW = it.area / Math.max(rowH, 1e-9);
      out.push({ ...it, x, y: rect.y, w: tileW, h: rowH });
      x += tileW;
    }
    return { x: rect.x, y: rect.y + rowH, w: rect.w, h: rect.h - rowH };
  } else {
    const rowW = s / Math.max(rect.h, 1e-9);
    let y = rect.y;
    for (const it of row) {
      const tileH = it.area / Math.max(rowW, 1e-9);
      out.push({ ...it, x: rect.x, y, w: rowW, h: tileH });
      y += tileH;
    }
    return { x: rect.x + rowW, y: rect.y, w: rect.w - rowW, h: rect.h };
  }
}
