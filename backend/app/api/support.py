from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.support_ticket import SupportTicket
from app.utils.security import decode_token
from uuid import UUID
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


async def get_optional_user_id(authorization: Optional[str] = Header(None)) -> Optional[UUID]:
    """Obtener ID del usuario desde el token JWT (opcional)"""
    if not authorization:
        return None
    try:
        token = authorization.replace("Bearer ", "")
        payload = decode_token(token)
        if payload and payload.get("sub"):
            return UUID(payload.get("sub"))
    except Exception:
        pass
    return None


class TicketCreate(BaseModel):
    message: str
    user_email: Optional[str] = None


class TicketResponse(BaseModel):
    id: int
    message: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


@router.post("/", response_model=TicketResponse, status_code=201)
async def create_support_ticket(
    data: TicketCreate,
    user_id: Optional[UUID] = Depends(get_optional_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Crear un ticket de soporte"""
    if not data.message or not data.message.strip():
        raise HTTPException(status_code=400, detail="El mensaje no puede estar vacío")

    ticket = SupportTicket(
        user_id=user_id,
        message=data.message.strip(),
        user_email=data.user_email,
        status="pending"
    )
    db.add(ticket)
    await db.commit()
    await db.refresh(ticket)

    logger.info(f"📬 Ticket de soporte creado: #{ticket.id}")
    return TicketResponse(
        id=ticket.id,
        message=ticket.message,
        status=ticket.status,
        created_at=ticket.created_at
    )


@router.get("/", response_model=List[TicketResponse])
async def list_my_tickets(
    user_id: Optional[UUID] = Depends(get_optional_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Listar los tickets del usuario actual"""
    if not user_id:
        return []
    result = await db.execute(
        select(SupportTicket)
        .where(SupportTicket.user_id == user_id)
        .order_by(SupportTicket.created_at.desc())
        .limit(20)
    )
    tickets = result.scalars().all()
    return [
        TicketResponse(id=t.id, message=t.message, status=t.status, created_at=t.created_at)
        for t in tickets
    ]
