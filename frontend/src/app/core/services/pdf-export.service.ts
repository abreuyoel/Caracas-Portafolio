import { Injectable } from '@angular/core';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface PdfDashboardSnapshot {
  user_email?: string;
  generated_at: Date;
  summary: {
    total_invested_usd: number;
    cost_basis_current_usd: number;
    current_value_usd: number;
    total_pnl_usd: number;
    total_pnl_pct: number;
    total_positions: number;
    bcv_rate: number;
  };
  positions: Array<{
    symbol: string;
    name?: string;
    quantity: number;
    avg_price_usd: number;
    current_price_usd: number;
    value_usd: number;
    pnl_usd: number;
    pnl_pct: number;
  }>;
  metrics?: {
    sharpe?: number;
    var_95?: number;
    cvar_95?: number;
    max_drawdown_pct?: number;
    volatility_annual_pct?: number;
    intraday_pnl_usd?: number;
    intraday_pnl_pct?: number;
    concentration_index?: number;
  };
}

@Injectable({ providedIn: 'root' })
export class PdfExportService {

  exportDashboard(snap: PdfDashboardSnapshot): void {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const W = doc.internal.pageSize.getWidth();
    const M = 40;

    // ── Header ──────────────────────────────────────────────────────────────
    doc.setFillColor(20, 24, 33);
    doc.rect(0, 0, W, 80, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('Caracas Portafolio', M, 38);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Reporte de Portafolio · ${snap.generated_at.toLocaleString('es-VE')}`, M, 56);
    if (snap.user_email) doc.text(snap.user_email, W - M, 56, { align: 'right' });

    // ── Summary cards ───────────────────────────────────────────────────────
    let y = 110;
    doc.setTextColor(50, 50, 50);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Resumen', M, y);
    y += 14;

    const fmt$ = (n: number) => '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmt_ = (n: number, d = 2) => (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

    const summaryRows = [
      ['Capital invertido (WAC actual)', fmt$(snap.summary.cost_basis_current_usd)],
      ['Valor de mercado actual', fmt$(snap.summary.current_value_usd)],
      ['P&L Total (USD)', fmt$(snap.summary.total_pnl_usd)],
      ['P&L Total (%)', fmt_(snap.summary.total_pnl_pct) + '%'],
      ['Posiciones activas', String(snap.summary.total_positions)],
      ['Tasa BCV', fmt_(snap.summary.bcv_rate, 4) + ' Bs/USD'],
    ];

    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      body: summaryRows,
      theme: 'plain',
      styles: { fontSize: 11, cellPadding: 6 },
      columnStyles: {
        0: { cellWidth: 220, textColor: [110, 110, 110] },
        1: { fontStyle: 'bold', halign: 'right' },
      },
    });
    y = (doc as any).lastAutoTable.finalY + 20;

    // ── Risk metrics ────────────────────────────────────────────────────────
    if (snap.metrics) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text('Métricas de Riesgo', M, y);
      y += 8;

      const m = snap.metrics;
      const rows: any[][] = [];
      if (m.sharpe != null)               rows.push(['Sharpe Ratio', fmt_(m.sharpe)]);
      if (m.volatility_annual_pct != null) rows.push(['Volatilidad anualizada', fmt_(m.volatility_annual_pct) + '%']);
      if (m.var_95 != null)               rows.push(['VaR 95%', fmt_(m.var_95) + '%']);
      if (m.cvar_95 != null)              rows.push(['CVaR 95% (Expected Shortfall)', fmt_(m.cvar_95) + '%']);
      if (m.max_drawdown_pct != null)     rows.push(['Max Drawdown', fmt_(m.max_drawdown_pct) + '%']);
      if (m.intraday_pnl_usd != null)     rows.push(['P&L Intraday (USD)', fmt$(m.intraday_pnl_usd)]);
      if (m.intraday_pnl_pct != null)     rows.push(['P&L Intraday (%)', fmt_(m.intraday_pnl_pct) + '%']);
      if (m.concentration_index != null)  rows.push(['Concentración Top-2', fmt_(m.concentration_index) + '%']);

      if (rows.length) {
        autoTable(doc, {
          startY: y + 6,
          margin: { left: M, right: M },
          body: rows,
          theme: 'plain',
          styles: { fontSize: 11, cellPadding: 6 },
          columnStyles: {
            0: { cellWidth: 260, textColor: [110, 110, 110] },
            1: { fontStyle: 'bold', halign: 'right' },
          },
        });
        y = (doc as any).lastAutoTable.finalY + 20;
      }
    }

    // ── Positions table ─────────────────────────────────────────────────────
    if (snap.positions.length) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text('Posiciones Activas', M, y);
      y += 6;

      autoTable(doc, {
        startY: y + 6,
        margin: { left: M, right: M },
        head: [['Símbolo', 'Empresa', 'Cant.', 'Costo prom.', 'Precio actual', 'Valor', 'P&L', 'P&L %']],
        body: snap.positions.map(p => [
          p.symbol,
          p.name || '—',
          p.quantity.toLocaleString(),
          fmt$(p.avg_price_usd),
          fmt$(p.current_price_usd),
          fmt$(p.value_usd),
          fmt$(p.pnl_usd),
          (p.pnl_pct >= 0 ? '+' : '') + fmt_(p.pnl_pct) + '%',
        ]),
        theme: 'striped',
        headStyles: { fillColor: [76, 98, 255], textColor: 255, fontSize: 10 },
        bodyStyles: { fontSize: 9 },
        columnStyles: {
          0: { fontStyle: 'bold' },
          2: { halign: 'right' },
          3: { halign: 'right' }, 4: { halign: 'right' },
          5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' },
        },
        didParseCell: (data) => {
          if (data.section === 'body' && (data.column.index === 6 || data.column.index === 7)) {
            const raw = String(data.cell.raw ?? '');
            if (raw.includes('-') && raw !== '-') data.cell.styles.textColor = [192, 57, 43];
            else if (raw.startsWith('+'))        data.cell.styles.textColor = [40, 180, 99];
          }
        },
      });
      y = (doc as any).lastAutoTable.finalY + 20;
    }

    // ── Footer ──────────────────────────────────────────────────────────────
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(9);
      doc.setTextColor(150, 150, 150);
      const H = doc.internal.pageSize.getHeight();
      doc.text('caracasportafolio.com — generado automáticamente', M, H - 20);
      doc.text(`${i} / ${pageCount}`, W - M, H - 20, { align: 'right' });
    }

    const ts = snap.generated_at.toISOString().slice(0, 10);
    doc.save(`portafolio-${ts}.pdf`);
  }
}
