from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.database import Base


class ChatSession(Base):
    """Sesión de chat con IA"""
    __tablename__ = "chat_sessions"

    id = Column(Integer, primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), default="Nuevo Chat")  # Título generado automáticamente
    chat_type = Column(String(20), default="general")  # general, portfolio, technical, comparative
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    model_used = Column(String(50), default="gemini-pro")

    def __repr__(self):
        return f"<ChatSession {self.id} - {self.title}>"


class ChatMessage(Base):
    """Mensaje individual dentro de una sesión de chat"""
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(20), nullable=False)  # "user" o "assistant"
    content = Column(Text, nullable=False)
    model_used = Column(String(50))
    tokens_used = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f"<ChatMessage {self.id} - {self.role}>"