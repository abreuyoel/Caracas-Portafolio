from sqlalchemy import Column, Integer, String, Boolean, DateTime, Numeric, Date, BigInteger, UniqueConstraint
from sqlalchemy.sql import func
from app.database import Base


class Stock(Base):
    __tablename__ = "stocks"

    id = Column(Integer, primary_key=True)
    symbol = Column(String(20), unique=True, nullable=False, index=True)
    name = Column(String(200), nullable=False)
    isin = Column(String(50))
    currency = Column(String(10), default='Bs')
    is_active = Column(Boolean, default=True)
    shares_outstanding = Column(BigInteger)
    last_price = Column(Numeric(18, 4))
    prev_close = Column(Numeric(18, 4))
    day_high = Column(Numeric(18, 4))
    day_low = Column(Numeric(18, 4))
    volume = Column(BigInteger)
    last_updated = Column(DateTime(timezone=True))

    def __repr__(self):
        return f"<Stock {self.symbol}>"


class PriceHistory(Base):
    __tablename__ = "price_history"

    id = Column(BigInteger, primary_key=True)
    stock_id = Column(Integer, nullable=False, index=True)
    price_date = Column(Date, nullable=False)
    open_price = Column(Numeric(18, 4))
    close_price = Column(Numeric(18, 4))
    change_amount = Column(Numeric(18, 4))
    change_pct = Column(Numeric(8, 4))
    high_price = Column(Numeric(18, 4))
    low_price = Column(Numeric(18, 4))
    trades = Column(Integer)
    volume = Column(BigInteger)
    amount = Column(Numeric(18, 2))

    __table_args__ = (
        UniqueConstraint('stock_id', 'price_date', name='unique_stock_date'),
    )


class BcvRate(Base):
    __tablename__ = "bcv_rates"

    id = Column(Integer, primary_key=True)
    rate_date = Column(Date, unique=True, nullable=False)
    rate = Column(Numeric(12, 4), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())