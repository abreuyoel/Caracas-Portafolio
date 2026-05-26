import logging
import asyncio
import json
import ssl
import time
import websockets
from datetime import date, datetime, timezone
from sqlalchemy import text
from app.websocket.manager import manager
from app.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

# Configuración del Socket de la BVC
BVC_WS_URL = "wss://market.bolsadecaracas.com/socket.io/?EIO=4&transport=websocket"
BVC_HEADERS = {
    "Origin": "https://market.bolsadecaracas.com",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Accept-Language": "es-419,es;q=0.9,en;q=0.8"
}

# Cache global para enviar a nuevos clientes apenas se conectan
bvc_cache = {}

# Throttle DB writes — at most once every 60 s to avoid hammering the pool
_DB_WRITE_INTERVAL = 60.0
_last_db_write: float = 0.0

# ── Intraday hourly aggregator (in-memory, today only) ────────────────────────
# Key: (symbol, hour_int) → {"open": float, "high": float, "low": float,
#                             "close": float, "volume": int, "trades": int,
#                             "last_ts": iso}
# Auto-resets when the date changes (cheap and avoids unbounded growth).
_intraday_buckets: dict = {}
_intraday_date: date | None = None


def _ingest_intraday_tick(item: dict) -> None:
    global _intraday_buckets, _intraday_date
    sym = (item.get('COD_SIMB') or '').strip()
    price = float(item.get('PRECIO') or 0)
    if not sym or price <= 0:
        return
    now = datetime.now(timezone.utc)
    today = now.date()
    if _intraday_date != today:
        _intraday_buckets = {}
        _intraday_date = today
    hour = now.hour
    key = (sym, hour)
    bucket = _intraday_buckets.get(key)
    vol = int(item.get('VOLUMEN') or 0)
    trades = int(item.get('TOT_OP_NEGOC') or 0)
    if not bucket:
        _intraday_buckets[key] = {
            "open": price, "high": price, "low": price, "close": price,
            "volume": vol, "trades": trades, "last_ts": now.isoformat(),
        }
        return
    bucket["high"] = max(bucket["high"], price)
    bucket["low"]  = min(bucket["low"],  price)
    bucket["close"] = price
    # volume/trades from BVC are cumulative-of-day; track delta vs prior bucket
    bucket["volume"] = vol
    bucket["trades"] = trades
    bucket["last_ts"] = now.isoformat()


def get_intraday_hourly(symbol: str | None = None) -> dict:
    """Returns today's per-hour OHLCV (in-memory). Caller must accept that
    rebooting the server clears the data — this is a transient/pragmatic
    aggregator, not durable storage."""
    sym = (symbol or "").upper().strip()
    rows = []
    for (s, h), b in _intraday_buckets.items():
        if sym and s != sym:
            continue
        rows.append({
            "symbol": s, "hour": h,
            "open": b["open"], "high": b["high"],
            "low":  b["low"],  "close": b["close"],
            "volume": b["volume"], "trades": b["trades"],
            "last_ts": b["last_ts"],
            "ret_pct": ((b["close"] - b["open"]) / b["open"] * 100) if b["open"] > 0 else 0.0,
        })
    rows.sort(key=lambda r: (r["symbol"], r["hour"]))
    return {"date": _intraday_date.isoformat() if _intraday_date else None, "rows": rows}


async def _persist_market_data(tickers: list) -> None:
    """
    Bulk-upsert last prices and today's OHLCV candle for every ticker
    received in a serverDataExt event. Uses a single CTE round-trip so
    stock_id look-ups are done inside the DB, not in Python.
    """
    today = date.today()
    now   = datetime.now(timezone.utc)

    # Build parallel arrays for PostgreSQL unnest
    symbols:  list[str]   = []
    names:    list[str]   = []
    prices:   list[float] = []
    highs:    list[float] = []
    lows:     list[float] = []
    opens:    list[float] = []
    volumes:  list[int]   = []
    amounts:  list[float] = []
    trades_l: list[int]   = []
    chg_abs:  list[float] = []
    chg_pct:  list[float] = []

    for item in tickers:
        sym   = (item.get('COD_SIMB') or '').strip()
        price = float(item.get('PRECIO') or 0)
        if not sym or not price:
            continue
        symbols.append(sym)
        names.append((item.get('DESC_SIMB') or sym).strip())
        prices.append(price)
        highs.append(float(item.get('PRECIO_MAX')     or price))
        lows.append(float(item.get('PRECIO_MIN')      or price))
        opens.append(float(item.get('PRECIO_APERT')   or price))
        volumes.append(int(item.get('VOLUMEN')         or 0))
        amounts.append(float(item.get('MONTO_EFECTIVO') or 0))
        trades_l.append(int(item.get('TOT_OP_NEGOC')   or 0))
        chg_abs.append(float(item.get('VAR_ABS')       or 0))
        chg_pct.append(float(item.get('VAR_REL')       or 0))

    if not symbols:
        return

    try:
        async with AsyncSessionLocal() as session:
            # 1. Upsert stocks — set last_price + intraday fields
            await session.execute(text("""
                INSERT INTO stocks (symbol, name, currency, last_price, day_high, day_low,
                                    volume, last_updated, is_active)
                SELECT
                    unnest(:symbols::text[]),
                    unnest(:names::text[]),
                    'Bs',
                    unnest(:prices::numeric[]),
                    unnest(:highs::numeric[]),
                    unnest(:lows::numeric[]),
                    unnest(:volumes::bigint[]),
                    :now,
                    TRUE
                ON CONFLICT (symbol) DO UPDATE SET
                    last_price   = EXCLUDED.last_price,
                    day_high     = EXCLUDED.day_high,
                    day_low      = EXCLUDED.day_low,
                    volume       = EXCLUDED.volume,
                    last_updated = EXCLUDED.last_updated
            """), {
                'symbols': symbols,  'names': names,
                'prices':  prices,   'highs': highs,
                'lows':    lows,     'volumes': volumes,
                'now':     now,
            })

            # 2. Upsert today's price_history row via CTE (stock_id resolved in DB)
            await session.execute(text("""
                WITH data(symbol, open_p, close_p, high_p, low_p, vol, amt, trd, chg_a, chg_p) AS (
                    SELECT
                        unnest(:symbols::text[]),
                        unnest(:opens::numeric[]),
                        unnest(:prices::numeric[]),
                        unnest(:highs::numeric[]),
                        unnest(:lows::numeric[]),
                        unnest(:volumes::bigint[]),
                        unnest(:amounts::numeric[]),
                        unnest(:trades::int[]),
                        unnest(:chg_abs::numeric[]),
                        unnest(:chg_pct::numeric[])
                )
                INSERT INTO price_history
                    (stock_id, price_date, open_price, close_price, high_price, low_price,
                     volume, amount, trades, change_amount, change_pct)
                SELECT
                    s.id, :today, d.open_p, d.close_p, d.high_p, d.low_p,
                    d.vol, d.amt, d.trd, d.chg_a, d.chg_p
                FROM data d
                JOIN stocks s ON s.symbol = d.symbol
                ON CONFLICT (stock_id, price_date) DO UPDATE SET
                    close_price   = EXCLUDED.close_price,
                    high_price    = GREATEST(price_history.high_price,  EXCLUDED.high_price),
                    low_price     = LEAST(price_history.low_price,      EXCLUDED.low_price),
                    volume        = EXCLUDED.volume,
                    amount        = EXCLUDED.amount,
                    trades        = EXCLUDED.trades,
                    change_amount = EXCLUDED.change_amount,
                    change_pct    = EXCLUDED.change_pct
            """), {
                'symbols': symbols, 'opens': opens,   'prices': prices,
                'highs':   highs,   'lows':  lows,    'volumes': volumes,
                'amounts': amounts, 'trades': trades_l,
                'chg_abs': chg_abs, 'chg_pct': chg_pct,
                'today':   today,
            })

            await session.commit()
            logger.debug(f"📊 DB market sync: {len(symbols)} tickers actualizados")
    except Exception as exc:
        logger.error(f"❌ Error en _persist_market_data: {exc}")

async def start_bvc_proxy():
    """
    Demonio en background que mantiene viva una conexión con la Bolsa de Caracas,
    salta las protecciones CORS, captura la data en vivo, y la retransmite a
    nuestra propia red de WebSockets interna (Angular Clients).
    """
    retry_delay = 5
    
    # Create an unverified SSL context to bypass 'CERTIFICATE_VERIFY_FAILED' on BVC servers. 
    # Since we are just pulling public ticker data, a strict verification is not critical here.
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    
    while True:
        try:
            logger.info(f"🔄 Conectando al BVC Proxy WS: {BVC_WS_URL}")
            async with websockets.connect(BVC_WS_URL, extra_headers=BVC_HEADERS, ping_interval=None, ssl=ssl_context) as ws:
                logger.info("✅ BVC Proxy Conectado. Esperando Handshake...")
                
                # Bucle de recepción de mensajes
                ping_task = None
                
                try:
                    async for message in ws:
                        if isinstance(message, bytes):
                            message = message.decode('utf-8')
                            
                        if message.startswith('0'):
                            # Handshake de Socket.io
                            payload_str = message[1:]
                            payload = json.loads(payload_str)
                            logger.info(f"🤝 Handshake recibido BVC, estableciendo Ping cada {payload.get('pingInterval')}ms")
                            
                            # Comenzar a pingear ('2') en background
                            if ping_task:
                                ping_task.cancel()
                                
                            ping_interval = payload.get('pingInterval', 25000) / 1000.0
                            
                            async def ping_loop(w, interval):
                                try:
                                    while True:
                                        await asyncio.sleep(interval)
                                        await w.send('2')
                                except asyncio.CancelledError:
                                    pass
                                except Exception as e:
                                    logger.error(f"Error en ping loop BVC: {e}")
                            
                            ping_task = asyncio.create_task(ping_loop(ws, ping_interval))
                            await ws.send('40') # ACK connect
                            
                        elif message.startswith('40'):
                            logger.info("🟢 Suscripción exitosa a los canales de la BVC.")
                            
                        elif message.startswith('3'):
                            # Pong de BVC, ignorar
                            pass
                            
                        elif message.startswith('42'):
                            # Evento de datos reales
                            try:
                                payload_str = message[2:]
                                payload = json.loads(payload_str)
                                event_name = payload[0]
                                event_data = payload[1]

                                # Guardar estado en memoria para los nuevos clientes
                                bvc_cache[event_name] = event_data

                                # Retransmisión mundial a todos los clientes de nuestra app conectados
                                await manager.broadcast({
                                    "type": "bvc_event",
                                    "eventName": event_name,
                                    "data": event_data
                                })

                                # Persist last prices + today's OHLCV to DB (throttled)
                                if event_name == 'serverDataExt' and isinstance(event_data, list):
                                    # Hourly aggregator (in-memory, every tick)
                                    for _t in event_data:
                                        try: _ingest_intraday_tick(_t)
                                        except Exception: pass
                                    global _last_db_write
                                    now_ts = time.monotonic()
                                    if now_ts - _last_db_write >= _DB_WRITE_INTERVAL:
                                        _last_db_write = now_ts
                                        asyncio.create_task(_persist_market_data(event_data))

                            except Exception as e:
                                logger.error(f"Error retransmitiendo BVC event: {e}")
                                
                except websockets.exceptions.ConnectionClosed as e:
                    logger.warning(f"⚠️ BVC Proxy Desconectado. Código: {e.code}")
                except Exception as e:
                    logger.error(f"❌ Error inesperado en BVC Proxy loop: {e}")
                finally:
                    if ping_task:
                        ping_task.cancel()
                        
        except Exception as e:
            logger.error(f"❌ Fallo al iniciar BVC Proxy WS: {e}")
            
        logger.info(f"⏳ Reintentando conectar a BVC en {retry_delay}s...")
        await asyncio.sleep(retry_delay)
