from sqlalchemy import Column, Integer, String, DateTime, Numeric, Date, ForeignKey, Text, BigInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base
import uuid


class Dividend(Base):
    """Registro de dividendos recibidos por el usuario."""
    __tablename__ = "dividends"

    id = Column(BigInteger, primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), index=True, nullable=True)

    # Datos del dividendo
    stock_symbol = Column(String(20), nullable=False, index=True)
    stock_name   = Column(String(200))
    shares_held  = Column(Numeric(18, 4), nullable=False)              # acciones al momento del pago
    dividend_per_share_bs  = Column(Numeric(18, 6), nullable=False)    # Bs por acción
    dividend_per_share_usd = Column(Numeric(18, 8))                    # USD por acción (calculado)
    total_bs   = Column(Numeric(18, 2), nullable=False)                # total recibido en Bs
    total_usd  = Column(Numeric(18, 6))                                # total en USD
    bcv_rate   = Column(Numeric(12, 4))                                # tasa BCV en la fecha de pago
    ex_date    = Column(Date, index=True)                              # fecha ex-dividendo
    payment_date = Column(Date, nullable=False, index=True)            # fecha de pago efectivo
    notes      = Column(Text)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<Dividend {self.stock_symbol} {self.payment_date} Bs{self.total_bs}>"
