from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from app.config import settings
from typing import AsyncGenerator
import logging

logger = logging.getLogger(__name__)

# Engine con configuración optimizada
engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    pool_timeout=30,
    pool_recycle=1800
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

Base = declarative_base()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def _add_missing_columns(conn):
    """Agrega columnas que faltan sin tirar error si ya existen (migrations livianas)."""
    new_columns = [
        ("user_profiles", "portfolio_drop_reaction", "VARCHAR DEFAULT 'mantener'"),
        ("user_profiles", "allows_margin_trading", "BOOLEAN DEFAULT FALSE"),
        ("user_profiles", "notification_frequency", "VARCHAR DEFAULT 'daily'"),
        ("chat_sessions", "chat_type", "VARCHAR(20) DEFAULT 'general'"),
    ]
    for table, col, definition in new_columns:
        try:
            await conn.execute(
                __import__('sqlalchemy', fromlist=['text']).text(
                    f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {definition}"
                )
            )
        except Exception as e:
            logger.debug(f"Column {table}.{col} already exists or error: {e}")


async def init_db():
    """Inicializar DB con manejo de errores"""
    try:
        logger.info("🔄 Conectando a PostgreSQL...")

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await _add_missing_columns(conn)

        logger.info("✅ Database initialized successfully")
    except Exception as e:
        logger.error(f"❌ Database initialization failed: {e}")
        logger.warning("⚠️  Continuing without database initialization...")
        # No lanzar el error para permitir que el servidor arranque