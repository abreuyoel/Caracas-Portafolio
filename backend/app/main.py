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


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("🚀 Starting up...")
    try:
        await init_db()
    except Exception as e:
        logger.warning(f"⚠️  DB init failed: {e}")

    # Lanzar sync de historial al arrancar (sin bloquear)
    try:
        from app.api.stocks import _sync_all_history_bg
        asyncio.create_task(_sync_all_history_bg())
        logger.info("🔄 Sync de historial lanzado en background al startup")
    except Exception as e:
        logger.warning(f"⚠️  No se pudo lanzar sync al startup: {e}")

    # Scheduler: BCV daily rate + notificaciones
    try:
        scheduler = AsyncIOScheduler(timezone="America/Caracas")
        # Tasa BCV: lunes–viernes a las 00:00 hora Caracas
        scheduler.add_job(
            fetch_and_save_today_rate,
            trigger=CronTrigger(day_of_week="mon-fri", hour=0, minute=0, timezone="America/Caracas"),
            id="bcv_daily_rate",
            name="BCV Daily USD Rate",
            misfire_grace_time=3600,
            replace_existing=True,
        )
        # Fetch rate immediately on startup to ensure today's rate is in the DB
        asyncio.create_task(fetch_and_save_today_rate())

        scheduler.start()
        logger.info("🗓️  APScheduler started — BCV rate job: Mon–Fri 00:00 Caracas")
    except Exception as e:
        logger.warning(f"⚠️  Scheduler init failed: {e}")

    yield
    # Shutdown
    logger.info("🛑 Shutting down...")
    try:
        scheduler.shutdown(wait=False)
    except Exception:
        pass


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
        #"https://stages-sussex-charity-karma.trycloudflare.com",  # Tu túnel frontend
        "https://*.trycloudflare.com",  # Wildcard para pruebas futuras
        "http://localhost:4200",
        "http://127.0.0.1:4200",
        settings.frontend_url  # Si está definido en tus settings
    ],
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