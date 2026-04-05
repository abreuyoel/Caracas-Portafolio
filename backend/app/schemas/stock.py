from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date
from decimal import Decimal


class StockResponse(BaseModel):
    id: int
    symbol: str
    name: str
    isin: Optional[str]
    currency: str
    is_active: bool
    last_price: Optional[Decimal]
    prev_close: Optional[Decimal]
    day_high: Optional[Decimal]
    day_low: Optional[Decimal]
    volume: Optional[int]
    last_updated: Optional[datetime]
    change_amount: Optional[Decimal] = None
    change_pct: Optional[Decimal] = None

    class Config:
        from_attributes = True


class StockPriceUpdate(BaseModel):
    symbol: str
    last_price: Decimal
    prev_close: Optional[Decimal]
    change_amount: Decimal
    change_pct: Decimal
    volume: Optional[int]
    timestamp: datetime