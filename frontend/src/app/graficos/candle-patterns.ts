/**
 * Algorithmic candlestick pattern detection.
 * Pure functions — no DOM, no chart-library coupling.
 *
 * Each detector returns `null` if no pattern at index `i`,
 * otherwise a `Pattern` ready to be turned into a Lightweight-Charts marker.
 */

export interface BasicCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type PatternKind =
  | 'THREE_WHITE_SOLDIERS'
  | 'THREE_BLACK_CROWS'
  | 'MORNING_STAR'
  | 'EVENING_STAR'
  | 'BULLISH_ENGULFING'
  | 'BEARISH_ENGULFING'
  | 'HAMMER'
  | 'SHOOTING_STAR'
  | 'DOJI';

export interface Pattern {
  index: number;
  time: string;
  kind: PatternKind;
  bias: 'bullish' | 'bearish' | 'neutral';
  label: string;
  description: string;
}

const body  = (c: BasicCandle) => Math.abs(c.close - c.open);
const range = (c: BasicCandle) => Math.max(c.high - c.low, 1e-9);
const isBull = (c: BasicCandle) => c.close > c.open;
const isBear = (c: BasicCandle) => c.close < c.open;
const upperWick = (c: BasicCandle) => c.high - Math.max(c.open, c.close);
const lowerWick = (c: BasicCandle) => Math.min(c.open, c.close) - c.low;

// ─────────────────────────────────────────────────────────────────────────────

function threeWhiteSoldiers(cs: BasicCandle[], i: number): Pattern | null {
  if (i < 2) return null;
  const a = cs[i - 2], b = cs[i - 1], c = cs[i];
  if (!isBull(a) || !isBull(b) || !isBull(c)) return null;
  if (!(b.open > a.open && b.open < a.close)) return null;
  if (!(c.open > b.open && c.open < b.close)) return null;
  if (!(b.close > a.close && c.close > b.close)) return null;
  // bodies should be substantial (>50% of range)
  if (body(a) / range(a) < 0.5) return null;
  if (body(b) / range(b) < 0.5) return null;
  if (body(c) / range(c) < 0.5) return null;
  return {
    index: i, time: c.time, kind: 'THREE_WHITE_SOLDIERS', bias: 'bullish',
    label: '3 Soldados',
    description: 'Tres velas alcistas consecutivas con cuerpos sólidos — reversión alcista fuerte.',
  };
}

function threeBlackCrows(cs: BasicCandle[], i: number): Pattern | null {
  if (i < 2) return null;
  const a = cs[i - 2], b = cs[i - 1], c = cs[i];
  if (!isBear(a) || !isBear(b) || !isBear(c)) return null;
  if (!(b.open < a.open && b.open > a.close)) return null;
  if (!(c.open < b.open && c.open > b.close)) return null;
  if (!(b.close < a.close && c.close < b.close)) return null;
  if (body(a) / range(a) < 0.5) return null;
  if (body(b) / range(b) < 0.5) return null;
  if (body(c) / range(c) < 0.5) return null;
  return {
    index: i, time: c.time, kind: 'THREE_BLACK_CROWS', bias: 'bearish',
    label: '3 Cuervos',
    description: 'Tres velas bajistas consecutivas con cuerpos sólidos — reversión bajista fuerte.',
  };
}

function morningStar(cs: BasicCandle[], i: number): Pattern | null {
  if (i < 2) return null;
  const a = cs[i - 2], b = cs[i - 1], c = cs[i];
  if (!isBear(a)) return null;
  if (body(a) / range(a) < 0.5) return null;        // long bear body
  if (body(b) / range(b) > 0.35) return null;       // small body (star)
  if (Math.max(b.open, b.close) >= a.close + body(a) * 0.1) return null; // gap-down
  if (!isBull(c)) return null;
  // c closes well into a's body
  const aMid = (a.open + a.close) / 2;
  if (c.close < aMid) return null;
  return {
    index: i, time: c.time, kind: 'MORNING_STAR', bias: 'bullish',
    label: 'Estrella del Amanecer',
    description: 'Reversión alcista de 3 velas tras tendencia bajista.',
  };
}

function eveningStar(cs: BasicCandle[], i: number): Pattern | null {
  if (i < 2) return null;
  const a = cs[i - 2], b = cs[i - 1], c = cs[i];
  if (!isBull(a)) return null;
  if (body(a) / range(a) < 0.5) return null;
  if (body(b) / range(b) > 0.35) return null;
  if (Math.min(b.open, b.close) <= a.close - body(a) * 0.1) return null; // gap-up
  if (!isBear(c)) return null;
  const aMid = (a.open + a.close) / 2;
  if (c.close > aMid) return null;
  return {
    index: i, time: c.time, kind: 'EVENING_STAR', bias: 'bearish',
    label: 'Estrella del Atardecer',
    description: 'Reversión bajista de 3 velas tras tendencia alcista.',
  };
}

function bullishEngulfing(cs: BasicCandle[], i: number): Pattern | null {
  if (i < 1) return null;
  const a = cs[i - 1], b = cs[i];
  if (!isBear(a) || !isBull(b)) return null;
  if (b.open > a.close) return null;          // open ≤ prior close
  if (b.close < a.open) return null;          // close ≥ prior open
  if (body(b) <= body(a)) return null;        // strictly engulfs
  return {
    index: i, time: b.time, kind: 'BULLISH_ENGULFING', bias: 'bullish',
    label: 'Envolvente Alcista',
    description: 'Vela alcista envuelve por completo a la bajista anterior.',
  };
}

function bearishEngulfing(cs: BasicCandle[], i: number): Pattern | null {
  if (i < 1) return null;
  const a = cs[i - 1], b = cs[i];
  if (!isBull(a) || !isBear(b)) return null;
  if (b.open < a.close) return null;
  if (b.close > a.open) return null;
  if (body(b) <= body(a)) return null;
  return {
    index: i, time: b.time, kind: 'BEARISH_ENGULFING', bias: 'bearish',
    label: 'Envolvente Bajista',
    description: 'Vela bajista envuelve por completo a la alcista anterior.',
  };
}

function hammer(cs: BasicCandle[], i: number): Pattern | null {
  const c = cs[i];
  const r = range(c), b = body(c);
  if (b / r > 0.35) return null;
  if (lowerWick(c) < b * 2) return null;
  if (upperWick(c) > b * 0.5) return null;
  return {
    index: i, time: c.time, kind: 'HAMMER', bias: 'bullish',
    label: 'Martillo',
    description: 'Mecha inferior larga — rechazo de precios bajos, reversión alcista probable.',
  };
}

function shootingStar(cs: BasicCandle[], i: number): Pattern | null {
  const c = cs[i];
  const r = range(c), b = body(c);
  if (b / r > 0.35) return null;
  if (upperWick(c) < b * 2) return null;
  if (lowerWick(c) > b * 0.5) return null;
  return {
    index: i, time: c.time, kind: 'SHOOTING_STAR', bias: 'bearish',
    label: 'Estrella Fugaz',
    description: 'Mecha superior larga — rechazo de precios altos, reversión bajista probable.',
  };
}

function doji(cs: BasicCandle[], i: number): Pattern | null {
  const c = cs[i];
  const r = range(c);
  if (r <= 0) return null;
  if (body(c) / r > 0.05) return null;
  return {
    index: i, time: c.time, kind: 'DOJI', bias: 'neutral',
    label: 'Doji',
    description: 'Apertura ≈ cierre — indecisión del mercado.',
  };
}

const DETECTORS = [
  threeWhiteSoldiers, threeBlackCrows,
  morningStar, eveningStar,
  bullishEngulfing, bearishEngulfing,
  hammer, shootingStar,
  doji,
];

/**
 * Scans the candle array and returns every pattern detected.
 * Multi-bar patterns return at the index of their LAST candle.
 */
export function detectPatterns(candles: BasicCandle[]): Pattern[] {
  const found: Pattern[] = [];
  for (let i = 0; i < candles.length; i++) {
    for (const det of DETECTORS) {
      const p = det(candles, i);
      if (p) { found.push(p); break; }   // first match per candle wins
    }
  }
  return found;
}

/**
 * Convert detected patterns into Lightweight-Charts marker objects.
 * Caller passes them directly to `series.setMarkers(...)`.
 */
export function patternsToMarkers(patterns: Pattern[]) {
  return patterns.map(p => ({
    time: p.time,
    position: p.bias === 'bullish' ? 'belowBar' : (p.bias === 'bearish' ? 'aboveBar' : 'inBar'),
    color:   p.bias === 'bullish' ? '#26a641' : (p.bias === 'bearish' ? '#f85149' : '#d29922'),
    shape:   p.bias === 'bullish' ? 'arrowUp' : (p.bias === 'bearish' ? 'arrowDown' : 'circle'),
    text:    p.label,
    size:    1,
  }));
}
