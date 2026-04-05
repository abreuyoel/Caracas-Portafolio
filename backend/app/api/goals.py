from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.goal import InvestmentGoal
from app.models.stock import Stock
from app.utils.security import decode_token
from uuid import UUID
from typing import List, Optional
from pydantic import BaseModel
from datetime import date, datetime, timezone
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
    except Exception as e:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")


class GoalCreate(BaseModel):
    title: str
    description: Optional[str] = None
    goal_type: str  # "porcentaje", "precio_objetivo", "monto", "sueno"
    stock_symbol: Optional[str] = None  # if goal is for a specific stock
    target_value: Optional[float] = None
    currency: str = "USD"
    deadline: Optional[date] = None
    icon: Optional[str] = None
    color: Optional[str] = None


class GoalUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    target_value: Optional[float] = None
    current_value: Optional[float] = None
    deadline: Optional[date] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    is_achieved: Optional[bool] = None


class GoalResponse(BaseModel):
    id: int
    title: str
    description: Optional[str]
    goal_type: str
    stock_symbol: Optional[str]
    stock_name: Optional[str]
    target_value: Optional[float]
    current_value: Optional[float]
    currency: str
    deadline: Optional[date]
    icon: Optional[str]
    color: Optional[str]
    is_achieved: bool
    achieved_at: Optional[datetime]
    progress_pct: Optional[float]
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/", response_model=List[GoalResponse])
async def list_goals(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(InvestmentGoal, Stock.symbol, Stock.name)
        .outerjoin(Stock, InvestmentGoal.stock_id == Stock.id)
        .where(InvestmentGoal.user_id == user_id)
        .order_by(InvestmentGoal.created_at.desc())
    )
    rows = result.all()
    goals = []
    for goal, sym, sname in rows:
        progress = None
        if goal.target_value and goal.current_value and float(goal.target_value) > 0:
            progress = min(100.0, float(goal.current_value) / float(goal.target_value) * 100)
        goals.append(GoalResponse(
            id=goal.id,
            title=goal.title,
            description=goal.description,
            goal_type=goal.goal_type,
            stock_symbol=sym,
            stock_name=sname,
            target_value=float(goal.target_value) if goal.target_value else None,
            current_value=float(goal.current_value) if goal.current_value else None,
            currency=goal.currency or "USD",
            deadline=goal.deadline,
            icon=goal.icon,
            color=goal.color,
            is_achieved=goal.is_achieved or False,
            achieved_at=goal.achieved_at,
            progress_pct=progress,
            created_at=goal.created_at
        ))
    return goals


@router.post("/", response_model=GoalResponse, status_code=201)
async def create_goal(
    data: GoalCreate,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    stock_id = None
    stock_sym = None
    stock_name = None
    if data.stock_symbol:
        result = await db.execute(select(Stock).where(Stock.symbol == data.stock_symbol))
        stock = result.scalar_one_or_none()
        if stock:
            stock_id = stock.id
            stock_sym = stock.symbol
            stock_name = stock.name

    goal = InvestmentGoal(
        user_id=user_id,
        stock_id=stock_id,
        title=data.title,
        description=data.description,
        goal_type=data.goal_type,
        target_value=Decimal(str(data.target_value)) if data.target_value is not None else None,
        current_value=Decimal("0"),
        currency=data.currency,
        deadline=data.deadline,
        icon=data.icon,
        color=data.color,
    )
    db.add(goal)
    await db.commit()
    await db.refresh(goal)
    return GoalResponse(
        id=goal.id,
        title=goal.title,
        description=goal.description,
        goal_type=goal.goal_type,
        stock_symbol=stock_sym,
        stock_name=stock_name,
        target_value=float(goal.target_value) if goal.target_value else None,
        current_value=0.0,
        currency=goal.currency or "USD",
        deadline=goal.deadline,
        icon=goal.icon,
        color=goal.color,
        is_achieved=False,
        achieved_at=None,
        progress_pct=0.0,
        created_at=goal.created_at
    )


@router.put("/{goal_id}", response_model=GoalResponse)
async def update_goal(
    goal_id: int,
    data: GoalUpdate,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(InvestmentGoal).where(
            InvestmentGoal.id == goal_id,
            InvestmentGoal.user_id == user_id
        )
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Objetivo no encontrado")

    if data.title is not None: goal.title = data.title
    if data.description is not None: goal.description = data.description
    if data.target_value is not None: goal.target_value = Decimal(str(data.target_value))
    if data.current_value is not None: goal.current_value = Decimal(str(data.current_value))
    if data.deadline is not None: goal.deadline = data.deadline
    if data.icon is not None: goal.icon = data.icon
    if data.color is not None: goal.color = data.color
    if data.is_achieved is not None:
        goal.is_achieved = data.is_achieved
        if data.is_achieved and not goal.achieved_at:
            goal.achieved_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(goal)

    # Fetch stock info
    stock_sym = None
    stock_name = None
    if goal.stock_id:
        sr = await db.execute(select(Stock).where(Stock.id == goal.stock_id))
        stock = sr.scalar_one_or_none()
        if stock:
            stock_sym = stock.symbol
            stock_name = stock.name

    progress = None
    if goal.target_value and goal.current_value and float(goal.target_value) > 0:
        progress = min(100.0, float(goal.current_value) / float(goal.target_value) * 100)

    return GoalResponse(
        id=goal.id, title=goal.title, description=goal.description,
        goal_type=goal.goal_type, stock_symbol=stock_sym, stock_name=stock_name,
        target_value=float(goal.target_value) if goal.target_value else None,
        current_value=float(goal.current_value) if goal.current_value else None,
        currency=goal.currency or "USD", deadline=goal.deadline,
        icon=goal.icon, color=goal.color,
        is_achieved=goal.is_achieved or False, achieved_at=goal.achieved_at,
        progress_pct=progress, created_at=goal.created_at
    )


@router.delete("/{goal_id}", status_code=204)
async def delete_goal(
    goal_id: int,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(InvestmentGoal).where(
            InvestmentGoal.id == goal_id,
            InvestmentGoal.user_id == user_id
        )
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Objetivo no encontrado")
    await db.delete(goal)
    await db.commit()
