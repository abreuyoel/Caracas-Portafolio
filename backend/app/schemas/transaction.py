from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date, datetime
from decimal import Decimal


class SlippageEntry(BaseModel):
    quantity: int = Field(..., gt=0)
    price: float = Field(..., gt=0)

class TransactionCreate(BaseModel):
    stock_symbol: str
    order_type: str = Field(..., pattern="^(Compra|Venta)$")
    request_type: str = Field(..., pattern="^(Mercado|Limite)$")
    quantity: int = Field(..., gt=0)
    avg_price: Optional[float] = None                # ahora opcional (se calcula si hay slippage)
    gross_amount: Optional[float] = None
    commission: Optional[float] = 0
    iva: Optional[float] = 0
    registry_fee: Optional[float] = 0
    net_amount: Optional[float] = None
    bcv_rate: Optional[float] = None
    amount_usd: Optional[float] = None
    transaction_date: date
    order_number: Optional[str] = None
    brokerage: Optional[str] = None
    notes: Optional[str] = None
    slippage_entries: Optional[List[SlippageEntry]] = None   # nuevo


class TransactionResponse(BaseModel):
    id: int
    order_number: Optional[str]
    order_type: str
    request_type: str
    quantity: int
    avg_price: float
    gross_amount: Optional[float]
    commission: Optional[float]
    iva: Optional[float]
    registry_fee: Optional[float]
    net_amount: Optional[float]
    bcv_rate: Optional[float]
    amount_usd: Optional[float]
    transaction_date: date
    brokerage: Optional[str]
    notes: Optional[str]
    stock_symbol: str
    stock_name: Optional[str]
    created_at: str

    class Config:
        from_attributes = True


class TransactionUpdate(BaseModel):
    quantity: Optional[int] = None
    avg_price: Optional[float] = None
    notes: Optional[str] = None

class SlippageTramo(BaseModel):
    tramo_num: int
    cantidad: int
    precio: Decimal
    monto_tramo: Optional[Decimal] = None

    class Config:
        from_attributes = True


class TransactionWithSlippage(BaseModel):
    """Extiende TransactionResponse con los tramos de slippage"""
    id: int
    slippages: List[SlippageTramo] = []

    class Config:
        from_attributes = True
