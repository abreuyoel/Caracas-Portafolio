"""
Servicio de notificaciones de apertura y cierre de sesión BVC.
La BVC opera Lunes-Viernes, 9:00 AM - 1:00 PM (hora de Caracas, UTC-4).
"""
import logging
from sqlalchemy import select, delete as sa_delete

logger = logging.getLogger(__name__)


async def _broadcast_market_event(title: str, body: str, url: str = "/dashboard") -> int:
    """
    Envía una notificación push a todos los usuarios suscritos.
    Retorna el número de notificaciones enviadas con éxito.
    """
    from app.database import AsyncSessionLocal
    from app.models.alert import PushSubscription
    from app.services.push_service import send_push_notification

    sent = 0
    expired_ids: list[int] = []

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(PushSubscription))
        subscriptions = result.scalars().all()

        for sub in subscriptions:
            success = await send_push_notification(
                endpoint=sub.endpoint,
                p256dh=sub.p256dh,
                auth=sub.auth,
                title=title,
                body=body,
                url=url,
                icon="/icons/icon-192x192.png",
            )
            if success:
                sent += 1
            else:
                # 410/404 → marcar para eliminar
                expired_ids.append(sub.id)

        # Limpiar suscripciones expiradas
        if expired_ids:
            await db.execute(
                sa_delete(PushSubscription).where(PushSubscription.id.in_(expired_ids))
            )
            await db.commit()

    logger.info(f"📣 Mercado: {title} — {sent} notificaciones enviadas")
    return sent


async def notify_market_open():
    """Notificación al abrir la sesión de la BVC (9:00 AM Caracas)."""
    await _broadcast_market_event(
        title="🔔 BVC Abierta",
        body="La Bolsa de Caracas acaba de abrir su sesión. ¡El mercado está activo!",
        url="/graficos",
    )


async def notify_market_close():
    """Notificación al cierre de la sesión de la BVC (1:00 PM Caracas)."""
    await _broadcast_market_event(
        title="🔕 BVC Cerrada",
        body="La sesión de la Bolsa de Caracas ha concluido. Revisa tu portafolio.",
        url="/portfolio",
    )
