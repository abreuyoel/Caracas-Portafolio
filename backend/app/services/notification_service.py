from datetime import datetime, timezone, timedelta
from typing import List, Dict
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import asyncio
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.config import settings

logger = logging.getLogger(__name__)


class NotificationService:
    """Servicio de notificaciones personalizadas"""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def generate_daily_digest(self, user_id) -> Dict:
        """
        Generar resumen diario personalizado
        """
        from app.models.user_profile import UserProfile
        from app.models.transaction import Transaction
        from app.models.user import User
        
        # Obtener perfil y usuario
        profile_result = await self.db.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        profile = profile_result.scalar_one_or_none()
        
        if not profile:
            return {"error": "Perfil no encontrado"}
        
        user_result = await self.db.execute(
            select(User).where(User.id == user_id)
        )
        user = user_result.scalar_one_or_none()
        
        # Analizar portafolio del usuario
        portfolio_result = await self.db.execute(
            select(Transaction)
            .where(Transaction.user_id == user_id)
            .order_by(Transaction.transaction_date.desc())
            .limit(10)
        )
        recent_transactions = portfolio_result.scalars().all()
        
        # Generar análisis con IA
        analysis = await self._generate_ai_analysis(profile, recent_transactions)
        
        return {
            "user_id": str(user_id),
            "user_email": user.email if user else None,
            "user_name": user.full_name if user else "Inversor",
            "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "profile": profile.risk_profile.value,
            "analysis": analysis,
            "recommendations": await self._get_daily_recommendations(profile),
            "alerts": await self._check_risk_alerts(user_id, profile)
        }
    
    async def _generate_ai_analysis(self, profile, transactions) -> str:
        """Generar análisis con IA basado en perfil"""
        try:
            import google.generativeai as genai
            from app.config import settings
            
            genai.configure(api_key=settings.gemini_api_key)
            model = genai.GenerativeModel('gemini-1.5-flash')
            
            prompt = f"""
            Eres un analista financiero experto. Genera un resumen diario personalizado.
            
            Perfil del usuario:
            - Riesgo: {profile.risk_profile.value}
            - Objetivo: {profile.investment_goal.value}
            - Horizonte: {profile.time_horizon.value}
            - Tolerancia pérdida: {profile.max_loss_tolerance}%
            
            Transacciones recientes: {len(transactions)} operaciones
            
            Genera un resumen de 150 palabras con:
            1. Estado general del mercado BVC
            2. Recomendaciones según su perfil
            3. Acciones a monitorear
            4. Advertencias de riesgo si aplican
            
            Tono: Profesional pero accesible. En español.
            """
            
            response = model.generate_content(prompt)
            return response.text
            
        except Exception as e:
            logger.error(f"Error generating AI analysis: {e}")
            return "Análisis no disponible en este momento."
    
    async def _get_daily_recommendations(self, profile) -> List[Dict]:
        """Obtener recomendaciones del día (simulado)"""
        # Implementación real: consultar scraping o API de mercado
        return [
            {"symbol": "BPV", "action": "mantener", "reason": "Perfil conservador"},
            {"symbol": "FNC", "action": "comprar", "reason": "Crecimiento moderado"}
        ]
    
    async def _check_risk_alerts(self, user_id, profile) -> List[Dict]:
        """Verificar alertas de riesgo"""
        alerts = []
        # TODO: Implementar chequeo de riesgos real
        # Ejemplo: si la volatilidad supera el umbral
        # alerts.append({"type": "volatility", "message": "Alta volatilidad detectada"})
        return alerts
    
    async def send_daily_notification(self, digest: Dict) -> bool:
        """Enviar notificación por email"""
        try:
            subject = f"📊 Tu Resumen Diario de Inversión - {digest['date']}"
            body = self._build_email_body(digest)
            
            success = await self._send_email(
                to_email=digest['user_email'],
                subject=subject,
                body=body
            )
            if success:
                logger.info(f"✅ Notificación diaria enviada a {digest['user_email']}")
            return success
        except Exception as e:
            logger.error(f"Error sending notification to {digest['user_email']}: {e}")
            return False
    
    def _build_email_body(self, digest: Dict) -> str:
        """Construir cuerpo del email en HTML"""
        profile = digest['profile']
        name = digest['user_name']
        date = digest['date']
        analysis = digest['analysis']
        recommendations = digest.get('recommendations', [])
        alerts = digest.get('alerts', [])
        
        html = f"""
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px; }}
                .container {{ max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }}
                .header {{ text-align: center; padding-bottom: 20px; border-bottom: 1px solid #eee; }}
                .profile {{ background: #e8f0fe; padding: 10px; border-radius: 6px; margin: 20px 0; }}
                .analysis {{ margin: 20px 0; line-height: 1.6; }}
                .recommendations {{ background: #f9f9f9; padding: 15px; border-radius: 6px; margin: 20px 0; }}
                .recommendations ul {{ padding-left: 20px; }}
                .footer {{ font-size: 12px; color: #888; text-align: center; margin-top: 30px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h2>📈 Resumen Diario de Inversión</h2>
                    <p>{date}</p>
                </div>
                <div class="profile">
                    <strong>Hola {name}</strong><br>
                    Perfil: {profile} · Objetivo: {digest.get('profile_goal', '')}
                </div>
                <div class="analysis">
                    <h3>🔍 Análisis del Día</h3>
                    <p>{analysis}</p>
                </div>
                <div class="recommendations">
                    <h3>💡 Recomendaciones</h3>
                    <ul>
        """
        for rec in recommendations:
            html += f"<li><strong>{rec['symbol']}</strong>: {rec['action']} – {rec['reason']}</li>"
        html += """
                    </ul>
                </div>
        """
        if alerts:
            html += """
                <div class="alerts">
                    <h3>⚠️ Alertas</h3>
                    <ul>
            """
            for alert in alerts:
                html += f"<li>{alert['message']}</li>"
            html += "</ul></div>"
        
        html += """
                <div class="footer">
                    <p>Este es un análisis generado automáticamente. Consulta siempre a un asesor financiero.</p>
                    <p>Puedes ajustar tus preferencias de notificación en tu perfil.</p>
                </div>
            </div>
        </body>
        </html>
        """
        return html
    
    async def _send_email(self, to_email: str, subject: str, body: str) -> bool:
        """Enviar email usando SMTP (ejecutado en hilo para no bloquear)"""
        try:
            loop = asyncio.get_event_loop()
            # Ejecutar en hilo para no bloquear
            await loop.run_in_executor(
                None,
                self._send_email_sync,
                to_email,
                subject,
                body
            )
            return True
        except Exception as e:
            logger.error(f"Error sending email: {e}")
            return False
    
    def _send_email_sync(self, to_email: str, subject: str, body: str):
        """Versión síncrona de envío de email"""
        try:
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = settings.email_from
            msg['To'] = to_email

            # Adjuntar versión HTML
            msg.attach(MIMEText(body, 'html'))

            # Conectar al servidor SMTP
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port)
            server.starttls()
            server.login(settings.smtp_user, settings.smtp_password)
            server.sendmail(settings.email_from, to_email, msg.as_string())
            server.quit()
        except Exception as e:
            logger.error(f"SMTP error: {e}")
            raise


async def send_daily_notifications_task():
    """
    Tarea programada para enviar notificaciones diarias
    Ejecutar diariamente a las 8:00 AM
    """
    from app.database import AsyncSessionLocal
    from app.models.user_profile import UserProfile
    
    logger.info("📧 Iniciando envío de notificaciones diarias...")
    
    async with AsyncSessionLocal() as db:
        # Obtener usuarios con notificaciones diarias activas
        result = await db.execute(
            select(UserProfile).where(UserProfile.daily_notifications == True)
        )
        profiles = result.scalars().all()
        
        notification_service = NotificationService(db)
        
        for profile in profiles:
            try:
                digest = await notification_service.generate_daily_digest(profile.user_id)
                if digest.get("user_email"):
                    await notification_service.send_daily_notification(digest)
                else:
                    logger.warning(f"Usuario {profile.user_id} sin email, no se puede enviar.")
            except Exception as e:
                logger.error(f"Error procesando usuario {profile.user_id}: {e}")
                # Continuar con el siguiente usuario
    
    logger.info("✅ Envío de notificaciones diarias completado.")