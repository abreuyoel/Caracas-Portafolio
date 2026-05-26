from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.database import get_db
from app.models.paper_trading import PaperPortfolio, PaperTransaction
from app.models.stock import Stock, BcvRate
from app.utils.security import decode_token
from app.websocket.bvc_proxy import bvc_cache
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID
import logging

logger = logging.getLogger(__name__)


def _get_live_price_bs(symbol: str) -> float | None:
    """Get the latest BVC price from the in-memory WebSocket cache."""
    data = bvc_cache.get("serverDataExt") or bvc_cache.get("serverData")
    if not data or not isinstance(data, list):
        return None
    for item in data:
        if isinstance(item, dict) and item.get("COD_SIMB") == symbol:
            precio = item.get("PRECIO")
            if precio and precio > 0:
                return float(precio)
    return None

router = APIRouter()

STARTING_BALANCE = Decimal("10000")


async def get_current_user_id(authorization: str = Header(...)) -> UUID:
    token = authorization.replace("Bearer ", "")
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Token inválido")
    return UUID(payload.get("sub"))


# ── helpers ────────────────────────────────────────────────────────────────────

async def _get_or_create_pp(user_id: UUID, db: AsyncSession) -> PaperPortfolio:
    result = await db.execute(select(PaperPortfolio).where(PaperPortfolio.user_id == user_id))
    pp = result.scalar_one_or_none()
    if not pp:
        pp = PaperPortfolio(user_id=user_id, virtual_balance_usd=STARTING_BALANCE)
        db.add(pp)
        await db.flush()
    return pp


async def _get_bcv(db: AsyncSession) -> Decimal:
    result = await db.execute(select(BcvRate).order_by(BcvRate.rate_date.desc()).limit(1))
    row = result.scalar_one_or_none()
    return Decimal(str(row.rate)) if row else Decimal("36")


async def _build_positions(user_id: UUID, db: AsyncSession) -> dict:
    result = await db.execute(
        select(PaperTransaction)
        .where(PaperTransaction.user_id == user_id)
        .order_by(PaperTransaction.executed_at)
    )
    txs = result.scalars().all()
    positions: dict = {}
    for tx in txs:
        sym = tx.stock_symbol
        if sym not in positions:
            positions[sym] = {"qty": 0, "cost_usd": Decimal("0"), "name": tx.stock_name or sym}
        q = tx.quantity
        if tx.order_type == "BUY":
            positions[sym]["qty"] += q
            positions[sym]["cost_usd"] += tx.total_usd
        else:
            if positions[sym]["qty"] > 0:
                avg = positions[sym]["cost_usd"] / positions[sym]["qty"]
                positions[sym]["cost_usd"] -= avg * q
            positions[sym]["qty"] -= q
    return {s: p for s, p in positions.items() if p["qty"] > 0}


# ── endpoints ──────────────────────────────────────────────────────────────────

@router.get("/portfolio")
async def get_paper_portfolio(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    pp = await _get_or_create_pp(user_id, db)
    bcv = await _get_bcv(db)
    positions = await _build_positions(user_id, db)

    holdings = []
    total_value = Decimal("0")
    total_cost = Decimal("0")

    for sym, pos in positions.items():
        stock_r = await db.execute(select(Stock).where(Stock.symbol == sym))
        stock = stock_r.scalar_one_or_none()
        # Prefer live WS price over database price
        live_bs = _get_live_price_bs(sym)
        if live_bs is not None:
            price_usd = Decimal(str(live_bs)) / bcv
        elif stock and stock.last_price:
            price_usd = Decimal(str(stock.last_price)) / bcv
        else:
            price_usd = Decimal("0")

        cur_val = price_usd * pos["qty"]
        cost = pos["cost_usd"]
        pnl = cur_val - cost
        pnl_pct = (pnl / cost * 100) if cost > 0 else Decimal("0")

        holdings.append({
            "symbol": sym,
            "name": pos["name"],
            "quantity": pos["qty"],
            "avg_cost_usd": float(cost / pos["qty"]),
            "current_price_usd": float(price_usd),
            "current_value_usd": float(cur_val),
            "cost_usd": float(cost),
            "pnl_usd": float(pnl),
            "pnl_pct": float(pnl_pct),
        })
        total_value += cur_val
        total_cost += cost

    cash = Decimal(str(pp.virtual_balance_usd))
    total_portfolio = cash + total_value
    total_pnl = total_portfolio - STARTING_BALANCE

    return {
        "virtual_balance_usd": float(cash),
        "total_invested_usd": float(total_cost),
        "total_current_value_usd": float(total_value),
        "total_portfolio_value_usd": float(total_portfolio),
        "total_pnl_usd": float(total_pnl),
        "total_pnl_pct": float(total_pnl / STARTING_BALANCE * 100),
        "bcv_rate": float(bcv),
        "holdings": holdings,
        "created_at": pp.created_at.isoformat() if pp.created_at else None,
        "reset_count": pp.reset_count or 0,
    }


@router.get("/stocks")
async def get_tradeable_stocks(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    bcv = await _get_bcv(db)
    result = await db.execute(
        select(Stock)
        .where(Stock.is_active == True)
        .where(Stock.last_price != None)
        .order_by(Stock.symbol)
    )
    stocks = result.scalars().all()
    return [
        {
            "symbol": s.symbol,
            "name": s.name,
            "last_price_bs": float(s.last_price),
            "last_price_usd": float(Decimal(str(s.last_price)) / bcv),
        }
        for s in stocks
    ]


class OrderRequest(BaseModel):
    symbol: str
    order_type: str   # BUY | SELL
    quantity: int
    executed_price_bs: Optional[float] = None
    notes: Optional[str] = None
    apply_slippage: bool = True  # liquidity-based slippage simulator (paper trading)


async def _estimate_slippage_pct(
    symbol: str,
    quantity: int,
    order_type: str,
    db: AsyncSession,
) -> tuple[float, dict]:
    """Estimates slippage % based on order size relative to BVC liquidity.
    Uses 20-day avg volume from PriceHistory. Square-root impact model:
        slippage_pct = k * sqrt(qty / adv_20d)
    where k is calibrated for BVC's low-liquidity environment.
    Returns (slippage_pct, debug_info).
    """
    from app.models.stock import PriceHistory
    from datetime import date as _date, timedelta as _td

    res = await db.execute(select(Stock).where(Stock.symbol == symbol))
    stock = res.scalar_one_or_none()
    if not stock:
        return 0.0, {"reason": "stock_not_found"}

    cutoff = _date.today() - _td(days=45)
    res = await db.execute(
        select(PriceHistory.volume)
        .where(PriceHistory.stock_id == stock.id)
        .where(PriceHistory.price_date >= cutoff)
        .order_by(PriceHistory.price_date.desc())
        .limit(20)
    )
    vols = [int(r.volume) for r in res.all() if r.volume]
    if not vols:
        return 0.5, {"reason": "no_volume_history", "fallback_pct": 0.5}

    adv = sum(vols) / len(vols)
    if adv <= 0:
        return 0.5, {"reason": "zero_adv"}

    # Square-root market impact model (BVC-tuned: k=2.5 for thin liquidity)
    K = 2.5
    ratio = quantity / adv
    base_slip = K * (ratio ** 0.5)

    # Floor (typical BVC bid-ask spread ~0.15%) and cap (10% extreme)
    slip_pct = max(0.15, min(10.0, base_slip))

    # Sells in BVC tend to slip slightly more than buys (less buy-side depth)
    if order_type == "SELL":
        slip_pct *= 1.10

    return round(slip_pct, 4), {
        "adv_20d": int(adv),
        "samples": len(vols),
        "qty_to_adv_ratio": round(ratio, 6),
        "base_pct": round(base_slip, 4),
        "applied_pct": round(slip_pct, 4),
        "model": "sqrt_impact_k2.5",
    }


@router.post("/order")
async def execute_order(
    body: OrderRequest,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    if body.order_type not in ("BUY", "SELL"):
        raise HTTPException(status_code=400, detail="order_type debe ser BUY o SELL")
    if body.quantity <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a 0")

    pp = await _get_or_create_pp(user_id, db)
    bcv = await _get_bcv(db)

    stock_r = await db.execute(select(Stock).where(Stock.symbol == body.symbol))
    stock = stock_r.scalar_one_or_none()
    if not stock:
        raise HTTPException(status_code=404, detail=f"Accion {body.symbol} no encontrada")
    if not stock.last_price and body.executed_price_bs is None:
        raise HTTPException(status_code=400, detail=f"Sin precio disponible para {body.symbol}")

    slippage_info = None
    if body.executed_price_bs is not None and body.executed_price_bs > 0:
        # Frontend already applied slippage; trust the executed price as-is.
        price_bs = Decimal(str(body.executed_price_bs))
    else:
        # MARKET order — get the mid price and apply server-side slippage.
        live_bs = _get_live_price_bs(body.symbol)
        if live_bs is not None:
            mid_bs = Decimal(str(live_bs))
            logger.info(f"Paper Trade: Using live WS price for {body.symbol}: Bs {live_bs}")
        else:
            mid_bs = Decimal(str(stock.last_price))
        price_bs = mid_bs

        if body.apply_slippage:
            slip_pct, slip_dbg = await _estimate_slippage_pct(
                body.symbol, body.quantity, body.order_type, db
            )
            adj = Decimal(str(slip_pct)) / Decimal("100")
            if body.order_type == "BUY":
                price_bs = (mid_bs * (Decimal("1") + adj)).quantize(Decimal("0.0001"))
            else:
                price_bs = (mid_bs * (Decimal("1") - adj)).quantize(Decimal("0.0001"))
            slippage_info = {
                "applied_pct": slip_pct,
                "mid_price_bs": float(mid_bs),
                "executed_price_bs": float(price_bs),
                "diff_bs": float(price_bs - mid_bs),
                **slip_dbg,
            }

    price_usd = price_bs / bcv
    total_usd = price_usd * body.quantity

    if body.order_type == "BUY":
        cash = Decimal(str(pp.virtual_balance_usd))
        if cash < total_usd:
            raise HTTPException(
                status_code=400,
                detail=f"Saldo insuficiente. Disponible: ${float(cash):.2f}, necesario: ${float(total_usd):.2f}"
            )
        pp.virtual_balance_usd = cash - total_usd
    else:
        positions = await _build_positions(user_id, db)
        net_qty = positions.get(body.symbol, {}).get("qty", 0)
        if net_qty < body.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"Solo tienes {net_qty} acciones de {body.symbol}"
            )
        pp.virtual_balance_usd = Decimal(str(pp.virtual_balance_usd)) + total_usd

    pt = PaperTransaction(
        user_id=user_id,
        stock_symbol=body.symbol,
        stock_name=stock.name,
        order_type=body.order_type,
        quantity=body.quantity,
        price_bs=price_bs,
        price_usd=price_usd,
        bcv_rate=bcv,
        total_usd=total_usd,
        notes=body.notes,
    )
    db.add(pt)
    await db.commit()

    return {
        "status": "ejecutada",
        "symbol": body.symbol,
        "order_type": body.order_type,
        "quantity": body.quantity,
        "price_bs": float(price_bs),
        "price_usd": float(price_usd),
        "total_usd": float(total_usd),
        "bcv_rate": float(bcv),
        "new_balance_usd": float(pp.virtual_balance_usd),
        "slippage": slippage_info,
    }


@router.get("/slippage-preview")
async def preview_slippage(
    symbol: str,
    quantity: int,
    order_type: str = "BUY",
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Preview the slippage that would apply if you placed this order right now.
    Useful to show a banner in the UI before clicking Execute."""
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="quantity > 0")
    if order_type not in ("BUY", "SELL"):
        raise HTTPException(status_code=400, detail="order_type BUY|SELL")
    pct, dbg = await _estimate_slippage_pct(symbol.upper(), quantity, order_type, db)
    return {
        "symbol": symbol.upper(),
        "order_type": order_type,
        "quantity": quantity,
        "slippage_pct": pct,
        **dbg,
    }


@router.get("/history")
async def get_history(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PaperTransaction)
        .where(PaperTransaction.user_id == user_id)
        .order_by(PaperTransaction.executed_at.desc())
    )
    txs = result.scalars().all()
    return [
        {
            "id": t.id,
            "symbol": t.stock_symbol,
            "name": t.stock_name,
            "order_type": t.order_type,
            "quantity": t.quantity,
            "price_bs": float(t.price_bs),
            "price_usd": float(t.price_usd),
            "total_usd": float(t.total_usd),
            "bcv_rate": float(t.bcv_rate) if t.bcv_rate else None,
            "executed_at": t.executed_at.isoformat() if t.executed_at else None,
            "notes": t.notes,
        }
        for t in txs
    ]


@router.post("/reset")
async def reset_portfolio(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    pp = await _get_or_create_pp(user_id, db)
    await db.execute(
        delete(PaperTransaction).where(PaperTransaction.user_id == user_id)
    )
    pp.virtual_balance_usd = STARTING_BALANCE
    pp.reset_count = (pp.reset_count or 0) + 1
    pp.last_reset_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status": "reiniciado", "balance_usd": float(STARTING_BALANCE), "reset_count": pp.reset_count}
