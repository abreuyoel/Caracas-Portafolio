from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.config import settings
from app.database import init_db
from app.api import api_router
import logging
import asyncio
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from app.services.notification_service import send_daily_notifications_task
from app.services.bcv_daily_service import fetch_and_save_today_rate
from app.services.market_live_daemon import fetch_and_broadcast_live_prices
from app.services.market_notifications_service import notify_market_open, notify_market_close
from app.websocket.bvc_proxy import start_bvc_proxy


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # === DEBUG: Log de variables de entorno ===
    import os
    logger.info("=== STARTUP DEBUG ===")
    logger.info(f"PORT env var: {os.getenv('PORT')}")
    logger.info(f"SUPABASE_URL: {'✅' if os.getenv('SUPABASE_URL') else '❌ NOT SET'}")
    logger.info(f"GEMINI_API_KEY: {'✅' if os.getenv('GEMINI_API_KEY') else '❌ NOT SET'}")
    logger.info(f"RESEND_API_KEY: {'✅' if os.getenv('RESEND_API_KEY') else '❌ NOT SET'}")
    logger.info("=======================")
    # ====================================
    
    # 1. Inicializar DB (crítico - si falla, no continuar)
    try:
        await init_db()
        logger.info("✅ Database initialized")
    except Exception as e:
        logger.error(f"❌ DB init failed: {e}")
        # No yield - la app no debe iniciar sin DB
        return

    # 2. Lanzar sync de historial en background (no bloqueante)
    try:
        from app.api.stocks import _sync_all_history_bg, _sync_all_bvc_sessions_bg
        asyncio.create_task(_sync_all_history_bg())
        logger.info("🔄 Sync de historial (scraper HTML) lanzado en background")
        # Also run the BVC API-based full sync to fill any gaps
        asyncio.create_task(_sync_all_bvc_sessions_bg())
        logger.info("🔄 Sync BVC API (getOperacionesHistorico) lanzado en background")
    except Exception as e:
        logger.warning(f"⚠️  No se pudo lanzar sync al startup: {e}")

    # 2.b. Lanzar proxy Websocket de BVC a nuestra app
    try:
        asyncio.create_task(start_bvc_proxy())
        logger.info("🌐 BVC WebSocket Proxy lanzado en background")
    except Exception as e:
        logger.error(f"❌ Error al iniciar proxy websockets: {e}")

    # 3. Scheduler para tareas programadas
    scheduler = None
    try:
        scheduler = AsyncIOScheduler(timezone="America/Caracas")
        
        # Job: Tasa BCV diaria (Lun-Vie 00:00 Caracas)
        scheduler.add_job(
            fetch_and_save_today_rate,
            trigger=CronTrigger(day_of_week="mon-fri", hour=0, minute=0, timezone="America/Caracas"),
            id="bcv_daily_rate",
            name="BCV Daily USD Rate",
            misfire_grace_time=3600,
            replace_existing=True,
        )
        
        # Fetch inmediato al startup (para tener tasa hoy)
        asyncio.create_task(fetch_and_save_today_rate())

        # Job: Live market prices cada 30 segundos (en el daemon se valida horario)
        scheduler.add_job(
            fetch_and_broadcast_live_prices,
            trigger="interval",
            seconds=30,
            id="live_price_daemon",
            name="Live Market Price Daemon",
            max_instances=1,
            misfire_grace_time=10,
            replace_existing=True,
        )
        # Intento inmediato al startup
        asyncio.create_task(fetch_and_broadcast_live_prices())

        # Job: Notificación apertura BVC (Lun-Vie 09:00 Caracas)
        scheduler.add_job(
            notify_market_open,
            trigger=CronTrigger(day_of_week="mon-fri", hour=9, minute=0, timezone="America/Caracas"),
            id="market_open_notification",
            name="BVC Market Open Notification",
            misfire_grace_time=600,
            replace_existing=True,
        )

        # Job: Notificación cierre BVC (Lun-Vie 13:00 Caracas)
        scheduler.add_job(
            notify_market_close,
            trigger=CronTrigger(day_of_week="mon-fri", hour=13, minute=0, timezone="America/Caracas"),
            id="market_close_notification",
            name="BVC Market Close Notification",
            misfire_grace_time=600,
            replace_existing=True,
        )

        # Job: Sync BVC sessions for ALL symbols (Lun-Vie 14:00 Caracas — 1h after market close)
        # Ensures every trading session is captured in price_history with no gaps.
        from app.api.stocks import _sync_all_bvc_sessions_bg
        scheduler.add_job(
            _sync_all_bvc_sessions_bg,
            trigger=CronTrigger(day_of_week="mon-fri", hour=14, minute=0, timezone="America/Caracas"),
            id="bvc_sessions_sync",
            name="BVC Sessions Full Sync (all symbols)",
            misfire_grace_time=3600,
            replace_existing=True,
        )
        # Second run at 18:00 to catch any late updates
        scheduler.add_job(
            _sync_all_bvc_sessions_bg,
            trigger=CronTrigger(day_of_week="mon-fri", hour=18, minute=0, timezone="America/Caracas"),
            id="bvc_sessions_sync_eve",
            name="BVC Sessions Evening Sync",
            misfire_grace_time=3600,
            replace_existing=True,
        )

        scheduler.start()
        logger.info("✅ APScheduler started — BCV rate: Mon-Fri 00:00 | Live: 30s | Notif: 09:00/13:00 | BVC session sync: 14:00 + 18:00")
    except Exception as e:
        logger.error(f"❌ Scheduler init failed: {e}")
        # Continuamos sin scheduler - no es crítico para el health check

    # Guardar scheduler en app state para shutdown limpio
    app.state.scheduler = scheduler

    yield  # ← App corriendo

    # Shutdown
    logger.info("🛑 Shutting down...")
    
    # Cerrar scheduler si existe
    scheduler = getattr(app.state, 'scheduler', None)
    if scheduler:
        try:
            scheduler.shutdown(wait=False)
            logger.info("🗓️  Scheduler shutdown complete")
        except Exception as e:
            logger.warning(f"⚠️  Scheduler shutdown error: {e}")


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Sistema de Gestión de Portafolio de Inversión - Bolsa de Caracas",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        # Producción - DOMINIOS PERSONALIZADOS
        "https://caracasportafolio.com",
        "https://www.caracasportafolio.com",
        # API personalizada
        "https://api.caracasportafolio.com",
        # Desarrollo local
        "http://localhost:4200",
        "http://127.0.0.1:4200",
        # Variable de entorno para flexibilidad
        settings.frontend_url,
    ],
    allow_origin_regex=r"https://.*\.caracas-portafolio\.pages\.dev|https://.*\.trycloudflare\.com",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(api_router, prefix="/api/v1")


@app.get("/")
async def root():
    return {
        "message": "Investment Portfolio API",
        "version": settings.app_version,
        "docs": "/docs",
        "status": "running"
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy"}