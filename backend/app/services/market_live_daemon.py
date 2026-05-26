"""
market_live_daemon.py
─────────────────────
Background daemon that fetches the entire live market board from the BVC,
persists daily candles (OHLCV) automatically, and broadcasts the full 
depth order book to all connected WebSocket clients every 30 seconds.
"""
from __future__ import annotations

import logging
from datetime import datetime, date as date_type

import pytz
from sqlalchemy import select, text

from app.database import AsyncSessionLocal
from app.models.stock import Stock
from app.services.bvc_scraper import BVCScraper
from app.websocket.manager import manager

logger = logging.getLogger(__name__)
CARACAS_TZ = pytz.timezone("America/Caracas")
bvc_scraper = BVCScraper()

# Cache local para no emitir eventos repetidos si nada cambia
_last_board_state = {}

async def fetch_and_broadcast_live_prices() -> None:
    """
    Core daemon task (called by APScheduler every 30 seconds):

    1. Checks if we are in live market hours (09:00-15:30) or EOD settlement (15:30-16:30).
    2. Fetches the complete market board at once.
    3. Broadcasts the dictionary to `manager` (market_board_update).
    4. Upserts daily closing prices into `price_history`.
    """
    now = datetime.now(CARACAS_TZ)
    
    # ── 1. Schedule Validation ────────────────────────────────────────────────
    if now.weekday() >= 5: # Saturday/Sunday
        return

    hour = now.hour
    minute = now.minute

    # Activo si son las 09:00 a 15:30
    is_live = False
    if 9 <= hour < 15 or (hour == 15 and minute <= 30):
        is_live = True

    # Despues de cierre, hasta las 16:30, revisar 3 veces por hora (mins 0, 20, 40)
    is_eod = False
    if (hour == 15 and minute > 30) or hour == 16:
        # Relajamos el check en el minuto exacto, como el APScheduler corre
        # cada 30 segundos, aceptamos un margen.
        if minute in (0, 20, 40, 59):
            is_eod = True
            
    if not (is_live or is_eod):
        return

    logger.debug(f"📡 [DAEMON] Fetching live market (Live: {is_live}, EOD: {is_eod})")

    try:
        # ── 2. Fetch Board ────────────────────────────────────────────────────
        board = await bvc_scraper.get_market_board()
        if not board:
            return

        global _last_board_state
        
        # ── 3. Detect Changes & Broadcast ──────────────────────────────────────
        has_changed = False
        for sym, data in board.items():
            prev = _last_board_state.get(sym)
            if not prev:
                has_changed = True
                break
            # Detectamos si cambió el volumen, precio, bids, o asks
            if (prev.get('close') != data.get('close') or
                prev.get('volume') != data.get('volume') or
                prev.get('bid_price') != data.get('bid_price') or
                prev.get('ask_price') != data.get('ask_price')):
                has_changed = True
                break

        _last_board_state = board

        if has_changed or is_eod: # Siempre guardar/enviar en EOD
            # Enviar el Payload Total al Frontend
            await manager.broadcast({
                "type": "market_board_update",
                "data": board
            })
            logger.info("📡 [DAEMON] Market board broadcasted to WS clients.")

            # ── 4. Upsert Database Daily History ──────────────────────────────
            today = date_type.today().isoformat()
            
            async with AsyncSessionLocal() as db:
                stocks = (await db.execute(select(Stock))).scalars().all()
                sym_to_id = {s.symbol: s.id for s in stocks}

                updated_count = 0
                for sym, data in board.items():
                    if sym not in sym_to_id:
                        continue
                        
                    sid = sym_to_id[sym]
                    cp = float(data.get("close", 0) or 0)
                    if cp == 0:
                        continue

                    # Actualizar maestro
                    await db.execute(
                        text("UPDATE stocks SET last_price = :cp, is_active = :ia WHERE id = :sid"),
                        {"cp": cp, "sid": sid, "ia": True}
                    )
                    
                    # Upsert Historial (Daily Candle)
                    await db.execute(
                        text("""
                            INSERT INTO price_history
                                (stock_id, price_date, open_price, close_price,
                                 high_price, low_price, volume, amount, trades)
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
                            "sid": sid,
                            "pd":  data.get("time", today),
                            "op":  float(data.get("open",   0) or 0),
                            "cp":  cp,
                            "hp":  float(data.get("high",   0) or 0),
                            "lp":  float(data.get("low",    0) or 0),
                            "vol": int(data.get("volume", 0) or 0),
                            "amt": float(data.get("amount", 0) or 0),
                            "trd": int(data.get("trades", 0) or 0),
                        },
                    )
                    updated_count += 1

                await db.commit()
                logger.info(f"✅ [DAEMON] DB Upsert complete. {updated_count} stocks updated.")

    except Exception as exc:
        logger.error(f"❌ [DAEMON] Unexpected error: {exc}")
