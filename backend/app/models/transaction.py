from sqlalchemy import Column, Integer, String, DateTime, Numeric, Date, ForeignKey, Text, BigInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base
import uuid

class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(BigInteger, primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), index=True)
    order_number = Column(String(50))
    order_type = Column(String(10), nullable=False)
    request_type = Column(String(20))
    quantity = Column(Integer, nullable=False)
    avg_price = Column(Numeric(18, 4), nullable=False)
    gross_amount = Column(Numeric(18, 2))
    commission = Column(Numeric(18, 2))
    iva = Column(Numeric(18, 2))
    registry_fee = Column(Numeric(18, 2))
    net_amount = Column(Numeric(18, 2))
    bcv_rate = Column(Numeric(12, 4))
    amount_usd = Column(Numeric(18, 6))
    brokerage = Column(String(100), index=True)
    transaction_date = Column(Date, nullable=False, index=True)
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    slippages = relationship("TransactionSlippage", back_populates="transaction", cascade="all, delete-orphan", order_by="TransactionSlippage.tramo_num")

    def __repr__(self):
        return f"<Transaction {self.order_number}>"
    

class TransactionSlippage(Base):
    __tablename__ = "transaction_slippages"

    id = Column(BigInteger, primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    transaction_id = Column(BigInteger, ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False, index=True)
    tramo_num = Column(Integer, nullable=False)
    cantidad = Column(Integer, nullable=False)
    precio = Column(Numeric(18, 4), nullable=False)
    monto_tramo = Column(Numeric(18, 2))

    transaction = relationship("Transaction", back_populates="slippages")

    def __repr__(self):
        return f"<Slippage tx={self.transaction_id} tramo={self.tramo_num} cant={self.cantidad} precio={self.precio}>"