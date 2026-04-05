from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, UniqueConstraint, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.database import Base
import uuid


class SocialProfile(Base):
    """
    Perfil público/privado del usuario en la red Caracas Portafolio.
    El alias es OBLIGATORIO y es el único identificador público visible.
    Nunca se expone email, nombre real ni cédula.
    """
    __tablename__ = "social_profiles"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id     = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)

    # Identidad pública (alias obligatorio, único)
    alias       = Column(String(40), unique=True, nullable=False, index=True)
    bio         = Column(String(280), default="")
    avatar_url  = Column(String, default="")

    # Visibilidad
    is_public   = Column(Boolean, default=False)   # False = perfil privado (no aparece en la red)

    # Qué datos permite ver a sus seguidores
    show_capital_initial   = Column(Boolean, default=False)
    show_current_value     = Column(Boolean, default=False)
    show_pnl               = Column(Boolean, default=False)
    show_transactions      = Column(Boolean, default=False)
    show_holdings          = Column(Boolean, default=False)
    show_top_positions     = Column(Boolean, default=False)
    notify_on_transaction  = Column(Boolean, default=False)

    # Selección específica de acciones (JSONB list de símbolos)
    # Si está vacío y show_holdings es True, muestra todo. 
    # Si tiene símbolos, solo muestra esos símbolos.
    visible_symbols        = Column(Text, default="[]") # Usamos Text para compatibilidad, parseado como JSON

    # Consentimiento Legal
    accepted_terms         = Column(Boolean, default=False)
    terms_accepted_at      = Column(DateTime(timezone=True), nullable=True)

    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class SocialFollow(Base):
    """
    Relación follower → followed.
    pending = True: solicitud pendiente de aprobación (para perfiles privados).
    """
    __tablename__ = "social_follows"
    __table_args__ = (UniqueConstraint("follower_id", "followed_id", name="uq_follow"),)

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    follower_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    followed_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    is_pending  = Column(Boolean, default=False)   # True si el seguido aún no aprobó
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
