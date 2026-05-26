"""
Modelos de la comunidad social de Caracas Portafolio.
─────────────────────────────────────────────────────
Posts, reacciones, comentarios, encuestas, badges, torneos.
"""

from sqlalchemy import (
    Column, String, Boolean, DateTime, Integer, Float,
    ForeignKey, UniqueConstraint, Text, BigInteger
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.database import Base
import uuid


# ── Posts del Feed ──────────────────────────────────────────────────────────────

class SocialPost(Base):
    """Publicación en el feed social."""
    __tablename__ = "social_posts"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id       = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    post_type     = Column(String(20), nullable=False, default="text")   # text | trade_share | milestone | poll | screenshot
    content       = Column(Text, default="")
    image_url     = Column(String, nullable=True)
    trade_id      = Column(UUID(as_uuid=True), nullable=True)           # ref a transactions.id si es trade_share
    poll_id       = Column(UUID(as_uuid=True), nullable=True)           # ref a market_polls.id
    is_anonymous  = Column(Boolean, default=False)
    fire_count    = Column(Integer, default=0)
    save_count    = Column(Integer, default=0)
    comment_count = Column(Integer, default=0)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())


class PostReaction(Base):
    """Reacción a un post (fuego o guardar)."""
    __tablename__ = "post_reactions"
    __table_args__ = (UniqueConstraint("post_id", "user_id", "reaction", name="uq_post_reaction"),)

    id       = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    post_id  = Column(UUID(as_uuid=True), ForeignKey("social_posts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id  = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    reaction = Column(String(10), nullable=False)   # fire | save
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PostComment(Base):
    """Comentario en un post."""
    __tablename__ = "post_comments"

    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    post_id           = Column(UUID(as_uuid=True), ForeignKey("social_posts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id           = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    parent_comment_id = Column(UUID(as_uuid=True), nullable=True)
    content           = Column(Text, nullable=False)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())


# ── Encuestas tipo Polymarket ──────────────────────────────────────────────────

class MarketPoll(Base):
    """Encuesta de mercado."""
    __tablename__ = "market_polls"

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    creator_id     = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    poll_type      = Column(String(20), nullable=False)   # price_direction | price_range | free | dividend | sentiment
    title          = Column(String(300), nullable=False)
    symbol         = Column(String(20), nullable=True)    # acción relacionada (opcional)
    options        = Column(Text, nullable=False)          # JSON array de opciones
    correct_option = Column(Integer, nullable=True)        # se llena al resolver
    closes_at      = Column(DateTime(timezone=True), nullable=False)
    resolved_at    = Column(DateTime(timezone=True), nullable=True)
    is_resolved    = Column(Boolean, default=False)
    total_votes    = Column(Integer, default=0)
    created_at     = Column(DateTime(timezone=True), server_default=func.now())


class PollVote(Base):
    """Voto en una encuesta."""
    __tablename__ = "poll_votes"
    __table_args__ = (UniqueConstraint("poll_id", "user_id", name="uq_poll_vote"),)

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    poll_id      = Column(UUID(as_uuid=True), ForeignKey("market_polls.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id      = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    option_index = Column(Integer, nullable=False)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())


# ── Badges / Insignias ─────────────────────────────────────────────────────────

class UserBadge(Base):
    """Insignia ganada por un usuario."""
    __tablename__ = "user_badges"
    __table_args__ = (UniqueConstraint("user_id", "badge_id", name="uq_user_badge"),)

    id        = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id   = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    badge_id  = Column(String(40), nullable=False)         # key del badge: diamond_hands, sniper, oracle, etc.
    earned_at = Column(DateTime(timezone=True), server_default=func.now())


# ── Torneos Paper Trading ──────────────────────────────────────────────────────

class PaperTournament(Base):
    """Torneo de paper trading."""
    __tablename__ = "paper_tournaments"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title           = Column(String(200), nullable=False)
    description     = Column(Text, default="")
    initial_balance = Column(Float, default=10000.0)
    starts_at       = Column(DateTime(timezone=True), nullable=False)
    ends_at         = Column(DateTime(timezone=True), nullable=False)
    is_active       = Column(Boolean, default=True)
    created_by      = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    max_participants = Column(Integer, default=100)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())


class TournamentEntry(Base):
    """Participante en un torneo."""
    __tablename__ = "tournament_entries"
    __table_args__ = (UniqueConstraint("tournament_id", "user_id", name="uq_tournament_entry"),)

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tournament_id = Column(UUID(as_uuid=True), ForeignKey("paper_tournaments.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id       = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    current_value = Column(Float, default=10000.0)
    roi_pct       = Column(Float, default=0.0)
    trades_count  = Column(Integer, default=0)
    joined_at     = Column(DateTime(timezone=True), server_default=func.now())


# ── Market Mood (sentimiento diario) ───────────────────────────────────────────

class MarketMoodVote(Base):
    """Voto de sentimiento diario."""
    __tablename__ = "market_mood_votes"
    __table_args__ = (UniqueConstraint("user_id", "vote_date", name="uq_mood_vote_day"),)

    id        = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id   = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    sentiment = Column(String(10), nullable=False)   # bull | bear | neutral
    vote_date = Column(String(10), nullable=False)   # YYYY-MM-DD (1 voto por día)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
