"""
Refresh price_history for ALL active stocks pulling from BVC APIs.
Skips dates already present (uses _insert_missing_sessions which checks the unique constraint).

Run from backend/ with venv activated:
    python scratch/refresh_all_price_history.py
"""
import asyncio
import logging
import os
import sys
import time
from datetime import date as _date

# Add backend root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)
logger = logging.getLogger("refresh_all")

from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.stock import Stock, PriceHistory
from app.api.stocks import _fetch_bvc_sessions_for_symbol, _insert_missing_sessions


async def main():
    started = time.time()
    print("=" * 70)
    print(f"REFRESH price_history — {_date.today().isoformat()}")
    print("=" * 70)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Stock).where(Stock.is_active == True))
        stocks = result.scalars().all()

    total = len(stocks)
    print(f"Acciones activas en DB: {total}\n")

    grand_inserted = 0
    errors: list[tuple[str, str]] = []
    per_stock: list[tuple[str, int, int]] = []  # (symbol, bvc_sessions, inserted)

    for idx, stock in enumerate(stocks, 1):
        sym = stock.symbol
        try:
            sessions = await _fetch_bvc_sessions_for_symbol(sym)
            if not sessions:
                print(f"  [{idx:>2}/{total}] {sym:<8} BVC devolvió 0 sesiones, skip")
                per_stock.append((sym, 0, 0))
                continue

            async with AsyncSessionLocal() as db:
                res = await db.execute(select(Stock).where(Stock.symbol == sym))
                db_stock = res.scalar_one_or_none()
                if not db_stock:
                    continue
                inserted = await _insert_missing_sessions(db, db_stock, sessions)

            grand_inserted += inserted
            per_stock.append((sym, len(sessions), inserted))
            tag = "✅" if inserted > 0 else "  "
            print(f"  [{idx:>2}/{total}] {tag} {sym:<8} BVC={len(sessions):>4} inserted={inserted:>4}")
        except Exception as e:
            errors.append((sym, str(e)))
            print(f"  [{idx:>2}/{total}] ❌ {sym:<8} ERROR: {e}")

    elapsed = time.time() - started
    print("\n" + "=" * 70)
    print(f"TERMINADO en {elapsed:.1f}s")
    print(f"  Total filas insertadas en price_history: {grand_inserted}")
    print(f"  Acciones procesadas: {total}")
    print(f"  Acciones con inserts: {sum(1 for _, _, i in per_stock if i > 0)}")
    print(f"  Errores: {len(errors)}")
    if errors:
        print("\nErrores detallados:")
        for sym, msg in errors:
            print(f"  - {sym}: {msg}")
    print("=" * 70)


if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
