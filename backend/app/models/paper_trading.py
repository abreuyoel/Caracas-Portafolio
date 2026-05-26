from sqlalchemy import Column, Integer, String, DateTime, Numeric, ForeignKey, Text, BigInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.database import Base


class PaperPortfolio(Base):
    __tablename__ = "paper_portfolios"

    id = Column(Integer, primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
                     unique=True, nullable=False, index=True)
    virtual_balance_usd = Column(Numeric(18, 6), nullable=False, default=10000)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    reset_count = Column(Integer, default=0)
    last_reset_at = Column(DateTime(timezone=True))


class PaperTransaction(Base):
    __tablename__ = "paper_transactions"

    id = Column(BigInteger, primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
                     nullable=False, index=True)
    stock_symbol = Column(String(20), nullable=False, index=True)
    stock_name = Column(String(200))
    order_type = Column(String(4), nullable=False)   # BUY | SELL
    quantity = Column(Integer, nullable=False)
    price_bs = Column(Numeric(18, 4), nullable=False)
    price_usd = Column(Numeric(18, 6), nullable=False)
    bcv_rate = Column(Numeric(12, 4))
    total_usd = Column(Numeric(18, 6), nullable=False)
    executed_at = Column(DateTime(timezone=True), server_default=func.now())
    notes = Column(Text)
