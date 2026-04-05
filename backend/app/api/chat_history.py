from fastapi import APIRouter, Depends, HTTPException, Header, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from app.database import get_db
from app.models.chat import ChatSession, ChatMessage
from app.models.transaction import Transaction
from app.models.stock import Stock
from app.models.portfolio import PortfolioPosition
from app.models.user_profile import UserProfile
from app.utils.security import decode_token
from app.schemas.chat import (
    ChatSessionCreate,
    ChatSessionResponse,
    ChatMessageResponse,
    ChatRequest,
    ChatMessageCreate
)
from uuid import UUID
from typing import List, Optional, Dict, Any
import google.generativeai as genai
from app.config import settings
import logging
from datetime import datetime

router = APIRouter()
logger = logging.getLogger(__name__)


# ==================== AUTH ====================

async def get_current_user_id(authorization: str = Header(...)) -> UUID:
    """Obtener ID del usuario desde el token JWT"""
    try:
        if not authorization:
            raise HTTPException(status_code=401, detail="Token no proporcionado")
        token = authorization.replace("Bearer ", "")
        payload = decode_token(token)
        if not payload or not payload.get("sub"):
            raise HTTPException(status_code=401, detail="Token inválido")
        return UUID(payload.get("sub"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error decoding token: {e}")
        raise HTTPException(status_code=401, detail="Token inválido o expirado")


def get_gemini_model():
    """Obtener modelo de Gemini disponible con fallback"""
    models_to_try = [
        settings.gemini_model,
        'gemini-1.5-flash',
        'gemini-1.0-pro',
        'gemini-pro'
    ]
    for model_name in models_to_try:
        try:
            model = genai.GenerativeModel(model_name)
            logger.info(f"✅ Using model: {model_name}")
            return model, model_name
        except Exception as e:
            logger.warning(f"⚠️ Model {model_name} not available: {e}")
            continue
    raise Exception("No se pudo conectar con ningún modelo de Gemini")


# ==================== CONSTRUCTOR DE CONTEXTO TÉCNICO ====================

def _build_indicator_history(ind: Dict[str, Any]) -> str:
    """
    Construye un bloque de texto con el RECORRIDO COMPLETO de cada indicador
    activo que tenga historial. Incluye TODOS los indicadores:
    RSI, EMA20/50/200, MACD, Volumen, Bollinger, VWAP, S/R,
    OBV, A/D, Aroon, ADX, Chaikin, ATR%, DMI, Stoch, MFI, Ichimoku.
    """
    sections: List[str] = []

    # ── RSI ─────────────────────────────────────────────────────────────────
    rsi_hist = ind.get('rsiHistory') or []
    if len(rsi_hist) >= 3:
        values = [p['value'] for p in rsi_hist]
        times  = [p.get('time', f'T{i}') for i, p in enumerate(rsi_hist)]
        n = len(values)
        rsi_max   = max(values)
        rsi_min   = min(values)
        idx_max   = values.index(rsi_max)
        idx_min   = values.index(rsi_min)
        rsi_start = values[0]
        rsi_end   = values[-1]
        delta     = rsi_end - rsi_start
        speed     = abs(delta / max(n - 1, 1))

        zone_events = []
        for i in range(1, n):
            pv, cv = values[i-1], values[i]
            t = times[i]
            if pv < 70 <= cv:
                zone_events.append(f"entró a sobrecompra (>70) en {t}")
            elif pv >= 70 > cv:
                zone_events.append(f"salió de sobrecompra en {t}")
            if pv > 30 >= cv:
                zone_events.append(f"entró a sobreventa (<30) en {t}")
            elif pv <= 30 < cv:
                zone_events.append(f"salió de sobreventa en {t}")

        curr_rsi = ind.get('rsi14') or rsi_end
        if curr_rsi > 70:   estado = f"⚠️ SOBRECOMPRADO ({curr_rsi:.1f})"
        elif curr_rsi < 30: estado = f"⚠️ SOBREVENDIDO ({curr_rsi:.1f})"
        else:               estado = f"{'zona alcista' if curr_rsi > 50 else 'zona bajista' if curr_rsi < 50 else 'neutral'} ({curr_rsi:.1f})"

        block = [f"📊 RSI(14) — RECORRIDO ({n} períodos):"]
        block.append(f"  • Inicio: {rsi_start:.1f}  →  Fin: {rsi_end:.1f}  (Δ {'+' if delta>=0 else ''}{delta:.1f})")
        block.append(f"  • Máximo: {rsi_max:.1f} (período {idx_max+1}) | Mínimo: {rsi_min:.1f} (período {idx_min+1})")
        block.append(f"  • Velocidad de cambio: {speed:.2f} pts/período")
        if zone_events:
            block.append(f"  • Cruces de zona: {'; '.join(zone_events)}")
        block.append(f"  • Estado actual: {estado}")
        sections.append("\n".join(block))

    elif ind.get('rsi14') is not None:
        rsi = ind['rsi14']
        label = "⚠️ SOBRECOMPRADO" if rsi > 70 else "⚠️ SOBREVENDIDO" if rsi < 30 else "neutral"
        slope = ind.get('rsi_slope', 0) or 0
        slope_txt = " (↑ subiendo)" if slope > 0 else " (↓ bajando)" if slope < 0 else ""
        sections.append(f"📊 RSI(14): {rsi:.2f} → {label}{slope_txt}")

    # ── EMA20 ────────────────────────────────────────────────────────────────
    ema20_hist = ind.get('ema20History') or []
    if len(ema20_hist) >= 3:
        values = [p['value'] for p in ema20_hist]
        n      = len(values)
        start, end = values[0], values[-1]
        pct = (end - start) / start * 100 if start else 0
        recent = values[-5:]
        slope_recent = (recent[-1] - recent[0]) / max(len(recent)-1, 1)

        block = [f"📈 EMA20 — RECORRIDO ({n} períodos):"]
        block.append(f"  • Inicio: {start:.2f}  →  Fin: {end:.2f}  ({'+' if pct>=0 else ''}{pct:.1f}%)")
        block.append(f"  • Pendiente reciente (últimos {len(recent)} p.): {'+' if slope_recent>=0 else ''}{slope_recent:.3f} por período")
        price = ind.get('lastPrice', 0) or 0
        if price:
            dist = (price - end) / end * 100 if end else 0
            block.append(f"  • Precio actual {'+' if dist>=0 else ''}{dist:.1f}% vs EMA20")
        sections.append("\n".join(block))

    elif ind.get('ema20'):
        sections.append(f"📈 EMA20: {ind['ema20']:.2f}")

    # ── EMA50 ────────────────────────────────────────────────────────────────
    ema50_hist = ind.get('ema50History') or []
    if len(ema50_hist) >= 3:
        values = [p['value'] for p in ema50_hist]
        n      = len(values)
        start, end = values[0], values[-1]
        pct = (end - start) / start * 100 if start else 0

        block = [f"📉 EMA50 — RECORRIDO ({n} períodos):"]
        block.append(f"  • Inicio: {start:.2f}  →  Fin: {end:.2f}  ({'+' if pct>=0 else ''}{pct:.1f}%)")
        ema20_cur = ind.get('ema20')
        if ema20_cur:
            cross_label = "EMA20 SOBRE EMA50 → alcista" if ema20_cur > end else "EMA20 BAJO EMA50 → bajista"
            block.append(f"  • Cruce actual: {cross_label}")
        if ind.get('golden_cross'):
            block.append(f"  • ⭐ GOLDEN CROSS detectado en el período")
        if ind.get('death_cross'):
            block.append(f"  • 💀 DEATH CROSS detectado en el período")
        sections.append("\n".join(block))

    elif ind.get('ema50'):
        ema20 = ind.get('ema20', 0) or 0
        ema50 = ind['ema50']
        cross = "📈 ALCISTA" if ema20 > ema50 else "📉 BAJISTA"
        sections.append(f"📉 EMA50: {ema50:.2f} | Cruce EMA20/50: {cross}")

    # ── EMA200 ───────────────────────────────────────────────────────────────
    if ind.get('ema200'):
        price = ind.get('lastPrice', 0) or 0
        pos = "✅ precio SOBRE EMA200 (tendencia alcista de largo plazo)" \
              if price > ind['ema200'] \
              else "⚠️ precio BAJO EMA200 (tendencia bajista de largo plazo)"
        sections.append(f"🎯 EMA200: {ind['ema200']:.2f} → {pos}")

    # ── MACD ─────────────────────────────────────────────────────────────────
    macd_hist = ind.get('macdHistory') or []
    if len(macd_hist) >= 3:
        values = [p['value'] for p in macd_hist]
        times  = [p.get('time', f'T{i}') for i, p in enumerate(macd_hist)]
        n      = len(values)
        start, end = values[0], values[-1]

        zero_events = []
        for i in range(1, n):
            pv, cv = values[i-1], values[i]
            t = times[i]
            if pv < 0 <= cv:
                zero_events.append(f"cruce alcista de cero en {t}")
            elif pv >= 0 > cv:
                zero_events.append(f"cruce bajista de cero en {t}")

        block = [f"🔄 MACD — RECORRIDO ({n} períodos):"]
        block.append(f"  • Inicio: {start:.4f}  →  Fin: {end:.4f}")
        if zero_events:
            block.append(f"  • Cruces de línea cero: {'; '.join(zero_events)}")
        else:
            side = "positivo (alcista)" if end > 0 else "negativo (bajista)"
            block.append(f"  • Permaneció en territorio {side} durante todo el período")
        hist_val  = ind.get('macd_hist', 0) or 0
        cross_lbl = ind.get('macd_cross', '')
        mom       = ind.get('macd_momentum', '')
        block.append(f"  • Histograma actual: {hist_val:.4f} ({'↑ creciendo' if hist_val > 0 else '↓ decreciendo'})")
        if cross_lbl:
            block.append(f"  • Cruce señal: {'📈 MACD sobre señal' if 'SOBRE' in cross_lbl else '📉 MACD bajo señal'}")
        if mom:
            block.append(f"  • Momentum: {mom}")
        sections.append("\n".join(block))

    elif ind.get('macd') is not None:
        macd_v = ind['macd']
        sig    = ind.get('macd_signal', 0) or 0
        hist_v = ind.get('macd_hist', 0) or 0
        sections.append(
            f"🔄 MACD: {macd_v:.4f} | Signal: {sig:.4f} | "
            f"Hist: {hist_v:.4f} ({'alcista' if hist_v > 0 else 'bajista'})"
        )

    # ── Volumen ──────────────────────────────────────────────────────────────
    vol_hist = ind.get('volumeHistory') or []
    if len(vol_hist) >= 3:
        values = [p['value'] for p in vol_hist]
        n      = len(values)
        vol_avg = sum(values) / n
        vol_max = max(values)
        vol_min = min(values)
        vol_cur = values[-1]
        pct_vs_avg = (vol_cur - vol_avg) / vol_avg * 100 if vol_avg else 0
        spikes = [i+1 for i, v in enumerate(values) if v > vol_avg * 2]

        block = [f"🔊 VOLUMEN — RECORRIDO ({n} períodos):"]
        block.append(f"  • Promedio del período: {vol_avg:,.0f}")
        block.append(f"  • Máximo: {vol_max:,.0f} | Mínimo: {vol_min:,.0f}")
        block.append(f"  • Volumen actual: {vol_cur:,.0f} ({'+' if pct_vs_avg>=0 else ''}{pct_vs_avg:.1f}% vs promedio)")
        if spikes:
            block.append(f"  • Picos >2x promedio en períodos: {', '.join(map(str, spikes))}")
        block.append(f"  • Status: {ind.get('volume_status', 'N/A')} | Ratio: {ind.get('volume_ratio', 1):.2f}x")
        sections.append("\n".join(block))

    elif ind.get('volume_ratio') is not None:
        ratio  = ind['volume_ratio']
        status = ind.get('volume_status', 'NORMAL')
        lbl    = "↑ ALTO" if ratio > 1.5 else "↓ BAJO" if ratio < 0.5 else "→ NORMAL"
        sections.append(f"🔊 Volumen: {ind.get('volume_current', 0):,.0f} | Ratio: {ratio:.2f}x → {lbl} ({status})")

    # ── Bollinger Bands ──────────────────────────────────────────────────────
    if ind.get('bb_upper') and ind.get('bb_lower') and ind.get('bb_middle'):
        bb_u  = ind['bb_upper']
        bb_m  = ind['bb_middle']
        bb_l  = ind['bb_lower']
        bb_w  = ind.get('bb_width', 0) or 0
        bb_pos = ind.get('bb_position', 'N/A')
        price  = ind.get('lastPrice', 0) or 0

        if bb_w < 3:    width_label = "MUY ESTRECHO → baja volatilidad, posible explosión de precio"
        elif bb_w < 6:  width_label = "estrecho → volatilidad comprimida"
        elif bb_w > 15: width_label = "AMPLIO → alta volatilidad"
        else:           width_label = "normal"

        block = [f"🔷 BOLLINGER BANDS:"]
        block.append(f"  • Superior: {bb_u:.2f} | Media: {bb_m:.2f} | Inferior: {bb_l:.2f}")
        block.append(f"  • Ancho de banda: {bb_w:.1f}% → {width_label}")
        block.append(f"  • Posición del precio: {bb_pos}")
        if price:
            dist_u = (price - bb_u) / bb_u * 100 if bb_u else 0
            dist_l = (price - bb_l) / bb_l * 100 if bb_l else 0
            block.append(
                f"  • Precio {'+' if dist_u>=0 else ''}{dist_u:.1f}% vs banda superior | "
                f"{'+' if dist_l>=0 else ''}{dist_l:.1f}% vs banda inferior"
            )
        sections.append("\n".join(block))

    # ── VWAP ─────────────────────────────────────────────────────────────────
    if ind.get('vwap') is not None:
        vwap  = ind['vwap']
        price = ind.get('lastPrice', 0) or 0
        pos   = "✅ SOBRE VWAP (compradores en control)" \
                if price > vwap else "⚠️ BAJO VWAP (vendedores en control)"
        pct   = (price - vwap) / vwap * 100 if vwap else 0
        sections.append(
            f"📍 VWAP: {vwap:.2f} | Precio: {price:.2f} → {pos} ({'+' if pct>=0 else ''}{pct:.1f}%)"
        )

    # ── Soporte / Resistencia ────────────────────────────────────────────────
    if ind.get('support20') and ind.get('resistance20'):
        sup  = ind['support20']
        res  = ind['resistance20']
        price = ind.get('lastPrice', 0) or 0
        rng  = res - sup
        block = [f"🎯 SOPORTE / RESISTENCIA (20 períodos):"]
        block.append(f"  • Soporte: {sup:.2f} Bs | Resistencia: {res:.2f} Bs | Rango: {rng:.2f} Bs")
        if price and rng > 0:
            pos_rng = (price - sup) / rng * 100
            block.append(
                f"  • Precio en {pos_rng:.1f}% del rango (0% = soporte, 100% = resistencia)"
            )
        sections.append("\n".join(block))

    # ── Golden / Death Cross ─────────────────────────────────────────────────
    if ind.get('golden_cross'):
        sections.append("⭐ GOLDEN CROSS: EMA20 cruzó sobre EMA50 → señal alcista fuerte")
    if ind.get('death_cross'):
        sections.append("💀 DEATH CROSS: EMA20 cruzó bajo EMA50 → señal bajista fuerte")

    # ========== NUEVOS INDICADORES (OBV, A/D, Aroon, ADX, Chaikin, ATR%, DMI, Stoch, MFI, Ichimoku) ==========

    # ── OBV ─────────────────────────────────────────────────────────────────
    if ind.get('obv') is not None:
        obv = ind['obv']
        sections.append(f"📊 OBV (On‑Balance Volume): {obv:,.0f} – {'alcista (subiendo)' if obv > 0 else 'bajista (bajando)'}")

    # ── A/D (Accumulation/Distribution) ─────────────────────────────────────
    if ind.get('adl') is not None:
        adl = ind['adl']
        sections.append(f"💰 A/D Line: {adl:,.0f} – {'acumulación' if adl > 0 else 'distribución'}")

    # ── Aroon (up/down) ─────────────────────────────────────────────────────
    if ind.get('aroon_up') is not None and ind.get('aroon_down') is not None:
        up = ind['aroon_up']
        down = ind['aroon_down']
        if up >= 70 and down < 30:
            interp = "🚀 FUERTE ALCISTA (nuevos máximos)"
        elif down >= 70 and up < 30:
            interp = "🪂 FUERTE BAJISTA (nuevos mínimos)"
        else:
            interp = "⟷ SIN TENDENCIA CLARA"
        sections.append(f"📈 Aroon(25): Up={up:.1f}% / Down={down:.1f}% → {interp}")

    # ── ADX ─────────────────────────────────────────────────────────────────
    if ind.get('adx') is not None:
        adx = ind['adx']
        if adx > 25:
            interp = "TENDENCIA FUERTE"
        elif adx < 15:
            interp = "SIN TENDENCIA (rango)"
        else:
            interp = "TENDENCIA DÉBIL"
        sections.append(f"📉 ADX: {adx:.1f} → {interp}")

    # ── Chaikin Oscillator ─────────────────────────────────────────────────
    if ind.get('chaikin') is not None:
        chaikin = ind['chaikin']
        sections.append(f"🔄 Chaikin Osc: {chaikin:,.2f} – {'presión compradora' if chaikin > 0 else 'presión vendedora'}")

    # ── ATR% ────────────────────────────────────────────────────────────────
    if ind.get('atr_percent') is not None:
        atr_pct = ind['atr_percent']
        if atr_pct > 5:
            interp = "ALTA VOLATILIDAD"
        elif atr_pct < 2:
            interp = "BAJA VOLATILIDAD"
        else:
            interp = "VOLATILIDAD MODERADA"
        sections.append(f"⚠️ ATR%: {atr_pct:.2f}% → {interp}")

    # ── DMI (Dynamic Momentum Index) ────────────────────────────────────────
    if ind.get('dmi') is not None:
        dmi = ind['dmi']
        sections.append(f"⚡ DMI: {dmi:.1f} – {'sobre 50 → momentum alcista' if dmi > 50 else 'bajo 50 → momentum bajista'}")

    # ── Stochastic %K ───────────────────────────────────────────────────────
    if ind.get('stoch_k') is not None:
        stoch = ind['stoch_k']
        if stoch > 80:
            interp = "⚠️ SOBRECOMPRA"
        elif stoch < 20:
            interp = "⚠️ SOBREVENTA"
        else:
            interp = "NEUTRAL"
        sections.append(f"📊 Stoch %K: {stoch:.1f}% → {interp}")

    # ── MFI (Money Flow Index) ──────────────────────────────────────────────
    if ind.get('mfi') is not None:
        mfi = ind['mfi']
        if mfi > 80:
            interp = "DISTRIBUCIÓN (sobrecompra)"
        elif mfi < 20:
            interp = "ACUMULACIÓN (sobreventa)"
        else:
            interp = "NEUTRAL"
        sections.append(f"💵 MFI: {mfi:.1f} → {interp}")

    # ── Ichimoku Cloud (valores actuales) ───────────────────────────────────
    if ind.get('ichimoku_tenkan') is not None and ind.get('ichimoku_kijun') is not None:
        tenkan = ind['ichimoku_tenkan']
        kijun  = ind['ichimoku_kijun']
        span_a = ind.get('ichimoku_span_a')
        price = ind.get('lastPrice', 0)
        if price > tenkan and price > kijun:
            signal = "ALCISTA"
        elif price < tenkan and price < kijun:
            signal = "BAJISTA"
        else:
            signal = "NEUTRAL"
        sections.append(f"☁️ Ichimoku: Tenkan={tenkan:.2f}, Kijun={kijun:.2f} → señal {signal}")

    return "\n\n".join(sections) if sections else "(Sin datos de indicadores disponibles)"


def build_chart_context_prompt(ctx: dict, user_message: str, order_book: List[Dict] = None, profile_data: Dict[str, Any] = None) -> str:
    """
    Construye el prompt completo para análisis técnico del gráfico.
    Incluye precio, velas recientes, recorrido de todos los indicadores
    activos, libro de órdenes, perfil del inversor y las instrucciones de análisis para la IA.
    """
    ind   = ctx.get('indicators') or {}
    price = 0.0

    if ctx.get('lastCandle'):
        price = ctx['lastCandle'].get('close', 0)
        ind['lastPrice'] = price

    # ── Cabecera ────────────────────────────────────────────────────────────
    lines = [
        f"📊 ACCIÓN: {ctx['symbol']} ({ctx.get('name', 'N/A')})",
        f"🕒 Período: {ctx.get('timeframe', 'Todo')} | Tipo: {ctx.get('chartType', 'candlestick')}",
        f"📈 Velas totales: {ctx.get('totalCandles', 0)}",
    ]

    if ctx.get('lastCandle'):
        c    = ctx['lastCandle']
        chg  = ctx.get('priceChange', 0) or 0
        pct  = ctx.get('priceChangePct', 0) or 0
        sign = '+' if chg >= 0 else ''
        em   = "📈" if chg >= 0 else "📉"
        lines.append(
            f"💰 Precio actual: {c.get('close', 0):.2f} Bs  "
            f"{sign}{chg:.2f} ({sign}{pct:.2f}%) {em}"
        )

    # ── Tasa BCV / precio en USD ─────────────────────────────────────────────
    usd_rate = ctx.get('usd_rate') or 0
    if usd_rate and usd_rate > 0 and price > 0:
        usd_price = price / usd_rate
        lines.append(f"💱 Tasa BCV: {usd_rate:.2f} Bs/USD → Precio ≈ ${usd_price:.4f} USD")

    trend = ind.get('trend', '')
    if trend:
        emoji = {"ALCISTA_FUERTE":"🚀","ALCISTA":"📈","BAJISTA_FUERTE":"🪂","BAJISTA":"📉"}.get(trend, "➡️")
        lines.append(f"🧭 Tendencia general: {emoji} {trend}")

    # ── Últimas 5 velas ──────────────────────────────────────────────────────
    recent = ctx.get('recentCandles') or []
    if len(recent) >= 2:
        lines.append("\n🕯 Últimas 5 velas:")
        for c in recent[-5:]:
            color = "🟢" if c.get('close', 0) >= c.get('open', 0) else "🔴"
            lines.append(
                f"   {color} {c.get('time','')}  "
                f"O:{c.get('open',0):.2f}  H:{c.get('high',0):.2f}  "
                f"L:{c.get('low',0):.2f}  C:{c.get('close',0):.2f}  "
                f"Vol:{c.get('volume',0):,.0f}"
            )

    # ── Bloque de indicadores ────────────────────────────────────────────────
    enabled_str = ind.get('enabled', 'no especificado')
    lines.append(f"\nIndicadores activos: {enabled_str}")
    lines.append("\n" + "═"*60)
    lines.append("RECORRIDO HISTÓRICO DE INDICADORES ACTIVOS")
    lines.append("═"*60)
    lines.append(_build_indicator_history(ind))
    lines.append("═"*60)

    # ── Libro de órdenes (si está disponible) ────────────────────────────────
    if order_book and len(order_book) > 0:
        lines.append("\n📘 LIBRO DE ÓRDENES (profundidad de mercado):")
        # Mostrar primeros 5 niveles de compra y venta
        for i, level in enumerate(order_book[:5]):
            lines.append(
                f"  Nivel {i+1}: Compra {level.get('buy_volume',0):,.0f} @ {level.get('buy_price',0):.2f}  |  "
                f"Venta {level.get('sell_volume',0):,.0f} @ {level.get('sell_price',0):.2f}"
            )
        total_buy_vol = sum(l.get('buy_volume',0) for l in order_book)
        total_sell_vol = sum(l.get('sell_volume',0) for l in order_book)
        if total_buy_vol + total_sell_vol > 0:
            imbalance = (total_buy_vol - total_sell_vol) / (total_buy_vol + total_sell_vol) * 100
            direccion = "presión compradora" if imbalance > 0 else "presión vendedora"
            lines.append(f"  Desbalance neto: {imbalance:+.1f}% → {direccion}")

    # ── Perfil del inversor ─────────────────────────────────────────────────
    profile_block = ""
    if profile_data:
        _rp  = profile_data.get('risk_profile', 'moderado')
        _th  = profile_data.get('time_horizon', 'mediano').replace('_', ' ')
        _ml  = profile_data.get('max_loss', 20)
        _er  = profile_data.get('expected_return', 20)
        _sec = ', '.join(profile_data.get('sectors', [])) or 'No especificados'
        _mg  = 'Sí' if profile_data.get('allows_margin') else 'No'
        profile_block = f"""
════════════════════════════════════════════════════════
PERFIL DEL INVERSOR
════════════════════════════════════════════════════════
• Perfil de riesgo: {_rp.upper()}
• Horizonte temporal: {_th}
• Tolerancia máx. de pérdida: {_ml}%
• Retorno esperado: {_er}%
• Sectores de interés: {_sec}
• Permite margen: {_mg}
════════════════════════════════════════════════════════
⚠️ TEN EN CUENTA EL PERFIL AL DAR RECOMENDACIONES:
- Un inversor {_rp} con horizonte {_th} y tolerancia {_ml}% debería recibir
  consejos acordes a su capacidad de riesgo.
- Al final incluye una nota breve de si esta acción encaja con el perfil.
════════════════════════════════════════════════════════"""

    context_block = "\n".join(lines)

    # ── Prompt final para la IA ──────────────────────────────────────────────
    prompt = f"""Eres un analista técnico experto en la Bolsa de Valores de Caracas (BVC).
Hablas en español venezolano, tono profesional pero accesible.
Cuando el precio está disponible en USD (tasa BCV incluida), menciona ambos precios (Bs y USD) para mayor claridad.

════════════════════════════════════════════════════════
DATOS TÉCNICOS COMPLETOS — {ctx['symbol']}
════════════════════════════════════════════════════════
{context_block}
════════════════════════════════════════════════════════{profile_block}

PREGUNTA DEL USUARIO: {user_message}

════════════════════════════════════════════════════════
INSTRUCCIONES DE ANÁLISIS
════════════════════════════════════════════════════════

1. **ANALIZA TODOS LOS INDICADORES** presentes en los datos de arriba.
   No omitas ninguno. Si un indicador no tiene historial, explica su valor actual.

2. **NARRA EL RECORRIDO** de cada indicador: cómo evolucionó en el período,
   no solo el valor final. Usa el estilo de estos ejemplos:
   - "El RSI pasó de 68 a 28 en 8 períodos, señal de fuerte caída hacia sobreventa"
   - "El MACD cruzó la línea cero a la baja en el período 5, confirmando momentum bajista"
   - "El volumen tuvo un pico de 3x el promedio en el período 4, coincidiendo con la vela roja mayor"
   - "Las bandas de Bollinger se estrecharon progresivamente, compresión previa a movimiento fuerte"

3. **CONECTA LOS INDICADORES** entre sí: indica cuándo varios confirman
   la misma señal o cuando hay divergencia (ej. precio sube pero RSI baja).

4. **SEÑALES CLAVE**: menciona cruces, toques de bandas, picos de volumen,
   divergencias precio/oscilador, golden/death cross, etc.

5. **LIBRO DE ÓRDENES**: si está disponible, analiza la profundidad, el desbalance
   y los niveles de soporte/resistencia implícitos.

6. **CONCLUSIÓN CLARA**: termina con COMPRAR / MANTENER / VENDER / ESPERAR,
   respaldado por al menos 3 indicadores distintos.

7. Usa **negritas** para valores clave. Organiza en secciones claras.
   Sin límite estricto de palabras — prioriza la completitud del análisis.

RESPUESTA:"""

    return prompt


# ==================== SESSIONES DE CHAT ====================

@router.get("/sessions", response_model=List[ChatSessionResponse])
async def get_chat_sessions(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
    limit: int = 50,
    offset: int = 0
):
    """Obtener todas las sesiones de chat del usuario"""
    try:
        query = (
            select(
                ChatSession,
                func.count(ChatMessage.id).label("message_count"),
                func.max(ChatMessage.content).label("last_message"),
                func.max(ChatMessage.created_at).label("last_message_at")
            )
            .outerjoin(ChatMessage, ChatSession.id == ChatMessage.session_id)
            .where(ChatSession.user_id == user_id)
            .group_by(ChatSession.id)
            .order_by(desc(ChatSession.updated_at))
            .offset(offset)
            .limit(limit)
        )
        result = await db.execute(query)
        sessions = result.all()

        response = []
        for session, message_count, last_message, last_message_at in sessions:
            response.append(ChatSessionResponse(
                id=session.id,
                user_id=str(session.user_id),
                title=session.title,
                chat_type=getattr(session, 'chat_type', 'general') or 'general',
                is_active=session.is_active,
                created_at=session.created_at,
                updated_at=session.updated_at,
                model_used=session.model_used,
                message_count=message_count or 0,
                last_message=last_message,
                last_message_at=last_message_at
            ))
        return response

    except Exception as e:
        logger.error(f"❌ Error getting chat sessions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sessions/{session_id}", response_model=ChatSessionResponse)
async def get_chat_session(
    session_id: int,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Obtener una sesión de chat específica"""
    try:
        result = await db.execute(
            select(ChatSession).where(
                ChatSession.id == session_id,
                ChatSession.user_id == user_id
            )
        )
        session = result.scalar_one_or_none()
        if not session:
            raise HTTPException(status_code=404, detail="Sesión de chat no encontrada")

        msg_count_res = await db.execute(
            select(func.count(ChatMessage.id)).where(ChatMessage.session_id == session_id)
        )
        message_count = msg_count_res.scalar() or 0

        last_msg_res = await db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(desc(ChatMessage.created_at))
            .limit(1)
        )
        last_msg = last_msg_res.scalar_one_or_none()

        return ChatSessionResponse(
            id=session.id,
            user_id=str(session.user_id),
            title=session.title,
            chat_type=getattr(session, 'chat_type', 'general') or 'general',
            is_active=session.is_active,
            created_at=session.created_at,
            updated_at=session.updated_at,
            model_used=session.model_used,
            message_count=message_count,
            last_message=last_msg.content if last_msg else None,
            last_message_at=last_msg.created_at if last_msg else None
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error getting chat session: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sessions", response_model=ChatSessionResponse)
async def create_chat_session(
    session_data: ChatSessionCreate,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Crear nueva sesión de chat"""
    try:
        chat_session = ChatSession(
            user_id=user_id,
            title=session_data.title,
            model_used=session_data.model_used,
            chat_type=session_data.chat_type or 'general'
        )
        db.add(chat_session)
        await db.commit()
        await db.refresh(chat_session)

        return ChatSessionResponse(
            id=chat_session.id,
            user_id=str(chat_session.user_id),
            title=chat_session.title,
            chat_type=getattr(chat_session, 'chat_type', 'general') or 'general',
            is_active=chat_session.is_active,
            created_at=chat_session.created_at,
            updated_at=chat_session.updated_at,
            model_used=chat_session.model_used,
            message_count=0
        )

    except Exception as e:
        await db.rollback()
        logger.error(f"❌ Error creating chat session: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/sessions/{session_id}")
async def delete_chat_session(
    session_id: int,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Eliminar una sesión de chat y todos sus mensajes"""
    try:
        result = await db.execute(
            select(ChatSession).where(
                ChatSession.id == session_id,
                ChatSession.user_id == user_id
            )
        )
        session = result.scalar_one_or_none()
        if not session:
            raise HTTPException(status_code=404, detail="Sesión de chat no encontrada")

        await db.delete(session)
        await db.commit()
        return {"message": "Sesión eliminada exitosamente", "session_id": session_id}

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"❌ Error deleting chat session: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/sessions/{session_id}/title")
async def update_chat_session_title(
    session_id: int,
    title_data: dict = Body(...),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Actualizar título de la sesión"""
    try:
        result = await db.execute(
            select(ChatSession).where(
                ChatSession.id == session_id,
                ChatSession.user_id == user_id
            )
        )
        session = result.scalar_one_or_none()
        if not session:
            raise HTTPException(status_code=404, detail="Sesión de chat no encontrada")

        session.title = title_data.get("title", "Nuevo Chat")
        await db.commit()
        return {"message": "Título actualizado", "title": session.title}

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"❌ Error updating session title: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== MENSAJES ====================

@router.get("/sessions/{session_id}/messages", response_model=List[ChatMessageResponse])
async def get_chat_messages(
    session_id: int,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
    limit: int = 100,
    offset: int = 0
):
    """Obtener todos los mensajes de una sesión"""
    try:
        session_result = await db.execute(
            select(ChatSession).where(
                ChatSession.id == session_id,
                ChatSession.user_id == user_id
            )
        )
        session = session_result.scalar_one_or_none()
        if not session:
            raise HTTPException(status_code=404, detail="Sesión de chat no encontrada")

        messages_result = await db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at.asc())
            .offset(offset)
            .limit(limit)
        )
        messages = messages_result.scalars().all()

        return [ChatMessageResponse(
            id=msg.id,
            session_id=msg.session_id,
            role=msg.role,
            content=msg.content,
            model_used=msg.model_used,
            tokens_used=msg.tokens_used,
            created_at=msg.created_at
        ) for msg in messages]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error getting chat messages: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== CHAT CON IA ====================

@router.post("/chat")
async def chat_with_ai(
    chat_data: ChatRequest,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Chat con IA.
    - Modo COMPARATIVO: si llega stocks_context con múltiples acciones
    - Modo GRÁFICO: si llega chart_context con symbol único
    - Modo GENERAL: usa portafolio y transacciones del usuario
    """
    try:
        genai.configure(api_key=settings.gemini_api_key)
        model, model_name = get_gemini_model()

        is_comparison_mode = (
            getattr(chat_data, 'comparison_mode', False) or
            (hasattr(chat_data, 'stocks_context') and 
             chat_data.stocks_context and 
             len(chat_data.stocks_context) >= 2)
        )

        # Obtener libro(s) de órdenes si están presentes en la request
        order_book  = getattr(chat_data, 'order_book',  None)   # modo individual
        order_books = getattr(chat_data, 'order_books', None)   # modo comparativo {symbol: entries}

        if is_comparison_mode:
            stocks_ctx = chat_data.stocks_context or []
            if len(stocks_ctx) < 2:
                return {
                    "response": "⚠️ Se necesitan al menos 2 acciones para comparar.",
                    "error": "insufficient_stocks"
                }
            logger.info(f"🔍 [CHAT-COMPARISON] Comparando {len(stocks_ctx)} acciones")
            prompt = build_comparison_prompt(stocks_ctx, chat_data.message, order_book, order_books)

        elif (hasattr(chat_data, 'chart_context') and
              chat_data.chart_context and
              isinstance(chat_data.chart_context, dict) and
              chat_data.chart_context.get('symbol')):
            ctx = chat_data.chart_context
            ind = ctx.get('indicators') or {}
            logger.info(
                f"📊 [CHAT-CHART] Históricos recibidos — "
                f"RSI:{len(ind.get('rsiHistory') or [])} "
                f"EMA20:{len(ind.get('ema20History') or [])} "
                f"EMA50:{len(ind.get('ema50History') or [])}"
            )
            # Fetch investment profile for this user
            profile_data = None
            try:
                prof_res = await db.execute(select(UserProfile).where(UserProfile.user_id == user_id))
                profile = prof_res.scalar_one_or_none()
                if profile:
                    profile_data = {
                        "risk_profile": getattr(profile, 'risk_profile', 'moderado'),
                        "time_horizon": getattr(profile, 'time_horizon', 'mediano_plazo'),
                        "max_loss": float(getattr(profile, 'max_loss_tolerance', 20) or 20),
                        "expected_return": float(getattr(profile, 'expected_return', 20) or 20),
                        "sectors": getattr(profile, 'preferred_sectors', []) or [],
                        "allows_margin": bool(getattr(profile, 'allows_margin_trading', False)),
                    }
            except Exception:
                pass
            prompt = build_chart_context_prompt(ctx, chat_data.message, order_book, profile_data)

        else:
            # Cargar datos comunes (perfil, portafolio, transacciones)
            chat_type = getattr(chat_data, 'chat_type', 'general') or 'general'

            # Resolver chat_type desde la sesión si no viene en la request
            if chat_type == 'general' and chat_data.session_id:
                try:
                    sess_res = await db.execute(
                        select(ChatSession).where(ChatSession.id == chat_data.session_id)
                    )
                    sess = sess_res.scalar_one_or_none()
                    if sess:
                        chat_type = getattr(sess, 'chat_type', 'general') or 'general'
                except Exception:
                    pass

            is_portfolio_mode = chat_type == 'portfolio'

            tx_limit = 20 if is_portfolio_mode else 5
            tx_result = await db.execute(
                select(Transaction)
                .where(Transaction.user_id == user_id)
                .order_by(desc(Transaction.transaction_date))
                .limit(tx_limit)
            )
            transactions = tx_result.scalars().all()

            # Load last 8 messages from session to keep conversation context
            session_history_ctx = ""
            if chat_data.session_id:
                try:
                    hist_res = await db.execute(
                        select(ChatMessage)
                        .where(ChatMessage.session_id == chat_data.session_id)
                        .order_by(desc(ChatMessage.created_at))
                        .limit(8)
                    )
                    hist_msgs = list(reversed(hist_res.scalars().all()))
                    if hist_msgs:
                        hist_lines = []
                        for msg in hist_msgs:
                            role_label = "Usuario" if msg.role == "user" else "Asistente"
                            hist_lines.append(f"{role_label}: {(msg.content or '')[:600]}")
                        session_history_ctx = (
                            "\n═══ CONVERSACIÓN ANTERIOR (contexto) ═══\n"
                            + "\n".join(hist_lines)
                            + "\n══════════════════════════════════════\n"
                        )
                except Exception:
                    pass

            pf_result = await db.execute(
                select(PortfolioPosition, Stock.symbol, Stock.name)
                .join(Stock, PortfolioPosition.stock_id == Stock.id, isouter=True)
                .where(PortfolioPosition.user_id == user_id)
                .where(PortfolioPosition.total_shares > 0)
            )
            positions_raw = pf_result.all()

            profile_result = await db.execute(
                select(UserProfile).where(UserProfile.user_id == user_id)
            )
            profile = profile_result.scalar_one_or_none()

            profile_ctx = ""
            profile_conclusion = ""
            if profile:
                _rp = getattr(profile.risk_profile, 'value', str(profile.risk_profile))
                _ig = getattr(profile.investment_goal, 'value', str(profile.investment_goal))
                _th = getattr(profile.time_horizon, 'value', str(profile.time_horizon))
                profile_ctx = f"""
═══ PERFIL DEL INVERSOR ═══
• Riesgo: {_rp.upper()}
• Objetivo: {_ig.replace('_', ' ')}
• Horizonte temporal: {_th.replace('_', ' ')}
• Experiencia: {profile.experience_level}/10
• Pérdida máx. tolerada: {profile.max_loss_tolerance}%
• Retorno anual esperado: {profile.expected_return}%
• Capital disponible: ${profile.available_capital:,.0f}
• Acciones volátiles: {'Permitidas' if getattr(profile, 'allows_volatile_stocks', True) else 'No permitidas'}
• Margen/Apalancamiento: {'Sí' if getattr(profile, 'allows_margin_trading', False) else 'No'}
• Sectores preferidos: {profile.preferred_sectors or 'No especificado'}
• Sectores evitados: {profile.avoided_sectors or 'Ninguno'}
• Reacción ante caída 20%: {getattr(profile, 'portfolio_drop_reaction', 'mantener')}
"""
                profile_conclusion = (
                    f"\n🎯 Al final incluye una sección 'Recomendación para perfil {_rp.upper()}' "
                    f"con una acción concreta (comprar/mantener/vender/diversificar) "
                    f"coherente con horizonte '{_th.replace('_',' ')}' y tolerancia {profile.max_loss_tolerance}% de pérdida."
                )

            if is_portfolio_mode:
                # Modo portafolio: contexto rico con P&L, transacciones detalladas
                pf_lines = []
                total_invested = 0.0
                total_current = 0.0
                for row in positions_raw:
                    pos = row[0]
                    sym = row[1] or str(pos.stock_id)
                    name = row[2] or sym
                    shares = float(pos.total_shares or 0)
                    avg_price = float(pos.avg_buy_price or 0)
                    curr_price = float(pos.current_price or avg_price)
                    invested = float(pos.total_invested_bs or (shares * avg_price))
                    current_val = float(pos.current_value_bs or (shares * curr_price))
                    unreal_pnl = float(pos.unrealized_pnl_bs or (current_val - invested))
                    unreal_pct = (unreal_pnl / invested * 100) if invested > 0 else 0
                    real_pnl = float(pos.realized_pnl_bs or 0)
                    total_invested += invested
                    total_current += current_val
                    sign = '+' if unreal_pct >= 0 else ''
                    pf_lines.append(
                        f"  📌 {sym} ({name[:25]}): {shares:,.0f} acc | Precio promedio: {avg_price:.2f} Bs | "
                        f"Precio actual: {curr_price:.2f} Bs | Invertido: {invested:,.2f} Bs | "
                        f"Valor actual: {current_val:,.2f} Bs | G/P no realizada: {sign}{unreal_pnl:,.2f} Bs ({sign}{unreal_pct:.1f}%) | "
                        f"G/P realizada: {real_pnl:+,.2f} Bs"
                    )

                total_pnl = total_current - total_invested
                total_pct = (total_pnl / total_invested * 100) if total_invested > 0 else 0

                pf_ctx = f"""
═══ PORTAFOLIO COMPLETO ═══
Resumen: {len(pf_lines)} posición(es) activa(s)
Capital total invertido: {total_invested:,.2f} Bs
Valor actual del portafolio: {total_current:,.2f} Bs
Ganancia/Pérdida total no realizada: {total_pnl:+,.2f} Bs ({total_pct:+.1f}%)

Posiciones detalladas:
{''.join(chr(10) + l for l in pf_lines) if pf_lines else '  (Sin posiciones abiertas)'}
"""
                tx_lines = []
                for t in transactions:
                    try:
                        sym_tx = str(t.stock_id)
                        qty = float(t.quantity or 0)
                        price = float(getattr(t, 'avg_price', None) or getattr(t, 'price', 0) or 0)
                        gross = float(getattr(t, 'gross_amount', None) or (qty * price))
                        net = float(getattr(t, 'net_amount', gross) or gross)
                        usd = float(getattr(t, 'amount_usd', 0) or 0)
                        date_str = t.transaction_date.strftime('%d/%m/%Y') if t.transaction_date else '?'
                        tx_lines.append(
                            f"  {date_str} | {t.order_type} {sym_tx}: {qty:,.0f} acc @ {price:.2f} Bs | "
                            f"Bruto: {gross:,.2f} Bs | Neto: {net:,.2f} Bs | USD: ${usd:,.2f}"
                        )
                    except Exception:
                        tx_lines.append(f"  {t.order_type} {t.stock_id}")

                tx_ctx = "\n".join(tx_lines) if tx_lines else "Sin transacciones"

                prompt = f"""Eres un asesor financiero de portafolio experto en la Bolsa de Valores de Caracas (BVC).
Hablas en español venezolano, tono profesional. Tienes acceso COMPLETO al portafolio e historial del inversor.
{profile_ctx}
{pf_ctx}
═══ HISTORIAL DE TRANSACCIONES (últimas {len(tx_lines)}) ═══
{tx_ctx}
{session_history_ctx}
═══ PREGUNTA DEL INVERSOR ═══
{chat_data.message}

INSTRUCCIONES:
1. Analiza el portafolio en detalle: composición, diversificación, riesgo concentrado.
2. Evalúa el desempeño: cuáles acciones están en pérdida, cuáles en ganancia.
3. Identifica patrones en el comportamiento de compra/venta (¿compra en picos? ¿vende en mínimos?).
4. Basándote en el perfil de inversión, indica si el portafolio ACTUAL es coherente con sus objetivos.
5. Da una recomendación clara: qué acciones mantener, cuáles vender, y si debería esperar antes de invertir más.
6. Si aplica, sugiere acciones de la BVC que complementen el portafolio según su perfil.
7. Usa **negritas** para valores clave.{profile_conclusion}
Respuesta:"""

            else:
                # Modo general (BVC general + perfil + portafolio resumido)
                tx_ctx = "\n".join([
                    f"- {t.order_type} {t.stock_id}: {t.quantity} acc"
                    for t in transactions
                ]) if transactions else "Sin transacciones recientes"

                pf_ctx = "\n".join([
                    f"- {row[1] or row[0].stock_id}: {row[0].total_shares} acciones"
                    for row in positions_raw
                ]) if positions_raw else "Portafolio vacío"

                prompt = f"""Eres asistente financiero experto en la BVC. Español venezolano.
{profile_ctx}
Transacciones recientes:
{tx_ctx}

Portafolio actual:
{pf_ctx}
{session_history_ctx}
Pregunta: {chat_data.message}

Responde de manera clara, cita datos cuando sea posible, máximo 400 palabras.{profile_conclusion}
Respuesta:"""

        response = model.generate_content(prompt)
        logger.info(f"✅ [CHAT] Respuesta generada ({len(response.text)} chars)")

        # Auto-create session for chart/comparison chats that don't have one yet
        active_session_id = chat_data.session_id
        if not active_session_id and (is_comparison_mode or (hasattr(chat_data, 'chart_context') and chat_data.chart_context)):
            try:
                if is_comparison_mode:
                    stocks_ctx = getattr(chat_data, 'stocks_context', []) or []
                    symbols = [c.get('symbol', '') for c in stocks_ctx[:3] if c.get('symbol')]
                    title = f"Comparación: {' vs '.join(symbols)}" if symbols else "Análisis comparativo"
                    chat_type_new = 'comparative'
                else:
                    sym = chat_data.chart_context.get('symbol', 'Acción')
                    title = f"Análisis técnico: {sym}"
                    chat_type_new = 'technical'
                new_session = ChatSession(
                    user_id=user_id,
                    title=title,
                    model_used=model_name,
                    chat_type=chat_type_new,
                )
                db.add(new_session)
                await db.flush()
                active_session_id = new_session.id
                await db.commit()
                await db.refresh(new_session)
            except Exception as se:
                logger.warning(f"⚠️ No se pudo crear sesión: {se}")
                try: await db.rollback()
                except: pass

        if active_session_id:
            try:
                db.add(ChatMessage(
                    session_id=active_session_id,
                    role="user",
                    content=chat_data.message,
                    model_used=model_name
                ))
                db.add(ChatMessage(
                    session_id=active_session_id,
                    role="assistant",
                    content=response.text,
                    model_used=model_name
                ))
                await db.commit()
            except Exception as db_err:
                logger.warning(f"⚠️ No se pudo guardar en DB: {db_err}")
                await db.rollback()

        return {
            "response": response.text,
            "session_id": active_session_id,
            "model_used": model_name,
            "timestamp": datetime.utcnow().isoformat(),
            "has_data": True,
            "mode": "comparison" if is_comparison_mode else "chart" if chat_data.chart_context else (getattr(chat_data, 'chat_type', 'general') or 'general')
        }

    except Exception as e:
        logger.error(f"❌ Error chat IA: {e}", exc_info=True)
        try:
            await db.rollback()
        except:
            pass
        return {
            "response": "⚠️ Error temporal. Intenta de nuevo.",
            "session_id": getattr(chat_data, 'session_id', None),
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat(),
            "has_data": False
        }


# ========== FUNCIONES PARA MODO COMPARATIVO ==========

def build_comparison_prompt(
    stocks_context: List[Dict[str, Any]],
    user_message: str,
    order_book: List[Dict] = None,
    order_books: Dict[str, List[Dict]] = None
) -> str:
    """
    Construye prompt para comparación de múltiples acciones,
    incluyendo TODOS los indicadores técnicos y el libro de órdenes
    de cada acción individual cuando está disponible.
    """
    lines = [
        "📊 MODO COMPARATIVO MULTIACCIÓN — BOLSA DE VALORES DE CARACAS",
        "════════════════════════════════════════════════════════════",
        f"Acciones a comparar: {len(stocks_context)}",
        ""
    ]

    lines.append("📈 ANÁLISIS POR ACCIÓN")
    lines.append("─" * 50)

    for i, ctx in enumerate(stocks_context, 1):
        ind  = ctx.get('indicators', {})
        last = ctx.get('lastCandle', {})
        chg  = ctx.get('priceChangePct', 0)
        trend= ind.get('trend', 'NEUTRAL')
        emoji= {"ALCISTA_FUERTE": "🚀", "ALCISTA": "📈",
                "BAJISTA_FUERTE": "🪂", "BAJISTA": "📉"}.get(trend, "➡️")
        sign = '+' if chg >= 0 else ''
        sym  = ctx['symbol']

        lines.append(f"\n{'='*50}")
        lines.append(f"{i}. {sym} — {ctx.get('name', 'N/A')}")
        lines.append(f"{'='*50}")
        lines.append(f"   Precio: {last.get('close', 0):.2f} Bs ({sign}{chg:.2f}%) {emoji}")
        lines.append(f"   Tendencia: {trend}")

        # ── Indicadores de momentum/tendencia
        rsi = ind.get('rsi14')
        if rsi is not None:
            rsi_lbl = "SOBRECOMPRADO" if rsi > 70 else "SOBREVENDIDO" if rsi < 30 else "neutral"
            lines.append(f"   RSI(14): {rsi:.1f} → {rsi_lbl}")

        macd_v = ind.get('macd'); macd_h = ind.get('macd_hist')
        if macd_v is not None:
            macd_h_str = f'{macd_h:.4f}' if macd_h is not None else 'N/A'
            lines.append(f"   MACD: {macd_v:.4f} | Hist: {macd_h_str} | {ind.get('macd_cross','')}")

        adx = ind.get('adx')
        if adx is not None:
            lines.append(f"   ADX: {adx:.1f} → {'TENDENCIA FUERTE' if adx > 25 else 'RANGO' if adx < 15 else 'TENDENCIA DÉBIL'}")

        aroon_up = ind.get('aroon_up'); aroon_dn = ind.get('aroon_down')
        if aroon_up is not None:
            aroon_dn_str = f'{aroon_dn:.0f}' if aroon_dn is not None else '0'
            lines.append(f"   Aroon: Up={aroon_up:.0f}% / Down={aroon_dn_str}%")

        stoch = ind.get('stoch_k')
        if stoch is not None:
            lines.append(f"   Stoch %K: {stoch:.1f}% → {'SOBRECOMPRA' if stoch > 80 else 'SOBREVENTA' if stoch < 20 else 'neutral'}")

        dmi = ind.get('dmi')
        if dmi is not None:
            lines.append(f"   DMI: {dmi:.1f} → {'alcista' if dmi > 50 else 'bajista'}")

        # ── Indicadores de volumen/flujo
        obv = ind.get('obv'); adl = ind.get('adl')
        if obv is not None:
            lines.append(f"   OBV: {obv:,.0f} | A/D: {adl:,.0f if adl else 0:,.0f}")

        chaikin = ind.get('chaikin')
        if chaikin is not None:
            lines.append(f"   Chaikin Osc: {chaikin:,.2f} → {'presión compradora' if chaikin > 0 else 'presión vendedora'}")

        mfi = ind.get('mfi')
        if mfi is not None:
            lines.append(f"   MFI: {mfi:.1f} → {'DIST.' if mfi > 80 else 'ACUM.' if mfi < 20 else 'neutral'}")

        vol_ratio = ind.get('volume_ratio')
        if vol_ratio is not None:
            lines.append(f"   Volumen: {ind.get('volume_current',0):,.0f} ({vol_ratio:.2f}x promedio) → {ind.get('volume_status','')}")

        # ── Precio vs EMAs
        ema20 = ind.get('ema20'); ema50 = ind.get('ema50')
        if ema20 and ema50:
            cross = "EMA20 > EMA50 (alcista)" if ema20 > ema50 else "EMA20 < EMA50 (bajista)"
            lines.append(f"   EMA20: {ema20:.2f} | EMA50: {ema50:.2f} → {cross}")
            if ind.get('golden_cross'): lines.append("   ⭐ GOLDEN CROSS reciente")
            if ind.get('death_cross'):  lines.append("   💀 DEATH CROSS reciente")

        # ── Volatilidad
        atr_pct = ind.get('atr_percent')
        if atr_pct is not None:
            lines.append(f"   ATR%: {atr_pct:.2f}% → {'ALTA volatilidad' if atr_pct > 5 else 'BAJA' if atr_pct < 2 else 'MODERADA'}")

        bb_w = ind.get('bb_width')
        if bb_w is not None:
            lines.append(f"   BB Width: {bb_w:.1f}% | Posición: {ind.get('bb_position','N/A')}")

        vwap = ind.get('vwap')
        if vwap is not None:
            price_now = last.get('close', 0)
            pos = "SOBRE VWAP ✅" if price_now > vwap else "BAJO VWAP ⚠️"
            lines.append(f"   VWAP: {vwap:.2f} → precio {pos}")

        # ── Libro de órdenes de esta acción específica
        ob_sym = (order_books or {}).get(sym, [])
        if ob_sym:
            lines.append(f"\n   📘 LIBRO DE ÓRDENES ({sym}) — {len(ob_sym)} niveles:")
            total_buy  = sum(l.get('buy_volume', 0)  for l in ob_sym)
            total_sell = sum(l.get('sell_volume', 0) for l in ob_sym)
            for j, lv in enumerate(ob_sym[:4]):
                lines.append(
                    f"     Nivel {j+1}: Compra {lv.get('buy_volume',0):>8,.0f} @ {lv.get('buy_price',0):.2f}"
                    f"  |  Venta {lv.get('sell_volume',0):>8,.0f} @ {lv.get('sell_price',0):.2f}"
                )
            if total_buy + total_sell > 0:
                imb = (total_buy - total_sell) / (total_buy + total_sell) * 100
                lines.append(f"     Desbalance: {imb:+.1f}% → {'presión compradora' if imb > 0 else 'presión vendedora'}")
        elif order_book and i == 1:
            # Fallback: libro principal solo para la primera acción
            lines.append(f"\n   📘 LIBRO DE ÓRDENES ({sym}):")
            for j, lv in enumerate(order_book[:4]):
                lines.append(
                    f"     Nivel {j+1}: Compra {lv.get('buy_volume',0):>8,.0f} @ {lv.get('buy_price',0):.2f}"
                    f"  |  Venta {lv.get('sell_volume',0):>8,.0f} @ {lv.get('sell_price',0):.2f}"
                )

    # ── Ranking automático
    lines.append(f"\n{'='*50}")
    lines.append("🏆 RANKING AUTOMÁTICO POR CRITERIOS")
    lines.append("─" * 50)

    comparison_data = []
    for ctx in stocks_context:
        ind = ctx.get('indicators', {})
        comparison_data.append({
            'symbol':      ctx['symbol'],
            'precio':      ctx.get('lastCandle', {}).get('close', 0),
            'cambio_pct':  ctx.get('priceChangePct', 0),
            'rsi':         ind.get('rsi14', 0) or 0,
            'tendencia':   ind.get('trend', 'NEUTRAL'),
            'ema_dist':    ind.get('ema20_distance', 0) or 0,
            'volume_ratio':ind.get('volume_ratio', 1) or 1,
            'macd_hist':   ind.get('macd_hist', 0) or 0,
            'golden_cross':ind.get('golden_cross', False),
            'death_cross': ind.get('death_cross', False),
            'adx':         ind.get('adx', 0) or 0,
            'stoch':       ind.get('stoch_k', 50) or 50,
            'mfi':         ind.get('mfi', 50) or 50,
            'obv':         ind.get('obv', 0) or 0,
            'chaikin':     ind.get('chaikin', 0) or 0,
            'atr_pct':     ind.get('atr_percent', 0) or 0,
        })

    best_momentum = max(comparison_data, key=lambda x: x['cambio_pct'])
    lines.append(f"   📈 Mejor momentum: {best_momentum['symbol']} ({best_momentum['cambio_pct']:+.2f}%)")
    best_volume = max(comparison_data, key=lambda x: x['volume_ratio'])
    lines.append(f"   🔊 Mayor volumen relativo: {best_volume['symbol']} ({best_volume['volume_ratio']:.2f}x)")
    best_adx = max(comparison_data, key=lambda x: x['adx'])
    lines.append(f"   📊 Mayor ADX (tendencia más fuerte): {best_adx['symbol']} ({best_adx['adx']:.1f})")
    best_ob = max(comparison_data, key=lambda x: abs(x['obv']))
    lines.append(f"   💹 Mayor OBV absoluto: {best_ob['symbol']} ({best_ob['obv']:,.0f})")

    # Score técnico compuesto
    signal_scores = []
    for d in comparison_data:
        score = 0
        if d['golden_cross']:                         score += 50
        if d['death_cross']:                          score -= 50
        if d['tendencia'] == 'ALCISTA_FUERTE':        score += 30
        elif d['tendencia'] == 'ALCISTA':             score += 20
        elif d['tendencia'] == 'BAJISTA_FUERTE':      score -= 30
        elif d['tendencia'] == 'BAJISTA':             score -= 20
        if d['macd_hist'] > 0:                        score += 15
        if d['ema_dist'] > 0:                         score += 10
        if d['adx'] > 25:                             score += 15
        if d['stoch'] > 80:                           score -= 15
        if d['stoch'] < 20:                           score += 15
        if d['mfi'] > 80:                             score -= 15
        if d['mfi'] < 20:                             score += 15
        if d['chaikin'] > 0:                          score += 10
        if d['volume_ratio'] > 1.5:                   score += 10
        signal_scores.append((d['symbol'], score))

    signal_scores.sort(key=lambda x: x[1], reverse=True)
    lines.append(f"\n   🥇 Score técnico compuesto:")
    for rank, (sym, sc) in enumerate(signal_scores, 1):
        lines.append(f"      {rank}. {sym}: {sc:+d} pts")

    prompt = f"""Eres un analista técnico senior de la BVC especializado en comparación de activos.

{chr(10).join(lines)}

PREGUNTA DEL USUARIO: {user_message}

════════════════════════════════════════════════════════════
INSTRUCCIONES PARA ANÁLISIS COMPARATIVO
════════════════════════════════════════════════════════════

1. **RANKING FINAL**: Ordena las acciones de MEJOR a PEOR oportunidad de inversión.

2. **GANADORA ABSOLUTA**: Selecciona UNA acción como la mejor opción. Justifica
   con al menos 5 indicadores distintos (técnicos, volumen, momentum y libro).

3. **ANÁLISIS CRUZADO**: Compara en detalle RSI, tendencias, volumen, OBV, A/D,
   ADX, Stoch, MFI, Chaikin y señales entre todas las acciones.

4. **LIBROS DE ÓRDENES**: Si los libros están disponibles, analiza la liquidez,
   el spread bid/ask y el desbalance compra/venta de cada acción.

5. **DIVERSIFICACIÓN**: Si aplica, recomienda dividir capital entre 2 acciones.

6. **NIVELES**: Para la ganadora, indica precio de entrada, stop loss y take profit.

7. **TABLA COMPARATIVA**:
   | Acción | Score | RSI | ADX | Volumen | Libro | Recomendación |

8. **CONCLUSIÓN EJECUTIVA**: Una frase contundente sobre cuál elegir y por qué.

RESPUESTA COMPARATIVA:"""

    return prompt