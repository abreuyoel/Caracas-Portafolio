"""
Servicio de notificaciones push WebPush / VAPID.
Usado tanto por el scheduler de alertas como por el endpoint de test.
"""
import asyncio
import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)


async def send_push_notification(
    endpoint: str,
    p256dh: str,
    auth: str,
    title: str,
    body: str,
    url: str = "/",
    icon: str = "/icons/icon-192x192.png",
) -> bool:
    """
    Envía una notificación push WebPush a una suscripción.
    Devuelve True si se envió correctamente.
    """
    from app.config import settings

    payload = json.dumps({
        "title": title,
        "body": body,
        "icon": icon,
        "url": url,
        "badge": "/icons/icon-72x72.png",
    })

    subscription_info = {
        "endpoint": endpoint,
        "keys": {"p256dh": p256dh, "auth": auth},
    }

    try:
        from pywebpush import webpush, WebPushException

        def _send():
            webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=settings.vapid_private_key,
                vapid_claims={
                    "sub": f"mailto:{settings.vapid_contact_email}",
                },
            )

        await asyncio.to_thread(_send)
        logger.info(f"✅ Push enviado a {endpoint[:50]}…")
        return True

    except Exception as e:
        err_str = str(e)
        if "410" in err_str or "404" in err_str:
            logger.info(f"🗑 Suscripción expirada (eliminable): {endpoint[:50]}")
        else:
            logger.warning(f"⚠️  Push error: {e}")
        return False
