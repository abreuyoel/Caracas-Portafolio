from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.database import Base


class UserSettings(Base):
    __tablename__ = "user_settings"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    default_currency = Column(String(10), default='USD')
    price_refresh_interval = Column(Integer, default=30)
    notifications_enabled = Column(Boolean, default=True)
    email_notifications = Column(Boolean, default=False)
    theme = Column(String(20), default='dark')
    language = Column(String(10), default='es')
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())