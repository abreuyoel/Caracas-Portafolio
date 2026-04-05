from fastapi import APIRouter, Depends, HTTPException, Header, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, text
from app.database import get_db, AsyncSessionLocal
from app.models.stock import Stock, PriceHistory, BcvRate
from app.services.bvc_scraper import bvc_scraper
from app.utils.security import decode_token
from uuid import UUID
from typing import List, Optional, Dict
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone, date as date_type
import time

def _now():
    """Retorna datetime actual con timezone UTC (compatible con PostgreSQL)"""
    return datetime.now(timezone.utc)
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


class StockInfo(BaseModel):
    """Información de una acción"""
    symbol: str
    name: str
    is_active: bool
    currency: Optional[str] = "Bs"
    last_price: Optional[float] = None
    isin: Optional[str] = None


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


@router.get("/bvc/active", response_model=List[StockInfo])
async def get_bvc_active_stocks(
    user_id: UUID = Depends(get_current_user_id),
    force_refresh: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """
    Obtener lista de acciones ACTIVAS de la BVC.
    Si force_refresh=True o los datos tienen más de 24 horas, se actualizan desde la BVC.
    """
    try:
        # Si no se fuerza refresh, buscar en DB y verificar antigüedad
        if not force_refresh:
            # Obtener la última fecha de actualización de cualquier acción
            result = await db.execute(
                select(Stock.last_updated).order_by(Stock.last_updated.desc()).limit(1)
            )
            last_update = result.scalar_one_or_none()

            # Si hay datos y son recientes (menos de 24h), retornarlos
            if last_update and (_now() - last_update) < timedelta(hours=24):
                result = await db.execute(
                    select(Stock).where(Stock.is_active == True)
                )
                stocks = result.scalars().all()
                # Solo usar caché si tenemos más de 10 acciones
                # (≤10 indica que probablemente solo está el fallback hardcodeado)
                if stocks and len(stocks) > 10:
                    logger.info(f"✅ Usando caché: {len(stocks)} acciones activas en DB")
                    return [
                        StockInfo(
                            symbol=s.symbol,
                            name=s.name,
                            is_active=s.is_active,
                            currency=s.currency,
                            last_price=float(s.last_price) if s.last_price else None,
                            isin=s.isin
                        )
                        for s in stocks
                    ]
                elif stocks:
                    logger.info(f"⚠️ Solo {len(stocks)} acciones en caché (posible fallback), forzando actualización desde BVC...")

        # Si llegamos aquí, necesitamos refrescar desde la BVC
        logger.info("🔄 Actualizando lista de acciones desde BVC...")
        stocks_data = await bvc_scraper.get_active_stocks()

        # Extraer símbolos activos obtenidos
        active_symbols = [s['symbol'] for s in stocks_data]

        # Actualizar o insertar cada acción activa
        updated_count = 0
        for stock_data in stocks_data:
            result = await db.execute(
                select(Stock).where(Stock.symbol == stock_data['symbol'])
            )
            stock = result.scalar_one_or_none()
            now = _now()

            if stock:
                # Actualizar existente
                stock.name = stock_data['name']
                stock.is_active = True
                stock.last_updated = now
            else:
                # Crear nueva
                stock = Stock(
                    symbol=stock_data['symbol'],
                    name=stock_data['name'],
                    is_active=True,
                    currency='Bs',
                    last_updated=now
                )
                db.add(stock)
            updated_count += 1

        # Marcar como inactivas las que estaban en DB pero no aparecen en la nueva lista
        if active_symbols:
            await db.execute(
                update(Stock)
                .where(Stock.symbol.not_in(active_symbols))
                .values(is_active=False, last_updated=_now())
            )

        await db.commit()

        logger.info(f"✅ {updated_count} acciones activas actualizadas en DB")
        return [
            StockInfo(
                symbol=s['symbol'],
                name=s['name'],
                is_active=True,
                currency='Bs'
            )
            for s in stocks_data
        ]

    except Exception as e:
        logger.error(f"❌ Error en get_bvc_active_stocks: {e}")
        # Fallback: retornar lista hardcodeada de activas
        fallback = bvc_scraper._get_fallback_stocks()
        return [
            StockInfo(
                symbol=s['symbol'],
                name=s['name'],
                is_active=True,
                currency='Bs'
            )
            for s in fallback
        ]


@router.get("/bvc/market-movers")
async def get_market_movers(
    user_id: UUID = Depends(get_current_user_id),
    period: str = "weekly",
    db: AsyncSession = Depends(get_db)
):
    """
    Retorna top gainers, losers y stable de la BVC para el período indicado.
    period: weekly (7d) | monthly (30d) | quarterly (90d)
    Calcula el % de cambio entre el precio al inicio del período y el más reciente.
    """
    period_days = {"weekly": 7, "monthly": 30, "quarterly": 90}.get(period, 7)
    cutoff = date_type.today() - timedelta(days=period_days)

    try:
        stocks_res = await db.execute(select(Stock).where(Stock.is_active == True))
        stocks = stocks_res.scalars().all()

        movers = []
        for stock in stocks:
            # Precio más reciente disponible
            latest_res = await db.execute(
                select(PriceHistory)
                .where(PriceHistory.stock_id == stock.id)
                .order_by(PriceHistory.price_date.desc())
                .limit(1)
            )
            latest = latest_res.scalar_one_or_none()
            if not latest:
                continue

            # Precio al inicio del período
            start_res = await db.execute(
                select(PriceHistory)
                .where(PriceHistory.stock_id == stock.id, PriceHistory.price_date <= cutoff)
                .order_by(PriceHistory.price_date.desc())
                .limit(1)
            )
            start = start_res.scalar_one_or_none()

            latest_price = float(latest.close_price or 0)
            if not start:
                # Usar el primer precio disponible dentro del período si no hay anterior al corte
                first_res = await db.execute(
                    select(PriceHistory)
                    .where(PriceHistory.stock_id == stock.id, PriceHistory.price_date >= cutoff)
                    .order_by(PriceHistory.price_date.asc())
                    .limit(1)
                )
                first = first_res.scalar_one_or_none()
                if not first:
                    continue
                start_price = float(first.close_price or 0)
                start_date = first.price_date.isoformat()
            else:
                start_price = float(start.close_price or 0)
                start_date = start.price_date.isoformat()

            if start_price <= 0 or latest_price <= 0:
                continue

            change_pct = ((latest_price - start_price) / start_price) * 100
            movers.append({
                "symbol": stock.symbol,
                "name": stock.name,
                "start_price": round(start_price, 2),
                "start_date": start_date,
                "latest_price": round(latest_price, 2),
                "change_pct": round(change_pct, 2),
                "last_date": latest.price_date.isoformat(),
                "volume": int(latest.volume or 0),
            })

        if not movers:
            return {
                "period": period,
                "gainers": [], "losers": [], "stable": [], "uptrend": [], "institutional": [],
                "message": "Sin datos históricos aún. Visita la sección Gráficos para cargar histórico de alguna acción."
            }

        movers.sort(key=lambda x: x["change_pct"], reverse=True)

        gainers = sorted([m for m in movers if m["change_pct"] > 0], key=lambda x: x["change_pct"], reverse=True)[:5]
        losers  = sorted([m for m in movers if m["change_pct"] < 0], key=lambda x: x["change_pct"])[:5]
        stable  = [m for m in movers if abs(m["change_pct"]) <= 1][:5]

        # ── Uptrend: sesiones consecutivas al alza ─────────────────────────────
        uptrend = []
        if period in ("monthly", "quarterly"):
            for stock in stocks:
                hist_res = await db.execute(
                    select(PriceHistory)
                    .where(PriceHistory.stock_id == stock.id, PriceHistory.price_date >= cutoff)
                    .order_by(PriceHistory.price_date.asc())
                )
                hist = hist_res.scalars().all()
                if len(hist) < 3:
                    continue
                closes = [float(h.close_price or 0) for h in hist]
                consecutive = max_consecutive = 0
                for i in range(1, len(closes)):
                    if closes[i] > closes[i - 1]:
                        consecutive += 1
                        max_consecutive = max(max_consecutive, consecutive)
                    else:
                        consecutive = 0
                if max_consecutive >= 3:
                    mover = next((m for m in movers if m["symbol"] == stock.symbol), None)
                    if mover:
                        uptrend.append({**mover, "consecutive_up": max_consecutive})
            uptrend.sort(key=lambda x: x.get("consecutive_up", 0), reverse=True)
            uptrend = uptrend[:5]

        # ── Cartera institucional: mayor volumen acumulado + más sesiones operadas ─
        # Proxy: acciones con más días negociados y mayor volumen en el período
        institutional_candidates = []
        for stock in stocks:
            hist_res = await db.execute(
                select(PriceHistory)
                .where(PriceHistory.stock_id == stock.id, PriceHistory.price_date >= cutoff)
                .order_by(PriceHistory.price_date.asc())
            )
            hist = hist_res.scalars().all()
            if len(hist) < 2:
                continue
            sessions = len(hist)
            total_vol = sum(int(h.volume or 0) for h in hist)
            total_amount = sum(float(h.amount or 0) for h in hist)
            latest_close = float(hist[-1].close_price or 0)
            # Score: sesiones * volumen ponderado (favorece liquidez y actividad)
            liquidity_score = sessions * (total_vol ** 0.5)
            mover = next((m for m in movers if m["symbol"] == stock.symbol), None)
            if mover:
                institutional_candidates.append({
                    **mover,
                    "sessions": sessions,
                    "total_volume": total_vol,
                    "total_amount_bs": round(total_amount, 0),
                    "liquidity_score": round(liquidity_score, 0),
                })
        institutional_candidates.sort(key=lambda x: x["liquidity_score"], reverse=True)
        institutional = institutional_candidates[:6]

        return {
            "period": period,
            "period_days": period_days,
            "gainers": gainers,
            "losers": losers,
            "stable": stable,
            "uptrend": uptrend,
            "institutional": institutional,
            "total_analyzed": len(movers),
        }

    except Exception as e:
        logger.error(f"❌ Error market-movers: {e}")
        return {"period": period, "gainers": [], "losers": [], "stable": [], "uptrend": [], "institutional": [], "error": str(e)}


@router.get("/bcv-rates")
async def get_bcv_rates(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Retorna todas las tasas BCV disponibles como {fecha: tasa}"""
    try:
        result = await db.execute(select(BcvRate).order_by(BcvRate.rate_date))
        rates = result.scalars().all()
        return {r.rate_date.isoformat(): float(r.rate) for r in rates}
    except Exception as e:
        logger.error(f"❌ Error getting BCV rates: {e}")
        return {}


class BcvRateItem(BaseModel):
    date: str   # YYYY-MM-DD
    rate: float


@router.post("/bcv-rates/import")
async def import_bcv_rates(
    items: List[BcvRateItem],
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Importa tasas BCV en bulk. Formato: [{date: 'YYYY-MM-DD', rate: float}]"""
    try:
        inserted = 0
        for item in items:
            try:
                d = date_type.fromisoformat(item.date)
                await db.execute(
                    text("""
                        INSERT INTO bcv_rates (rate_date, rate)
                        VALUES (:d, :r)
                        ON CONFLICT (rate_date) DO UPDATE SET rate = EXCLUDED.rate
                    """),
                    {"d": d, "r": item.rate}
                )
                inserted += 1
            except Exception:
                continue
        await db.commit()
        return {"imported": inserted, "total": len(items)}
    except Exception as e:
        await db.rollback()
        logger.error(f"❌ Error importing BCV rates: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Estado global del sync ────────────────────────────────────────────────────
_sync_running = False
_sync_last_completed: Optional[str] = None   # ISO datetime
_sync_stocks_done = 0
_sync_stocks_total = 0


async def _sync_all_history_bg():
    """Tarea en background: descarga historial de todas las acciones activas."""
    global _sync_running, _sync_last_completed, _sync_stocks_done, _sync_stocks_total
    if _sync_running:
        logger.info("⏭️ [SYNC] Ya hay un sync en curso, se omite.")
        return
    _sync_running = True
    _sync_stocks_done = 0
    _sync_stocks_total = 0
    try:
        async with AsyncSessionLocal() as db:
            stocks_res = await db.execute(select(Stock).where(Stock.is_active == True))
            stocks = stocks_res.scalars().all()
            _sync_stocks_total = len(stocks)
            logger.info(f"🔄 [SYNC] Iniciando sync de {_sync_stocks_total} acciones…")
            synced = 0
            for stock in stocks:
                try:
                    recent_res = await db.execute(
                        select(PriceHistory)
                        .where(PriceHistory.stock_id == stock.id)
                        .order_by(PriceHistory.price_date.desc())
                        .limit(1)
                    )
                    recent = recent_res.scalar_one_or_none()
                    if recent and (date_type.today() - recent.price_date).days <= 7:
                        continue  # Ya tiene datos recientes
                    
                    # Llamar al método local que descarga datos, ajusta y guarda de ser necesario.
                    await get_stock_history(symbol=stock.symbol, user_id=None, db=db)
                    synced += 1
                except Exception as e:
                    logger.warning(f"⚠️ [SYNC] {stock.symbol}: {e}")
                finally:
                    _sync_stocks_done += 1
            _sync_last_completed = datetime.now(timezone.utc).isoformat()
            logger.info(f"✅ [SYNC] Completado: {synced} acciones sincronizadas")
    except Exception as e:
        logger.error(f"❌ [SYNC] Error: {e}")
    finally:
        _sync_running = False


@router.get("/bvc/sync-status")
async def get_sync_status(user_id: UUID = Depends(get_current_user_id)):
    """Retorna el estado actual del sync de historial."""
    return {
        "running": _sync_running,
        "stocks_done": _sync_stocks_done,
        "stocks_total": _sync_stocks_total,
        "last_completed": _sync_last_completed,
    }


@router.post("/bvc/sync-history")
async def sync_all_history(
    background_tasks: BackgroundTasks,
    user_id: UUID = Depends(get_current_user_id),
):
    """Dispara sync de historial de todas las acciones en background."""
    if _sync_running:
        return {"message": "Sync ya en progreso", "running": True}
    background_tasks.add_task(_sync_all_history_bg)
    return {"message": "Sync iniciado en background", "running": True}


@router.get("/bvc/{symbol}")
async def get_stock_details(
    symbol: str,
    user_id: UUID = Depends(get_current_user_id)
):
    """Obtener detalles de una acción específica y verificar si está activa"""
    try:
        details = await bvc_scraper.get_stock_details(symbol.upper())
        if not details:
            raise HTTPException(status_code=404, detail="Acción no encontrada")
        if not details.get('is_active', False):
            raise HTTPException(
                status_code=400,
                detail=f"La acción {symbol} no está activa (Estado: {details.get('status', 'Desconocido')})"
            )
        return details
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error getting stock details: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bvc/refresh")
async def refresh_stocks_from_bvc(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Forzar actualización completa de la lista de acciones desde la BVC
    """
    try:
        stocks_data = await bvc_scraper.get_active_stocks()
        active_symbols = [s['symbol'] for s in stocks_data]

        updated_count = 0
        for stock_data in stocks_data:
            result = await db.execute(
                select(Stock).where(Stock.symbol == stock_data['symbol'])
            )
            stock = result.scalar_one_or_none()
            now = _now()

            if stock:
                stock.name = stock_data['name']
                stock.is_active = True
                stock.last_updated = now
            else:
                stock = Stock(
                    symbol=stock_data['symbol'],
                    name=stock_data['name'],
                    is_active=True,
                    currency='Bs',
                    last_updated=now
                )
                db.add(stock)
            updated_count += 1

        # Desactivar las que ya no están
        if active_symbols:
            await db.execute(
                update(Stock)
                .where(Stock.symbol.not_in(active_symbols))
                .values(is_active=False, last_updated=_now())
            )

        await db.commit()

        return {
            "message": f"✅ {updated_count} acciones activas actualizadas",
            "count": updated_count,
            "active_count": len(active_symbols),
            "timestamp": _now().isoformat()
        }

    except Exception as e:
        await db.rollback()
        logger.error(f"❌ Error refreshing stocks: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ── Mapa de meses para parseo de fechas BVC ────────────────────────────────
_MONTH_MAP = {
    'JAN':1,'FEB':2,'MAR':3,'APR':4,'MAY':5,'JUN':6,
    'JUL':7,'AUG':8,'SEP':9,'OCT':10,'NOV':11,'DEC':12,
    'ENE':1,'ABR':4,'AGO':8,'DIC':12,
}

def _bvc_date_iso(date_str: str) -> str | None:
    """Convierte '20-MAR-26' → '2026-03-20'"""
    try:
        parts = date_str.strip().split('-')
        if len(parts) != 3:
            return None
        day   = int(parts[0])
        month = _MONTH_MAP.get(parts[1].upper())
        year_s= int(parts[2])
        year  = 2000 + year_s if year_s < 100 else year_s
        if not month:
            return None
        return f"{year:04d}-{month:02d}-{day:02d}"
    except Exception:
        return None

def _bvc_num(s: str) -> float | None:
    """Parsea número venezolano: '2.180.579,95' → 2180579.95"""
    s = str(s).strip()
    if not s or s == '-':
        return None
    if '.' in s and ',' in s:
        s = s.replace('.', '').replace(',', '.')
    elif ',' in s:
        s = s.replace(',', '.')
    try:
        return float(s)
    except Exception:
        return None


async def _store_price_history(db: AsyncSession, symbol: str, candles: list) -> None:
    """Upsert candles into price_history table for a given symbol."""
    try:
        stock_res = await db.execute(select(Stock).where(Stock.symbol == symbol))
        stock = stock_res.scalar_one_or_none()
        if not stock:
            return
        for c in candles:
            try:
                price_date = date_type.fromisoformat(c['time'])
            except Exception:
                continue
            await db.execute(
                text("""
                    INSERT INTO price_history
                        (stock_id, price_date, open_price, close_price, high_price, low_price, volume, amount, trades)
                    VALUES
                        (:sid, :pd, :op, :cp, :hp, :lp, :vol, :amt, :trd)
                    ON CONFLICT (stock_id, price_date) DO UPDATE SET
                        close_price = EXCLUDED.close_price,
                        open_price  = EXCLUDED.open_price,
                        high_price  = EXCLUDED.high_price,
                        low_price   = EXCLUDED.low_price,
                        volume      = EXCLUDED.volume,
                        amount      = EXCLUDED.amount,
                        trades      = EXCLUDED.trades
                """),
                {
                    "sid": stock.id,
                    "pd": price_date,
                    "op": c.get("open"),
                    "cp": c.get("close"),
                    "hp": c.get("high"),
                    "lp": c.get("low"),
                    "vol": int(c.get("volume") or 0),
                    "amt": c.get("amount"),
                    "trd": int(c.get("trades") or 0),
                }
            )
        await db.commit()
        
        # 3. Actualizar last_price en la tabla stocks con el cierre mas reciente
        if candles:
            latest_candle = max(candles, key=lambda x: x['time'])
            stock.last_price = latest_candle.get('close')
            stock.last_updated = _now()
            await db.commit()
            
        logger.info(f"✅ [HISTORY-STORE] {symbol}: {len(candles)} candles upserted and last_price updated")
    except Exception as e:
        logger.warning(f"⚠️ [HISTORY-STORE] {symbol}: {e}")
        try:
            await db.rollback()
        except Exception:
            pass


@router.get("/bvc/{symbol}/history")
async def get_stock_history(
    symbol: str,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Obtener datos históricos OHLCV completos de una acción para gráficos de velas.
    - Si la tabla #ult3 tiene más de 10 registros, se usa directamente (rápido).
    - Si no, se utiliza el calendario y paginación (más lento, solo para acciones con poca actividad reciente).
    - Aplica ajuste por reconversión monetaria (2008, 2021).
    - Retorna velas ordenadas ASC por fecha para LightweightCharts.
    """
    sym = symbol.upper().strip()
    logger.info(f"📊 Obteniendo historial para {sym}")

    try:
        # 1. Obtener HTML completo para analizar #ult3
        html = await bvc_scraper._get_full_html(sym)
        if not html:
            logger.warning(f"⚠️ No se pudo obtener HTML para {sym}, usando fallback")
            return await _fallback_history(sym)

        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, 'lxml')
        tbody = soup.find('tbody', {'id': 'ult3'})

        # 2. Decidir qué método usar según cantidad de filas en #ult3
        use_calendar = False
        rows = []

        if tbody:
            rows = tbody.find_all('tr')
            logger.info(f"🔍 {sym}: {len(rows)} filas encontradas en #ult3")

        # Si hay pocas filas (≤ 10), es probable que solo muestre los últimos 3 movimientos
        # y necesitemos el calendario. De lo contrario, usamos #ult3 directamente.
        if len(rows) <= 10:
            logger.info(f"📅 {sym}: solo {len(rows)} filas en #ult3, usando calendario/paginación")
            use_calendar = True

        if use_calendar:
            full_history = await bvc_scraper.get_full_price_history(sym)
            if not full_history:
                logger.warning(f"⚠️ No se obtuvo historial completo para {sym}, usando fallback #ult3")
                return await _fallback_history(sym)

            candles = []
            for item in full_history:
                candles.append({
                    'time':    item['date'].isoformat(),
                    'open':    float(item['open']),
                    'high':    float(item['high']),
                    'low':     float(item['low']),
                    'close':   float(item['close']),
                    'volume':  int(item['volume']),
                    'amount':  float(item['amount']),
                    'trades':  int(item['trades']),
                })
        else:
            # Procesar directamente desde #ult3 (mucho más rápido)
            raw_candles = []
            for row in rows:
                cells = row.find_all('td')
                if len(cells) < 10:
                    continue
                raw_date = cells[0].get_text(strip=True)
                date_iso = _bvc_date_iso(raw_date)
                if not date_iso:
                    continue

                open_p  = _bvc_num(cells[1].get_text(strip=True))
                close_p = _bvc_num(cells[2].get_text(strip=True))
                high_p  = _bvc_num(cells[5].get_text(strip=True))
                low_p   = _bvc_num(cells[6].get_text(strip=True))
                volume  = _bvc_num(cells[8].get_text(strip=True))
                amount  = _bvc_num(cells[9].get_text(strip=True))
                trades  = _bvc_num(cells[7].get_text(strip=True))

                if any(v is None for v in [open_p, close_p, high_p, low_p]):
                    continue

                raw_candles.append({
                    'time':   date_iso,
                    'open':   open_p,
                    'high':   high_p,
                    'low':    low_p,
                    'close':  close_p,
                    'volume': volume or 0,
                    'amount': amount or 0,
                    'trades': int(trades) if trades else 0,
                })

            if not raw_candles:
                raise HTTPException(status_code=404, detail=f"Sin datos históricos para {sym}")

            raw_candles.sort(key=lambda x: x['time'])
            candles = _adjust_for_reconversion(sym, raw_candles)

        logger.info(f"✅ [HISTORY] {sym}: {len(candles)} velas finales | "
                    f"{candles[0]['time']} → {candles[-1]['time']} | cierre: {candles[-1]['close']}")

        # Store in price_history table (background, non-blocking errors)
        try:
            await _store_price_history(db, sym, candles)
        except Exception as store_err:
            logger.warning(f"⚠️ [HISTORY-STORE] No se pudo guardar historial: {store_err}")

        return {
            'symbol':  sym,
            'count':   len(candles),
            'candles': candles,
        }

    except Exception as e:
        logger.error(f"❌ Error obteniendo historial de {sym}: {e}")
        # Fallback final: intentar con la tabla #ult3
        try:
            return await _fallback_history(sym)
        except Exception:
            raise HTTPException(status_code=500, detail=str(e))
        
async def _fallback_history(symbol: str):
    """Fallback usando solo la tabla #ult3 (comportamiento original)"""
    sym = symbol.upper().strip()
    logger.info(f"📊 [FALLBACK] Usando #ult3 para {sym}")

    html = await bvc_scraper._get_full_html(sym)
    if not html:
        raise HTTPException(status_code=503, detail="Scraping no disponible")

    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, 'lxml')

    tbody = soup.find('tbody', {'id': 'ult3'})
    if not tbody:
        raise HTTPException(status_code=404, detail=f"Sin datos históricos para {sym}")

    rows = tbody.find_all('tr')
    raw_candles = []
    for row in rows:
        cells = row.find_all('td')
        if len(cells) < 10:
            continue
        raw_date = cells[0].get_text(strip=True)
        date_iso = _bvc_date_iso(raw_date)
        if not date_iso:
            continue

        open_p  = _bvc_num(cells[1].get_text(strip=True))
        close_p = _bvc_num(cells[2].get_text(strip=True))
        high_p  = _bvc_num(cells[5].get_text(strip=True))
        low_p   = _bvc_num(cells[6].get_text(strip=True))
        volume  = _bvc_num(cells[8].get_text(strip=True))
        amount  = _bvc_num(cells[9].get_text(strip=True))
        trades  = _bvc_num(cells[7].get_text(strip=True))

        if any(v is None for v in [open_p, close_p, high_p, low_p]):
            continue

        raw_candles.append({
            'time':   date_iso,
            'open':   open_p,
            'high':   high_p,
            'low':    low_p,
            'close':  close_p,
            'volume': volume or 0,
            'amount': amount or 0,
            'trades': int(trades) if trades else 0,
        })

    if not raw_candles:
        raise HTTPException(status_code=404, detail=f"Sin datos históricos para {sym}")

    raw_candles.sort(key=lambda x: x['time'])
    candles = _adjust_for_reconversion(sym, raw_candles)

    return {
        'symbol':  sym,
        'count':   len(candles),
        'candles': candles,
    }

def _adjust_for_reconversion(symbol: str, candles: list) -> list:
    """Ajusta precios por reconversiones monetarias (mismo código original)"""
    candles = [dict(c) for c in candles]
    i = 1
    while i < len(candles):
        prev_close = candles[i-1]['close']
        curr_open  = candles[i]['open']
        if prev_close > 0 and curr_open > 0:
            ratio = prev_close / curr_open
            if ratio > 500:
                exp = 0
                r = ratio
                while r > 3:
                    r /= 1000
                    exp += 1
                factor = 1000 ** exp
                if factor < 1000:
                    factor = 1000
                logger.info(f"💱 [HISTORY] {symbol}: reconversión en {candles[i]['time']} "
                           f"ratio={ratio:.0f}x → factor={factor:,.0f}. "
                           f"Ajustando {i} velas anteriores.")
                for j in range(i):
                    for field in ('open', 'high', 'low', 'close'):
                        candles[j][field] = round(candles[j][field] / factor, 4)
                    if candles[j].get('amount'):
                        candles[j]['amount'] = round(candles[j]['amount'] / factor, 2)
        i += 1
    return candles

def _bvc_date_iso(date_str: str) -> str | None:
    """Convierte '20-MAR-26' → '2026-03-20'"""
    try:
        parts = date_str.strip().split('-')
        if len(parts) != 3:
            return None
        day   = int(parts[0])
        month = _MONTH_MAP.get(parts[1].upper())
        year_s= int(parts[2])
        year  = 2000 + year_s if year_s < 100 else year_s
        if not month:
            return None
        return f"{year:04d}-{month:02d}-{day:02d}"
    except Exception:
        return None

def _bvc_num(s: str) -> float | None:
    """Parsea número venezolano: '2.180.579,95' → 2180579.95"""
    s = str(s).strip()
    if not s or s == '-':
        return None
    if '.' in s and ',' in s:
        s = s.replace('.', '').replace(',', '.')
    elif ',' in s:
        s = s.replace(',', '.')
    try:
        return float(s)
    except Exception:
        return None



@router.get("/bvc/{symbol}/live")
async def get_live_candle(
    symbol: str,
    user_id: UUID = Depends(get_current_user_id)
):
    """
    Obtiene la vela del día actual en tiempo real desde market.bolsadecaracas.com.
    - Si el mercado está cerrado: retorna {market_open: false}
    - Si está abierto: retorna la vela live del día con {market_open: true, candle: {...}}
    - Si la acción no tiene movimiento hoy: retorna {market_open: true, candle: null}
    """
    sym = symbol.upper().strip()

    market_open = bvc_scraper.is_market_open()
    logger.info(f"📡 [LIVE] {sym} — mercado {'ABIERTO' if market_open else 'CERRADO'}")

    if not market_open:
        return {
            'symbol':      sym,
            'market_open': False,
            'candle':      None,
            'message':     'Mercado cerrado',
        }

    try:
        candle = await bvc_scraper.get_live_candle(sym)
    except Exception as e:
        logger.error(f"❌ [LIVE] Error scraping {sym}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    if candle:
        logger.info(f"✅ [LIVE] {sym}: O={candle['open']} H={candle['high']} L={candle['low']} C={candle['close']} V={candle['volume']}")
    else:
        logger.info(f"⚠️ [LIVE] {sym}: sin movimiento hoy")

    return {
        'symbol':      sym,
        'market_open': True,
        'candle':      candle,
    }


_historical_rates_cache = None
_historical_rates_cache_time = None
CACHE_TTL = 3600  # 1 hour

@router.get("/bcv-rates/historical")
async def get_historical_bcv_rates(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Return all historical USD rates from the database (bcv_rates table)."""
    global _historical_rates_cache, _historical_rates_cache_time
    now = time.time()
    if _historical_rates_cache is None or (now - _historical_rates_cache_time) > CACHE_TTL:
        try:
            result = await db.execute(select(BcvRate).order_by(BcvRate.rate_date))
            rates = result.scalars().all()
            _historical_rates_cache = {r.rate_date.isoformat(): float(r.rate) for r in rates}
        except Exception as e:
            logger.error(f"Error loading historical BCV rates from DB: {e}")
            _historical_rates_cache = {}
        _historical_rates_cache_time = now
    return {"rates": _historical_rates_cache}