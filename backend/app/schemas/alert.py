from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class AlertResponse(BaseModel):
    id: int
    alert_type: str
    message: str
    is_triggered: bool
    is_read: bool
    triggered_at: Optional[datetime]
    created_at: datetime
    stock_symbol: Optional[str]

    class Config:
        from_attributes = True


class AlertCreate(BaseModel):
    stock_id: Optional[int] = None
    goal_id: Optional[int] = None
    alert_type: str
    condition_type: Optional[str] = None
    condition_value: Optional[float] = None
    message: Optional[str] = None


class PushSubscriptionCreate(BaseModel):
    endpoint: str
    p256dh: str
    auth_key: str