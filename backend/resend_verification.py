import asyncio
import secrets
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, delete

# Para poder importar de app
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), ".")))

from app.database import AsyncSessionLocal
from app.models.user import User
from app.models.email_verification import EmailVerification
from app.utils.email import send_verification_email
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("resend_script")

async def resend_pending_emails():
    async with AsyncSessionLocal() as db:
        # Buscar usuarios no verificados
        result = await db.execute(select(User).where(User.is_verified == False))
        unverified_users = result.scalars().all()
        
        if not unverified_users:
            logger.info("✅ No hay usuarios sin verificar.")
            return

        logger.info(f"Encontrados {len(unverified_users)} usuarios sin verificar. Procediendo a enviar correos...")

        for user in unverified_users:
            # Eliminar tokens anteriores y crear uno nuevo
            await db.execute(delete(EmailVerification).where(EmailVerification.user_id == user.id))
            
            token = secrets.token_urlsafe(48)
            expires = datetime.now(timezone.utc) + timedelta(hours=24)
            verification = EmailVerification(user_id=user.id, token=token, expires_at=expires)
            
            db.add(verification)
            await db.commit()

            try:
                sent = await send_verification_email(user.email, token)
                if sent:
                    logger.info(f"✅ Correo enviado a {user.email}")
                else:
                    logger.warning(f"⚠️  No se pudo enviar correo a {user.email}")
            except Exception as e:
                logger.error(f"❌ Error reenviando verificación a {user.email}: {e}")

if __name__ == "__main__":
    asyncio.run(resend_pending_emails())
