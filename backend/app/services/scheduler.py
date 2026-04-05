from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from datetime import datetime
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.stock import Stock, PriceHistory, BcvRate
from app.models.portfolio import PortfolioPosition
from app.utils.scraper import get_active_stocks, get_stock_history, get_bcv_rate
from app.websocket.manager import manager
from decimal import Decimal

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()


async def update_stock_prices():
    """Actualizar precios de todas las acciones activas"""
    logger.info("Starting stock price update...")
    
    async with AsyncSessionLocal() as db:
        # Obtener todas las acciones activas
        result = await db.execute(select(Stock).where(Stock.is_active == True))
        stocks = result.scalars().all()
        
        for stock in stocks:
            try:
                history = await get_stock_history(stock.symbol)
                if history:
                    # Actualizar stock
                    stock.last_price = Decimal(str(history['close']))
                    stock.prev_close = Decimal(str(history['open']))
                    stock.day_high = Decimal(str(history['high']))
                    stock.day_low = Decimal(str(history['low']))
                    stock.volume = history['volume']
                    stock.last_updated = datetime.utcnow()
                    
                    # Guardar histórico
                    price_history = PriceHistory(
                        stock_id=stock.id,
                        price_date=datetime.strptime(history['date'], '%d-%b-%y').date() if isinstance(history['date'], str) else history['date'],
                        open_price=Decimal(str(history['open'])),
                        close_price=Decimal(str(history['close'])),
                        change_amount=Decimal(str(history['change'])),
                        change_pct=Decimal(str(history['change_pct'])),
                        high_price=Decimal(str(history['high'])),
                        low_price=Decimal(str(history['low'])),
                        trades=history['trades'],
                        volume=history['volume'],
                        amount=Decimal(str(history['amount']))
                    )
                    
                    db.add(price_history)
                    
                    # Notificar a usuarios con esta acción en su portafolio
                    portfolio_result = await db.execute(
                        select(PortfolioPosition).where(PortfolioPosition.stock_id == stock.id)
                    )
                    positions = portfolio_result.scalars().all()
                    
                    for position in positions:
                        # Calcular P&L actualizado
                        if position.total_shares > 0:
                            position.current_price = stock.last_price
                            position.current_value_bs = position.total_shares * stock.last_price
                            
                            # Necesitamos tasa BCV para USD
                            bcv_result = await db.execute(select(BcvRate).order_by(BcvRate.rate_date.desc()))
                            bcv = bcv_result.scalar_one_or_none()
                            if bcv:
                                position.current_value_usd = position.current_value_bs / bcv.rate
                                position.unrealized_pnl_usd = position.current_value_usd - position.total_invested_usd
                                position.unrealized_pnl_pct = (position.unrealized_pnl_usd / position.total_invested_usd * 100) if position.total_invested_usd > 0 else Decimal("0")
                            
                            position.last_updated = datetime.utcnow()
                            
                            # Enviar actualización WebSocket
                            change_pct = float(history['change_pct']) if history['change_pct'] else 0
                            await manager.send_price_update(
                                position.user_id,
                                stock.symbol,
                                float(stock.last_price),
                                change_pct
                            )
                
                await db.commit()
                
            except Exception as e:
                logger.error(f"Error updating stock {stock.symbol}: {e}")
                await db.rollback()
    
    logger.info("Stock price update completed")


async def update_bcv_rate():
    """Actualizar tasa BCV"""
    logger.info("Updating BCV rate...")
    
    try:
        rate = await get_bcv_rate()
        if rate:
            async with AsyncSessionLocal() as db:
                bcv_rate = BcvRate(
                    rate_date=datetime.utcnow().date(),
                    rate=Decimal(str(rate))
                )
                db.add(bcv_rate)
                await db.commit()
                logger.info(f"BCV rate updated: {rate}")
    except Exception as e:
        logger.error(f"Error updating BCV rate: {e}")


async def check_alerts():
    """Verificar y enviar alertas"""
    logger.info("Checking alerts...")
    # Implementar lógica de alertas
    pass


def start_scheduler():
    """Iniciar el scheduler de tareas"""
    # Actualizar precios cada 30 segundos
    scheduler.add_job(
        update_stock_prices,
        trigger=IntervalTrigger(seconds=30),
        id='update_stocks',
        name='Update Stock Prices',
        replace_existing=True
    )
    
    # Actualizar BCV cada hora
    scheduler.add_job(
        update_bcv_rate,
        trigger=IntervalTrigger(hours=1),
        id='update_bcv',
        name='Update BCV Rate',
        replace_existing=True
    )
    
    # Verificar alertas cada minuto
    scheduler.add_job(
        check_alerts,
        trigger=IntervalTrigger(minutes=1),
        id='check_alerts',
        name='Check Alerts',
        replace_existing=True
    )
    
    scheduler.start()
    logger.info("Scheduler started")


def stop_scheduler():
    """Detener el scheduler"""
    scheduler.shutdown()