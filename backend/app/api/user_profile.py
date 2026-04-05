from fastapi import APIRouter, Depends, HTTPException, Header, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.database import get_db
from app.models.user_profile import UserProfile, RiskProfile, InvestmentGoal, TimeHorizon
from app.schemas.user_profile import (
    UserProfileCreate,
    UserProfileUpdate,
    UserProfileResponse,
    InvestmentQuestionnaire
)
from app.utils.security import decode_token
from uuid import UUID
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import logging
import json

logger = logging.getLogger(__name__)
router = APIRouter()


async def get_current_user_id(authorization: str = Header(...)) -> UUID:
    """Obtener ID del usuario desde el token JWT"""
    try:
        token = authorization.replace("Bearer ", "")
        payload = decode_token(token)
        if not payload or not payload.get("sub"):
            raise HTTPException(status_code=401, detail="Token inválido")
        return UUID(payload.get("sub"))
    except Exception as e:
        logger.error(f"Error decoding token: {e}")
        raise HTTPException(status_code=401, detail="Token inválido o expirado")


@router.get("/questionnaire")
async def get_investment_questionnaire():
    """Obtener cuestionario para determinar perfil de inversión"""
    return InvestmentQuestionnaire()


@router.post("/calculate-profile")
async def calculate_risk_profile(
    answers: dict,
    user_id: UUID = Depends(get_current_user_id)
):
    """
    Calcular perfil de riesgo basado en respuestas del cuestionario
    
    answers: {
        "question_1": "crecimiento_moderado",
        "question_2": "mediano_plazo",
        "question_3": "10",
        "question_4": "5",
        "question_5": "mantener"
    }
    """
    try:
        # Mapeo de respuestas a scores
        question_map = {
            "question_1": {
                "preservar_capital": 1, "ingreso_pasivo": 3, "crecimiento_moderado": 5,
                "crecimiento_agresivo": 7, "especulacion": 10
            },
            "question_2": {
                "corto_plazo": 2, "mediano_plazo": 5, "largo_plazo": 7, "muy_largo_plazo": 10
            },
            "question_3": {
                "5": 1, "10": 3, "20": 5, "30": 7, "50": 10
            },
            "question_4": {
                "1": 1, "3": 3, "5": 5, "7": 7, "10": 10
            },
            "question_5": {
                "vender_todo": 1, "vender_parcial": 3, "mantener": 5,
                "comprar_mas": 8, "apalancarme": 10
            }
        }
        
        # Calcular score total
        total_score = 0
        for question, answer in answers.items():
            if question in question_map and answer in question_map[question]:
                total_score += question_map[question][answer]
        
        # Promedio (máximo 50 puntos / 5 preguntas = 10)
        avg_score = total_score / 5
        
        # Determinar perfil
        if avg_score <= 3:
            risk_profile = RiskProfile.CONSERVADOR
            investment_goal = InvestmentGoal.PRESERVAR_CAPITAL
        elif avg_score <= 5:
            risk_profile = RiskProfile.MODERADO
            investment_goal = InvestmentGoal.CRECIMIENTO_MODERADO
        else:
            risk_profile = RiskProfile.AGRESIVO
            investment_goal = InvestmentGoal.CRECIMIENTO_AGRESIVO
        
        # Determinar horizonte temporal
        time_horizon_answer = answers.get("question_2", "mediano_plazo")
        time_horizon = TimeHorizon(time_horizon_answer)
        
        # Determinar tolerancia a pérdida
        max_loss = float(answers.get("question_3", "10"))
        
        return {
            "risk_profile": risk_profile.value,
            "investment_goal": investment_goal.value,
            "time_horizon": time_horizon.value,
            "risk_score": round(avg_score, 2),
            "max_loss_tolerance": max_loss,
            "recommendation": get_profile_recommendation(risk_profile, investment_goal, time_horizon)
        }
        
    except Exception as e:
        logger.error(f"Error calculating profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def get_profile_recommendation(risk_profile: RiskProfile, goal: InvestmentGoal, horizon: TimeHorizon) -> str:
    """Obtener recomendación basada en perfil"""
    recommendations = {
        RiskProfile.CONSERVADOR: "Te recomendamos acciones de banca y servicios básicos con alta liquidez y baja volatilidad (BPV, BNC, BVL). Evita acciones especulativas.",
        RiskProfile.MODERADO: "Te recomendamos un portafolio balanceado: 60% acciones estables (banca, telecom) + 40% acciones de crecimiento moderado (FNC, CCR, SVS).",
        RiskProfile.AGRESIVO: "Puedes considerar acciones de mayor volatilidad con potencial de crecimiento (GZL, PTN, acciones pequeñas). Monitorea diariamente."
    }
    
    return recommendations.get(risk_profile, "Consulta con un asesor financiero.")


@router.get("/", response_model=Optional[UserProfileResponse])
async def get_user_profile(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Obtener perfil de inversión del usuario"""
    try:
        result = await db.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        profile = result.scalar_one_or_none()
        
        if not profile:
            return None
        
        return UserProfileResponse(
            user_id=str(profile.user_id),
            risk_profile=profile.risk_profile.value,
            investment_goal=profile.investment_goal.value,
            time_horizon=profile.time_horizon.value,
            experience_level=profile.experience_level,
            max_loss_tolerance=profile.max_loss_tolerance,
            expected_return=profile.expected_return,
            available_capital=profile.available_capital,
            allows_volatile_stocks=profile.allows_volatile_stocks,
            allows_margin_trading=profile.allows_margin_trading,
            preferred_sectors=profile.preferred_sectors,
            avoided_sectors=profile.avoided_sectors,
            daily_notifications=profile.daily_notifications,
            opportunity_alerts=profile.opportunity_alerts,
            risk_alerts=profile.risk_alerts,
            notification_frequency=profile.notification_frequency,
            portfolio_drop_reaction=getattr(profile, 'portfolio_drop_reaction', None),
            profile_updated_at=profile.profile_updated_at,
            created_at=profile.created_at
        )
        
    except Exception as e:
        logger.error(f"Error getting profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/", response_model=UserProfileResponse)
async def create_user_profile(
    profile_data: UserProfileCreate,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Crear perfil de inversión del usuario"""
    try:
        # Verificar si ya existe
        result = await db.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        existing = result.scalar_one_or_none()
        
        if existing:
            raise HTTPException(status_code=400, detail="El usuario ya tiene un perfil")
        
        # Crear nuevo perfil
        profile = UserProfile(
            user_id=user_id,
            **profile_data.model_dump()
        )
        
        db.add(profile)
        await db.commit()
        await db.refresh(profile)
        
        logger.info(f"✅ Perfil creado para usuario {user_id}")
        
        return UserProfileResponse(
            user_id=str(profile.user_id),
            risk_profile=profile.risk_profile.value,
            investment_goal=profile.investment_goal.value,
            time_horizon=profile.time_horizon.value,
            experience_level=profile.experience_level,
            max_loss_tolerance=profile.max_loss_tolerance,
            expected_return=profile.expected_return,
            available_capital=profile.available_capital,
            allows_volatile_stocks=profile.allows_volatile_stocks,
            allows_margin_trading=profile.allows_margin_trading,
            preferred_sectors=profile.preferred_sectors,
            avoided_sectors=profile.avoided_sectors,
            daily_notifications=profile.daily_notifications,
            opportunity_alerts=profile.opportunity_alerts,
            risk_alerts=profile.risk_alerts,
            notification_frequency=profile.notification_frequency,
            portfolio_drop_reaction=getattr(profile, 'portfolio_drop_reaction', None),
            profile_updated_at=profile.profile_updated_at,
            created_at=profile.created_at
        )
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error creating profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/", response_model=UserProfileResponse)
async def update_user_profile(
    profile_data: UserProfileUpdate,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Actualizar perfil de inversión del usuario"""
    try:
        result = await db.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        profile = result.scalar_one_or_none()
        
        if not profile:
            raise HTTPException(status_code=404, detail="Perfil no encontrado")
        
        # Actualizar campos
        update_data = profile_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            if value is not None:
                setattr(profile, field, value)
        
        profile.profile_updated_at = datetime.now(timezone.utc)
        
        await db.commit()
        await db.refresh(profile)
        
        logger.info(f"✅ Perfil actualizado para usuario {user_id}")
        
        return UserProfileResponse(
            user_id=str(profile.user_id),
            risk_profile=profile.risk_profile.value,
            investment_goal=profile.investment_goal.value,
            time_horizon=profile.time_horizon.value,
            experience_level=profile.experience_level,
            max_loss_tolerance=profile.max_loss_tolerance,
            expected_return=profile.expected_return,
            available_capital=profile.available_capital,
            allows_volatile_stocks=profile.allows_volatile_stocks,
            allows_margin_trading=profile.allows_margin_trading,
            preferred_sectors=profile.preferred_sectors,
            avoided_sectors=profile.avoided_sectors,
            daily_notifications=profile.daily_notifications,
            opportunity_alerts=profile.opportunity_alerts,
            risk_alerts=profile.risk_alerts,
            notification_frequency=profile.notification_frequency,
            portfolio_drop_reaction=getattr(profile, 'portfolio_drop_reaction', None),
            profile_updated_at=profile.profile_updated_at,
            created_at=profile.created_at
        )
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/recommendations")
async def get_personalized_recommendations(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Obtener recomendaciones personalizadas basadas en perfil + IA
    """
    try:
        # Obtener perfil del usuario
        profile_result = await db.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        profile = profile_result.scalar_one_or_none()
        
        if not profile:
            raise HTTPException(status_code=404, detail="Perfil no encontrado. Completa tu perfil primero.")
        
        # Obtener acciones activas
        from app.models.stock import Stock
        stocks_result = await db.execute(
            select(Stock).where(Stock.is_active == True)
        )
        stocks = stocks_result.scalars().all()
        
        # Filtrar por perfil
        recommended_stocks = []
        avoided_sectors = profile.avoided_sectors.split(",") if profile.avoided_sectors else []
        
        for stock in stocks:
            # Verificar sectores evitados
            if any(sector.lower() in stock.name.lower() for sector in avoided_sectors):
                continue
            
            # Score basado en perfil
            stock_score = calculate_stock_score(stock, profile)
            
            if stock_score >= 5:  # Mínimo score para recomendar
                recommended_stocks.append({
                    "symbol": stock.symbol,
                    "name": stock.name,
                    "score": stock_score,
                    "reason": get_stock_reason(stock, profile, stock_score)
                })
        
        # Ordenar por score
        recommended_stocks.sort(key=lambda x: x["score"], reverse=True)
        
        # Top 10 recomendaciones
        return {
            "profile": {
                "risk": profile.risk_profile.value,
                "goal": profile.investment_goal.value,
                "horizon": profile.time_horizon.value
            },
            "recommendations": recommended_stocks[:10],
            "generated_at": datetime.now(timezone.utc).isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting recommendations: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def calculate_stock_score(stock, profile) -> float:
    """Calcular score de acción basado en perfil"""
    score = 5.0  # Base
    
    # Ajustar por volatilidad (simulado)
    if profile.risk_profile == RiskProfile.CONSERVADOR:
        score -= 2  # Penalizar volatilidad
    elif profile.risk_profile == RiskProfile.AGRESIVO:
        score += 2  # Bonificar volatilidad
    
    # Ajustar por horizonte temporal
    if profile.time_horizon == TimeHorizon.CORTO_PLAZO:
        score -= 1  # Preferir liquidez
    elif profile.time_horizon == TimeHorizon.MUY_LARGO_PLAZO:
        score += 1  # Puede esperar más
    
    return min(10, max(1, score))


def get_stock_reason(stock, profile, score) -> str:
    """Obtener razón de recomendación"""
    if score >= 8:
        return "Altamente recomendada para tu perfil"
    elif score >= 6:
        return "Buena opción considerando tu perfil de riesgo"
    else:
        return "Opción moderada, monitorea de cerca"


# ==================== NOTIFICACIONES ====================

@router.post("/send-daily-analysis")
async def send_daily_analysis(
    background_tasks: BackgroundTasks,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Enviar análisis diario personalizado al usuario
    """
    try:
        # Obtener perfil
        profile_result = await db.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        profile = profile_result.scalar_one_or_none()
        
        if not profile or not profile.daily_notifications:
            return {"message": "Usuario no tiene notificaciones diarias activadas"}
        
        # Agregar a background task
        background_tasks.add_task(generate_daily_analysis, user_id, profile)
        
        return {"message": "Análisis diario en proceso"}
        
    except Exception as e:
        logger.error(f"Error scheduling daily analysis: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def generate_daily_analysis(user_id: UUID, profile: UserProfile):
    """Generar y enviar análisis diario (background task)"""
    try:
        # Aquí integrarías con tu servicio de IA
        # 1. Analizar movimientos del día
        # 2. Comparar con perfil del usuario
        # 3. Generar recomendaciones
        # 4. Enviar notificación
        
        logger.info(f"📊 Generating daily analysis for user {user_id}")
        
        # TODO: Implementar envío de email/push notification
        # TODO: Integrar con IA para generar análisis
        
    except Exception as e:
        logger.error(f"Error generating daily analysis: {e}")