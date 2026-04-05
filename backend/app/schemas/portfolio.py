from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from decimal import Decimal


class PortfolioPositionResponse(BaseModel):
    stock_id: int
    stock_symbol: str
    stock_name: str
    total_shares: int
    avg_buy_price: Decimal
    total_invested_bs: Decimal
    total_invested_usd: Decimal
    current_price: Decimal
    current_value_bs: Decimal
    current_value_usd: Decimal
    unrealized_pnl_bs: Decimal
    unrealized_pnl_usd: Decimal
    unrealized_pnl_pct: Decimal
    realized_pnl_bs: Decimal
    realized_pnl_usd: Decimal
    last_updated: datetime

    class Config:
        from_attributes = True


class PortfolioSummary(BaseModel):
    total_invested_usd: Decimal
    current_value_usd: Decimal
    total_unrealized_pnl_usd: Decimal
    total_unrealized_pnl_pct: Decimal
    total_realized_pnl_usd: Decimal
    total_positions: int
    best_performer: Optional[str]
    worst_performer: Optional[str]
    daily_change_usd: Decimal
    daily_change_pct: Decimal
    weekly_change_usd: Decimal
    weekly_change_pct: Decimal
    monthly_change_usd: Decimal
    monthly_change_pct: Decimal