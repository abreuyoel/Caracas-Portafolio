from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.transaction import Transaction
from app.models.stock import Stock
from app.models.portfolio import PortfolioPosition
from app.models.user_profile import UserProfile
from app.utils.security import decode_token
from uuid import UUID
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import google.generativeai as genai
from app.config import settings
import logging
from datetime import datetime, timezone, timedelta

router = APIRouter()
logger = logging.getLogger(__name__)


# ==================== SCHEMAS ====================

class ChartContext(BaseModel):
    """Contexto del gráfico enviado desde el frontend."""
    symbol: Optional[str] = None
    name: Optional[str] = None
    timeframe: Optional[str] = None
    chartType: Optional[str] = None
    currency: Optional[str] = "Bs"  # "USD" o "Bs"
    usd_rate: Optional[float] = None
    lastCandle: Optional[Dict[str, Any]] = None
    recentCandles: Optional[List[Dict[str, Any]]] = None
    totalCandles: Optional[int] = None
    priceChange: Optional[float] = None
    priceChangePct: Optional[float] = None
    indicators: Optional[Dict[str, Any]] = None  # Aquí llega todo el objeto indicators


class ChatMessage(BaseModel):
    """
    Mensaje para el chat con IA.
    Incluye contexto opcional del gráfico para análisis técnico.
    """
    message: str
    session_id: Optional[int] = None
    chart_context: Optional[ChartContext] = None
    stock_symbol: Optional[str] = None   # Para análisis histórico desde el chat
    days: Optional[int] = None           # Cantidad de días a analizar (ej: 365)


class ChatResponse(BaseModel):
    """Respuesta del chat con IA"""
    response: str
    model_used: Optional[str] = None
    error: Optional[str] = None
    timestamp: str
    has_data: bool = False
    session_id: Optional[int] = None


class AnalyzePortfolioRequest(BaseModel):
    """Solicitud para analizar portafolio"""
    stocks: Optional[List[dict]] = None
    goals: Optional[str] = None


class AnalyzePortfolioResponse(BaseModel):
    """Respuesta del análisis de portafolio"""
    analysis: str
    error: Optional[str] = None
    timestamp: str


class ModelInfo(BaseModel):
    """Información de modelo disponible"""
    models: List[str]
    configured_model: str
    timestamp: str


# ==================== DEPENDENCIES ====================

async def get_current_user_id(authorization: str = Header(...)) -> UUID:
    """
    Obtener ID del usuario desde el token JWT
    
    Args:
        authorization: Header de autorización con Bearer token
        
    Returns:
        UUID del usuario
        
    Raises:
        HTTPException: Si el token es inválido o expirado
    """
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


# ==================== HELPER FUNCTIONS ====================

def get_gemini_model():
    """
    Obtener modelo de Gemini disponible con fallback
    
    Returns:
        tuple: (model, model_name)
        
    Raises:
        Exception: Si ningún modelo está disponible
    """
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


def build_chart_context_block(ctx: ChartContext) -> str:
    """
    Construye bloque de contexto con EVOLUCIÓN de indicadores para análisis técnico.
    Incluye valores actuales, tendencias y últimas velas para contexto visual.
    """
    if not ctx or not ctx.symbol:
        return ""
    
    lines = [
        f"\n📊 ACCIÓN: {ctx.symbol} ({ctx.name or 'Sin nombre'})",
        f"🕒 Período: {ctx.timeframe or 'Todo'} | Tipo: {ctx.chartType or 'candlestick'}",
        f"📈 Velas analizadas: {ctx.totalCandles or 0}",
    ]

    # ── Precio actual y cambio ──────────────────────────────────
    if ctx.lastCandle:
        c = ctx.lastCandle
        sign = '+' if (ctx.priceChange or 0) >= 0 else ''
        trend_emoji = "📈" if (ctx.priceChange or 0) >= 0 else "📉"
        lines.append(f"💰 Precio: {c.get('close', 0):.2f} Bs {sign}{ctx.priceChange or 0:.2f} ({sign}{ctx.priceChangePct or 0:.2f}%) {trend_emoji}")

    ind = ctx.indicators or {}

    # ── RSI con tendencia y pendiente ───────────────────────────
    if ind.get('rsi14') is not None:
        rsi = ind['rsi14']
        slope = ind.get('rsi_slope', 0)
        
        if rsi > 70: label = "⚠️ SOBRECOMPRADO"
        elif rsi < 30: label = "⚠️ SOBREVENDIDO"
        elif rsi > 55: label = "zona alcista"
        elif rsi < 45: label = "zona bajista"
        else: label = "zona neutral"
        
        slope_txt = ""
        if slope > 2: slope_txt = " (↑ subiendo fuerte)"
        elif slope < -2: slope_txt = " (↓ bajando fuerte)"
        elif slope > 0: slope_txt = " (↑ subiendo)"
        elif slope < 0: slope_txt = " (↓ bajando)"
        
        lines.append(f"📊 RSI(14): {rsi:.2f} → {label}{slope_txt}")
        
        # ✅ Evolución histórica del RSI (últimos 10 puntos)
        if ind.get('rsiHistory') and len(ind['rsiHistory']) >= 10:
            rsi_hist = ind['rsiHistory'][-10:]
            rsi_start = rsi_hist[0]['value']
            rsi_end = rsi_hist[-1]['value']
            change = rsi_end - rsi_start
            trend = "↑" if change > 0 else "↓" if change < 0 else "→"
            lines.append(f"   ↳ Evolución: {rsi_start:.1f} → {rsi_end:.1f} {trend} ({'+' if change >=0 else ''}{change:.1f})")

    # ── EMAs con cruce y distancia al precio ────────────────────
    price = ctx.lastCandle.get('close', 0) if ctx.lastCandle else 0

    if ind.get('ema20') and ind.get('ema50'):
        cross = "📈 ALCISTA" if ind['ema20'] > ind['ema50'] else "📉 BAJISTA"
        lines.append(f"📈 Cruce EMA: {cross} (EMA20: {ind['ema20']:.2f} | EMA50: {ind['ema50']:.2f})")
        
        # ✅ Evolución de EMA20
        if ind.get('ema20History') and len(ind['ema20History']) >= 10:
            ema_hist = ind['ema20History'][-10:]
            ema_start = ema_hist[0]['value']
            ema_end = ema_hist[-1]['value']
            pct = ((ema_end - ema_start) / ema_start * 100) if ema_start else 0
            lines.append(f"   ↳ EMA20 ev: {ema_start:.2f} → {ema_end:.2f} ({'+' if pct >=0 else ''}{pct:.1f}%)")

    if ind.get('ema200'):
        pos = "✅ SOBRE" if price > ind['ema200'] else "⚠️ BAJO"
        lines.append(f"🎯 EMA200: {ind['ema200']:.2f} → precio {pos}")

    if ind.get('ema20_distance') is not None:
        d = ind['ema20_distance']
        lines.append(f"   ↳ Precio {'+' if d >= 0 else ''}{d:.1f}% vs EMA20")

    # ── Bollinger Bands con ancho y posición ────────────────────
    if ind.get('bb_upper') and ind.get('bb_middle') and ind.get('bb_lower'):
        width = ind.get('bb_width', 0)
        width_label = "estrecho" if width < 5 else "amplio" if width > 15 else "normal"
        lines.append(f"🔷 Bollinger: +{ind['bb_upper']:.2f} | ~{ind['bb_middle']:.2f} | -{ind['bb_lower']:.2f} (ancho {width_label})")
        
        if ind.get('bb_position'):
            bb_labels = {
                'TOCANDO_BANDA_SUPERIOR': '⚠️ Posible sobreextensión alcista',
                'TOCANDO_BANDA_INFERIOR': '⚠️ Posible sobrevendido',
                'ENTRE_BANDAS': '✅ Dentro de rango normal'
            }
            lines.append(f"📍 Posición: {bb_labels.get(ind['bb_position'], ind['bb_position'])}")

    # ── MACD con histograma y momentum ──────────────────────────
    if ind.get('macd') is not None:
        hist = ind.get('macd_hist', 0)
        mom = ind.get('macd_momentum', '')
        cross = ind.get('macd_cross', '')
        
        lines.append(f"🔄 MACD: {ind['macd']:.4f} | Signal: {ind.get('macd_signal', 0):.4f} | Hist: {hist:.4f}")
        
        if cross:
            cross_labels = {
                'MACD_SOBRE_SENAL': '📈 Momentum alcista',
                'MACD_BAJO_SENAL': '📉 Momentum bajista'
            }
            lines.append(f"   Señal: {cross_labels.get(cross, cross)}")
        if mom:
            lines.append(f"   Momentum: histograma {mom}")
        
        # ✅ Evolución del MACD
        if ind.get('macdHistory') and len(ind['macdHistory']) >= 10:
            macd_hist = ind['macdHistory'][-10:]
            macd_start = macd_hist[0]['value']
            macd_end = macd_hist[-1]['value']
            cross_txt = "cruce alcista" if macd_start < 0 <= macd_end else "cruce bajista" if macd_start > 0 >= macd_end else "sin cruce"
            lines.append(f"   ↳ MACD ev: {macd_start:.4f} → {macd_end:.4f} ({cross_txt})")

    # ── Volumen con ratio vs promedio ───────────────────────────
    if ind.get('volume_ratio') is not None:
        ratio = ind['volume_ratio']
        status = ind.get('volume_status', 'normal').lower()
        vol_trend = "↑ ALTO" if ratio > 1.5 else "↓ BAJO" if ratio < 0.5 else "→ NORMAL"
        lines.append(f"🔊 Volumen: {ind.get('volume_current', 0):,.0f} | Ratio: {ratio:.2f}x vs promedio → {vol_trend} ({status})")
        
        # ✅ Evolución del volumen
        if ind.get('volumeHistory') and len(ind['volumeHistory']) >= 10:
            vol_hist = ind['volumeHistory'][-10:]
            vol_avg = sum(v['value'] for v in vol_hist) / len(vol_hist)
            current = vol_hist[-1]['value']
            vol_change = ((current - vol_avg) / vol_avg * 100) if vol_avg else 0
            lines.append(f"   ↳ Vol ev: promedio {vol_avg:,.0f} → actual {current:,.0f} ({'+' if vol_change >=0 else ''}{vol_change:.1f}%)")

    # ── VWAP ────────────────────────────────────────────────────
    if ind.get('vwap') is not None:
        vwap_pos = "✅ SOBRE VWAP" if price > ind['vwap'] else "⚠️ BAJO VWAP"
        lines.append(f"📍 VWAP: {ind['vwap']:.2f} → {vwap_pos}")

    # ── Soportes y Resistencias ─────────────────────────────────
    if ind.get('support20') and ind.get('resistance20'):
        lines.append(f"🎯 Soporte(20): {ind['support20']:.2f} Bs | Resistencia(20): {ind['resistance20']:.2f} Bs")

    # ── Cruces importantes ──────────────────────────────────────
    if ind.get('golden_cross'):
        lines.append(f"⭐ GOLDEN CROSS: EMA20 cruzó sobre EMA50 → señal alcista fuerte")
    if ind.get('death_cross'):
        lines.append(f"💀 DEATH CROSS: EMA20 cruzó bajo EMA50 → señal bajista fuerte")

    # ── Tendencia general ───────────────────────────────────────
    if ind.get('trend'):
        emoji = {"ALCISTA_FUERTE": "🚀", "ALCISTA": "📈", "BAJISTA_FUERTE": "🪂", "BAJISTA": "📉"}.get(ind['trend'], "➡️")
        lines.append(f"🧭 Tendencia: {emoji} {ind['trend']}")

    # ── Últimas 5 velas para contexto visual ────────────────────
    if ctx.recentCandles and len(ctx.recentCandles) >= 2:
        lines.append(f"\n🕯 Últimas 5 velas:")
        for c in ctx.recentCandles[-5:]:
            trend = "🟢" if c.get('close', 0) >= c.get('open', 0) else "🔴"
            lines.append(f"   {trend} {c.get('time','')} O:{c.get('open',0):.2f} H:{c.get('high',0):.2f} L:{c.get('low',0):.2f} C:{c.get('close',0):.2f} Vol:{c.get('volume',0):,.0f}")

    # ── RESUMEN DE EVOLUCIÓN RECIENTE ───────────────────────────
    evo_lines = []
    if ind.get('rsiHistory') and len(ind['rsiHistory']) >= 10:
        rsi_start = ind['rsiHistory'][0]['value']
        rsi_end = ind['rsiHistory'][-1]['value']
        evo_lines.append(f"RSI: {rsi_start:.1f} → {rsi_end:.1f} ({'+' if rsi_end >= rsi_start else ''}{rsi_end-rsi_start:.1f})")
    if ind.get('ema20History') and len(ind['ema20History']) >= 10:
        ema_start = ind['ema20History'][0]['value']
        ema_end = ind['ema20History'][-1]['value']
        pct = (ema_end - ema_start) / ema_start * 100 if ema_start else 0
        evo_lines.append(f"EMA20: {ema_start:.2f} → {ema_end:.2f} ({'+' if pct >=0 else ''}{pct:.1f}%)")
    if ind.get('macdHistory') and len(ind['macdHistory']) >= 10:
        macd_start = ind['macdHistory'][0]['value']
        macd_end = ind['macdHistory'][-1]['value']
        cross_txt = "cruce alcista" if macd_start < 0 <= macd_end else "cruce bajista" if macd_start > 0 >= macd_end else "sin cruce"
        evo_lines.append(f"MACD: {macd_start:.4f} → {macd_end:.4f} ({cross_txt})")
    if ind.get('volumeHistory') and len(ind['volumeHistory']) >= 10:
        vol_hist = ind['volumeHistory'][-10:]
        vol_avg = sum(v['value'] for v in vol_hist) / len(vol_hist)
        vol_current = vol_hist[-1]['value']
        vol_change = (vol_current - vol_avg) / vol_avg * 100 if vol_avg else 0
        evo_lines.append(f"Volumen: promedio {vol_avg:,.0f} → actual {vol_current:,.0f} ({'+' if vol_change >=0 else ''}{vol_change:.1f}%)")

    if evo_lines:
        lines.append("\n📈 EVOLUCIÓN RECIENTE (resumen):")
        lines.extend([f"   • {line}" for line in evo_lines])

    lines.append("\n" + "═" * 60)
    return "\n".join(lines)


# ==================== ENDPOINTS ====================

def _build_profile_block(profile: UserProfile) -> str:
    """Construye bloque de texto con el perfil de inversión del usuario."""
    if not profile:
        return ""
    lines = [
        "\n👤 PERFIL DEL INVERSOR:",
        f"• Perfil de riesgo: {profile.risk_profile.value.upper()}",
        f"• Objetivo: {profile.investment_goal.value.replace('_', ' ')}",
        f"• Horizonte temporal: {profile.time_horizon.value.replace('_', ' ')}",
        f"• Experiencia: {profile.experience_level}/10",
        f"• Pérdida máxima tolerada: {profile.max_loss_tolerance}%",
        f"• Retorno anual esperado: {profile.expected_return}%",
    ]
    if profile.available_capital and profile.available_capital > 0:
        lines.append(f"• Capital disponible: ${profile.available_capital:,.2f}")
    if profile.preferred_sectors:
        lines.append(f"• Sectores preferidos: {profile.preferred_sectors}")
    if profile.avoided_sectors:
        lines.append(f"• Sectores a evitar: {profile.avoided_sectors}")
    if profile.allows_volatile_stocks:
        lines.append("• Acepta acciones volátiles: Sí")
    lines.append("═" * 40)
    return "\n".join(lines)


def _profile_recommendation_instruction(profile: UserProfile) -> str:
    """Instrucción para que la IA cierre con recomendación personalizada."""
    if not profile:
        return ""
    perfil = profile.risk_profile.value
    return (
        f"\n\n🎯 RECOMENDACIÓN PERSONALIZADA (obligatoria al final):\n"
        f"Considerando que el inversor tiene perfil '{perfil.upper()}', horizonte "
        f"'{profile.time_horizon.value.replace('_',' ')}' y tolera hasta {profile.max_loss_tolerance}% "
        f"de pérdida, indica en 2-3 oraciones si debería COMPRAR / MANTENER / VENDER / DISTRIBUIR "
        f"esta posición y por qué es coherente con su perfil."
    )


@router.post("/chat", response_model=ChatResponse)
async def chat_with_ai(
    chat_data: ChatMessage,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Chat con IA - Análisis técnico completo + perfil del inversor"""
    try:
        genai.configure(api_key=settings.gemini_api_key)
        model, model_name = get_gemini_model()

        # ── Obtener perfil del usuario ────────────────────────────────────────
        profile_result = await db.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        profile = profile_result.scalar_one_or_none()
        profile_block = _build_profile_block(profile) if profile else ""
        profile_instruction = _profile_recommendation_instruction(profile) if profile else ""

        # 🔍 DETECCIÓN DE MODO ANÁLISIS HISTÓRICO (días explícitos desde el chat)
        has_historical_request = bool(chat_data.stock_symbol and chat_data.days)

        # 🔍 DETECCIÓN DE MODO GRÁFICO
        has_chart_data = (
            chat_data.chart_context is not None and
            hasattr(chat_data.chart_context, 'symbol') and
            chat_data.chart_context.symbol and
            chat_data.chart_context.symbol.strip() != ''
        )

        logger.info(f"🔍 [CHAT] chart={has_chart_data} historical={has_historical_request}")

        # ── MODO HISTÓRICO: el usuario pide analizar X días de una acción ────
        if has_historical_request:
            sym = chat_data.stock_symbol.upper().strip()
            days = min(max(chat_data.days, 1), 1825)  # entre 1 y 5 años
            from app.services.bvc_scraper import bvc_scraper
            full_history = await bvc_scraper.get_full_price_history(sym)

            candles_block = ""
            if full_history:
                cutoff = datetime.now(timezone.utc).date() - timedelta(days=days)
                filtered = [c for c in full_history if c['date'] >= cutoff]
                if filtered:
                    first = filtered[0]
                    last  = filtered[-1]
                    price_chg = last['close'] - first['close']
                    price_chg_pct = (price_chg / first['close'] * 100) if first['close'] else 0
                    highs  = [c['high']  for c in filtered]
                    lows   = [c['low']   for c in filtered]
                    vols   = [c['volume'] for c in filtered]
                    avg_vol = sum(vols) / len(vols) if vols else 0
                    candles_block = (
                        f"📊 HISTORIAL {sym} — últimos {days} días ({len(filtered)} sesiones)\n"
                        f"• Desde: {first['date']} | Hasta: {last['date']}\n"
                        f"• Precio inicio: {first['close']:.2f} Bs | Precio actual: {last['close']:.2f} Bs\n"
                        f"• Variación período: {'+' if price_chg >= 0 else ''}{price_chg:.2f} Bs ({'+' if price_chg_pct >= 0 else ''}{price_chg_pct:.1f}%)\n"
                        f"• Máximo del período: {max(highs):.2f} Bs\n"
                        f"• Mínimo del período: {min(lows):.2f} Bs\n"
                        f"• Volumen promedio diario: {avg_vol:,.0f} acciones\n"
                        f"• Últimas 5 sesiones:\n"
                    )
                    for c in filtered[-5:]:
                        direction = "🟢" if c['close'] >= c['open'] else "🔴"
                        candles_block += (
                            f"  {direction} {c['date']} | O:{c['open']:.2f} H:{c['high']:.2f} "
                            f"L:{c['low']:.2f} C:{c['close']:.2f} V:{c['volume']:,}\n"
                        )
                else:
                    candles_block = f"No hay datos para {sym} en los últimos {days} días."
            else:
                candles_block = f"No se pudo obtener el historial de {sym}."

            prompt = f"""Eres analista experto en la Bolsa de Valores de Caracas (BVC).
{profile_block}

DATOS HISTÓRICOS:
{candles_block}

PREGUNTA DEL USUARIO: {chat_data.message}

INSTRUCCIONES:
1. Analiza la evolución del precio en el período solicitado
2. Identifica la tendencia general (alcista / bajista / lateral)
3. Comenta los niveles de soporte y resistencia clave del período
4. Evalúa el volumen y qué señala sobre el interés del mercado
5. Máximo 450 palabras, en español venezolano profesional
{profile_instruction}

RESPUESTA:"""

        elif has_chart_data:
            ctx = chat_data.chart_context
            ind = ctx.indicators or {}
            currency = ctx.currency or "Bs"
            currency_label = "USD ($)" if currency == "USD" else "Bolívares (Bs)"
            price_symbol = "$" if currency == "USD" else "Bs"

            # ✅ Construir contexto TÉCNICO COMPLETO pero CONCISO
            close_price = ctx.lastCandle.get('close', 0) if ctx.lastCandle else 0
            context_lines = [
                f"📊 ACCIÓN: {ctx.symbol} ({ctx.name or 'N/A'})",
                f"🕒 Timeframe: {ctx.timeframe or 'Todo'}",
                f"💱 Moneda mostrada: {currency_label}",
                f"💰 Precio: {close_price:.4f} {price_symbol}",
                f"📈 Cambio: {ctx.priceChange:.4f} {price_symbol} ({ctx.priceChangePct:.2f}%)",
                f"📊 Tendencia: {ind.get('trend', 'NEUTRAL')}",
                "",
                "📈 INDICADORES ACTUALES:",
            ]

            # RSI
            if ind.get('rsi14') is not None:
                rsi = ind['rsi14']
                zona = "SOBRECOMPRADO" if rsi > 70 else "SOBREVENDIDO" if rsi < 30 else "NEUTRAL"
                context_lines.append(f"• RSI(14): {rsi:.2f} ({zona})")
                if ind.get('rsiHistory') and len(ind['rsiHistory']) >= 5:
                    hist = ind['rsiHistory']
                    rsi_start = hist[0]['value']
                    rsi_end = hist[-1]['value']
                    context_lines.append(f"  → Evolución: {rsi_start:.1f} → {rsi_end:.1f} ({'+' if rsi_end>=rsi_start else ''}{rsi_end-rsi_start:.1f})")

            # EMAs
            if ind.get('ema20') and ind.get('ema50'):
                cross = "ALCISTA" if ind['ema20'] > ind['ema50'] else "BAJISTA"
                context_lines.append(f"• EMA20: {ind['ema20']:.2f}")
                context_lines.append(f"• EMA50: {ind['ema50']:.2f}")
                context_lines.append(f"• Cruce: {cross}")
                if ind.get('ema20History') and len(ind['ema20History']) >= 5:
                    hist = ind['ema20History']
                    ema_start = hist[0]['value']
                    ema_end = hist[-1]['value']
                    pct = ((ema_end - ema_start) / ema_start * 100) if ema_start else 0
                    context_lines.append(f"  → EMA20 ev: {ema_start:.2f} → {ema_end:.2f} ({'+' if pct>=0 else ''}{pct:.1f}%)")

            # MACD
            if ind.get('macd') is not None:
                context_lines.append(f"• MACD: {ind['macd']:.4f}")
                context_lines.append(f"• Signal: {ind.get('macd_signal', 0):.4f}")
                context_lines.append(f"• Histograma: {ind.get('macd_hist', 0):.4f}")
                if ind.get('macdHistory') and len(ind['macdHistory']) >= 5:
                    hist = ind['macdHistory']
                    macd_start = hist[0]['value']
                    macd_end = hist[-1]['value']
                    context_lines.append(f"  → MACD ev: {macd_start:.4f} → {macd_end:.4f}")

            # Bollinger
            if ind.get('bb_upper') and ind.get('bb_lower'):
                context_lines.append(f"• Bollinger Upper: {ind['bb_upper']:.2f}")
                context_lines.append(f"• Bollinger Lower: {ind['bb_lower']:.2f}")
                context_lines.append(f"• Posición: {ind.get('bb_position', 'N/A')}")

            # Volumen
            if ind.get('volume_ratio') is not None:
                context_lines.append(f"• Volumen Ratio: {ind['volume_ratio']:.2f}x")
                context_lines.append(f"• Status: {ind.get('volume_status', 'NORMAL')}")
                if ind.get('volumeHistory') and len(ind['volumeHistory']) >= 5:
                    hist = ind['volumeHistory']
                    vol_avg = sum(v['value'] for v in hist) / len(hist)
                    vol_current = hist[-1]['value']
                    context_lines.append(f"  → Vol promedio: {vol_avg:,.0f} → actual: {vol_current:,.0f}")

            if ind.get('golden_cross'):
                context_lines.append("⭐ GOLDEN CROSS detectado")
            if ind.get('death_cross'):
                context_lines.append("💀 DEATH CROSS detectado")

            if ind.get('support20') and ind.get('resistance20'):
                context_lines.append(f"• Soporte(20): {ind['support20']:.2f}")
                context_lines.append(f"• Resistencia(20): {ind['resistance20']:.2f}")

            context_block = "\n".join(context_lines)

            currency_instruction = (
                f"IMPORTANTE: El usuario tiene el gráfico en {currency_label}. "
                f"Todos los precios, niveles de soporte/resistencia, EMAs, Bollinger y valores monetarios "
                f"DEBEN expresarse en {price_symbol}. NO mezcles monedas en la respuesta."
            )

            prompt = f"""Eres analista técnico experto en BVC.
{profile_block}

DATOS TÉCNICOS DE {ctx.symbol}:
{context_block}

{currency_instruction}

PREGUNTA: {chat_data.message}

INSTRUCCIONES:
1. Analiza TODOS los indicadores mencionados arriba
2. Menciona la EVOLUCIÓN de cada indicador (cómo cambió en el período)
3. Explica qué significa cada valor
4. Da una recomendación clara: COMPRAR, MANTENER o VENDER
5. Justifica con al menos 3 indicadores diferentes
6. Máximo 450 palabras
7. Español venezolano profesional
8. Todos los valores monetarios en {price_symbol}
{profile_instruction}

RESPUESTA:"""

        else:
            # Modo general: asesor financiero con perfil del usuario
            profile_ctx = ""
            if profile_block:
                profile_ctx = f"\nCONTEXTO DEL USUARIO:{profile_block}\n"
            prompt = (
                f"Eres un asesor financiero experto en la Bolsa de Valores de Caracas (BVC). "
                f"Respondes siempre en español venezolano de manera clara, profesional y útil.\n"
                f"{profile_ctx}"
                f"\nPREGUNTA: {chat_data.message}\n"
                f"RESPUESTA (máximo 350 palabras):"
            )

        logger.info(f"🤖 [CHAT] Generando respuesta...")
        response = model.generate_content(prompt)

        return ChatResponse(
            response=response.text,
            model_used=model_name,
            timestamp=datetime.now(timezone.utc).isoformat(),
            has_data=True,
            session_id=chat_data.session_id
        )

    except Exception as e:
        logger.error(f"❌ Error en chat IA: {e}", exc_info=True)
        return ChatResponse(
            response="⚠️ Error temporal. Intenta de nuevo.",
            error=str(e),
            timestamp=datetime.now(timezone.utc).isoformat(),
            has_data=False
        )

@router.post("/analyze-portfolio", response_model=AnalyzePortfolioResponse)
async def analyze_portfolio(
    request: Optional[AnalyzePortfolioRequest] = None,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Analizar portafolio de inversión con IA
    
    Args:
        request: Solicitud opcional con datos del portafolio
        user_id: ID del usuario autenticado
        db: Sesión de base de datos
        
    Returns:
        AnalyzePortfolioResponse: Análisis del portafolio
    """
    try:
        genai.configure(api_key=settings.gemini_api_key)
        model, model_name = get_gemini_model()

        prompt = """
        Eres un asesor financiero experto en la Bolsa de Valores de Caracas (BVC) y en mercados bursátiles.
        Eres experto en trading y/o en holding de acuerdo al tipo de riesgo que el usuario tenga o si su 
        inversión es a corto o a largo plazo.
        El usuario quiere analizar su portafolio de inversión.
        
        Proporciona recomendaciones sobre:
        1. Diversificación del portafolio
        2. Gestión de riesgo
        3. Oportunidades en la BVC
        4. Consideraciones sobre inflación y tasa BCV
        5. Estrategias de inversión a largo plazo
        
        Responde en español de manera clara y útil.
        Máximo 300 palabras.
        Usa emojis moderadamente para hacer la respuesta más amigable.
        
        Análisis:
        """

        response = model.generate_content(prompt)
        logger.info(f"✅ Portfolio analysis generated for user {user_id}")

        return AnalyzePortfolioResponse(
            analysis=response.text,
            timestamp=datetime.now(timezone.utc).isoformat()
        )

    except Exception as e:
        logger.error(f"❌ Error analizando portafolio: {e}")
        return AnalyzePortfolioResponse(
            analysis="Lo siento, no pude analizar tu portafolio en este momento. Por favor intenta más tarde.",
            error=str(e),
            timestamp=datetime.now(timezone.utc).isoformat()
        )


@router.get("/models", response_model=ModelInfo)
async def list_available_models():
    """
    Listar modelos de Gemini disponibles para generación de contenido
    
    Returns:
        ModelInfo: Lista de modelos disponibles
    """
    try:
        genai.configure(api_key=settings.gemini_api_key)
        models = genai.list_models()
        available_models = [
            m.name.replace('models/', '')
            for m in models
            if m.supported_generation_methods and 'generateContent' in m.supported_generation_methods
        ]
        return {
            "models": available_models,
            "configured_model": settings.gemini_model,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"Error listing models: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def health_check():
    """
    Verificar estado del servicio de IA
    
    Returns:
        dict: Estado del servicio
    """
    try:
        genai.configure(api_key=settings.gemini_api_key)
        model, model_name = get_gemini_model()
        return {
            "status": "healthy",
            "model": model_name,
            "api_key_configured": bool(settings.gemini_api_key),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"❌ AI health check failed: {e}")
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }