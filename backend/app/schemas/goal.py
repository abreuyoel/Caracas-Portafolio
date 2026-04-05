from pydantic import BaseModel, Field
from typing import Optional
from datetime import date, datetime
from decimal import Decimal


class GoalCreate(BaseModel):
    stock_id: Optional[int] = None
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    goal_type: str = Field(..., pattern="^(amount_usd|amount_bs|percentage|dream)$")
    target_value: Decimal
    currency: str = "USD"
    deadline: Optional[date] = None
    icon: Optional[str] = None
    color: Optional[str] = None


class GoalResponse(BaseModel):
    id: int
    stock_id: Optional[int]
    stock_symbol: Optional[str]
    title: str
    description: Optional[str]
    goal_type: str
    target_value: Decimal
    current_value: Decimal
    currency: str
    deadline: Optional[date]
    icon: Optional[str]
    color: Optional[str]
    progress_pct: Decimal
    is_achieved: bool
    achieved_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class GoalUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    target_value: Optional[Decimal] = None
    deadline: Optional[date] = None
    icon: Optional[str] = None
    color: Optional[str] = None