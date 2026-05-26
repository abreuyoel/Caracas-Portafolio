from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.alert import Alert, PushSubscription
from app.models.stock import Stock
from app.utils.security import decode_token
from uuid import UUID
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
from decimal import Decimal
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


async def get_current_user_id(authorization: str = Header(...)) -> UUID:
    try:
        token = authorization.replace("Bearer ", "")
        payload = decode_token(token)
        if not payload or not payload.get("sub"):
            raise HTTPException(status_code=401, detail="Token inválido")
        return UUID(payload.get("sub"))
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")


class AlertCreate(BaseModel):
    stock_symbol: str
    alert_type: str  # "precio_objetivo", "porcentaje_subida", "porcentaje_bajada"
    condition_type: str  # "above", "below"
    condition_value: float
    message: Optional[str] = None


class AlertResponse(BaseModel):
    id: int
    stock_symbol: Optional[str]
    stock_name: Optional[str]
    alert_type: str
    condition_type: Optional[str]
    condition_value: Optional[float]
    message: Optional[str]
    is_triggered: bool
    is_read: bool
    triggered_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class PushSubscriptionCreate(BaseModel):
    endpoint: str
    p256dh: str
    auth_key: str


@router.get("/", response_model=List[AlertResponse])
async def list_alerts(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Alert, Stock.symbol, Stock.name)
        .outerjoin(Stock, Alert.stock_id == Stock.id)
        .where(Alert.user_id == user_id)
        .order_by(Alert.created_at.desc())
    )
    rows = result.all()
    return [
        AlertResponse(
            id=a.id, stock_symbol=sym, stock_name=sname,
            alert_type=a.alert_type, condition_type=a.condition_type,
            condition_value=float(a.condition_value) if a.condition_value else None,
            message=a.message, is_triggered=a.is_triggered or False,
            is_read=a.is_read or False, triggered_at=a.triggered_at,
            created_at=a.created_at
        )
        for a, sym, sname in rows
    ]


@router.post("/", response_model=AlertResponse, status_code=201)
async def create_alert(
    data: AlertCreate,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    stock_id = None
    stock_sym = None
    stock_name = None
    result = await db.execute(select(Stock).where(Stock.symbol == data.stock_symbol))
    stock = result.scalar_one_or_none()
    if stock:
        stock_id = stock.id
        stock_sym = stock.symbol
        stock_name = stock.name

    alert = Alert(
        user_id=user_id,
        stock_id=stock_id,
        alert_type=data.alert_type,
        condition_type=data.condition_type,
        condition_value=Decimal(str(data.condition_value)),
        message=data.message or f"Alerta de precio para {data.stock_symbol}",
    )
    db.add(alert)
    await db.commit()
    await db.refresh(alert)
    return AlertResponse(
        id=alert.id, stock_symbol=stock_sym, stock_name=stock_name,
        alert_type=alert.alert_type, condition_type=alert.condition_type,
        condition_value=float(alert.condition_value) if alert.condition_value else None,
        message=alert.message, is_triggered=False, is_read=False,
        triggered_at=None, created_at=alert.created_at
    )


@router.put("/{alert_id}/read", status_code=200)
async def mark_alert_read(
    alert_id: int,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Alert).where(Alert.id == alert_id, Alert.user_id == user_id)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alerta no encontrada")
    alert.is_read = True
    await db.commit()
    return {"status": "ok"}


@router.delete("/{alert_id}", status_code=204)
async def delete_alert(
    alert_id: int,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Alert).where(Alert.id == alert_id, Alert.user_id == user_id)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alerta no encontrada")
    await db.delete(alert)
    await db.commit()


@router.post("/push/subscribe", status_code=201)
async def subscribe_push(
    data: PushSubscriptionCreate,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    # Check if already exists
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.user_id == user_id,
            PushSubscription.endpoint == data.endpoint
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.p256dh = data.p256dh
        existing.auth_key = data.auth_key
        await db.commit()
        return {"status": "updated"}

    sub = PushSubscription(
        user_id=user_id,
        endpoint=data.endpoint,
        p256dh=data.p256dh,
        auth_key=data.auth_key
    )
    db.add(sub)
    await db.commit()
    return {"status": "subscribed"}


@router.post("/push/test")
async def test_push_notification(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Envía una notificación push de prueba al usuario."""
    from app.services.push_service import send_push_notification
    result = await db.execute(
        select(PushSubscription).where(PushSubscription.user_id == user_id)
    )
    subs = result.scalars().all()
    if not subs:
        raise HTTPException(status_code=404, detail="No tienes suscripciones push registradas. Activa las notificaciones primero.")

    sent = 0
    for sub in subs:
        ok = await send_push_notification(
            endpoint=sub.endpoint,
            p256dh=sub.p256dh,
            auth=sub.auth_key,
            title="🔔 Test de notificación",
            body="¡Las notificaciones push funcionan correctamente en Caracas Portafolio!",
            url="/goals"
        )
        if ok:
            sent += 1

    if sent == 0:
        raise HTTPException(status_code=500, detail="No se pudo enviar la notificación. La suscripción puede estar expirada — reactiva las notificaciones.")
    return {"status": "sent", "count": sent}


@router.get("/push/vapid-public-key")
async def get_vapid_public_key():
    from app.config import settings
    return {"public_key": settings.vapid_public_key}


@router.delete("/push/unsubscribe", status_code=200)
async def unsubscribe_push(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Eliminar todas las suscripciones push del usuario"""
    result = await db.execute(
        select(PushSubscription).where(PushSubscription.user_id == user_id)
    )
    subs = result.scalars().all()
    for sub in subs:
        await db.delete(sub)
    await db.commit()
    logger.info(f"🔕 Push suscripciones eliminadas para usuario {user_id}")
    return {"status": "unsubscribed", "removed": len(subs)}
