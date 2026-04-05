from sqlalchemy import Column, Integer, DateTime, Numeric, ForeignKey, UniqueConstraint, BigInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.database import Base


class PortfolioPosition(Base):
    __tablename__ = "portfolio_positions"

    id = Column(BigInteger, primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), index=True)
    total_shares = Column(Integer, nullable=False, default=0)
    avg_buy_price = Column(Numeric(18, 4))
    total_invested_bs = Column(Numeric(18, 2))
    total_invested_usd = Column(Numeric(18, 6))
    current_price = Column(Numeric(18, 4))
    current_value_bs = Column(Numeric(18, 2))
    current_value_usd = Column(Numeric(18, 6))
    unrealized_pnl_bs = Column(Numeric(18, 2))
    unrealized_pnl_usd = Column(Numeric(18, 6))
    unrealized_pnl_pct = Column(Numeric(8, 4))
    realized_pnl_bs = Column(Numeric(18, 2), default=0)
    realized_pnl_usd = Column(Numeric(18, 6), default=0)
    last_updated = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('user_id', 'stock_id', name='unique_user_stock'),
    )