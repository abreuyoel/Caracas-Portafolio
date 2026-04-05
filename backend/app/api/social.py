"""
Social Profile API
Endpoints para crear/editar perfil público, seguir/dejar de seguir y
consultar el feed de perfiles públicos de la red Caracas Portafolio.

Privacidad: el alias es el único identificador público.
Nunca se devuelve email, username real ni datos del usuario (User table).
"""

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.models.social_profile import SocialProfile, SocialFollow
from app.models.transaction import Transaction
from app.models.portfolio import PortfolioPosition
from app.utils.security import decode_token
from uuid import UUID
from typing import Optional
from pydantic import BaseModel, Field
import re

router = APIRouter()


# ── Auth helper ───────────────────────────────────────────────────────────────

async def get_current_user_id(authorization: str = Header(...)) -> UUID:
    token = authorization.replace("Bearer ", "")
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Token inválido")
    return UUID(payload.get("sub"))


# ── Schemas ───────────────────────────────────────────────────────────────────

ALIAS_RE = re.compile(r'^[a-zA-Z0-9_.-]{3,40}$')


class SocialProfileUpsert(BaseModel):
    alias: str = Field(..., min_length=3, max_length=40)
    bio: Optional[str] = Field("", max_length=280)
    avatar_url: Optional[str] = ""
    is_public: bool = False
    show_capital_initial: bool = False
    show_current_value: bool = False
    show_pnl: bool = False
    show_transactions: bool = False
    show_holdings: bool = False
    show_top_positions: bool = False
    notify_on_transaction: bool = False
    visible_symbols: Optional[list[str]] = Field(default_factory=list)
    accepted_terms: bool = False


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/me")
async def get_my_profile(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Obtener mi perfil social (o null si no existe)."""
    result = await db.execute(
        select(SocialProfile).where(SocialProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        return None
    return _serialize_profile(profile, include_private=True)


@router.put("/me")
async def upsert_my_profile(
    body: SocialProfileUpsert,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Crear o actualizar mi perfil social."""
    if not ALIAS_RE.match(body.alias):
        raise HTTPException(
            status_code=422,
            detail="El alias solo puede contener letras, números, puntos, guiones bajos y guiones. 3–40 caracteres."
        )

    # Verificar unicidad del alias (excluyendo el propio perfil)
    existing = await db.execute(
        select(SocialProfile).where(
            SocialProfile.alias == body.alias,
            SocialProfile.user_id != user_id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Ese alias ya está en uso. Elige otro.")

    result = await db.execute(
        select(SocialProfile).where(SocialProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()

    if profile is None:
        if not body.accepted_terms:
            raise HTTPException(status_code=400, detail="Debes aceptar los términos y condiciones")
        
        # Guardamos como string JSON
        import json
        profile_data = body.model_dump()
        profile_data['visible_symbols'] = json.dumps(profile_data.get('visible_symbols', []))
        if body.accepted_terms:
            profile_data['terms_accepted_at'] = func.now()
            
        profile = SocialProfile(user_id=user_id, **profile_data)
        db.add(profile)
    else:
        import json
        for k, v in body.model_dump().items():
            if k == 'visible_symbols':
                setattr(profile, k, json.dumps(v))
            elif k == 'accepted_terms' and v and not profile.accepted_terms:
                setattr(profile, k, v)
                setattr(profile, 'terms_accepted_at', func.now())
            else:
                setattr(profile, k, v)

    await db.commit()
    await db.refresh(profile)
    return _serialize_profile(profile, include_private=True)


@router.delete("/me")
async def delete_my_profile(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Eliminar mi perfil social (derecho al olvido – LOPDP)."""
    result = await db.execute(
        select(SocialProfile).where(SocialProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()
    if profile:
        await db.delete(profile)
        await db.commit()
    return {"deleted": True}


@router.get("/feed")
async def get_public_feed(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Lista de perfiles públicos (sólo alias + bio + stats permitidos)."""
    # 1. Obtener perfiles públicos
    result = await db.execute(
        select(SocialProfile).where(SocialProfile.is_public == True)
    )
    profiles = result.scalars().all()

    # 2. Obtener a quién sigo para marcar is_followed
    follow_res = await db.execute(
        select(SocialFollow.followed_id).where(
            SocialFollow.follower_id == user_id,
            SocialFollow.is_pending == False
        )
    )
    following_ids = set(follow_res.scalars().all())
    
    # 3. Serializar
    feed = []
    for p in profiles:
        data = _serialize_profile(p, include_private=False)
        data["is_followed"] = p.user_id in following_ids
        feed.append(data)

    return feed


@router.get("/{alias}/data")
async def get_public_profile_data(
    alias: str,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Obtener datos financieros públicos de un perfil (holdings/txs),
    respetando los niveles de visibilidad y el whitelist (visible_symbols).
    """
    # 1. Buscar el perfil
    res = await db.execute(select(SocialProfile).where(SocialProfile.alias == alias))
    profile = res.scalar_one_or_none()
    if not profile or not profile.is_public:
        raise HTTPException(status_code=404, detail="Perfil no encontrado o privado")

    # 2. Verificar si el usuario actual lo sigue (o es el mismo)
    is_self = profile.user_id == user_id
    if not is_self:
        follow_res = await db.execute(select(SocialFollow).where(
            SocialFollow.follower_id == user_id,
            SocialFollow.followed_id == profile.user_id,
            SocialFollow.is_pending == False
        ))
        if not follow_res.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Debes seguir este perfil para ver sus estadísticas")

    # 3. Preparar respuesta filtrada
    visible_symbols = _parse_json(profile.visible_symbols)
    
    data = {
        "alias": profile.alias,
        "is_public": profile.is_public,
        "stats": {}
    }

    # Capital Inicial
    if profile.show_capital_initial or is_self:
        # Sumar todos los net_amount de compras del usuario
        cap_res = await db.execute(
            select(func.sum(Transaction.amount_usd)).where(
                Transaction.user_id == profile.user_id,
                Transaction.order_type == "Compra"
            )
        )
        data["stats"]["capital_initial"] = float(cap_res.scalar() or 0)

    # P&L Total
    if profile.show_pnl or is_self:
        # Aquí simplificamos, pero idealmente usamos el mismo motor de PortfolioAnalytics
        # Por ahora devolvemos un placeholder o el cálculo básico si es necesario
        data["stats"]["pnl_total"] = 0 # Implementar cálculo real si se desea

    # Holdings (Filtrado por visible_symbols)
    if profile.show_holdings or is_self:
        query = select(PortfolioPosition).where(PortfolioPosition.user_id == profile.user_id)
        if visible_symbols and not is_self:
             from app.models.stock import Stock
             query = query.join(Stock).where(Stock.symbol.in_(visible_symbols))
        
        pos_res = await db.execute(query)
        positions = pos_res.scalars().all()
        data["holdings"] = [{"symbol": p.stock.symbol, "quantity": p.quantity} for p in positions]

    # Transactions (Filtrado por visible_symbols)
    if profile.show_transactions or is_self:
        tx_query = select(Transaction).where(Transaction.user_id == profile.user_id)
        if visible_symbols and not is_self:
             from app.models.stock import Stock
             tx_query = tx_query.join(Stock).where(Stock.symbol.in_(visible_symbols))
        
        tx_res = await db.execute(tx_query.limit(20).order_by(Transaction.transaction_date.desc()))
        data["transactions"] = [
            {
                "date": tx.transaction_date.isoformat(),
                "type": tx.order_type,
                "symbol": tx.stock.symbol,
                "quantity": tx.quantity,
                "price": float(tx.avg_price)
            } for tx in tx_res.scalars().all()
        ]

    return data


@router.get("/{alias}")
async def get_profile_by_alias(
    alias: str,
    user_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db)
):
    """Obtener perfil público por alias."""
    result = await db.execute(
        select(SocialProfile).where(SocialProfile.alias == alias, SocialProfile.is_public == True)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Perfil no encontrado o es privado")
    return _serialize_profile(profile, include_private=False)


# ── Follow / Unfollow ─────────────────────────────────────────────────────────

@router.post("/{alias}/follow")
async def follow_profile(
    alias: str,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Seguir a un perfil por alias."""
    target = await db.execute(
        select(SocialProfile).where(SocialProfile.alias == alias)
    )
    target_profile = target.scalar_one_or_none()
    if not target_profile:
        raise HTTPException(status_code=404, detail="Perfil no encontrado")
    if target_profile.user_id == user_id:
        raise HTTPException(status_code=400, detail="No puedes seguirte a ti mismo")

    existing = await db.execute(
        select(SocialFollow).where(
            SocialFollow.follower_id == user_id,
            SocialFollow.followed_id == target_profile.user_id
        )
    )
    if existing.scalar_one_or_none():
        return {"status": "already_following"}

    follow = SocialFollow(
        follower_id=user_id,
        followed_id=target_profile.user_id,
        is_pending=not target_profile.is_public
    )
    db.add(follow)
    await db.commit()
    return {"status": "pending" if follow.is_pending else "following"}


@router.delete("/{alias}/follow")
async def unfollow_profile(
    alias: str,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Dejar de seguir un perfil."""
    target = await db.execute(
        select(SocialProfile).where(SocialProfile.alias == alias)
    )
    target_profile = target.scalar_one_or_none()
    if not target_profile:
        raise HTTPException(status_code=404, detail="Perfil no encontrado")

    follow = await db.execute(
        select(SocialFollow).where(
            SocialFollow.follower_id == user_id,
            SocialFollow.followed_id == target_profile.user_id
        )
    )
    follow_row = follow.scalar_one_or_none()
    if follow_row:
        await db.delete(follow_row)
        await db.commit()
    return {"status": "unfollowed"}


@router.get("/me/followers")
async def get_my_followers(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Lista de seguidores míos (alias únicamente)."""
    result = await db.execute(
        select(SocialFollow).where(
            SocialFollow.followed_id == user_id,
            SocialFollow.is_pending == False
        )
    )
    follows = result.scalars().all()
    follower_ids = [f.follower_id for f in follows]
    if not follower_ids:
        return []
    profiles = await db.execute(
        select(SocialProfile).where(SocialProfile.user_id.in_(follower_ids))
    )
    return [{"alias": p.alias, "avatar_url": p.avatar_url, "bio": p.bio}
            for p in profiles.scalars().all()]


@router.get("/me/following")
async def get_who_i_follow(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Lista de perfiles que sigo."""
    result = await db.execute(
        select(SocialFollow).where(
            SocialFollow.follower_id == user_id,
            SocialFollow.is_pending == False
        )
    )
    follows = result.scalars().all()
    followed_ids = [f.followed_id for f in follows]
    if not followed_ids:
        return []
    profiles = await db.execute(
        select(SocialProfile).where(SocialProfile.user_id.in_(followed_ids))
    )
    return [{"alias": p.alias, "avatar_url": p.avatar_url, "bio": p.bio}
            for p in profiles.scalars().all()]


# ── Serializer ────────────────────────────────────────────────────────────────

def _serialize_profile(p: SocialProfile, include_private: bool) -> dict:
    base = {
        "alias": p.alias,
        "bio": p.bio,
        "avatar_url": p.avatar_url,
        "is_public": p.is_public,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }
    if include_private:
        base.update({
            "show_capital_initial": p.show_capital_initial,
            "show_current_value": p.show_current_value,
            "show_pnl": p.show_pnl,
            "show_transactions": p.show_transactions,
            "show_holdings": p.show_holdings,
            "show_top_positions": p.show_top_positions,
            "notify_on_transaction": p.notify_on_transaction,
            "accepted_terms": p.accepted_terms,
            "visible_symbols": _parse_json(p.visible_symbols)
        })
    return base

def _parse_json(val):
    if not val: return []
    if isinstance(val, list): return val
    import json
    try:
        return json.loads(val)
    except:
        return []
