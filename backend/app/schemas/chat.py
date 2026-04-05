from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime


class ChatMessageCreate(BaseModel):
    """Crear nuevo mensaje"""
    role: str  # "user" o "assistant"
    content: str
    model_used: Optional[str] = None
    tokens_used: Optional[int] = 0


class ChatMessageResponse(BaseModel):
    """Respuesta de mensaje"""
    id: int
    session_id: int
    role: str
    content: str
    model_used: Optional[str]
    tokens_used: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


class ChatSessionCreate(BaseModel):
    """Crear nueva sesión de chat"""
    title: Optional[str] = "Nuevo Chat"
    model_used: Optional[str] = "gemini-pro"
    chat_type: Optional[str] = "general"  # general, portfolio, technical, comparative


class ChatSessionResponse(BaseModel):
    """Respuesta de sesión de chat"""
    id: int
    user_id: str
    title: str
    chat_type: Optional[str] = "general"
    is_active: bool
    created_at: datetime
    updated_at: datetime
    model_used: str
    message_count: int = 0
    last_message: Optional[str] = None
    last_message_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[int] = None
    chat_type: Optional[str] = "general"  # general, portfolio, technical, comparative

    # ── Modo gráfico individual ──────────────────────────────────────────────
    chart_context: Optional[Dict[str, Any]] = None

    # ✅ Libro de órdenes de la acción principal (modo individual)
    order_book: Optional[List[Dict[str, Any]]] = None

    # ── Modo comparativo ─────────────────────────────────────────────────────
    stocks_context: Optional[List[Dict[str, Any]]] = None
    comparison_mode: bool = False

    # ✅ Libros de órdenes por acción en modo comparativo
    # Formato: { "BBVA": [...entries], "MERCANTIL": [...entries], ... }
    order_books: Optional[Dict[str, List[Dict[str, Any]]]] = None

    class Config:
        extra = "allow"  # Permite campos extra no declarados