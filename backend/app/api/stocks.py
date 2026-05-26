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


@router.get("/bvc/with-history", response_model=List[StockInfo])
async def get_stocks_with_history(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Devuelve acciones con actividad de precio en los últimos 6 meses.
    Filtra acciones inactivas como CIE que no han tenido movimiento reciente.
    """
    six_months_ago = (_now() - timedelta(days=180)).date()
    result = await db.execute(
        select(Stock)
        .where(
            Stock.id.in_(
                select(PriceHistory.stock_id)
                .where(PriceHistory.price_date >= six_months_ago)
                .distinct()
            )
        )
        .order_by(Stock.symbol.asc())
    )
    stocks = result.scalars().all()
    return [
        StockInfo(
            symbol=s.symbol,
            name=s.name,
            is_active=s.is_active,
            currency=s.currency or "Bs",
            last_price=float(s.last_price) if s.last_price else None,
            isin=s.isin,
        )
        for s in stocks
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
    """Retorna todas las tasas BCV disponibles como {fecha: tasa}.
       Scrapea la tasa actual si el día de hoy no está en la BD.
    """
    try:
        from datetime import datetime, timezone, timedelta
        tz_ve = timezone(timedelta(hours=-4))
        today_iso = datetime.now(tz_ve).date().isoformat()

        result = await db.execute(select(BcvRate).order_by(BcvRate.rate_date))
        rates = result.scalars().all()

        rates_dict = {r.rate_date.isoformat(): float(r.rate) for r in rates}

        if today_iso not in rates_dict:
            from app.services.bcv_daily_service import _scrape_bcv_home, save_bcv_rate_to_db
            try:
                scraped = await _scrape_bcv_home()
                if scraped:
                    await save_bcv_rate_to_db(scraped["date"], scraped["rate"])
                    rates_dict[scraped["date"]] = scraped["rate"]
            except Exception as scrape_err:
                logger.error(f"Error scraping fallback BCV rate: {scrape_err}")

        return rates_dict
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


@router.post("/bvc/register-symbol")
async def register_symbol_from_bvc(
    symbol: str,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Registers (or re-activates) any BVC symbol directly from the BVC API,
    bypassing the Playwright scraper.  Useful when a stock is active on BVC
    but missing or marked inactive in the local DB.
    """
    import httpx as _httpx
    from datetime import date as _date

    sym = symbol.upper().strip()

    # ── Fetch metadata from getHistoricoSimbolo ───────────────────────────────
    try:
        async with _httpx.AsyncClient(timeout=20, verify=False) as client:
            hr = await client.post(
                _BVC_HIST_URL,
                content=f"simbolo={sym}",
                headers=_BVC_SCRAPE_HEADERS,
            )
            hr.raise_for_status()
            hdata = hr.json()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"No se pudo contactar BVC: {e}")

    if not hdata or not isinstance(hdata, dict):
        raise HTTPException(status_code=404, detail=f"BVC no devolvió datos para {sym}")

    encab_list = hdata.get("cur_hist_encab", [])
    if not encab_list:
        raise HTTPException(status_code=404, detail=f"Símbolo {sym} no encontrado en BVC")

    encab = encab_list[0]
    bvc_status = (encab.get("ESTATUS") or "").upper()
    name  = encab.get("DESC_EMP") or encab.get("DESC_SIMB") or sym
    isin  = encab.get("COD_ISIN") or None
    shares = encab.get("ACC_CIRC") or None

    # Verify it has recent sessions (last 6 months)
    sessions = await _fetch_bvc_sessions_for_symbol(sym)
    if not sessions:
        raise HTTPException(
            status_code=422,
            detail=f"{sym} no tiene sesiones en BVC. Verifica que el símbolo sea correcto."
        )

    latest_date = max(s["fecha"] for s in sessions)
    cutoff = (_date.today().replace(year=_date.today().year - 1)).isoformat()  # 1 year ago
    is_recently_active = latest_date >= cutoff

    # ── Upsert into stocks table ──────────────────────────────────────────────
    result = await db.execute(select(Stock).where(Stock.symbol == sym))
    stock = result.scalar_one_or_none()
    now = _now()

    if stock:
        stock.name = name
        stock.is_active = True
        stock.last_updated = now
        if isin:  stock.isin = isin
        action = "updated"
    else:
        stock = Stock(
            symbol=sym, name=name, is_active=True,
            currency="Bs", last_updated=now,
            isin=isin,
        )
        db.add(stock)
        action = "created"

    await db.commit()
    await db.refresh(stock)

    # Insert missing sessions
    inserted = await _insert_missing_sessions(db, stock, sessions)

    return {
        "symbol": sym,
        "name": name,
        "isin": isin,
        "bvc_status": bvc_status,
        "latest_session": latest_date,
        "total_sessions": len(sessions),
        "db_action": action,
        "sessions_inserted": inserted,
        "message": f"✅ {sym} registrado como activo. {inserted} sesiones nuevas insertadas.",
    }


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


@router.post("/bvc/sync-all-bvc-history")
async def sync_all_bvc_history(
    background_tasks: BackgroundTasks,
    user_id: UUID = Depends(get_current_user_id),
):
    """
    Re-descarga el histórico completo de todas las acciones activas desde las
    APIs JSON de la BVC (getOperacionesHistorico + getHistoricoSimbolo) e inserta
    únicamente las fechas que aún no están en price_history (skip por (stock_id, price_date)).

    Esto es lo que alimenta los gráficos: sincroniza todas las velas faltantes
    hasta hoy. Corre en background; el progreso/finalización queda en los logs
    del servidor con el prefijo [BVC-BATCH-SYNC].
    """
    from app.api.stocks import _sync_all_bvc_sessions_bg
    background_tasks.add_task(_sync_all_bvc_sessions_bg)
    return {
        "message": "Sync BVC completo iniciado en background",
        "method": "_sync_all_bvc_sessions_bg",
        "note": "Inserta solo fechas faltantes — las existentes se omiten",
    }


@router.get("/bvc/{symbol}")
async def get_stock_details(
    symbol: str,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Obtener detalles de una acción específica y verificar si está activa"""
    sym = symbol.upper()
    try:
        details = await bvc_scraper.get_stock_details(sym)
        if details:
            if not details.get('is_active', False):
                raise HTTPException(
                    status_code=400,
                    detail=f"La acción {sym} no está activa (Estado: {details.get('status', 'Desconocido')})"
                )
            # Cache ISIN and shares_outstanding back to DB for future DB fallbacks
            try:
                db_result = await db.execute(select(Stock).where(Stock.symbol == sym))
                db_stock = db_result.scalar_one_or_none()
                if db_stock:
                    isin_val = details.get('isin') or None
                    shares_val = details.get('shares_outstanding')
                    shares_int = None
                    if shares_val and str(shares_val).strip() not in ('', '0'):
                        try:
                            shares_int = int(str(shares_val).replace('.', '').replace(',', ''))
                        except Exception:
                            pass
                    if isin_val:
                        db_stock.isin = isin_val
                    if shares_int:
                        db_stock.shares_outstanding = shares_int
                    if isin_val or shares_int:
                        await db.commit()
            except Exception as cache_err:
                logger.warning(f"⚠️ Could not cache stock details: {cache_err}")
            return details
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"⚠️ BVC scraping failed for {sym}: {e}")

    # DB fallback when BVC is unreachable
    try:
        result = await db.execute(select(Stock).where(Stock.symbol == sym))
        stock = result.scalar_one_or_none()
        if stock:
            logger.info(f"✅ [DB-FALLBACK] Retornando datos de DB para {sym}")
            return {
                "symbol": stock.symbol,
                "name": stock.name,
                "company_name": stock.name,
                "is_active": stock.is_active,
                "currency": "Bs",
                "last_price": float(stock.last_price) if stock.last_price else None,
                "isin": stock.isin or "",
                "shares_outstanding": str(stock.shares_outstanding) if stock.shares_outstanding else "0",
                "source": "cache",
            }
    except Exception as db_err:
        logger.error(f"❌ [DB-FALLBACK] Error: {db_err}")

    raise HTTPException(status_code=404, detail=f"Acción {sym} no encontrada")


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
    """Convierte '20-MAR-26' o '20/03/2026' → '2026-03-20'"""
    date_str = date_str.strip()
    try:
        if '/' in date_str:
            parts = date_str.split('/')
            if len(parts) != 3:
                return None
            day = int(parts[0])
            month = int(parts[1])
            year = int(parts[2])
            if year < 100:
                year += 2000
            return f"{year:04d}-{month:02d}-{day:02d}"
        else:
            parts = date_str.split('-')
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
    """Parsea número venezolano: '2.180.579,95' → 2180579.95. Used by _parse_row and get_stock_history."""
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
        elif len(rows) > 0:
            # Comprobar que la fecha más reciente en #ult3 sea de los últimos días (max 3 días).
            # En ocasiones el sitio BVC desactualiza la tabla #ult3 y se debe consultar el histórico
            # de movimientos para obtener los días faltantes.
            from datetime import datetime, timezone, timedelta
            first_row_cells = rows[0].find_all('td')
            if first_row_cells:
                raw_date = first_row_cells[0].get_text(strip=True)
                date_iso = _bvc_date_iso(raw_date)
                if date_iso:
                    last_date = date_type.fromisoformat(date_iso)
                    tz_ve = timezone(timedelta(hours=-4))
                    today_ven = datetime.now(tz_ve).date()
                    if (today_ven - last_date).days > 3:
                        logger.info(f"📅 {sym}: la última fecha de #ult3 ({date_iso}) está atrasada, usando calendario/paginación")
                        use_calendar = True

        if use_calendar:
            # Optimización: buscar la última fecha en BD para no descargar desde 2021
            start_date_str = None
            try:
                stock_res = await db.execute(select(Stock).where(Stock.symbol == sym))
                stock = stock_res.scalar_one_or_none()
                if stock:
                    latest_ph_res = await db.execute(
                        select(PriceHistory)
                        .where(PriceHistory.stock_id == stock.id)
                        .order_by(PriceHistory.price_date.desc())
                        .limit(1)
                    )
                    latest_ph = latest_ph_res.scalar_one_or_none()
                    if latest_ph:
                        # Restamos 5 días para asegurar solapamiento y no perder datos
                        overlap_date = latest_ph.price_date - timedelta(days=5)
                        start_date_str = overlap_date.isoformat()
            except Exception as db_err:
                logger.warning(f"⚠️ Error buscando latest price para {sym}, descargando full: {db_err}")

            full_history = await bvc_scraper.get_full_price_history(sym, start_date=start_date_str)
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
        # Fallback final: usar datos cacheados en price_history (DB)
        try:
            stock_res = await db.execute(select(Stock).where(Stock.symbol == sym))
            stock = stock_res.scalar_one_or_none()
            if stock:
                from app.models.stock import PriceHistory
                ph_res = await db.execute(
                    select(PriceHistory)
                    .where(PriceHistory.stock_id == stock.id)
                    .order_by(PriceHistory.price_date.asc())
                )
                rows = ph_res.scalars().all()
                if rows:
                    candles = [
                        {
                            'time':   r.price_date.isoformat(),
                            'open':   float(r.open_price or r.close_price or 0),
                            'high':   float(r.high_price or r.close_price or 0),
                            'low':    float(r.low_price or r.close_price or 0),
                            'close':  float(r.close_price or 0),
                            'volume': int(r.volume or 0),
                            'amount': float(r.amount or 0),
                            'trades': int(r.trades or 0),
                        }
                        for r in rows
                    ]
                    logger.info(f"📦 [DB-FALLBACK] {sym}: {len(candles)} velas desde price_history")
                    return {'symbol': sym, 'count': len(candles), 'candles': candles}
        except Exception as db_err:
            logger.error(f"❌ [DB-FALLBACK] Error consultando price_history para {sym}: {db_err}")
        raise HTTPException(status_code=503, detail=f"Datos de historial no disponibles para {sym}")
        
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




@router.get("/bvc/{symbol}/live")
async def get_live_candle(
    symbol: str,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
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

    try:
        candle = await bvc_scraper.get_live_candle(sym)
    except Exception as e:
        logger.error(f"❌ [LIVE] Error scraping {sym}: {e}")
        candle = None

    if candle:
        logger.info(f"✅ [LIVE] {sym}: O={candle['open']} H={candle['high']} L={candle['low']} C={candle['close']} V={candle['volume']}")
        # Guardar en BD para fallback cuando el mercado cierre y el scraper regrese None
        try:
            await _store_price_history(db, sym, [candle])
        except Exception as store_err:
            logger.warning(f"⚠️ [LIVE-STORE] No se pudo guardar vela live en DB: {store_err}")
    else:
        logger.info(f"⚠️ [LIVE] {sym}: sin movimiento hoy, intentando fallback desde BD")
        try:
            stock_res = await db.execute(select(Stock).where(Stock.symbol == sym))
            stock = stock_res.scalar_one_or_none()
            if stock:
                # Use timezone aware constraint to filter out future dates, e.g., the fake 08-APR-26 ones
                from datetime import datetime, timezone, timedelta
                tz_ve = timezone(timedelta(hours=-4))
                today_ven = datetime.now(tz_ve).date()

                ph_res = await db.execute(
                    select(PriceHistory)
                    .where(PriceHistory.stock_id == stock.id, PriceHistory.price_date <= today_ven)
                    .order_by(PriceHistory.price_date.desc())
                    .limit(1)
                )

                # Cleanup potential future-dated garbage records generated by the previous timezone bugs
                try:
                    await db.execute(
                        text("DELETE FROM price_history WHERE stock_id = :sid AND price_date > :tv"),
                        {"sid": stock.id, "tv": today_ven}
                    )
                    await db.commit()
                except Exception as cleanup_err:
                    logger.warning(f"⚠️ [LIVE-DB-CLEANUP] failed for {sym}: {cleanup_err}")
                ph = ph_res.scalar_one_or_none()
                if ph:
                    candle = {
                        'time':   ph.price_date.isoformat(),
                        'open':   float(ph.open_price or ph.close_price or 0),
                        'high':   float(ph.high_price or ph.close_price or 0),
                        'low':    float(ph.low_price or ph.close_price or 0),
                        'close':  float(ph.close_price or 0),
                        'volume': int(ph.volume or 0),
                        'amount': float(ph.amount or 0),
                        'trades': int(ph.trades or 0),
                        'is_live': False
                    }
                    logger.info(f"📦 [LIVE-DB-FALLBACK] {sym}: Recuperada vela de hoy desde la BD")
        except Exception as db_err:
            logger.error(f"❌ [LIVE-DB-FALLBACK] Error consultando BD para {sym}: {db_err}")

    return {
        'symbol':      sym,
        'market_open': market_open,
        'candle':      candle,
        'message':     None if market_open else 'Mercado cerrado'
    }


@router.post("/bcv/fetch-now")
async def trigger_bcv_fetch(user_id: UUID = Depends(get_current_user_id)):
    """
    Forzar la obtención y guardado de la tasa BCV del día.
    Útil para diagnóstico o si el scheduler no corrió.
    """
    from app.services.bcv_daily_service import _scrape_bcv_home, save_bcv_rate_to_db
    result = _scrape_bcv_home()
    if not result:
        raise HTTPException(status_code=502, detail="No se pudo obtener la tasa BCV (scraping falló)")
    saved = await save_bcv_rate_to_db(result["date"], result["rate"])
    return {
        "date": result["date"],
        "rate": result["rate"],
        "saved": saved,
        "message": "Tasa guardada" if saved else "Tasa ya existía para esta fecha"
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

    from datetime import datetime, timezone, timedelta
    tz_ve = timezone(timedelta(hours=-4))
    today_iso = datetime.now(tz_ve).date().isoformat()

    now = time.time()

    # Invalidate cache if today is missing to force a fresh DB query/scrape
    if _historical_rates_cache is not None and today_iso not in _historical_rates_cache:
        _historical_rates_cache = None

    if _historical_rates_cache is None or (now - _historical_rates_cache_time) > CACHE_TTL:
        try:
            result = await db.execute(select(BcvRate).order_by(BcvRate.rate_date))
            rates = result.scalars().all()
            _historical_rates_cache = {r.rate_date.isoformat(): float(r.rate) for r in rates}

            if today_iso not in _historical_rates_cache:
                from app.services.bcv_daily_service import _scrape_bcv_home, save_bcv_rate_to_db
                try:
                    scraped = await _scrape_bcv_home()
                    if scraped:
                        await save_bcv_rate_to_db(scraped["date"], scraped["rate"])
                        _historical_rates_cache[scraped["date"]] = scraped["rate"]
                except Exception as scrape_err:
                    logger.error(f"Error scraping fallback BCV rate: {scrape_err}")

        except Exception as e:
            logger.error(f"Error loading historical BCV rates from DB: {e}")
            _historical_rates_cache = {}
        _historical_rates_cache_time = now
    return {"rates": _historical_rates_cache}


# ──────────────────────────────────────────────────────────────────────────────
# ÍNDICES BVC (IBC, Industrial, Financiero)
# ──────────────────────────────────────────────────────────────────────────────

_indices_cache: dict = {}
_indices_cache_time: dict = {}
_INDICES_CACHE_TTL = 1800  # 30 min

BVC_INDICES = {
    "IBC":        "Índice Bursátil Caracas",
    "INDUSTRIAL": "Índice Industrial BVC",
    "FINANCIERO": "Índice Financiero BVC",
}


@router.get("/indices/bvc")
async def get_bvc_indices(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Retorna el histórico de precios de los 3 índices BVC (IBC, Industrial, Financiero)
    almacenados como PriceHistory en la DB, más el VIX proxy calculado del IBC.
    """
    import math as _math

    result = {}
    for symbol, name in BVC_INDICES.items():
        now_ts = time.time()
        cache_key = symbol
        if cache_key in _indices_cache and (now_ts - _indices_cache_time.get(cache_key, 0)) < _INDICES_CACHE_TTL:
            result[symbol] = _indices_cache[cache_key]
            continue

        stock_q = await db.execute(select(Stock).where(Stock.symbol == symbol))
        stock = stock_q.scalar_one_or_none()

        if not stock:
            result[symbol] = {"symbol": symbol, "name": name, "series": [], "current": None, "change_pct": None, "vix_proxy": None}
            continue

        ph_q = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.stock_id == stock.id)
            .order_by(PriceHistory.date.asc())
        )
        history = ph_q.scalars().all()

        series = [
            {"time": ph.date.isoformat(), "value": float(ph.close_price)}
            for ph in history
            if ph.close_price is not None
        ]

        current    = series[-1]["value"] if series else None
        prev       = series[-2]["value"] if len(series) >= 2 else None
        change_pct = round((current - prev) / prev * 100, 2) if current and prev and prev > 0 else None

        # VIX proxy: 30-day rolling std dev of daily returns, annualised — only for IBC
        vix_proxy = None
        if symbol == "IBC" and len(series) >= 5:
            closes = [s["value"] for s in series]
            window = min(30, len(closes) - 1)
            rets = [(closes[i] - closes[i-1]) / closes[i-1] for i in range(len(closes) - window, len(closes))]
            if rets:
                mean_r = sum(rets) / len(rets)
                variance = sum((r - mean_r) ** 2 for r in rets) / len(rets)
                vix_proxy = round(_math.sqrt(variance) * _math.sqrt(252) * 100, 2)

        entry = {
            "symbol": symbol, "name": name,
            "series": series, "current": current,
            "change_pct": change_pct, "vix_proxy": vix_proxy,
        }
        _indices_cache[cache_key] = entry
        _indices_cache_time[cache_key] = now_ts
        result[symbol] = entry

    return result


# ──────────────────────────────────────────────────────────────────────────────
# BVC AJAX CHART PROXY  –  /stocks/indices/bvc-charts
# Proxies https://www.bolsadecaracas.com/wp-admin/admin-ajax.php
# and returns intraday + annual series for IBC, Financiero, Industrial.
# ──────────────────────────────────────────────────────────────────────────────

_bvc_charts_cache: dict = {}
_bvc_charts_cache_time: float = 0.0
_BVC_CHARTS_TTL = 300  # 5 min


def _parse_bvc_series(raw: list, fmt: str) -> list:
    """Convert BVC tick list → [{time, value}] sorted ascending.
    Intraday: time is Unix timestamp (int seconds) — required by lightweight-charts.
    Annual:   time is 'YYYY-MM-DD' string (lightweight-charts daily format).
    """
    from datetime import datetime as _dt, timezone as _tz, timedelta as _tdelta
    VEN = _tz(_tdelta(hours=-4))
    out = []
    for item in raw or []:
        try:
            hora = item.get("HORA", "")
            precio = float(item.get("PRECIO", 0) or 0)
            if fmt == "intraday":
                dt = _dt.strptime(hora, "%d/%m/%Y %H:%M:%S").replace(tzinfo=VEN)
                out.append({"time": int(dt.timestamp()), "value": precio})
            else:
                dt = _dt.strptime(hora, "%d/%m/%Y")
                out.append({"time": dt.strftime("%Y-%m-%d"), "value": precio})
        except Exception:
            continue
    out.sort(key=lambda x: x["time"])
    return out


@router.get("/indices/bvc-charts")
async def get_bvc_charts(user_id: UUID = Depends(get_current_user_id)):
    """
    Proxy the BVC WordPress AJAX chartsData endpoint.
    Returns intraday and annual series for IBC, Financiero, Industrial.
    """
    import httpx
    import time as _time

    global _bvc_charts_cache, _bvc_charts_cache_time
    now = _time.time()
    if _bvc_charts_cache and (now - _bvc_charts_cache_time) < _BVC_CHARTS_TTL:
        return _bvc_charts_cache

    url = "https://www.bolsadecaracas.com/wp-admin/admin-ajax.php"
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
        "Origin": "https://www.bolsadecaracas.com",
        "Referer": "https://www.bolsadecaracas.com/",
    }

    try:
        async with httpx.AsyncClient(verify=False, timeout=15) as client:
            resp = await client.post(url, data="action=chartsData&indice=ibc&variacion=", headers=headers)
            resp.raise_for_status()
            raw = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error al consultar BVC: {e}")

    ibc_intraday = _parse_bvc_series(raw.get("CUR_IBC", []), "intraday")
    ibc_annual   = _parse_bvc_series(raw.get("CUR_IBC_ANUAL", []), "annual")
    fin_intraday = _parse_bvc_series(raw.get("CUR_FIN", []), "intraday")
    fin_annual   = _parse_bvc_series(raw.get("CUR_FIN_ANUAL", []), "annual")
    ind_intraday = _parse_bvc_series(raw.get("CUR_IND", []), "intraday")
    ind_annual   = _parse_bvc_series(raw.get("CUR_IND_ANUAL", []), "annual")

    # VIX proxy: 30-day rolling std dev of IBC annual returns, annualised
    import math as _math
    vix_proxy = None
    if len(ibc_annual) >= 5:
        closes = [s["value"] for s in ibc_annual]
        window = min(30, len(closes) - 1)
        rets = [(closes[i] - closes[i-1]) / closes[i-1] for i in range(len(closes) - window, len(closes))]
        if rets:
            mean_r = sum(rets) / len(rets)
            variance = sum((r - mean_r) ** 2 for r in rets) / len(rets)
            vix_proxy = round(_math.sqrt(variance) * _math.sqrt(252) * 100, 2)

    result = {
        "IBC":        {"intraday": ibc_intraday, "annual": ibc_annual},
        "FINANCIERO": {"intraday": fin_intraday, "annual": fin_annual},
        "INDUSTRIAL": {"intraday": ind_intraday, "annual": ind_annual},
        "vix_proxy":  vix_proxy,
    }

    _bvc_charts_cache = result
    _bvc_charts_cache_time = now
    return result


# ── WTI Oil Correlation ────────────────────────────────────────────────────────
# Fetches 2 years of WTI (CL=F) daily closes from Yahoo Finance and correlates
# each BVC stock's daily returns against oil price movements.

_wti_corr_cache: dict  = {}
_wti_corr_cache_time: dict = {}   # keyed by days
_WTI_CORR_TTL = 3600 * 6  # 6-hour cache per (days) bucket


@router.get("/correlate-wti")
async def get_wti_correlation(
    days: int = 0,                 # 0 = all history; >0 = last N days
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Correlación de cada acción BVC vs precio del Petróleo WTI (CL=F).
    Clave para traders venezolanos: la economía y muchas empresas BVC
    dependen directamente del ciclo del petróleo.
    """
    import math as _m
    import httpx as _httpx
    import time as _time

    global _wti_corr_cache, _wti_corr_cache_time
    now = _time.time()
    cache_key = days
    if cache_key in _wti_corr_cache and (now - _wti_corr_cache_time.get(cache_key, 0)) < _WTI_CORR_TTL:
        return _wti_corr_cache[cache_key]

    # Fetch WTI 2-year daily OHLCV from Yahoo Finance
    WTI_URL = (
        "https://query1.finance.yahoo.com/v8/finance/chart/CL%3DF"
        "?interval=1d&range=2y"
    )
    try:
        async with _httpx.AsyncClient(timeout=15, verify=False) as client:
            resp = await client.get(WTI_URL, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        chart = resp.json()["chart"]["result"][0]
        timestamps = chart["timestamp"]
        closes_raw = chart["indicators"]["quote"][0]["close"]
        from datetime import timezone as _tz, datetime as _dt
        wti_prices: dict[str, float] = {}
        for ts, c in zip(timestamps, closes_raw):
            if c is None:
                continue
            d = _dt.fromtimestamp(ts, tz=_tz.utc).strftime("%Y-%m-%d")
            wti_prices[d] = float(c)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"No se pudo obtener datos WTI de Yahoo Finance: {exc}")

    if len(wti_prices) < 30:
        raise HTTPException(status_code=422, detail="Datos WTI insuficientes")

    wti_dates = sorted(wti_prices.keys())
    wti_rets: dict[str, float] = {}
    for i in range(1, len(wti_dates)):
        p0 = wti_prices[wti_dates[i - 1]]
        p1 = wti_prices[wti_dates[i]]
        if p0 > 0:
            wti_rets[wti_dates[i]] = (p1 / p0) - 1

    # Load all active BVC stocks and compute correlation vs WTI
    stocks_r = await db.execute(select(Stock).where(Stock.is_active == True))
    all_stocks = stocks_r.scalars().all()

    def pearson(a: list, b: list) -> float | None:
        n = len(a)
        if n < 10:
            return None
        ma = sum(a) / n; mb = sum(b) / n
        num = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
        da  = _m.sqrt(sum((x - ma) ** 2 for x in a))
        db  = _m.sqrt(sum((x - mb) ** 2 for x in b))
        return round(num / (da * db), 3) if da > 0 and db > 0 else None

    results = []
    for stock in all_stocks:
        ph_r = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.stock_id == stock.id, PriceHistory.close_price != None)
            .order_by(PriceHistory.price_date.asc())
        )
        rows = ph_r.scalars().all()
        if len(rows) < 30:
            continue

        bvc_prices: dict[str, float] = {r.price_date.isoformat(): float(r.close_price) for r in rows}
        bvc_dates = sorted(bvc_prices.keys())
        bvc_rets: dict[str, float] = {}
        for i in range(1, len(bvc_dates)):
            p0 = bvc_prices[bvc_dates[i - 1]]
            p1 = bvc_prices[bvc_dates[i]]
            if p0 > 0:
                bvc_rets[bvc_dates[i]] = (p1 / p0) - 1

        common_all = sorted(set(wti_rets.keys()) & set(bvc_rets.keys()))
        if len(common_all) < 10:
            continue

        # Apply custom day window
        common = common_all[-days:] if days > 0 and len(common_all) > days else common_all
        if len(common) < 10:
            continue

        wti_v = [wti_rets[d] for d in common]
        bvc_v = [bvc_rets[d]  for d in common]
        corr  = pearson(wti_v, bvc_v)
        if corr is None:
            continue

        # Short-window (90d) correlation for recent trend — only when not already limited
        win_90 = min(90, len(common))
        common_90 = common[-win_90:]
        corr_90 = pearson([wti_rets[d] for d in common_90], [bvc_rets[d] for d in common_90])

        if   corr >= 0.5:  label = "ALTA CORRELACIÓN — Expuesta al ciclo petrolero"
        elif corr >= 0.25: label = "CORRELACIÓN MODERADA"
        elif corr <= -0.5: label = "CORRELACIÓN INVERSA — Cobertura contra WTI"
        elif corr <= -0.25: label = "CORRELACIÓN INVERSA MODERADA"
        else:               label = "BAJA CORRELACIÓN — Relativamente independiente del petróleo"

        results.append({
            "symbol":       stock.symbol,
            "name":         stock.name,
            "corr_full":    corr,
            "corr_90d":     corr_90,
            "common_days":  len(common),
            "label":        label,
        })

    results.sort(key=lambda x: -abs(x["corr_full"]))

    response = {
        "wti_data_points": len(wti_rets),
        "wti_latest_date": wti_dates[-1] if wti_dates else None,
        "stocks": results,
        "note": "Correlación Pearson diaria vs WTI (CL=F) desde Yahoo Finance. Corr_90d = últimos 90 días.",
    }
    _wti_corr_cache[cache_key] = response
    _wti_corr_cache_time[cache_key] = now
    return response


# ---------------------------------------------------------------------------
# BVC Histórico + ISIN (scraper directo bolsadecaracas.com)
# ---------------------------------------------------------------------------
_bvc_hist_cache: Dict[str, dict] = {}
_bvc_hist_cache_time: Dict[str, float] = {}
_BVC_HIST_TTL = 3600  # 1 hora


@router.get("/bvc/{symbol}/emisor")
async def get_emisor_info(
    symbol: str,
    user_id: UUID = Depends(get_current_user_id),
):
    """
    Obtiene ISIN y datos históricos del emisor directamente desde bolsadecaracas.com.
    Datos: ISIN, nombre, sector, histórico de cotizaciones (fecha, apertura, máx, mín, cierre, volumen).
    """
    import httpx as _httpx
    import time as _time

    cache_key = symbol.upper()
    now = _time.time()
    if cache_key in _bvc_hist_cache and (now - _bvc_hist_cache_time.get(cache_key, 0)) < _BVC_HIST_TTL:
        return _bvc_hist_cache[cache_key]

    BVC_URL = "https://www.bolsadecaracas.com/wp-admin/admin-ajax.php?action=getHistoricoSimbolo"
    headers = {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Referer": "https://www.bolsadecaracas.com/historicos/",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Origin": "https://www.bolsadecaracas.com",
    }

    try:
        async with _httpx.AsyncClient(timeout=20, verify=False) as client:
            resp = await client.post(
                BVC_URL,
                content=f"simbolo={symbol.upper()}",
                headers=headers,
            )
        resp.raise_for_status()
        raw = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Error al contactar BVC: {exc}")

    if not raw or raw is None:
        raise HTTPException(status_code=404, detail=f"Sin datos para {symbol} en BVC")

    # BVC returns: { "cur_hist_encab": [...], "historicos": [...] }
    # cur_hist_encab = company/issuer header (ISIN, name, sector, shares)
    # historicos      = price history rows
    if isinstance(raw, dict):
        encab_list = raw.get("cur_hist_encab", [])
        hist_rows  = raw.get("historicos", [])
    elif isinstance(raw, list):
        # Fallback: older API may return flat list of history rows
        encab_list = []
        hist_rows  = raw
    else:
        raise HTTPException(status_code=502, detail="Formato inesperado de BVC")

    # Extract company metadata from header record
    encab = encab_list[0] if encab_list else {}
    isin    = encab.get("COD_ISIN") or None
    name    = encab.get("DESC_EMP") or encab.get("DESC_SIMB") or symbol
    sector  = encab.get("TIPO_INDI_SECTOR") or encab.get("TIPO_INDI") or None
    shares  = encab.get("ACC_CIRC") or None
    currency= encab.get("MONEDA") or "Bs"
    status  = encab.get("ESTATUS") or None

    if not hist_rows:
        raise HTTPException(status_code=404, detail=f"Sin histórico para {symbol}")

    # Normalize price history rows
    history = []
    for row in hist_rows:
        history.append({
            "fecha":    row.get("FEC_COTIZ")   or row.get("FECHA")    or None,
            "apertura": row.get("PREC_APERT")  or row.get("APERTURA") or None,
            "maximo":   row.get("PREC_MAX")    or row.get("MAXIMO")   or None,
            "minimo":   row.get("PREC_MIN")    or row.get("MINIMO")   or None,
            "cierre":   row.get("PREC_CIERRE") or row.get("CIERRE")   or row.get("PRECIO") or None,
            "volumen":  row.get("VOLUMEN")     or None,
            "monto":    row.get("MONTO_EFEC")  or row.get("MONTO")    or None,
        })

    response = {
        "symbol": symbol.upper(),
        "isin": isin,
        "name": name,
        "sector": sector,
        "shares_outstanding": shares,
        "currency": currency,
        "status": status,
        "total_records": len(history),
        "history": history,
    }
    _bvc_hist_cache[cache_key] = response
    _bvc_hist_cache_time[cache_key] = now
    return response


# ---------------------------------------------------------------------------
# BVC getOperacionesHistorico — sync missing candles into PriceHistory
# ---------------------------------------------------------------------------
_bvc_sync_cache: Dict[str, float] = {}
_BVC_SYNC_TTL = 3600  # re-sync at most once per hour per symbol

_BVC_OP_URL   = "https://www.bolsadecaracas.com/wp-admin/admin-ajax.php?action=getOperacionesHistorico"
_BVC_HIST_URL = "https://www.bolsadecaracas.com/wp-admin/admin-ajax.php?action=getHistoricoSimbolo"
_BVC_SCRAPE_HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Referer": "https://www.bolsadecaracas.com/historicos/",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}


def _extract_rows(resp) -> list:
    """Try all known key names BVC may use for the records array."""
    if not resp or not isinstance(resp, dict):
        return []
    for key in ("data", "historicos", "historico", "operaciones", "rows", "records", "result"):
        val = resp.get(key)
        if isinstance(val, list) and val:
            return val
    for val in resp.values():
        if isinstance(val, list) and val:
            return val
    return []


def _parse_float_bvc(v):
    if v is None:
        return None
    try:
        return float(str(v).replace(",", ".").strip())
    except Exception:
        return None


def _parse_int_bvc(v) -> int:
    if v is None:
        return 0
    try:
        return int(float(str(v).replace(",", "").strip()))
    except Exception:
        return 0


def _normalize_fecha(raw) -> str | None:
    """Normalise any BVC date string to YYYY-MM-DD, return None if invalid."""
    from datetime import date as _d
    if not raw:
        return None
    s = str(raw).strip()
    if "/" in s and len(s) == 10:
        parts = s.split("/")
        if len(parts[0]) == 2:           # DD/MM/YYYY
            s = f"{parts[2]}-{parts[1]}-{parts[0]}"
    s = s[:10]
    try:
        _d.fromisoformat(s)
        return s
    except Exception:
        return None


async def _fetch_bvc_sessions_for_symbol(sym: str) -> list[dict]:
    """
    Fetch all historical sessions for a single symbol from BVC.
    Tries getOperacionesHistorico (paginated) first, falls back to
    getHistoricoSimbolo if that returns nothing.
    Returns a list of normalised row dicts with keys:
      fecha, open_p, high_p, low_p, close_p, volume, trades, amount
    """
    import asyncio as _asyncio
    import httpx as _httpx
    from datetime import date as _date

    min_date = "2015-01-01"
    max_date = _date.today().isoformat()

    async def _fetch_page(client: _httpx.AsyncClient, page: int):
        body = f"simbolo={sym}&min={min_date}&max={max_date}&page={page}"
        try:
            r = await client.post(_BVC_OP_URL, content=body, headers=_BVC_SCRAPE_HEADERS)
            r.raise_for_status()
            return r.json()
        except Exception:
            return None

    all_raw: list[dict] = []

    async with _httpx.AsyncClient(timeout=30, verify=False) as client:
        page0 = await _fetch_page(client, 0)

    page0_rows = _extract_rows(page0)
    logger.debug(f"[BVC-SYNC] {sym}: page0 keys={list(page0.keys()) if isinstance(page0, dict) else None}, rows={len(page0_rows)}")

    if page0_rows:
        total_pages = int(page0.get("pages", 1)) if isinstance(page0, dict) else 1
        all_raw.extend(page0_rows)

        BATCH = 20
        async with _httpx.AsyncClient(timeout=30, verify=False) as client:
            for batch_start in range(1, total_pages, BATCH):
                tasks = [
                    _fetch_page(client, p)
                    for p in range(batch_start, min(batch_start + BATCH, total_pages))
                ]
                results = await _asyncio.gather(*tasks)
                for res in results:
                    all_raw.extend(_extract_rows(res))
    else:
        # Fallback: getHistoricoSimbolo (no pagination, usually full history)
        logger.info(f"[BVC-SYNC] {sym}: getOperacionesHistorico empty → fallback getHistoricoSimbolo")
        try:
            async with _httpx.AsyncClient(timeout=20, verify=False) as client:
                hr = await client.post(
                    _BVC_HIST_URL,
                    content=f"simbolo={sym}",
                    headers=_BVC_SCRAPE_HEADERS,
                )
                hr.raise_for_status()
                hdata = hr.json()
            fallback = hdata.get("historicos", []) if isinstance(hdata, dict) else []
            all_raw.extend(fallback)
            logger.info(f"[BVC-SYNC] {sym}: fallback gave {len(fallback)} rows")
        except Exception as fe:
            logger.warning(f"[BVC-SYNC] {sym}: fallback also failed: {fe}")

    # Normalise rows
    sessions: list[dict] = []
    for row in all_raw:
        fecha = _normalize_fecha(
            row.get("FEC_COTIZ") or row.get("FECHA") or
            row.get("fec_cotiz") or row.get("fecha") or
            row.get("fecha_cotiz") or row.get("date")
        )
        if not fecha:
            continue
        close_p = _parse_float_bvc(
            row.get("PREC_CIERRE") or row.get("CIERRE") or
            row.get("PRECIO") or row.get("prec_cierre")
        )
        if close_p is None:
            continue
        sessions.append({
            "fecha":   fecha,
            "open_p":  _parse_float_bvc(row.get("PREC_APERT")  or row.get("APERTURA")  or row.get("prec_apert")) or close_p,
            "high_p":  _parse_float_bvc(row.get("PREC_MAX")    or row.get("MAXIMO")    or row.get("prec_max"))   or close_p,
            "low_p":   _parse_float_bvc(row.get("PREC_MIN")    or row.get("MINIMO")    or row.get("prec_min"))   or close_p,
            "close_p": close_p,
            "volume":  _parse_int_bvc(row.get("TOT_ACC_NEGOC") or row.get("VOLUMEN")   or row.get("tot_acc_negoc")),
            "trades":  _parse_int_bvc(row.get("TOT_OP_NEGOC")  or row.get("tot_op_negoc")),
            "amount":  _parse_float_bvc(row.get("TOT_MONTO_NEGOC") or row.get("MONTO") or row.get("tot_monto_negoc")) or 0.0,
        })

    return sessions


async def _insert_missing_sessions(db: AsyncSession, stock: Stock, sessions: list[dict]) -> int:
    """
    Given a list of sessions from BVC, compare with DB and insert missing dates.
    Returns the number of rows inserted.
    """
    from datetime import date as _date

    if not sessions:
        return 0

    ph_res = await db.execute(
        select(PriceHistory.price_date).where(PriceHistory.stock_id == stock.id)
    )
    existing_dates: set[str] = {r.isoformat() for r in ph_res.scalars().all()}

    inserted = 0
    for s in sessions:
        if s["fecha"] in existing_dates:
            continue
        try:
            db.add(PriceHistory(
                stock_id=stock.id,
                price_date=_date.fromisoformat(s["fecha"]),
                open_price=s["open_p"],
                high_price=s["high_p"],
                low_price=s["low_p"],
                close_price=s["close_p"],
                volume=s["volume"],
                trades=s["trades"],
                amount=s["amount"],
            ))
            existing_dates.add(s["fecha"])
            inserted += 1
        except Exception as e:
            logger.warning(f"[BVC-SYNC] Insert error {stock.symbol} {s['fecha']}: {e}")

    if inserted > 0:
        try:
            await db.commit()
        except Exception:
            await db.rollback()

    return inserted


async def _sync_all_bvc_sessions_bg() -> None:
    """
    Batch job: fetch BVC sessions for ALL active symbols and insert missing
    dates into price_history. Also auto-registers newly-found active symbols.
    Runs at startup and after market close (14:00 + 18:00 Caracas).
    """
    import httpx as _httpx
    import time as _time
    from datetime import date as _date

    logger.info("🔄 [BVC-BATCH-SYNC] Starting full session sync for all active symbols…")
    total_inserted = 0
    errors = 0

    async with AsyncSessionLocal() as db:
        stocks_res = await db.execute(select(Stock).where(Stock.is_active == True))
        stocks = stocks_res.scalars().all()
        db_symbols: set[str] = {s.symbol for s in stocks}

    logger.info(f"[BVC-BATCH-SYNC] {len(stocks)} active symbols in DB")

    # ── Also discover symbols from BVC that might be missing from DB ──────────
    # Fetch the historicos dropdown to get the full symbol list
    try:
        async with _httpx.AsyncClient(timeout=20, verify=False) as client:
            r = await client.get(
                "https://www.bolsadecaracas.com/historicos/",
                headers={"User-Agent": "Mozilla/5.0"},
            )
            r.raise_for_status()
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(r.text, "lxml")
        select_el = soup.find("select", {"id": "simbolo"})
        bvc_options: list[tuple[str, str]] = []
        if select_el:
            for opt in select_el.find_all("option"):
                val = opt.get("value", "").strip()
                txt = opt.get_text(strip=True)
                if val and "Seleccione" not in txt:
                    bvc_options.append((val, txt))
        logger.info(f"[BVC-BATCH-SYNC] {len(bvc_options)} symbols on BVC historicos page")
    except Exception as e:
        logger.warning(f"[BVC-BATCH-SYNC] Could not fetch BVC symbol list: {e}")
        bvc_options = []

    # Symbols from BVC page not yet in DB → check and auto-register
    new_candidates = [(sym, name) for sym, name in bvc_options if sym not in db_symbols]
    if new_candidates:
        logger.info(f"[BVC-BATCH-SYNC] {len(new_candidates)} new candidates to check: {[s for s, _ in new_candidates]}")
        for sym, name in new_candidates:
            try:
                sessions = await _fetch_bvc_sessions_for_symbol(sym)
                if not sessions:
                    continue
                latest = max(s["fecha"] for s in sessions)
                cutoff = _date.today().replace(year=_date.today().year - 1).isoformat()
                if latest < cutoff:
                    logger.debug(f"[BVC-BATCH-SYNC] {sym}: latest={latest} too old, skipping")
                    continue
                async with AsyncSessionLocal() as db:
                    result = await db.execute(select(Stock).where(Stock.symbol == sym))
                    stock = result.scalar_one_or_none()
                    if not stock:
                        stock = Stock(symbol=sym, name=name, is_active=True, currency="Bs", last_updated=_now())
                        db.add(stock)
                        await db.commit()
                        await db.refresh(stock)
                        logger.info(f"[BVC-BATCH-SYNC] ✅ Auto-registered new symbol: {sym}")
                    inserted = await _insert_missing_sessions(db, stock, sessions)
                    total_inserted += inserted
                    _bvc_sync_cache[sym] = _time.time()
            except Exception as e:
                logger.warning(f"[BVC-BATCH-SYNC] {sym} auto-register error: {e}")

    # ── Sync sessions for all existing active stocks ──────────────────────────
    for stock in stocks:
        sym = stock.symbol
        try:
            sessions = await _fetch_bvc_sessions_for_symbol(sym)
            if not sessions:
                logger.debug(f"[BVC-BATCH-SYNC] {sym}: 0 sessions from BVC, skipping")
                continue

            async with AsyncSessionLocal() as db:
                # Re-fetch stock in this session
                res = await db.execute(select(Stock).where(Stock.symbol == sym))
                db_stock = res.scalar_one_or_none()
                if not db_stock:
                    continue
                inserted = await _insert_missing_sessions(db, db_stock, sessions)

            if inserted:
                logger.info(f"[BVC-BATCH-SYNC] {sym}: +{inserted} new sessions ({len(sessions)} BVC total)")
            total_inserted += inserted
            _bvc_sync_cache[sym] = _time.time()
        except Exception as e:
            logger.warning(f"[BVC-BATCH-SYNC] {sym}: error — {e}")
            errors += 1

    logger.info(
        f"✅ [BVC-BATCH-SYNC] Done — {total_inserted} rows inserted, "
        f"{len(new_candidates)} new symbols checked, {errors} errors"
    )


@router.post("/bvc/{symbol}/sync-bvc-history")
async def sync_bvc_history(
    symbol: str,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Fetch BVC sessions for a single symbol, insert missing dates, return merged candles.
    Rate-limited to one BVC fetch per hour; returns cached DB data when hot.
    """
    import time as _time

    sym = symbol.upper().strip()
    now = _time.time()

    stock_res = await db.execute(select(Stock).where(Stock.symbol == sym))
    stock = stock_res.scalar_one_or_none()
    if not stock:
        raise HTTPException(status_code=404, detail=f"Acción {sym} no encontrada en DB")

    last_sync = _bvc_sync_cache.get(sym, 0)
    if (now - last_sync) < _BVC_SYNC_TTL:
        # Within rate-limit window — return DB candles immediately
        ph_res = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.stock_id == stock.id)
            .order_by(PriceHistory.price_date.asc())
        )
        rows = ph_res.scalars().all()
        candles = [{
            'time':   r.price_date.isoformat(),
            'open':   float(r.open_price or r.close_price or 0),
            'high':   float(r.high_price or r.close_price or 0),
            'low':    float(r.low_price or r.close_price or 0),
            'close':  float(r.close_price or 0),
            'volume': int(r.volume or 0),
            'amount': float(r.amount or 0),
            'trades': int(r.trades or 0),
        } for r in rows]
        return {'symbol': sym, 'count': len(candles), 'candles': candles, 'synced': False, 'inserted': 0}

    # Fetch sessions from BVC and insert missing ones
    sessions = await _fetch_bvc_sessions_for_symbol(sym)
    inserted = await _insert_missing_sessions(db, stock, sessions)
    _bvc_sync_cache[sym] = now

    # Return the full merged history from DB (now includes any new inserts)
    ph_res = await db.execute(
        select(PriceHistory)
        .where(PriceHistory.stock_id == stock.id)
        .order_by(PriceHistory.price_date.asc())
    )
    rows = ph_res.scalars().all()

    # Also merge BVC sessions that might not be committed yet (edge case)
    db_dates = {r.price_date.isoformat() for r in rows}
    candles: list[dict] = [{
        'time':   r.price_date.isoformat(),
        'open':   float(r.open_price or r.close_price or 0),
        'high':   float(r.high_price or r.close_price or 0),
        'low':    float(r.low_price or r.close_price or 0),
        'close':  float(r.close_price or 0),
        'volume': int(r.volume or 0),
        'amount': float(r.amount or 0),
        'trades': int(r.trades or 0),
    } for r in rows]

    for s in sessions:
        if s["fecha"] not in db_dates:
            candles.append({
                'time': s["fecha"], 'open': s["open_p"], 'high': s["high_p"],
                'low': s["low_p"], 'close': s["close_p"],
                'volume': s["volume"], 'amount': s["amount"], 'trades': s["trades"],
            })

    candles.sort(key=lambda x: x['time'])
    logger.info(f"✅ [BVC-SYNC] {sym}: {len(sessions)} from BVC, +{inserted} inserted, {len(candles)} total")

    return {
        'symbol': sym,
        'count': len(candles),
        'candles': candles,
        'synced': True,
        'inserted': inserted,
    }