from sqlalchemy import Column, Integer, String, DateTime, Numeric, Boolean, ForeignKey, Text, BigInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.database import Base


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(BigInteger, primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=True)
    goal_id = Column(Integer, ForeignKey("investment_goals.id"), nullable=True)
    alert_type = Column(String(50), nullable=False)
    condition_type = Column(String(30))
    condition_value = Column(Numeric(18, 4))
    message = Column(Text)
    is_triggered = Column(Boolean, default=False)
    is_read = Column(Boolean, default=False, index=True)
    triggered_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id = Column(BigInteger, primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    endpoint = Column(String, nullable=False)
    p256dh = Column(String)
    auth_key = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())