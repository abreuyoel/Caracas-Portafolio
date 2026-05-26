"""
Community API — Caracas Portafolio
──────────────────────────────────
Feed social, encuestas Polymarket, leaderboard, market mood,
"qué compra la red", torneos de paper trading, badges.
"""

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, and_, case, literal_column
from app.database import get_db
from app.models.social_community import (
    SocialPost, PostReaction, PostComment,
    MarketPoll, PollVote, UserBadge,
    PaperTournament, TournamentEntry, MarketMoodVote,
)
from app.models.social_profile import SocialProfile, SocialFollow
from app.models.transaction import Transaction
from app.models.stock import Stock, BcvRate
from app.models.paper_trading import PaperPortfolio, PaperTransaction
from app.utils.security import decode_token
from uuid import UUID
from typing import Optional
from pydantic import BaseModel, Field
from datetime import datetime, timedelta, date, timezone
import json
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Auth ──────────────────────────────────────────────────────────────────────

async def get_current_user_id(authorization: str = Header(...)) -> UUID:
    token = authorization.replace("Bearer ", "")
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Token inválido")
    return UUID(payload.get("sub"))


async def _get_alias(user_id: UUID, db: AsyncSession) -> str:
    """Get alias for user_id, or '???' if no profile."""
    r = await db.execute(select(SocialProfile.alias).where(SocialProfile.user_id == user_id))
    return r.scalar_one_or_none() or "???"


async def _get_profile(user_id: UUID, db: AsyncSession) -> SocialProfile | None:
    r = await db.execute(select(SocialProfile).where(SocialProfile.user_id == user_id))
    return r.scalar_one_or_none()


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreatePostBody(BaseModel):
    content: str = Field("", max_length=1000)
    post_type: str = Field("text", pattern=r"^(text|trade_share|milestone|screenshot)$")
    image_url: Optional[str] = None
    trade_id: Optional[str] = None
    is_anonymous: bool = False


class CreateCommentBody(BaseModel):
    content: str = Field(..., min_length=1, max_length=500)
    parent_comment_id: Optional[str] = None


class CreatePollBody(BaseModel):
    title: str = Field(..., min_length=5, max_length=300)
    poll_type: str = Field("free", pattern=r"^(price_direction|price_range|free|dividend|sentiment)$")
    symbol: Optional[str] = None
    options: list[str] = Field(..., min_length=2, max_length=6)
    closes_in_hours: int = Field(48, ge=1, le=720)


class VotePollBody(BaseModel):
    option_index: int


class MoodVoteBody(BaseModel):
    sentiment: str = Field(..., pattern=r"^(bull|bear|neutral)$")


# ════════════════════════════════════════════════════════════════════════════════
#  FEED SOCIAL
# ════════════════════════════════════════════════════════════════════════════════

@router.get("/feed")
async def get_community_feed(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Timeline: posts de gente que sigo + mis propios posts.
    Ordenados por fecha descendente, paginados.
    """
    # Get IDs I follow
    follow_r = await db.execute(
        select(SocialFollow.followed_id).where(
            SocialFollow.follower_id == user_id,
            SocialFollow.is_pending == False,
        )
    )
    following_ids = [r for r in follow_r.scalars().all()]
    following_ids.append(user_id)  # include my own posts

    offset = (page - 1) * limit
    posts_r = await db.execute(
        select(SocialPost)
        .where(SocialPost.user_id.in_(following_ids))
        .order_by(desc(SocialPost.created_at))
        .offset(offset)
        .limit(limit)
    )
    posts = posts_r.scalars().all()

    # Enrich with alias + my reactions
    result = []
    for p in posts:
        alias = await _get_alias(p.user_id, db) if not p.is_anonymous else "Anónimo"
        avatar = ""
        if not p.is_anonymous:
            prof = await _get_profile(p.user_id, db)
            avatar = prof.avatar_url if prof else ""

        # Check my reactions
        my_reactions_r = await db.execute(
            select(PostReaction.reaction).where(
                PostReaction.post_id == p.id,
                PostReaction.user_id == user_id,
            )
        )
        my_reactions = [r for r in my_reactions_r.scalars().all()]

        # poll data if attached
        poll_data = None
        if p.poll_id:
            poll_r = await db.execute(select(MarketPoll).where(MarketPoll.id == p.poll_id))
            poll = poll_r.scalar_one_or_none()
            if poll:
                poll_data = _serialize_poll(poll)

        result.append({
            "id": str(p.id),
            "user_id": str(p.user_id) if not p.is_anonymous else None,
            "alias": alias,
            "avatar_url": avatar,
            "post_type": p.post_type,
            "content": p.content,
            "image_url": p.image_url,
            "is_anonymous": p.is_anonymous,
            "fire_count": p.fire_count,
            "save_count": p.save_count,
            "comment_count": p.comment_count,
            "my_reactions": my_reactions,
            "poll": poll_data,
            "is_mine": p.user_id == user_id,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        })

    return {"posts": result, "page": page, "limit": limit}


@router.post("/posts")
async def create_post(
    body: CreatePostBody,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Crear un post en el feed."""
    profile = await _get_profile(user_id, db)
    if not profile:
        raise HTTPException(status_code=400, detail="Necesitas crear un perfil social primero")

    if not body.content.strip() and not body.image_url:
        raise HTTPException(status_code=400, detail="El post no puede estar vacío")

    post = SocialPost(
        user_id=user_id,
        post_type=body.post_type,
        content=body.content.strip(),
        image_url=body.image_url,
        trade_id=UUID(body.trade_id) if body.trade_id else None,
        is_anonymous=body.is_anonymous,
    )
    db.add(post)

    # +5 reputation for posting
    profile.reputation_points = (profile.reputation_points or 0) + 5
    _update_level(profile)

    await db.commit()
    await db.refresh(post)

    return {
        "id": str(post.id),
        "created_at": post.created_at.isoformat() if post.created_at else None,
        "message": "Post publicado",
    }


@router.delete("/posts/{post_id}")
async def delete_post(
    post_id: str,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Eliminar mi post."""
    r = await db.execute(
        select(SocialPost).where(SocialPost.id == UUID(post_id), SocialPost.user_id == user_id)
    )
    post = r.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post no encontrado")
    await db.delete(post)
    await db.commit()
    return {"deleted": True}


@router.post("/posts/{post_id}/react")
async def react_to_post(
    post_id: str,
    reaction: str = Query("fire", pattern=r"^(fire|save)$"),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Toggle reaction (fire/save) on a post."""
    pid = UUID(post_id)
    existing = await db.execute(
        select(PostReaction).where(
            PostReaction.post_id == pid,
            PostReaction.user_id == user_id,
            PostReaction.reaction == reaction,
        )
    )
    row = existing.scalar_one_or_none()

    post_r = await db.execute(select(SocialPost).where(SocialPost.id == pid))
    post = post_r.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post no encontrado")

    if row:
        # Remove reaction
        await db.delete(row)
        if reaction == "fire":
            post.fire_count = max(0, (post.fire_count or 0) - 1)
        else:
            post.save_count = max(0, (post.save_count or 0) - 1)
        await db.commit()
        return {"status": "removed", "fire_count": post.fire_count, "save_count": post.save_count}
    else:
        # Add reaction
        db.add(PostReaction(post_id=pid, user_id=user_id, reaction=reaction))
        if reaction == "fire":
            post.fire_count = (post.fire_count or 0) + 1
            # Award reputation to post author if fire count hits milestones
            if post.fire_count in (5, 10, 25, 50):
                author = await _get_profile(post.user_id, db)
                if author:
                    author.reputation_points = (author.reputation_points or 0) + 10
                    _update_level(author)
        else:
            post.save_count = (post.save_count or 0) + 1
        await db.commit()
        return {"status": "added", "fire_count": post.fire_count, "save_count": post.save_count}


# ── Comments ──────────────────────────────────────────────────────────────────

@router.get("/posts/{post_id}/comments")
async def get_comments(
    post_id: str,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Listar comentarios de un post."""
    pid = UUID(post_id)
    r = await db.execute(
        select(PostComment)
        .where(PostComment.post_id == pid)
        .order_by(PostComment.created_at.asc())
    )
    comments = r.scalars().all()
    result = []
    for c in comments:
        alias = await _get_alias(c.user_id, db)
        prof = await _get_profile(c.user_id, db)
        result.append({
            "id": str(c.id),
            "alias": alias,
            "avatar_url": prof.avatar_url if prof else "",
            "content": c.content,
            "parent_comment_id": str(c.parent_comment_id) if c.parent_comment_id else None,
            "is_mine": c.user_id == user_id,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        })
    return result


@router.post("/posts/{post_id}/comments")
async def add_comment(
    post_id: str,
    body: CreateCommentBody,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Agregar comentario a un post."""
    pid = UUID(post_id)
    post_r = await db.execute(select(SocialPost).where(SocialPost.id == pid))
    post = post_r.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post no encontrado")

    comment = PostComment(
        post_id=pid,
        user_id=user_id,
        content=body.content.strip(),
        parent_comment_id=UUID(body.parent_comment_id) if body.parent_comment_id else None,
    )
    db.add(comment)
    post.comment_count = (post.comment_count or 0) + 1
    await db.commit()
    await db.refresh(comment)

    alias = await _get_alias(user_id, db)
    return {
        "id": str(comment.id),
        "alias": alias,
        "content": comment.content,
        "created_at": comment.created_at.isoformat() if comment.created_at else None,
    }


# ════════════════════════════════════════════════════════════════════════════════
#  ENCUESTAS POLYMARKET
# ════════════════════════════════════════════════════════════════════════════════

@router.post("/polls")
async def create_poll(
    body: CreatePollBody,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Crear encuesta."""
    profile = await _get_profile(user_id, db)
    if not profile:
        raise HTTPException(status_code=400, detail="Necesitas un perfil social")

    closes_at = datetime.now(timezone.utc) + timedelta(hours=body.closes_in_hours)

    poll = MarketPoll(
        creator_id=user_id,
        poll_type=body.poll_type,
        title=body.title.strip(),
        symbol=body.symbol.upper() if body.symbol else None,
        options=json.dumps(body.options),
        closes_at=closes_at,
    )
    db.add(poll)
    await db.commit()
    await db.refresh(poll)

    # Also create a post in the feed linking to this poll
    post = SocialPost(
        user_id=user_id,
        post_type="poll",
        content=body.title.strip(),
        poll_id=poll.id,
    )
    db.add(post)

    # +10 reputation for creating poll
    profile.reputation_points = (profile.reputation_points or 0) + 10
    _update_level(profile)

    await db.commit()

    return {"id": str(poll.id), "closes_at": closes_at.isoformat(), "message": "Encuesta creada"}


@router.get("/polls")
async def list_polls(
    active_only: bool = Query(True),
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=30),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Listar encuestas."""
    q = select(MarketPoll)
    if active_only:
        q = q.where(MarketPoll.closes_at > datetime.now(timezone.utc), MarketPoll.is_resolved == False)
    q = q.order_by(desc(MarketPoll.created_at)).offset((page - 1) * limit).limit(limit)

    r = await db.execute(q)
    polls = r.scalars().all()

    result = []
    for poll in polls:
        # Check if user voted
        vote_r = await db.execute(
            select(PollVote.option_index).where(
                PollVote.poll_id == poll.id, PollVote.user_id == user_id
            )
        )
        my_vote = vote_r.scalar_one_or_none()

        # Get vote counts per option
        votes_r = await db.execute(
            select(PollVote.option_index, func.count(PollVote.id))
            .where(PollVote.poll_id == poll.id)
            .group_by(PollVote.option_index)
        )
        vote_counts = dict(votes_r.all())

        creator_alias = await _get_alias(poll.creator_id, db)

        data = _serialize_poll(poll)
        data["creator_alias"] = creator_alias
        data["my_vote"] = my_vote
        data["vote_counts"] = vote_counts
        result.append(data)

    return {"polls": result, "page": page}


@router.post("/polls/{poll_id}/vote")
async def vote_poll(
    poll_id: str,
    body: VotePollBody,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Votar en una encuesta."""
    pid = UUID(poll_id)
    poll_r = await db.execute(select(MarketPoll).where(MarketPoll.id == pid))
    poll = poll_r.scalar_one_or_none()
    if not poll:
        raise HTTPException(status_code=404, detail="Encuesta no encontrada")
    if poll.is_resolved:
        raise HTTPException(status_code=400, detail="La encuesta ya fue resuelta")
    if poll.closes_at and poll.closes_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="La encuesta ya cerró")

    options = json.loads(poll.options) if isinstance(poll.options, str) else poll.options
    if body.option_index < 0 or body.option_index >= len(options):
        raise HTTPException(status_code=400, detail="Opción inválida")

    # Check if already voted
    existing = await db.execute(
        select(PollVote).where(PollVote.poll_id == pid, PollVote.user_id == user_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Ya votaste en esta encuesta")

    db.add(PollVote(poll_id=pid, user_id=user_id, option_index=body.option_index))
    poll.total_votes = (poll.total_votes or 0) + 1
    await db.commit()

    return {"message": "Voto registrado", "total_votes": poll.total_votes}


@router.get("/polls/{poll_id}/results")
async def poll_results(
    poll_id: str,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Resultados detallados de una encuesta."""
    pid = UUID(poll_id)
    poll_r = await db.execute(select(MarketPoll).where(MarketPoll.id == pid))
    poll = poll_r.scalar_one_or_none()
    if not poll:
        raise HTTPException(status_code=404, detail="Encuesta no encontrada")

    options = json.loads(poll.options) if isinstance(poll.options, str) else poll.options

    # Vote distribution
    votes_r = await db.execute(
        select(PollVote.option_index, func.count(PollVote.id))
        .where(PollVote.poll_id == pid)
        .group_by(PollVote.option_index)
    )
    vote_map = dict(votes_r.all())
    total = sum(vote_map.values()) or 1

    distribution = []
    for i, opt in enumerate(options):
        count = vote_map.get(i, 0)
        distribution.append({
            "index": i,
            "label": opt,
            "votes": count,
            "pct": round(count / total * 100, 1),
        })

    return {
        "poll": _serialize_poll(poll),
        "distribution": distribution,
        "total_votes": total,
    }


# ════════════════════════════════════════════════════════════════════════════════
#  LEADERBOARD
# ════════════════════════════════════════════════════════════════════════════════

@router.get("/leaderboard")
async def get_leaderboard(
    ranking_type: str = Query("roi", pattern=r"^(roi|reputation|followers|predictions)$"),
    period: str = Query("all", pattern=r"^(monthly|all)$"),
    limit: int = Query(20, ge=1, le=50),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Rankings de inversores."""

    if ranking_type == "reputation":
        # Order by reputation points
        r = await db.execute(
            select(SocialProfile)
            .where(SocialProfile.is_public == True, SocialProfile.show_in_leaderboard == True)
            .order_by(desc(SocialProfile.reputation_points))
            .limit(limit)
        )
        profiles = r.scalars().all()
        return {
            "type": "reputation",
            "entries": [
                {
                    "rank": i + 1,
                    "alias": p.alias,
                    "avatar_url": p.avatar_url,
                    "value": p.reputation_points or 0,
                    "level": p.level or "novato",
                    "is_me": p.user_id == user_id,
                }
                for i, p in enumerate(profiles)
            ],
        }

    elif ranking_type == "followers":
        # Count followers per profile
        r = await db.execute(
            select(
                SocialProfile.alias,
                SocialProfile.avatar_url,
                SocialProfile.user_id,
                SocialProfile.level,
                func.count(SocialFollow.id).label("follower_count"),
            )
            .outerjoin(SocialFollow, SocialFollow.followed_id == SocialProfile.user_id)
            .where(SocialProfile.is_public == True, SocialProfile.show_in_leaderboard == True)
            .group_by(SocialProfile.id)
            .order_by(desc("follower_count"))
            .limit(limit)
        )
        rows = r.all()
        return {
            "type": "followers",
            "entries": [
                {
                    "rank": i + 1,
                    "alias": row.alias,
                    "avatar_url": row.avatar_url,
                    "value": row.follower_count,
                    "level": row.level or "novato",
                    "is_me": row.user_id == user_id,
                }
                for i, row in enumerate(rows)
            ],
        }

    elif ranking_type == "predictions":
        r = await db.execute(
            select(SocialProfile)
            .where(
                SocialProfile.is_public == True,
                SocialProfile.show_in_leaderboard == True,
                SocialProfile.predictions_total > 0,
            )
            .order_by(desc(SocialProfile.prediction_score))
            .limit(limit)
        )
        profiles = r.scalars().all()
        return {
            "type": "predictions",
            "entries": [
                {
                    "rank": i + 1,
                    "alias": p.alias,
                    "avatar_url": p.avatar_url,
                    "value": round(p.prediction_score or 0, 1),
                    "total": p.predictions_total or 0,
                    "correct": p.predictions_correct or 0,
                    "level": p.level or "novato",
                    "is_me": p.user_id == user_id,
                }
                for i, p in enumerate(profiles)
            ],
        }

    else:  # roi — requires portfolio analytics (simplified)
        # We compute ROI from transactions for users opted-in to leaderboard
        r = await db.execute(
            select(SocialProfile)
            .where(SocialProfile.is_public == True, SocialProfile.show_in_leaderboard == True)
        )
        profiles = r.scalars().all()

        entries = []
        for p in profiles:
            # Calculate simple ROI: (current_value - invested) / invested
            buy_r = await db.execute(
                select(func.sum(Transaction.amount_usd))
                .where(Transaction.user_id == p.user_id, Transaction.order_type == "Compra")
            )
            total_invested = float(buy_r.scalar() or 0)
            if total_invested <= 0:
                continue

            sell_r = await db.execute(
                select(func.sum(Transaction.amount_usd))
                .where(Transaction.user_id == p.user_id, Transaction.order_type == "Venta")
            )
            total_sold = float(sell_r.scalar() or 0)

            # Simplified ROI (realized only, for privacy)
            roi = ((total_sold - total_invested) / total_invested * 100) if total_invested > 0 else 0

            entries.append({
                "alias": p.alias,
                "avatar_url": p.avatar_url,
                "value": round(roi, 2),
                "level": p.level or "novato",
                "is_me": p.user_id == user_id,
            })

        entries.sort(key=lambda x: x["value"], reverse=True)
        for i, e in enumerate(entries[:limit]):
            e["rank"] = i + 1

        return {"type": "roi", "entries": entries[:limit]}


# ── Badges ────────────────────────────────────────────────────────────────────

BADGE_CATALOG = {
    "estrella_naciente":  {"icon": "🌟", "label": "Estrella Naciente", "desc": "+20% ROI en su primer mes"},
    "manos_diamante":     {"icon": "💎", "label": "Manos de Diamante", "desc": "Mantiene posiciones >6 meses"},
    "sniper":             {"icon": "🎯", "label": "Sniper", "desc": "5 trades ganadores consecutivos"},
    "analista":           {"icon": "📚", "label": "Analista", "desc": "10+ posts con análisis"},
    "oraculo":            {"icon": "🔮", "label": "Oráculo", "desc": "80%+ acierto en encuestas"},
    "veterano_bvc":       {"icon": "🏛️", "label": "Veterano BVC", "desc": "1+ año en la plataforma"},
    "top_3":              {"icon": "👑", "label": "Top 3", "desc": "En el top 3 del leaderboard mensual"},
    "primer_post":        {"icon": "✍️", "label": "Primer Post", "desc": "Publicó su primer post"},
    "social_butterfly":   {"icon": "🦋", "label": "Mariposa Social", "desc": "10+ seguidores"},
    "poll_creator":       {"icon": "📊", "label": "Encuestador", "desc": "Creó 5+ encuestas"},
}


@router.get("/badges/{alias}")
async def get_user_badges(
    alias: str,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Obtener insignias de un usuario."""
    prof_r = await db.execute(select(SocialProfile).where(SocialProfile.alias == alias))
    prof = prof_r.scalar_one_or_none()
    if not prof:
        raise HTTPException(status_code=404, detail="Perfil no encontrado")

    badges_r = await db.execute(
        select(UserBadge).where(UserBadge.user_id == prof.user_id).order_by(UserBadge.earned_at.desc())
    )
    badges = badges_r.scalars().all()

    return [
        {
            "badge_id": b.badge_id,
            **BADGE_CATALOG.get(b.badge_id, {"icon": "🏅", "label": b.badge_id, "desc": ""}),
            "earned_at": b.earned_at.isoformat() if b.earned_at else None,
        }
        for b in badges
    ]


# ════════════════════════════════════════════════════════════════════════════════
#  MARKET MOOD — Sentimiento diario
# ════════════════════════════════════════════════════════════════════════════════

@router.post("/mood")
async def vote_mood(
    body: MoodVoteBody,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Votar sentimiento del mercado (1 voto por día)."""
    today = date.today().isoformat()

    existing = await db.execute(
        select(MarketMoodVote).where(
            MarketMoodVote.user_id == user_id,
            MarketMoodVote.vote_date == today,
        )
    )
    row = existing.scalar_one_or_none()
    if row:
        row.sentiment = body.sentiment
        await db.commit()
        return {"message": "Voto actualizado", "sentiment": body.sentiment}

    db.add(MarketMoodVote(user_id=user_id, sentiment=body.sentiment, vote_date=today))
    await db.commit()
    return {"message": "Voto registrado", "sentiment": body.sentiment}


@router.get("/mood")
async def get_mood(
    days: int = Query(7, ge=1, le=30),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Sentimiento agregado de los últimos N días."""
    cutoff = (date.today() - timedelta(days=days)).isoformat()

    # Today's mood
    today = date.today().isoformat()
    today_r = await db.execute(
        select(MarketMoodVote.sentiment, func.count(MarketMoodVote.id))
        .where(MarketMoodVote.vote_date == today)
        .group_by(MarketMoodVote.sentiment)
    )
    today_counts = dict(today_r.all())
    total_today = sum(today_counts.values()) or 1

    # My vote today
    my_vote_r = await db.execute(
        select(MarketMoodVote.sentiment).where(
            MarketMoodVote.user_id == user_id,
            MarketMoodVote.vote_date == today,
        )
    )
    my_vote = my_vote_r.scalar_one_or_none()

    # Historical daily trend
    hist_r = await db.execute(
        select(
            MarketMoodVote.vote_date,
            MarketMoodVote.sentiment,
            func.count(MarketMoodVote.id),
        )
        .where(MarketMoodVote.vote_date >= cutoff)
        .group_by(MarketMoodVote.vote_date, MarketMoodVote.sentiment)
        .order_by(MarketMoodVote.vote_date)
    )
    hist_rows = hist_r.all()

    # Group by date
    daily = {}
    for vdate, sentiment, count in hist_rows:
        if vdate not in daily:
            daily[vdate] = {"bull": 0, "bear": 0, "neutral": 0}
        daily[vdate][sentiment] = count

    history = []
    for d in sorted(daily.keys()):
        total = sum(daily[d].values()) or 1
        history.append({
            "date": d,
            "bull_pct": round(daily[d]["bull"] / total * 100, 1),
            "bear_pct": round(daily[d]["bear"] / total * 100, 1),
            "neutral_pct": round(daily[d]["neutral"] / total * 100, 1),
            "total_votes": sum(daily[d].values()),
        })

    return {
        "today": {
            "bull": today_counts.get("bull", 0),
            "bear": today_counts.get("bear", 0),
            "neutral": today_counts.get("neutral", 0),
            "total": sum(today_counts.values()),
            "bull_pct": round(today_counts.get("bull", 0) / total_today * 100, 1),
            "bear_pct": round(today_counts.get("bear", 0) / total_today * 100, 1),
            "neutral_pct": round(today_counts.get("neutral", 0) / total_today * 100, 1),
        },
        "my_vote": my_vote,
        "history": history,
    }


# ════════════════════════════════════════════════════════════════════════════════
#  ¿QUÉ COMPRA LA RED? — Actividad anonimizada
# ════════════════════════════════════════════════════════════════════════════════

@router.get("/network-activity")
async def get_network_activity(
    days: int = Query(7, ge=1, le=30),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Actividad de compra/venta de la red, 100% anonimizada.
    Solo muestra: qué % de la red compró/vendió cada acción esta semana.
    """
    cutoff = datetime.utcnow() - timedelta(days=days)

    # Only count users who opted into leaderboard (public profiles)
    public_users_r = await db.execute(
        select(SocialProfile.user_id).where(
            SocialProfile.is_public == True,
            SocialProfile.show_in_leaderboard == True,
        )
    )
    public_user_ids = [r for r in public_users_r.scalars().all()]
    if not public_user_ids:
        return {"stocks": [], "total_users": 0}

    # Get transactions from public users in the last N days
    txs_r = await db.execute(
        select(
            Transaction.stock_id,
            Transaction.order_type,
            func.count(func.distinct(Transaction.user_id)).label("user_count"),
            func.sum(Transaction.quantity).label("total_qty"),
        )
        .where(
            Transaction.user_id.in_(public_user_ids),
            Transaction.transaction_date >= cutoff,
        )
        .group_by(Transaction.stock_id, Transaction.order_type)
    )
    rows = txs_r.all()

    # Get stock symbols
    stock_ids = list({r.stock_id for r in rows if r.stock_id})
    stocks_map = {}
    if stock_ids:
        sr = await db.execute(select(Stock).where(Stock.id.in_(stock_ids)))
        stocks_map = {s.id: s for s in sr.scalars().all()}

    total_public = len(public_user_ids)
    stock_data = {}
    for row in rows:
        stock = stocks_map.get(row.stock_id)
        if not stock:
            continue
        sym = stock.symbol
        if sym not in stock_data:
            stock_data[sym] = {"symbol": sym, "name": stock.name, "buyers": 0, "sellers": 0, "buy_qty": 0, "sell_qty": 0}
        if row.order_type == "Compra":
            stock_data[sym]["buyers"] = row.user_count
            stock_data[sym]["buy_qty"] = int(row.total_qty or 0)
        else:
            stock_data[sym]["sellers"] = row.user_count
            stock_data[sym]["sell_qty"] = int(row.total_qty or 0)

    result = []
    for sym, d in stock_data.items():
        d["buy_pct"] = round(d["buyers"] / total_public * 100, 1)
        d["sell_pct"] = round(d["sellers"] / total_public * 100, 1)
        d["net_sentiment"] = "buy" if d["buyers"] > d["sellers"] else ("sell" if d["sellers"] > d["buyers"] else "neutral")
        result.append(d)

    result.sort(key=lambda x: x["buyers"] + x["sellers"], reverse=True)

    return {"stocks": result[:20], "total_users": total_public, "days": days}


# ════════════════════════════════════════════════════════════════════════════════
#  TORNEOS PAPER TRADING
# ════════════════════════════════════════════════════════════════════════════════

@router.get("/tournaments")
async def list_tournaments(
    active_only: bool = Query(True),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Listar torneos."""
    q = select(PaperTournament)
    if active_only:
        q = q.where(PaperTournament.is_active == True)
    q = q.order_by(desc(PaperTournament.starts_at))

    r = await db.execute(q)
    tournaments = r.scalars().all()

    result = []
    for t in tournaments:
        # Count participants
        cnt_r = await db.execute(
            select(func.count(TournamentEntry.id)).where(TournamentEntry.tournament_id == t.id)
        )
        participant_count = cnt_r.scalar() or 0

        # Check if I joined
        my_entry_r = await db.execute(
            select(TournamentEntry).where(
                TournamentEntry.tournament_id == t.id,
                TournamentEntry.user_id == user_id,
            )
        )
        my_entry = my_entry_r.scalar_one_or_none()

        result.append({
            "id": str(t.id),
            "title": t.title,
            "description": t.description,
            "initial_balance": t.initial_balance,
            "starts_at": t.starts_at.isoformat() if t.starts_at else None,
            "ends_at": t.ends_at.isoformat() if t.ends_at else None,
            "is_active": t.is_active,
            "participants": participant_count,
            "max_participants": t.max_participants,
            "joined": my_entry is not None,
            "my_roi": round(my_entry.roi_pct, 2) if my_entry else None,
        })

    return result


@router.post("/tournaments/{tournament_id}/join")
async def join_tournament(
    tournament_id: str,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Unirse a un torneo."""
    tid = UUID(tournament_id)
    t_r = await db.execute(select(PaperTournament).where(PaperTournament.id == tid))
    tournament = t_r.scalar_one_or_none()
    if not tournament:
        raise HTTPException(status_code=404, detail="Torneo no encontrado")
    if not tournament.is_active:
        raise HTTPException(status_code=400, detail="Este torneo ya no está activo")

    # Check if already joined
    existing = await db.execute(
        select(TournamentEntry).where(
            TournamentEntry.tournament_id == tid,
            TournamentEntry.user_id == user_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Ya estás inscrito en este torneo")

    # Check max participants
    cnt_r = await db.execute(
        select(func.count(TournamentEntry.id)).where(TournamentEntry.tournament_id == tid)
    )
    if (cnt_r.scalar() or 0) >= (tournament.max_participants or 100):
        raise HTTPException(status_code=400, detail="Torneo lleno")

    entry = TournamentEntry(
        tournament_id=tid,
        user_id=user_id,
        current_value=tournament.initial_balance,
    )
    db.add(entry)
    await db.commit()
    return {"message": "Te uniste al torneo", "initial_balance": tournament.initial_balance}


@router.get("/tournaments/{tournament_id}/standings")
async def tournament_standings(
    tournament_id: str,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Tabla de posiciones de un torneo."""
    tid = UUID(tournament_id)
    entries_r = await db.execute(
        select(TournamentEntry)
        .where(TournamentEntry.tournament_id == tid)
        .order_by(desc(TournamentEntry.roi_pct))
    )
    entries = entries_r.scalars().all()

    result = []
    for i, e in enumerate(entries):
        alias = await _get_alias(e.user_id, db)
        prof = await _get_profile(e.user_id, db)
        result.append({
            "rank": i + 1,
            "alias": alias,
            "avatar_url": prof.avatar_url if prof else "",
            "current_value": round(e.current_value, 2),
            "roi_pct": round(e.roi_pct, 2),
            "trades_count": e.trades_count,
            "is_me": e.user_id == user_id,
        })

    return result


# ════════════════════════════════════════════════════════════════════════════════
#  HELPERS
# ════════════════════════════════════════════════════════════════════════════════

def _serialize_poll(poll: MarketPoll) -> dict:
    options = json.loads(poll.options) if isinstance(poll.options, str) else poll.options
    return {
        "id": str(poll.id),
        "poll_type": poll.poll_type,
        "title": poll.title,
        "symbol": poll.symbol,
        "options": options,
        "correct_option": poll.correct_option,
        "closes_at": poll.closes_at.isoformat() if poll.closes_at else None,
        "is_resolved": poll.is_resolved,
        "total_votes": poll.total_votes or 0,
        "created_at": poll.created_at.isoformat() if poll.created_at else None,
    }


def _update_level(profile: SocialProfile):
    """Actualizar nivel basado en puntos de reputación."""
    pts = profile.reputation_points or 0
    if pts >= 5000:
        profile.level = "leyenda"
    elif pts >= 2000:
        profile.level = "elite"
    elif pts >= 500:
        profile.level = "experto"
    elif pts >= 100:
        profile.level = "trader"
    else:
        profile.level = "novato"
