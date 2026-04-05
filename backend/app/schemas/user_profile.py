from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from app.models.user_profile import RiskProfile, InvestmentGoal, TimeHorizon


class UserProfileCreate(BaseModel):
    """Crear perfil de inversión"""
    risk_profile: RiskProfile = RiskProfile.MODERADO
    investment_goal: InvestmentGoal = InvestmentGoal.CRECIMIENTO_MODERADO
    time_horizon: TimeHorizon = TimeHorizon.MEDIANO_PLAZO
    experience_level: int = Field(5, ge=1, le=10)
    max_loss_tolerance: float = Field(10.0, ge=0, le=100)
    expected_return: float = Field(15.0, ge=0, le=200)
    available_capital: float = Field(0.0, ge=0)
    allows_volatile_stocks: bool = True
    allows_margin_trading: bool = False
    preferred_sectors: Optional[str] = None
    avoided_sectors: Optional[str] = None
    daily_notifications: bool = True
    opportunity_alerts: bool = True
    risk_alerts: bool = True
    notification_frequency: str = "daily"
    portfolio_drop_reaction: Optional[str] = "mantener"


class UserProfileUpdate(BaseModel):
    """Actualizar perfil de inversión"""
    risk_profile: Optional[RiskProfile] = None
    investment_goal: Optional[InvestmentGoal] = None
    time_horizon: Optional[TimeHorizon] = None
    experience_level: Optional[int] = None
    max_loss_tolerance: Optional[float] = None
    expected_return: Optional[float] = None
    available_capital: Optional[float] = None
    allows_volatile_stocks: Optional[bool] = None
    allows_margin_trading: Optional[bool] = None
    preferred_sectors: Optional[str] = None
    avoided_sectors: Optional[str] = None
    daily_notifications: Optional[bool] = None
    opportunity_alerts: Optional[bool] = None
    risk_alerts: Optional[bool] = None
    notification_frequency: Optional[str] = None
    portfolio_drop_reaction: Optional[str] = None


class UserProfileResponse(BaseModel):
    """Respuesta del perfil"""
    user_id: str
    risk_profile: str
    investment_goal: str
    time_horizon: str
    experience_level: int
    max_loss_tolerance: float
    expected_return: float
    available_capital: float
    allows_volatile_stocks: bool
    allows_margin_trading: bool
    preferred_sectors: Optional[str]
    avoided_sectors: Optional[str]
    daily_notifications: bool
    opportunity_alerts: bool
    risk_alerts: bool
    notification_frequency: str
    portfolio_drop_reaction: Optional[str] = None
    profile_updated_at: datetime
    created_at: datetime

    class Config:
        from_attributes = True


class InvestmentQuestionnaire(BaseModel):
    """Cuestionario para determinar perfil"""
    questions: List[dict] = [
        {
            "id": 1,
            "question": "¿Cuál es tu principal objetivo de inversión?",
            "options": [
                {"value": "preservar_capital", "label": "Preservar mi capital", "risk_score": 1},
                {"value": "ingreso_pasivo", "label": "Generar ingresos pasivos", "risk_score": 3},
                {"value": "crecimiento_moderado", "label": "Crecimiento moderado", "risk_score": 5},
                {"value": "crecimiento_agresivo", "label": "Crecimiento agresivo", "risk_score": 7},
                {"value": "especulacion", "label": "Máximo retorno (alto riesgo)", "risk_score": 10}
            ]
        },
        {
            "id": 2,
            "question": "¿Cuál es tu horizonte de inversión?",
            "options": [
                {"value": "corto_plazo", "label": "Menos de 1 año", "risk_score": 2},
                {"value": "mediano_plazo", "label": "1-3 años", "risk_score": 5},
                {"value": "largo_plazo", "label": "3-5 años", "risk_score": 7},
                {"value": "muy_largo_plazo", "label": "Más de 5 años", "risk_score": 10}
            ]
        },
        {
            "id": 3,
            "question": "¿Qué porcentaje de pérdida máxima tolerarías en un año?",
            "options": [
                {"value": "5", "label": "Hasta 5%", "risk_score": 1},
                {"value": "10", "label": "Hasta 10%", "risk_score": 3},
                {"value": "20", "label": "Hasta 20%", "risk_score": 5},
                {"value": "30", "label": "Hasta 30%", "risk_score": 7},
                {"value": "50", "label": "Más de 30%", "risk_score": 10}
            ]
        },
        {
            "id": 4,
            "question": "¿Cuál es tu experiencia en inversión?",
            "options": [
                {"value": "1", "label": "Principiante (0-1 años)", "risk_score": 1},
                {"value": "3", "label": "Básica (1-3 años)", "risk_score": 3},
                {"value": "5", "label": "Intermedia (3-5 años)", "risk_score": 5},
                {"value": "7", "label": "Avanzada (5-10 años)", "risk_score": 7},
                {"value": "10", "label": "Experta (10+ años)", "risk_score": 10}
            ]
        },
        {
            "id": 5,
            "question": "¿Cómo reaccionarías si tu portafolio cae 20% en un mes?",
            "options": [
                {"value": "vender_todo", "label": "Vender todo inmediatamente", "risk_score": 1},
                {"value": "vender_parcial", "label": "Vender parcialmente", "risk_score": 3},
                {"value": "mantener", "label": "Mantener y esperar", "risk_score": 5},
                {"value": "comprar_mas", "label": "Comprar más (promediar)", "risk_score": 8},
                {"value": "apalancarme", "label": "Apalancarme para comprar más", "risk_score": 10}
            ]
        },
        {
            "id": 6,
            "question": "¿En qué sectores de la BVC prefieres invertir? (puedes elegir varios)",
            "multiple": True,
            "options": [
                {"value": "banca", "label": "🏦 Banca (BPV, BNC, BVL, ABC.A)"},
                {"value": "manufactura", "label": "🏭 Manufactura (FNV, CCR, SVS)"},
                {"value": "petroleo", "label": "⛽ Petróleo y Gas (PTN)"},
                {"value": "telecomunicaciones", "label": "📡 Telecomunicaciones (TDV.D)"},
                {"value": "alimentos", "label": "🍽️ Alimentos y Bebidas (RFM, RST)"},
                {"value": "seguros", "label": "🛡️ Seguros y Fondos (BVCC, RFM)"},
                {"value": "quimica", "label": "🧪 Química e Industria (CGQ)"},
                {"value": "todos", "label": "✅ Todos los sectores"}
            ]
        },
        {
            "id": 7,
            "question": "¿Hay sectores que prefieras evitar?",
            "multiple": True,
            "options": [
                {"value": "ninguno", "label": "✅ Ninguno, invierto en todo"},
                {"value": "banca", "label": "🏦 Banca"},
                {"value": "petroleo", "label": "⛽ Petróleo y Gas"},
                {"value": "manufactura", "label": "🏭 Manufactura"},
                {"value": "telecomunicaciones", "label": "📡 Telecomunicaciones"},
                {"value": "alimentos", "label": "🍽️ Alimentos y Bebidas"},
                {"value": "quimica", "label": "🧪 Química"}
            ]
        },
        {
            "id": 8,
            "question": "¿Cuál es tu retorno anual esperado en la BVC?",
            "options": [
                {"value": "10", "label": "Hasta 10% anual (conservador)", "risk_score": 1},
                {"value": "20", "label": "10–20% anual (moderado)", "risk_score": 3},
                {"value": "40", "label": "20–40% anual (crecimiento)", "risk_score": 6},
                {"value": "70", "label": "40–70% anual (agresivo)", "risk_score": 8},
                {"value": "100", "label": "Más del 70% anual (especulativo)", "risk_score": 10}
            ]
        },
        {
            "id": 9,
            "question": "¿Qué porcentaje de tu patrimonio total destinarías a la BVC?",
            "options": [
                {"value": "10", "label": "Menos del 10% (muy cauteloso)", "risk_score": 1},
                {"value": "25", "label": "10–25% (prudente)", "risk_score": 3},
                {"value": "50", "label": "25–50% (comprometido)", "risk_score": 6},
                {"value": "75", "label": "50–75% (concentrado)", "risk_score": 8},
                {"value": "90", "label": "Más del 75% (todo en BVC)", "risk_score": 10}
            ]
        }
    ]