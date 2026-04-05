from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.models.transaction import Transaction
from app.models.stock import Stock, BcvRate, PriceHistory
from app.models.portfolio import PortfolioPosition
from app.utils.security import decode_token
from uuid import UUID
import logging
from decimal import Decimal

logger = logging.getLogger(__name__)

router = APIRouter()


async def get_current_user_id(authorization: str = Header(...)) -> UUID:
    token = authorization.replace("Bearer ", "")
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Token inválido")
    return UUID(payload.get("sub"))



@router.get("/analytics")
async def get_portfolio_analytics(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Obtener análisis detallado del portafolio (Gráficos e Insights)"""
    try:
        # 1. Obtener todas las transacciones
        query = select(Transaction).where(Transaction.user_id == user_id).order_by(Transaction.transaction_date.asc())
        result = await db.execute(query)
        transactions = result.scalars().all()
        
        if not transactions:
            return {
                "summary": {
                    "total_buys": 0, "total_sells": 0, "total_invested_usd": 0,
                    "total_realized_pnl": 0, "total_unrealized_pnl": 0, "request_types": {}
                },
                "allocation": {"by_stock": [], "by_broker": []},
                "timeline": {"daily": [], "weekly": [], "monthly": []},
                "performance_by_stock": [],
                "insights": {}
            }

        # 2. Obtener precios actuales para ROI
        stock_ids = list(set([t.stock_id for t in transactions if t.stock_id]))
        stocks_query = select(Stock).where(Stock.id.in_(stock_ids))
        stocks_result = await db.execute(stocks_query)
        stocks_map = {s.id: s for s in stocks_result.scalars().all()}

        # Load latest BCV rate for USD conversion
        bcv_q = select(BcvRate).order_by(BcvRate.rate_date.desc()).limit(1)
        bcv_res = await db.execute(bcv_q)
        latest_bcv = bcv_res.scalar_one_or_none()
        current_bcv_rate = float(latest_bcv.rate) if latest_bcv else 36.0

        # 3. Procesar datos
        total_buys = 0
        total_sells = 0
        total_invested_usd = 0
        total_realized_pnl = 0
        req_types = {"Mercado": 0, "Limite": 0}
        daily_realized_pnl: dict = {}
        sell_pnl_by_symbol: dict = {}
        
        vol_by_stock = {}
        vol_by_broker = {}
        
        timeline_daily = {}
        timeline_weekly = {}
        timeline_monthly = {}
        
        performance_map = {} # Símbolo -> {datos}

        for tx in transactions:
            stock = stocks_map.get(tx.stock_id)
            symbol = stock.symbol if stock else "???"
            if not tx.transaction_date: continue
            
            # Grupos de tiempo
            day_str = tx.transaction_date.strftime("%Y-%m-%d")
            month_str = tx.transaction_date.strftime("%Y-%m")
            year, week, _ = tx.transaction_date.isocalendar()
            week_str = f"{year}-W{week:02d}"
            
            # Inicializar performance para este símbolo
            if symbol not in performance_map:
                performance_map[symbol] = {
                    "symbol": symbol,
                    "quantity": 0,
                    "cost_basis": 0,
                    "realized_pnl": 0,
                    "total_buys_vol": 0,
                    "total_sells_vol": 0,
                    "buy_count": 0,
                    "sell_count": 0
                }
            perf = performance_map[symbol]
            
            val_usd = float(tx.amount_usd or 0)
            avg_price_usd = float(tx.avg_price or 0) / 36.0 # TasaRef si no hay BCV en tx
            if tx.bcv_rate and tx.bcv_rate > 0:
                avg_price_usd = float(tx.avg_price) / float(tx.bcv_rate)

            if tx.order_type == "Compra":
                total_buys += 1
                total_invested_usd += val_usd
                perf["quantity"] += tx.quantity
                perf["cost_basis"] += val_usd
                perf["total_buys_vol"] += val_usd
                perf["buy_count"] += 1
                
                # Timelines (Inversión acumulada)
                timeline_daily[day_str] = timeline_daily.get(day_str, 0) + val_usd
                timeline_weekly[week_str] = timeline_weekly.get(week_str, 0) + val_usd
                timeline_monthly[month_str] = timeline_monthly.get(month_str, 0) + val_usd
                
                vol_by_stock[symbol] = vol_by_stock.get(symbol, 0) + val_usd
                broker = tx.brokerage or "Otra Casa de Bolsa"
                vol_by_broker[broker] = vol_by_broker.get(broker, 0) + val_usd
            else:
                total_sells += 1
                perf["sell_count"] += 1
                perf["total_sells_vol"] += val_usd
                
                # Realized PnL (WAC Method)
                # Costo promedio antes de la venta
                prev_qty = perf["quantity"]
                if prev_qty > 0:
                    unit_cost = perf["cost_basis"] / prev_qty
                    qty_to_sell = min(tx.quantity, prev_qty)
                    
                    realized = val_usd - (unit_cost * qty_to_sell)
                    perf["realized_pnl"] += realized
                    total_realized_pnl += realized

                    # Track daily realized P&L and per-symbol sell P&L
                    daily_realized_pnl[day_str] = daily_realized_pnl.get(day_str, 0) + realized
                    sell_pnl_by_symbol[symbol] = sell_pnl_by_symbol.get(symbol, 0) + realized

                    # ACTUALIZACIÓN CRÍTICA: Reducir la base del costo prorrateada
                    perf["cost_basis"] -= (unit_cost * qty_to_sell)
                    perf["quantity"] -= qty_to_sell

            rt = tx.request_type or "Mercado"
            req_types[rt] = req_types.get(rt, 0) + 1

        # 4. Calcular Unrealized y Formatear Rendimiento
        performance_list = []
        total_unrealized_pnl = 0
        best_trade = {"symbol": "", "gain_usd": -float('inf')}
        worst_trade = {"symbol": "", "loss_usd": float('inf')}

        for symbol, perf in performance_map.items():
            stock = next((s for s in stocks_map.values() if s.symbol == symbol), None)
            unrealized = 0
            current_value = 0
            
            if stock and perf["quantity"] > 0:
                # Get current price from stock or latest price_history
                last_price_bs = float(stock.last_price or 0)
                if last_price_bs <= 0:
                    hp_q = select(PriceHistory.close_price).where(
                        PriceHistory.stock_id == stock.id
                    ).order_by(PriceHistory.price_date.desc()).limit(1)
                    hp_res = await db.execute(hp_q)
                    hp_val = hp_res.scalar_one_or_none()
                    if hp_val:
                        last_price_bs = float(hp_val)
                current_price_usd = last_price_bs / current_bcv_rate if current_bcv_rate > 0 else 0
                current_value = current_price_usd * perf["quantity"]
                unrealized = current_value - perf["cost_basis"]
                total_unrealized_pnl += unrealized
            
            total_gain = perf["realized_pnl"] + unrealized
            cost_basis = perf["total_buys_vol"] # Usar el total invertido para el ROI global
            gain_pct = (total_gain / cost_basis * 100) if cost_basis > 0 else 0
            
            perf_item = {
                "symbol": symbol,
                "quantity": perf["quantity"],
                "total_invested": round(perf["total_buys_vol"], 2),
                "current_value": round(current_value, 2),
                "unrealized_pnl": round(unrealized, 2),
                "realized_pnl": round(perf["realized_pnl"], 2),
                "total_pnl": round(total_gain, 2),
                "gain_pct": round(gain_pct, 2),
                "buy_count": perf["buy_count"],
                "sell_count": perf["sell_count"]
            }
            performance_list.append(perf_item)
            
            if total_gain > best_trade["gain_usd"]:
                best_trade = {"symbol": symbol, "gain_usd": round(total_gain, 2)}
            if total_gain < worst_trade["loss_usd"]:
                worst_trade = {"symbol": symbol, "loss_usd": round(total_gain, 2)}

        # 5. Top Holdings (Unrealized)
        only_holdings = [p for p in performance_list if p["quantity"] > 0]
        top_unrealized_usd = max(only_holdings, key=lambda x: x["unrealized_pnl"]) if only_holdings else None
        top_unrealized_pct = max(only_holdings, key=lambda x: x["gain_pct"]) if only_holdings else None
        worst_holding_usd = min(only_holdings, key=lambda x: x["unrealized_pnl"]) if only_holdings else None
        top_holdings_sorted = sorted(only_holdings, key=lambda x: x["unrealized_pnl"], reverse=True)[:5]

        # Best / worst sell by symbol
        best_sell_sym = max(sell_pnl_by_symbol.items(), key=lambda x: x[1]) if sell_pnl_by_symbol else None
        worst_sell_sym = min(sell_pnl_by_symbol.items(), key=lambda x: x[1]) if sell_pnl_by_symbol else None

        # Best / worst day of realized gains
        best_gain_day = max(daily_realized_pnl.items(), key=lambda x: x[1]) if daily_realized_pnl else None
        worst_gain_day = min(daily_realized_pnl.items(), key=lambda x: x[1]) if daily_realized_pnl else None

        # 6. Formatear para el frontend
        return {
            "summary": {
                "total_buys": total_buys,
                "total_sells": total_sells,
                "total_invested_usd": round(total_invested_usd, 2),
                "total_realized_pnl": round(total_realized_pnl, 2),
                "total_unrealized_pnl": round(total_unrealized_pnl, 2),
                "request_types": req_types,
                "bcv_rate": round(current_bcv_rate, 2),
            },
            "allocation": {
                "by_stock": [{"name": k, "value": round(v, 2)} for k, v in sorted(vol_by_stock.items(), key=lambda x: x[1], reverse=True)],
                "by_broker": [{"name": k, "value": round(v, 2)} for k, v in sorted(vol_by_broker.items(), key=lambda x: x[1], reverse=True)]
            },
            "timeline": {
                "daily": [{"date": k, "value": round(v, 2)} for k, v in sorted(timeline_daily.items())],
                "weekly": [{"date": k, "value": round(v, 2)} for k, v in sorted(timeline_weekly.items())],
                "monthly": [{"date": k, "value": round(v, 2)} for k, v in sorted(timeline_monthly.items())]
            },
            "performance_by_stock": sorted(performance_list, key=lambda x: x["total_pnl"], reverse=True),
            "insights": {
                "best_position": best_trade if best_trade["symbol"] else None,
                "worst_position": worst_trade if worst_trade["symbol"] else None,
                "best_day": max(timeline_daily.items(), key=lambda x: x[1]) if timeline_daily else None,
                "best_gain_day": list(best_gain_day) if best_gain_day else None,
                "worst_gain_day": list(worst_gain_day) if worst_gain_day else None,
                "top_holding_gain": top_unrealized_usd,
                "top_holding_pct": top_unrealized_pct,
                "worst_holding": worst_holding_usd,
                "best_sell": {"symbol": best_sell_sym[0], "realized_pnl": round(best_sell_sym[1], 2)} if best_sell_sym else None,
                "worst_sell": {"symbol": worst_sell_sym[0], "realized_pnl": round(worst_sell_sym[1], 2)} if worst_sell_sym else None,
                "top_holdings": top_holdings_sorted,
            }
        }
    except Exception as e:
        logger.error(f"Error in analytics: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/summary")
async def get_portfolio_summary(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Obtener resumen del portafolio del usuario"""
    try:
        # 1. Obtener última tasa BCV para valor actual
        bcv_query = select(BcvRate).order_by(BcvRate.rate_date.desc()).limit(1)
        bcv_result = await db.execute(bcv_query)
        latest_bcv = bcv_result.scalar_one_or_none()
        current_bcv_rate = float(latest_bcv.rate) if latest_bcv else 1.0

        # 2. Calcular posiciones actuales (Cantidad neta por acción)
        # Compras
        buys_query = select(
            Transaction.stock_id,
            func.sum(Transaction.quantity).label("total_qty"),
            func.sum(Transaction.net_amount).label("total_invested_bs"),
            func.sum(Transaction.amount_usd).label("total_invested_usd")
        ).where(
            Transaction.user_id == user_id,
            Transaction.order_type == "Compra"
        ).group_by(Transaction.stock_id)
        
        buys_result = await db.execute(buys_query)
        buys_data = {row.stock_id: row for row in buys_result.all()}

        # Ventas
        sells_query = select(
            Transaction.stock_id,
            func.sum(Transaction.quantity).label("total_qty"),
            func.sum(Transaction.net_amount).label("total_sold_bs")
        ).where(
            Transaction.user_id == user_id,
            Transaction.order_type == "Venta"
        ).group_by(Transaction.stock_id)
        
        sells_result = await db.execute(sells_query)
        sells_data = {row.stock_id: row for row in sells_result.all()}

        # 3. Consolidar posiciones y obtener precios actuales
        final_invested_bs = 0.0
        final_invested_usd = 0.0
        current_value_bs = 0.0
        active_positions_count = 0
        total_transactions_count = 0

        # Obtener todos los stocks involucrados para sus precios
        stock_ids = list(set(list(buys_data.keys()) + list(sells_data.keys())))
        if stock_ids:
            stocks_query = select(Stock).where(Stock.id.in_(stock_ids))
            stocks_result = await db.execute(stocks_query)
            stocks_map = {s.id: s for s in stocks_result.scalars().all()}

            for sid in stock_ids:
                buy_row = buys_data.get(sid)
                sell_row = sells_data.get(sid)
                
                buy_qty = int(buy_row.total_qty) if buy_row else 0
                sell_qty = int(sell_row.total_qty) if sell_row else 0
                current_qty = buy_qty - sell_qty
                
                if current_qty > 0:
                    active_positions_count += 1
                    stock = stocks_map.get(sid)
                    last_price = float(stock.last_price or 0) if stock else 0.0
                    
                    # Fallback: si no hay last_price, buscar en el historial mas reciente
                    if last_price <= 0:
                        hist_query = select(PriceHistory.close_price).where(
                            PriceHistory.stock_id == sid
                        ).order_by(PriceHistory.price_date.desc()).limit(1)
                        hist_result = await db.execute(hist_query)
                        hist_price = hist_result.scalar_one_or_none()
                        if hist_price:
                            last_price = float(hist_price)
                    
                    # Valor actual en Bs
                    current_value_bs += current_qty * last_price
                    
                    # Cost basis (proporcional a lo que queda)
                    if buy_qty > 0:
                        ratio = current_qty / buy_qty
                        final_invested_bs += float(buy_row.total_invested_bs) * ratio
                        final_invested_usd += float(buy_row.total_invested_usd) * ratio

        # 4. Cálculo final de Rendimiento
        current_value_usd = current_value_bs / current_bcv_rate if current_bcv_rate > 0 else 0
        unrealized_pnl_bs = current_value_bs - final_invested_bs
        unrealized_pnl_usd = current_value_usd - final_invested_usd
        unrealized_pnl_pct = (unrealized_pnl_usd / final_invested_usd * 100) if final_invested_usd > 0 else 0.0

        # Contar transacciones totales
        tx_count_query = select(func.count(Transaction.id)).where(Transaction.user_id == user_id)
        tx_count_result = await db.execute(tx_count_query)
        total_transactions_count = tx_count_result.scalar() or 0

        return {
            "total_invested_usd": round(final_invested_usd, 2),
            "total_invested_bs": round(final_invested_bs, 2),
            "current_value_usd": round(current_value_usd, 2),
            "current_value_bs": round(current_value_bs, 2),
            "unrealized_pnl_usd": round(unrealized_pnl_usd, 2),
            "unrealized_pnl_bs": round(unrealized_pnl_bs, 2),
            "unrealized_pnl_pct": round(unrealized_pnl_pct, 2),
            "realized_pnl_usd": 0, # Implementación futura de FIFO
            "total_positions": active_positions_count,
            "total_transactions": total_transactions_count
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))