from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.database import Base


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id = Column(Integer, primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    message = Column(Text, nullable=False)
    user_email = Column(String(255), nullable=True)
    status = Column(String(30), default="pending")  # pending, reviewed, resolved
    created_at = Column(DateTime(timezone=True), server_default=func.now())
