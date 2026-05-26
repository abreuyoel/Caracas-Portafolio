from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.dividend import Dividend
from app.models.stock import Stock, BcvRate
from app.utils.security import decode_token
from uuid import UUID
from datetime import date
from pydantic import BaseModel
from typing import Optional
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


async def get_current_user_id(authorization: str = Header(...)) -> UUID:
    token = authorization.replace("Bearer ", "")
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Token inválido")
    return UUID(payload.get("sub"))


# ── Schemas ────────────────────────────────────────────────────────────────────

class DividendCreate(BaseModel):
    stock_symbol: str
    shares_held: float
    dividend_per_share_bs: float
    payment_date: date
    ex_date: Optional[date] = None
    notes: Optional[str] = None


class DividendUpdate(BaseModel):
    shares_held: Optional[float] = None
    dividend_per_share_bs: Optional[float] = None
    payment_date: Optional[date] = None
    ex_date: Optional[date] = None
    notes: Optional[str] = None


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/")
async def list_dividends(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Lista todos los dividendos registrados del usuario."""
    result = await db.execute(
        select(Dividend)
        .where(Dividend.user_id == user_id)
        .order_by(Dividend.payment_date.desc())
    )
    dividends = result.scalars().all()

    # Latest BCV for USD conversion reference
    bcv_r = await db.execute(select(BcvRate).order_by(BcvRate.rate_date.desc()).limit(1))
    bcv_row = bcv_r.scalar_one_or_none()
    current_bcv = float(bcv_row.rate) if bcv_row else 36.0

    total_bs  = sum(float(d.total_bs)  for d in dividends)
    total_usd = sum(float(d.total_usd or 0) for d in dividends)

    return {
        "dividends": [
            {
                "id": d.id,
                "stock_symbol": d.stock_symbol,
                "stock_name": d.stock_name,
                "shares_held": float(d.shares_held),
                "dividend_per_share_bs": float(d.dividend_per_share_bs),
                "dividend_per_share_usd": float(d.dividend_per_share_usd or 0),
                "total_bs": float(d.total_bs),
                "total_usd": float(d.total_usd or 0),
                "bcv_rate": float(d.bcv_rate or 0),
                "ex_date": d.ex_date.isoformat() if d.ex_date else None,
                "payment_date": d.payment_date.isoformat(),
                "notes": d.notes,
                "created_at": d.created_at.isoformat() if d.created_at else None,
            }
            for d in dividends
        ],
        "summary": {
            "count": len(dividends),
            "total_bs": round(total_bs, 2),
            "total_usd": round(total_usd, 6),
            "current_bcv": current_bcv,
        }
    }


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_dividend(
    data: DividendCreate,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Registra un nuevo dividendo recibido."""
    symbol = data.stock_symbol.upper().strip()

    # Lookup stock
    stock_r = await db.execute(select(Stock).where(Stock.symbol == symbol))
    stock = stock_r.scalar_one_or_none()

    # BCV rate at payment date
    bcv_r = await db.execute(
        select(BcvRate)
        .where(BcvRate.rate_date <= data.payment_date)
        .order_by(BcvRate.rate_date.desc())
        .limit(1)
    )
    bcv_row = bcv_r.scalar_one_or_none()
    bcv_rate = float(bcv_row.rate) if bcv_row else 36.0

    total_bs  = data.shares_held * data.dividend_per_share_bs
    dps_usd   = data.dividend_per_share_bs / bcv_rate if bcv_rate > 0 else 0
    total_usd = total_bs / bcv_rate if bcv_rate > 0 else 0

    dividend = Dividend(
        user_id=user_id,
        stock_id=stock.id if stock else None,
        stock_symbol=symbol,
        stock_name=stock.name if stock else symbol,
        shares_held=data.shares_held,
        dividend_per_share_bs=data.dividend_per_share_bs,
        dividend_per_share_usd=round(dps_usd, 8),
        total_bs=round(total_bs, 2),
        total_usd=round(total_usd, 6),
        bcv_rate=round(bcv_rate, 4),
        ex_date=data.ex_date,
        payment_date=data.payment_date,
        notes=data.notes,
    )
    db.add(dividend)
    await db.commit()
    await db.refresh(dividend)

    return {
        "id": dividend.id,
        "stock_symbol": dividend.stock_symbol,
        "total_bs": float(dividend.total_bs),
        "total_usd": float(dividend.total_usd or 0),
        "payment_date": dividend.payment_date.isoformat(),
        "message": f"Dividendo de {symbol} registrado correctamente",
    }


@router.put("/{dividend_id}")
async def update_dividend(
    dividend_id: int,
    data: DividendUpdate,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Actualiza un dividendo existente."""
    result = await db.execute(
        select(Dividend).where(Dividend.id == dividend_id, Dividend.user_id == user_id)
    )
    dividend = result.scalar_one_or_none()
    if not dividend:
        raise HTTPException(status_code=404, detail="Dividendo no encontrado")

    if data.shares_held is not None:
        dividend.shares_held = data.shares_held
    if data.dividend_per_share_bs is not None:
        dividend.dividend_per_share_bs = data.dividend_per_share_bs
    if data.payment_date is not None:
        dividend.payment_date = data.payment_date
    if data.ex_date is not None:
        dividend.ex_date = data.ex_date
    if data.notes is not None:
        dividend.notes = data.notes

    # Recalculate totals
    bcv_rate = float(dividend.bcv_rate or 36.0)
    shares   = float(dividend.shares_held)
    dps_bs   = float(dividend.dividend_per_share_bs)
    dividend.total_bs  = round(shares * dps_bs, 2)
    dividend.total_usd = round(shares * dps_bs / bcv_rate, 6) if bcv_rate > 0 else 0
    dividend.dividend_per_share_usd = round(dps_bs / bcv_rate, 8) if bcv_rate > 0 else 0

    await db.commit()
    return {"message": "Dividendo actualizado", "id": dividend_id}


@router.delete("/{dividend_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dividend(
    dividend_id: int,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Elimina un dividendo."""
    result = await db.execute(
        select(Dividend).where(Dividend.id == dividend_id, Dividend.user_id == user_id)
    )
    dividend = result.scalar_one_or_none()
    if not dividend:
        raise HTTPException(status_code=404, detail="Dividendo no encontrado")
    await db.delete(dividend)
    await db.commit()


@router.get("/summary/total-return")
async def get_dividend_total_return(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Calcula el retorno total incluyendo dividendos.
    Útil para mostrar el retorno real vs retorno de precio puro.
    """
    from app.models.transaction import Transaction
    from app.models.stock import BcvRate

    # All dividends
    div_r = await db.execute(
        select(Dividend).where(Dividend.user_id == user_id)
    )
    dividends = div_r.scalars().all()

    total_dividends_usd = sum(float(d.total_usd or 0) for d in dividends)
    total_dividends_bs  = sum(float(d.total_bs) for d in dividends)

    # Per-symbol dividend totals
    by_symbol: dict[str, dict] = {}
    for d in dividends:
        if d.stock_symbol not in by_symbol:
            by_symbol[d.stock_symbol] = {
                "symbol": d.stock_symbol,
                "name": d.stock_name,
                "total_bs": 0.0,
                "total_usd": 0.0,
                "payments": 0,
            }
        by_symbol[d.stock_symbol]["total_bs"]  += float(d.total_bs)
        by_symbol[d.stock_symbol]["total_usd"] += float(d.total_usd or 0)
        by_symbol[d.stock_symbol]["payments"]  += 1

    # Invested capital from transactions
    txs_r = await db.execute(
        select(Transaction)
        .where(Transaction.user_id == user_id)
        .where(Transaction.order_type == "Compra")
    )
    txs = txs_r.scalars().all()
    total_invested_usd = sum(float(tx.amount_usd or 0) for tx in txs)

    dividend_yield_pct = (total_dividends_usd / total_invested_usd * 100) if total_invested_usd > 0 else 0

    return {
        "total_dividends_bs": round(total_dividends_bs, 2),
        "total_dividends_usd": round(total_dividends_usd, 6),
        "total_invested_usd": round(total_invested_usd, 2),
        "dividend_yield_pct": round(dividend_yield_pct, 4),
        "by_symbol": sorted(by_symbol.values(), key=lambda x: x["total_usd"], reverse=True),
    }
