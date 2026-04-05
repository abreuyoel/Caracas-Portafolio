from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.database import Base
import enum


class RiskProfile(str, enum.Enum):
    """Perfiles de riesgo de inversión"""
    CONSERVADOR = "conservador"      # Bajo riesgo, estabilidad
    MODERADO = "moderado"            # Riesgo medio, balanceado
    AGRESIVO = "agresivo"            # Alto riesgo, alto retorno


class InvestmentGoal(str, enum.Enum):
    """Objetivos de inversión"""
    PRESERVAR_CAPITAL = "preservar_capital"
    INGRESO_PASIVO = "ingreso_pasivo"
    CRECIMIENTO_MODERADO = "crecimiento_moderado"
    CRECIMIENTO_AGRESIVO = "crecimiento_agresivo"
    ESPECULACION = "especulacion"


class TimeHorizon(str, enum.Enum):
    """Horizonte temporal"""
    CORTO_PLAZO = "corto_plazo"      # < 1 año
    MEDIANO_PLAZO = "mediano_plazo"   # 1-3 años
    LARGO_PLAZO = "largo_plazo"       # 3-5 años
    MUY_LARGO_PLAZO = "muy_largo_plazo"  # 5+ años


class UserProfile(Base):
    """Perfil de inversión del usuario"""
    __tablename__ = "user_profiles"

    id = Column(Integer, primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    
    # Perfil de riesgo
    risk_profile = Column(Enum(RiskProfile), default=RiskProfile.MODERADO)
    
    # Objetivo de inversión
    investment_goal = Column(Enum(InvestmentGoal), default=InvestmentGoal.CRECIMIENTO_MODERADO)
    
    # Horizonte temporal
    time_horizon = Column(Enum(TimeHorizon), default=TimeHorizon.MEDIANO_PLAZO)
    
    # Experiencia en inversión (1-10)
    experience_level = Column(Integer, default=5)
    
    # Porcentaje máximo de pérdida tolerada
    max_loss_tolerance = Column(Float, default=10.0)  # 10%
    
    # Porcentaje de retorno esperado anual
    expected_return = Column(Float, default=15.0)  # 15% anual
    
    # Capital disponible para invertir
    available_capital = Column(Float, default=0.0)
    
    # ¿Permite inversión en acciones volátiles?
    allows_volatile_stocks = Column(Boolean, default=True)
    
    # ¿Permite inversión a crédito/margen?
    allows_margin_trading = Column(Boolean, default=False)
    
    # Sectores de interés (JSON o texto)
    preferred_sectors = Column(Text, nullable=True)  # Ej: ["banca", "telecom", "energia"]
    
    # Sectores a evitar
    avoided_sectors = Column(Text, nullable=True)
    
    # ¿Quiere recibir notificaciones diarias?
    daily_notifications = Column(Boolean, default=True)
    
    # ¿Quiere alertas de oportunidades?
    opportunity_alerts = Column(Boolean, default=True)
    
    # ¿Quiere alertas de riesgo?
    risk_alerts = Column(Boolean, default=True)
    
    # Frecuencia de notificaciones
    notification_frequency = Column(String, default="daily")  # daily, weekly, real-time

    # Reacción ante caída del 20% del portafolio en un día (pregunta de comportamiento)
    # valores: vender_todo, vender_parcial, mantener, comprar_mas, apalancarme
    portfolio_drop_reaction = Column(String, default="mantener", nullable=True)
    
    # Última actualización del perfil
    profile_updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Fecha de creación
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f"<UserProfile {self.user_id} - {self.risk_profile}>"