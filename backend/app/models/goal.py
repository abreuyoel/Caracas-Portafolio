from sqlalchemy import Column, Integer, String, DateTime, Numeric, Date, Boolean, ForeignKey, Text, BigInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.database import Base


class InvestmentGoal(Base):
    __tablename__ = "investment_goals"

    id = Column(BigInteger, primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=True)
    title = Column(String(200), nullable=False)
    description = Column(Text)
    goal_type = Column(String(30), nullable=False)
    target_value = Column(Numeric(18, 4))
    current_value = Column(Numeric(18, 4), default=0)
    currency = Column(String(10), default='USD')
    deadline = Column(Date)
    icon = Column(String(50))
    color = Column(String(20))
    is_achieved = Column(Boolean, default=False)
    achieved_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())