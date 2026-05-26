from fastapi import APIRouter, Depends, HTTPException, Header, Query
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
from collections import defaultdict
from datetime import datetime, timedelta, timezone

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

        # 3b. Calcular tasa promedio de comisión de todas las transacciones con datos
        # Usamos gross_amount > 0 para evitar divisiones por cero de transacciones antiguas
        commission_rates = []
        for tx in transactions:
            gross = float(tx.gross_amount or 0)
            if gross <= 0:
                continue
            total_cost_tx = float(tx.commission or 0) + float(tx.iva or 0) + float(tx.registry_fee or 0)
            if total_cost_tx > 0:
                commission_rates.append(total_cost_tx / gross)

        avg_commission_rate = (sum(commission_rates) / len(commission_rates)) if commission_rates else 0.045  # 4.5% default BVC

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
            
            # Precio unitario en USD = precio de mercado actual / tasa BCV
            current_price_usd = (current_value / perf["quantity"]) if perf["quantity"] > 0 and current_value > 0 else 0

            # Net if sold today (accounting for sell commissions)
            estimated_sell_cost = current_value * avg_commission_rate if current_value > 0 else 0
            net_if_sold = (current_value - estimated_sell_cost) - perf["cost_basis"] if perf["quantity"] > 0 else 0
            net_if_sold_pct = (net_if_sold / perf["total_buys_vol"] * 100) if perf["total_buys_vol"] > 0 else 0

            perf_item = {
                "symbol": symbol,
                "quantity": perf["quantity"],
                "total_invested": round(perf["total_buys_vol"], 2),
                "current_value": round(current_value, 2),
                "unit_price_usd": round(current_price_usd, 6),
                "unrealized_pnl": round(unrealized, 2),
                "realized_pnl": round(perf["realized_pnl"], 2),
                "total_pnl": round(total_gain, 2),
                "gain_pct": round(gain_pct, 2),
                "buy_count": perf["buy_count"],
                "estimated_sell_cost_usd": round(estimated_sell_cost, 2),
                "net_if_sold_usd": round(net_if_sold, 2),
                "net_if_sold_pct": round(net_if_sold_pct, 2),
                "sell_count": perf["sell_count"]
            }
            performance_list.append(perf_item)
            
            if total_gain > best_trade["gain_usd"]:
                best_trade = {"symbol": symbol, "gain_usd": round(total_gain, 2)}
            if total_gain < worst_trade["loss_usd"]:
                worst_trade = {"symbol": symbol, "loss_usd": round(total_gain, 2)}

        # 4b. Totales consolidados netos si se vendiera todo
        total_net_if_sold = sum(p["net_if_sold_usd"] for p in performance_list if p["quantity"] > 0)
        total_estimated_sell_cost = sum(p["estimated_sell_cost_usd"] for p in performance_list if p["quantity"] > 0)

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

        # Cost basis of CURRENT holdings only (reduces when shares are sold via WAC)
        total_cost_basis_current = sum(
            perf["cost_basis"] for perf in performance_map.values() if perf["quantity"] > 0
        )

        # 6. Formatear para el frontend
        return {
            "summary": {
                "total_buys": total_buys,
                "total_sells": total_sells,
                "total_invested_usd": round(total_invested_usd, 2),
                "total_cost_basis_usd": round(total_cost_basis_current, 2),
                "total_realized_pnl": round(total_realized_pnl, 2),
                "total_unrealized_pnl": round(total_unrealized_pnl, 2),
                "request_types": req_types,
                "bcv_rate": round(current_bcv_rate, 2),
                "avg_commission_rate_pct": round(avg_commission_rate * 100, 3),
                "total_net_if_sold_usd": round(total_net_if_sold, 2),
                "total_estimated_sell_cost_usd": round(total_estimated_sell_cost, 2),
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


@router.get("/pnl-history")
async def get_pnl_history(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Retorna el historial diario de P&L del portafolio:
    - consolidated: lista [{date, value_usd, cost_usd, pnl_usd, pnl_pct}]
    - per_stock:    {SYMBOL: [{date, value_usd, cost_usd, pnl_usd, pnl_pct}]}

    Utiliza todos los registros de price_history disponibles para reconstruir
    el valor del portafolio en cada fecha de negociación.
    """
    try:
        # ── 1. Transactions (chronological) ──────────────────────────────────
        txs_q = (
            select(Transaction)
            .where(Transaction.user_id == user_id)
            .order_by(Transaction.transaction_date.asc())
        )
        transactions = (await db.execute(txs_q)).scalars().all()

        if not transactions:
            return {"consolidated": [], "per_stock": {}}

        # ── 2. Stocks metadata ────────────────────────────────────────────────
        stock_ids = list({t.stock_id for t in transactions if t.stock_id})
        stocks_map: dict[int, Stock] = {
            s.id: s
            for s in (await db.execute(select(Stock).where(Stock.id.in_(stock_ids)))).scalars().all()
        }

        # ── 3. Price history for portfolio stocks ─────────────────────────────
        ph_rows = (
            await db.execute(
                select(PriceHistory)
                .where(PriceHistory.stock_id.in_(stock_ids))
                .order_by(PriceHistory.price_date.asc())
            )
        ).scalars().all()

        if not ph_rows:
            return {"consolidated": [], "per_stock": {}}

        # price_map[stock_id][date_str] = close_price_bs
        price_map: dict[int, dict[str, float]] = defaultdict(dict)
        for ph in ph_rows:
            price_map[ph.stock_id][ph.price_date.isoformat()] = float(ph.close_price or 0)

        # ── 4. BCV rates ──────────────────────────────────────────────────────
        bcv_rows = (await db.execute(select(BcvRate).order_by(BcvRate.rate_date.asc()))).scalars().all()
        bcv_map: dict[str, float] = {r.rate_date.isoformat(): float(r.rate) for r in bcv_rows}
        sorted_bcv_dates = sorted(bcv_map.keys())
        fallback_bcv = float(bcv_rows[-1].rate) if bcv_rows else 36.0

        def get_bcv(date_str: str) -> float:
            if date_str in bcv_map:
                return bcv_map[date_str]
            for d in reversed(sorted_bcv_dates):
                if d <= date_str:
                    return bcv_map[d]
            return fallback_bcv

        # ── 5. Build position state timeline ─────────────────────────────────
        # For each stock, sorted list of (date_str, cumulative_qty, cumulative_cost_usd)
        stock_states: dict[int, list[tuple[str, float, float]]] = defaultdict(list)
        running: dict[int, dict] = {}

        # Track first purchase date per stock
        first_buy_date: dict[int, str] = {}

        for t in transactions:
            if not t.stock_id or not t.transaction_date:
                continue
            sid      = t.stock_id
            date_str = t.transaction_date.strftime("%Y-%m-%d")
            val_usd  = float(t.amount_usd or 0)

            if sid not in running:
                running[sid] = {"qty": 0.0, "cost": 0.0}

            if t.order_type == "Compra":
                running[sid]["qty"]  += t.quantity
                running[sid]["cost"] += val_usd
                if sid not in first_buy_date:
                    first_buy_date[sid] = date_str
            else:
                prev_qty = running[sid]["qty"]
                if prev_qty > 0:
                    unit_cost = running[sid]["cost"] / prev_qty
                    qty_sold  = min(t.quantity, prev_qty)
                    running[sid]["cost"] -= unit_cost * qty_sold
                    running[sid]["qty"]  -= qty_sold

            stock_states[sid].append((date_str, running[sid]["qty"], running[sid]["cost"]))

        def state_at(sid: int, date_str: str) -> tuple[float, float]:
            """Return (qty, cost_usd) for stock sid on or before date_str."""
            states = stock_states.get(sid, [])
            qty, cost = 0.0, 0.0
            for d, q, c in states:
                if d <= date_str:
                    qty, cost = q, c
                else:
                    break
            return qty, cost

        def price_at_or_before(sid: int, date_str: str) -> float | None:
            """Return close price (Bs) for stock on or before date_str."""
            pm = price_map.get(sid, {})
            for d in sorted(pm.keys(), reverse=True):
                if d <= date_str:
                    return pm[d]
            return None

        # ── 6. Iterate over all trading dates ─────────────────────────────────
        first_tx_date = transactions[0].transaction_date.strftime("%Y-%m-%d")
        all_dates     = sorted(
            {ph.price_date.isoformat() for ph in ph_rows if ph.price_date.isoformat() >= first_tx_date}
        )

        consolidated: list[dict] = []
        per_stock: dict[str, list[dict]] = {stocks_map[sid].symbol: [] for sid in stock_ids}

        for date_str in all_dates:
            bcv           = get_bcv(date_str)
            total_val_usd = 0.0
            total_cost    = 0.0

            for sid in stock_ids:
                qty, cost = state_at(sid, date_str)
                if qty <= 0:
                    continue

                # Only include stock from its first purchase date
                if date_str < first_buy_date.get(sid, date_str):
                    continue

                price_bs = price_at_or_before(sid, date_str)
                if price_bs is None or price_bs <= 0 or bcv <= 0:
                    continue

                value_usd = (qty * price_bs) / bcv
                pnl_usd   = value_usd - cost
                pnl_pct   = (pnl_usd / cost * 100) if cost > 0 else 0.0

                total_val_usd += value_usd
                total_cost    += cost

                sym = stocks_map[sid].symbol
                per_stock[sym].append({
                    "date":      date_str,
                    "value_usd": round(value_usd, 2),
                    "cost_usd":  round(cost, 2),
                    "pnl_usd":   round(pnl_usd, 2),
                    "pnl_pct":   round(pnl_pct, 2),
                })

            if total_cost > 0:
                pnl_usd = total_val_usd - total_cost
                consolidated.append({
                    "date":      date_str,
                    "value_usd": round(total_val_usd, 2),
                    "cost_usd":  round(total_cost, 2),
                    "pnl_usd":   round(pnl_usd, 2),
                    "pnl_pct":   round((pnl_usd / total_cost * 100) if total_cost > 0 else 0, 2),
                })

        return {
            "consolidated": consolidated,
            "per_stock":    per_stock,
        }

    except Exception as e:
        logger.error(f"Error in pnl-history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Monte Carlo ────────────────────────────────────────────────────────────────

@router.get("/montecarlo")
async def get_montecarlo(
    horizon: int = 252,        # trading days
    simulations: int = 500,
    dca_monthly_usd: float = 0,   # periodic monthly contribution in USD (0 = disabled)
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Monte Carlo simulation of the user's current portfolio value.
    Returns daily percentile series (P5, P25, P50, P75, P95).
    """
    import math, random

    if horizon < 1 or horizon > 756:
        raise HTTPException(status_code=400, detail="horizon must be 1-756 trading days")
    if simulations < 100 or simulations > 2000:
        raise HTTPException(status_code=400, detail="simulations must be 100-2000")

    # 1. Get current open positions and their USD value
    txs_r = await db.execute(
        select(Transaction)
        .where(Transaction.user_id == user_id)
        .order_by(Transaction.transaction_date)
    )
    transactions = txs_r.scalars().all()
    if not transactions:
        return {"error": "no_portfolio", "percentiles": {}}

    # Load stocks map (by id AND by symbol for fallback)
    all_sids = list({tx.stock_id for tx in transactions if tx.stock_id})
    stocks_by_id: dict = {}
    if all_sids:
        sr = await db.execute(select(Stock).where(Stock.id.in_(all_sids)))
        stocks_by_id = {s.id: s for s in sr.scalars().all()}

    # Build net qty keyed by symbol (same approach as analytics)
    net_qty: dict[str, int] = {}
    sym_to_stock: dict[str, Stock] = {}
    for tx in transactions:
        stock = stocks_by_id.get(tx.stock_id) if tx.stock_id else None
        symbol = stock.symbol if stock else None
        if not symbol:
            continue
        sym_to_stock[symbol] = stock
        delta = tx.quantity if tx.order_type == "Compra" else -tx.quantity
        net_qty[symbol] = net_qty.get(symbol, 0) + delta

    open_positions = {sym: qty for sym, qty in net_qty.items() if qty > 0}
    if not open_positions:
        return {"error": "no_open_positions", "percentiles": {}}

    # 2. BCV rate history (last 365 calendar days) – used to convert VES→USD historically
    bcv_hist_r = await db.execute(
        select(BcvRate)
        .order_by(BcvRate.rate_date.desc())
        .limit(365)
    )
    bcv_rows = bcv_hist_r.scalars().all()
    if not bcv_rows:
        return {"error": "no_price_data", "percentiles": {}}

    # Build date→rate lookup (most recent row = current rate)
    bcv_by_date: dict = {row.rate_date: float(row.rate) for row in bcv_rows}
    bcv = float(sorted(bcv_rows, key=lambda r: r.rate_date, reverse=True)[0].rate)

    # Estimate BCV daily devaluation rate from log-returns of BCV rate
    bcv_sorted_rates = [float(r.rate) for r in sorted(bcv_rows, key=lambda r: r.rate_date)]
    if len(bcv_sorted_rates) >= 10:
        bcv_log_rets = [
            math.log(bcv_sorted_rates[i] / bcv_sorted_rates[i - 1])
            for i in range(1, len(bcv_sorted_rates))
            if bcv_sorted_rates[i - 1] > 0 and bcv_sorted_rates[i] > 0
        ]
        mu_bcv = sum(bcv_log_rets) / len(bcv_log_rets)   # daily devaluation drift
        sigma_bcv = math.sqrt(sum((r - mu_bcv) ** 2 for r in bcv_log_rets) / len(bcv_log_rets))
    else:
        # Venezuela historical avg ~100-150% annual devaluation ≈ 0.003 daily
        mu_bcv = 0.003
        sigma_bcv = 0.01

    def bcv_for_date(d):
        """Return nearest available BCV rate for a given date."""
        if d in bcv_by_date:
            return bcv_by_date[d]
        # Walk back up to 5 days to find the closest rate
        from datetime import timedelta as _td
        for delta in range(1, 6):
            candidate = d - _td(days=delta)
            if candidate in bcv_by_date:
                return bcv_by_date[candidate]
        return bcv  # fallback to current rate

    # 3. For each position: get last price + historical daily log returns in USD
    stock_params: dict[str, dict] = {}
    total_value_usd = Decimal("0")

    for symbol, qty in open_positions.items():
        stock = sym_to_stock.get(symbol)
        if not stock or not stock.last_price:
            continue

        current_usd = Decimal(str(stock.last_price)) / Decimal(str(bcv)) * qty
        total_value_usd += current_usd

        # Get price history (last 252 trading days)
        hist_r = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.stock_id == stock.id)
            .where(PriceHistory.close_price != None)
            .order_by(PriceHistory.price_date.desc())
            .limit(252)
        )
        hist = list(reversed(hist_r.scalars().all()))

        if len(hist) >= 5:
            # Convert each historical VES price to USD using the BCV rate on that date.
            # This gives real USD returns, removing the hyperinflation / devaluation effect.
            closes_usd = []
            for h in hist:
                rate = bcv_for_date(h.price_date)
                if rate > 0:
                    closes_usd.append(float(h.close_price) / rate)

            if len(closes_usd) >= 5:
                log_returns = [
                    math.log(closes_usd[i] / closes_usd[i - 1])
                    for i in range(1, len(closes_usd))
                    if closes_usd[i - 1] > 0 and closes_usd[i] > 0
                ]
                mu = sum(log_returns) / len(log_returns)
                variance = sum((r - mu) ** 2 for r in log_returns) / len(log_returns)
                sigma = math.sqrt(variance)
            else:
                # Not enough BCV-matched data: use raw VES returns minus BCV devaluation
                closes_ves = [float(h.close_price) for h in hist]
                raw_rets = [math.log(closes_ves[i] / closes_ves[i-1]) for i in range(1, len(closes_ves)) if closes_ves[i-1] > 0]
                mu = (sum(raw_rets) / len(raw_rets)) - mu_bcv
                variance = sum((r - mu) ** 2 for r in raw_rets) / len(raw_rets)
                sigma = math.sqrt(variance)
        else:
            # Fallback: modest positive real USD return
            mu = 0.0001
            sigma = 0.015

        stock_params[symbol] = {
            "value_usd": float(current_usd),
            "mu": mu,
            "sigma": sigma,
        }

    if not stock_params or total_value_usd <= 0:
        return {"error": "no_price_data", "percentiles": {}}

    # 4. Compute weights
    tv = float(total_value_usd)
    weights = {sym: p["value_usd"] / tv for sym, p in stock_params.items()}

    # 5. Run Monte Carlo simulations in real USD terms.
    # Each step: portfolio USD return = weighted GBM stock return in USD.
    # BCV devaluation is already baked into mu (returns are USD-adjusted).
    dt = 1.0
    random.seed(42)
    dca = max(0.0, dca_monthly_usd)
    trading_days_per_month = 21  # approximate

    all_paths: list[list[float]] = []
    for _ in range(simulations):
        path_value = tv
        path = [path_value]
        for day in range(1, horizon + 1):
            # Apply GBM return for this day
            port_log_return = 0.0
            for sym, w in weights.items():
                p = stock_params[sym]
                mu_i = p["mu"]
                sigma_i = p["sigma"]
                z = random.gauss(0, 1)
                log_ret = (mu_i - 0.5 * sigma_i ** 2) * dt + sigma_i * math.sqrt(dt) * z
                port_log_return += w * log_ret
            path_value = path_value * math.exp(port_log_return)
            # Add monthly DCA contribution at end of each ~21-day period
            if dca > 0 and day % trading_days_per_month == 0:
                path_value += dca
            path.append(path_value)
        all_paths.append(path)

    total_contributed = tv + dca * (horizon // trading_days_per_month)

    # 6. Compute percentiles at each time step
    def percentile(data: list[float], pct: float) -> float:
        sorted_d = sorted(data)
        idx = (pct / 100) * (len(sorted_d) - 1)
        lo, hi = int(idx), min(int(idx) + 1, len(sorted_d) - 1)
        return sorted_d[lo] + (sorted_d[hi] - sorted_d[lo]) * (idx - lo)

    p5, p25, p50, p75, p95 = [], [], [], [], []
    for t in range(horizon + 1):
        vals_at_t = [path[t] for path in all_paths]
        p5.append(round(percentile(vals_at_t, 5), 2))
        p25.append(round(percentile(vals_at_t, 25), 2))
        p50.append(round(percentile(vals_at_t, 50), 2))
        p75.append(round(percentile(vals_at_t, 75), 2))
        p95.append(round(percentile(vals_at_t, 95), 2))

    ann_bcv_deval_pct = round((math.exp(mu_bcv * 252) - 1) * 100, 1)

    # ── Kelly Fraction from Monte Carlo outcomes ───────────────────────────
    # Uses the distribution of simulated final portfolio values to compute the
    # Kelly-optimal position-size fraction (then halved for safety).
    final_vals   = [path[-1] for path in all_paths]
    wins         = [v for v in final_vals if v > tv]
    losses       = [v for v in final_vals if v <= tv]
    mc_win_rate  = len(wins) / len(final_vals) if final_vals else 0.5
    mc_avg_gain  = (sum((v - tv) / tv for v in wins) / len(wins))   if wins   else 0.0
    mc_avg_loss  = (sum((tv - v) / tv for v in losses) / len(losses)) if losses else 0.01
    mc_b         = mc_avg_gain / mc_avg_loss if mc_avg_loss > 0 else 0
    mc_kelly     = ((mc_win_rate * mc_b - (1 - mc_win_rate)) / mc_b) if mc_b > 0 else 0
    mc_half_kelly = round(max(0.0, min(1.0, mc_kelly / 2)), 3)

    kelly_data = {
        "win_rate_pct":          round(mc_win_rate * 100, 1),
        "avg_gain_pct":          round(mc_avg_gain * 100, 2),
        "avg_loss_pct":          round(mc_avg_loss * 100, 2),
        "kelly_full":            round(max(0, mc_kelly), 3),
        "kelly_half":            mc_half_kelly,
        "suggested_allocation_pct": round(mc_half_kelly * 100, 1),
        "risk_assessment": (
            "CONSERVADOR — Riesgo < 10% del capital"  if mc_half_kelly < 0.10 else
            "MODERADO — Riesgo 10-25% del capital"    if mc_half_kelly < 0.25 else
            "AGRESIVO — Riesgo 25-50% del capital"    if mc_half_kelly < 0.50 else
            "MUY AGRESIVO — Riesgo > 50% del capital"
        ),
        "interpretation": (
            f"Con base en {simulations} simulaciones Monte Carlo, el portafolio "
            f"tiene {round(mc_win_rate*100,1)}% de probabilidad de ser rentable en {horizon} días. "
            f"La F de Kelly recomienda arriesgar el {round(mc_half_kelly*100,1)}% del capital disponible "
            f"para maximizar el crecimiento geométrico sin arruinarse."
        ),
    }

    return {
        "initial_value_usd": round(tv, 2),
        "total_contributed_usd": round(total_contributed, 2),
        "dca_monthly_usd": round(dca, 2),
        "horizon_days": horizon,
        "simulations": simulations,
        "bcv_rate": float(bcv),
        "bcv_annual_deval_pct": ann_bcv_deval_pct,
        "returns_in_usd": True,
        "stocks": [
            {
                "symbol": sym,
                "weight_pct": round(weights[sym] * 100, 1),
                "mu_daily": round(stock_params[sym]["mu"], 6),
                "sigma_daily": round(stock_params[sym]["sigma"], 6),
            }
            for sym in stock_params
        ],
        "percentiles": {
            "p5": p5,
            "p25": p25,
            "p50": p50,
            "p75": p75,
            "p95": p95,
        },
        "kelly": kelly_data,
    }


# ── Commission Summary ─────────────────────────────────────────────────────────

@router.get("/commission-summary")
async def get_commission_summary(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Calcula el peso real de comisiones, IVA y derechos de registro sobre
    todas las transacciones del usuario, tanto por tipo (compra/venta) como
    por acción.  Devuelve además el cálculo neto: lo que el inversor realmente
    recibió/pagó después de costos.
    """
    txs_r = await db.execute(
        select(Transaction).where(Transaction.user_id == user_id)
        .order_by(Transaction.transaction_date)
    )
    transactions = txs_r.scalars().all()
    if not transactions:
        return {"total": {}, "by_stock": [], "by_type": {}}

    # stock names
    sids = list({tx.stock_id for tx in transactions if tx.stock_id})
    stocks_map: dict[int, Stock] = {}
    if sids:
        sr = await db.execute(select(Stock).where(Stock.id.in_(sids)))
        stocks_map = {s.id: s for s in sr.scalars().all()}

    # latest BCV
    bcv_r = await db.execute(select(BcvRate).order_by(BcvRate.rate_date.desc()).limit(1))
    bcv_row = bcv_r.scalar_one_or_none()
    bcv = float(bcv_row.rate) if bcv_row else 36.0

    totals = {
        "gross_bs": 0.0, "commission_bs": 0.0, "iva_bs": 0.0,
        "registry_fee_bs": 0.0, "net_bs": 0.0,
        "gross_usd": 0.0, "total_cost_bs": 0.0, "total_cost_usd": 0.0,
        "buy_gross_bs": 0.0, "buy_cost_bs": 0.0,
        "sell_gross_bs": 0.0, "sell_cost_bs": 0.0,
    }
    by_stock: dict[str, dict] = {}
    by_type = {"Compra": {"gross_bs": 0.0, "cost_bs": 0.0, "count": 0},
               "Venta":  {"gross_bs": 0.0, "cost_bs": 0.0, "count": 0}}

    for tx in transactions:
        stock = stocks_map.get(tx.stock_id) if tx.stock_id else None
        symbol = stock.symbol if stock else "???"

        gross    = float(tx.gross_amount    or 0)
        comm     = float(tx.commission      or 0)
        iva      = float(tx.iva             or 0)
        reg_fee  = float(tx.registry_fee    or 0)
        net      = float(tx.net_amount      or 0)
        cost     = comm + iva + reg_fee

        totals["gross_bs"]       += gross
        totals["commission_bs"]  += comm
        totals["iva_bs"]         += iva
        totals["registry_fee_bs"] += reg_fee
        totals["net_bs"]         += net if tx.order_type == "Compra" else -net
        totals["total_cost_bs"]  += cost

        if tx.order_type == "Compra":
            totals["buy_gross_bs"] += gross
            totals["buy_cost_bs"]  += cost
        else:
            totals["sell_gross_bs"] += gross
            totals["sell_cost_bs"]  += cost

        t = tx.order_type if tx.order_type in by_type else "Compra"
        by_type[t]["gross_bs"] += gross
        by_type[t]["cost_bs"]  += cost
        by_type[t]["count"]    += 1

        if symbol not in by_stock:
            by_stock[symbol] = {
                "symbol": symbol, "name": stock.name if stock else symbol,
                "gross_bs": 0.0, "commission_bs": 0.0, "iva_bs": 0.0,
                "registry_fee_bs": 0.0, "total_cost_bs": 0.0,
                "buy_count": 0, "sell_count": 0,
            }
        s = by_stock[symbol]
        s["gross_bs"]       += gross
        s["commission_bs"]  += comm
        s["iva_bs"]         += iva
        s["registry_fee_bs"] += reg_fee
        s["total_cost_bs"]  += cost
        if tx.order_type == "Compra": s["buy_count"] += 1
        else: s["sell_count"] += 1

    # Enrich with pct and USD
    gross_total = totals["gross_bs"] or 1
    totals["total_cost_usd"] = round(totals["total_cost_bs"] / bcv, 4)
    totals["cost_pct"] = round(totals["total_cost_bs"] / gross_total * 100, 3)

    by_stock_list = []
    for s in sorted(by_stock.values(), key=lambda x: x["total_cost_bs"], reverse=True):
        g = s["gross_bs"] or 1
        s["cost_pct"]   = round(s["total_cost_bs"] / g * 100, 3)
        s["cost_usd"]   = round(s["total_cost_bs"] / bcv, 4)
        by_stock_list.append({k: round(v, 2) if isinstance(v, float) else v for k, v in s.items()})

    for t in by_type.values():
        g = t["gross_bs"] or 1
        t["cost_pct"] = round(t["cost_bs"] / g * 100, 3)

    return {
        "total": {k: round(v, 2) if isinstance(v, float) else v for k, v in totals.items()},
        "by_stock": by_stock_list,
        "by_type": by_type,
        "bcv_rate": bcv,
    }


# ── ISLR Estimator ─────────────────────────────────────────────────────────────

@router.get("/islr-estimate")
async def get_islr_estimate(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Estima la obligación ISLR sobre ganancias de capital realizadas.
    Usa tarifas Venezuela para persona natural (Tarifas 1 - Art. 50 LISLR).
    UT referencial: 9 Bs (valor orientativo, actualizar según Gaceta).
    """
    import math

    # Fetch transactions
    txs_r = await db.execute(
        select(Transaction).where(Transaction.user_id == user_id)
        .order_by(Transaction.transaction_date)
    )
    txs = txs_r.scalars().all()
    if not txs:
        return {"realized_gain_usd": 0, "islr_usd": 0, "breakdown": []}

    # Stock map
    sids = list({tx.stock_id for tx in txs if tx.stock_id})
    stocks_map = {}
    if sids:
        sr = await db.execute(select(Stock).where(Stock.id.in_(sids)))
        stocks_map = {s.id: s for s in sr.scalars().all()}

    # BCV
    bcv_r = await db.execute(select(BcvRate).order_by(BcvRate.rate_date.desc()).limit(1))
    bcv_row = bcv_r.scalar_one_or_none()
    bcv = float(bcv_row.rate) if bcv_row else 36.0

    # WAC realized gain per symbol
    running: dict[str, dict] = {}
    realized_by_symbol: dict[str, float] = {}
    total_realized_usd = 0.0

    for tx in txs:
        stock = stocks_map.get(tx.stock_id) if tx.stock_id else None
        symbol = stock.symbol if stock else "???"
        val_usd = float(tx.amount_usd or 0)

        if symbol not in running:
            running[symbol] = {"qty": 0.0, "cost": 0.0}

        if tx.order_type == "Compra":
            running[symbol]["qty"]  += tx.quantity
            running[symbol]["cost"] += val_usd
        else:
            prev = running[symbol]
            if prev["qty"] > 0:
                unit_cost = prev["cost"] / prev["qty"]
                qty_sold  = min(tx.quantity, prev["qty"])
                gain      = val_usd - (unit_cost * qty_sold)
                realized_by_symbol[symbol] = realized_by_symbol.get(symbol, 0.0) + gain
                total_realized_usd += gain
                prev["cost"] -= unit_cost * qty_sold
                prev["qty"]  -= qty_sold

    if total_realized_usd <= 0:
        return {
            "realized_gain_usd": round(total_realized_usd, 2),
            "realized_gain_bs": round(total_realized_usd * bcv, 2),
            "islr_usd": 0.0, "islr_bs": 0.0,
            "effective_rate_pct": 0.0,
            "by_symbol": [],
            "note": "Sin ganancias realizadas. No hay obligación ISLR estimada.",
        }

    # Venezuela ISLR Tarifa 1 – Persona Natural (en UT)
    # Tramos orientativos (UT actualizados a 2024):
    # 0–1000 UT: 6%, 1001–1500 UT: 9%, 1501–2000 UT: 12%,
    # 2001–2500 UT: 16%, 2501–3000 UT: 20%, 3001–4000 UT: 24%,
    # 4001–6000 UT: 29%, >6000 UT: 34%
    UT_VALUE_BS = 9.0  # Bs por UT (valor referencial — actualizar según Gaceta)
    UT_VALUE_USD = UT_VALUE_BS / bcv

    gain_in_ut = total_realized_usd / UT_VALUE_USD

    brackets = [
        (1000, 0.06), (500, 0.09), (500, 0.12), (500, 0.16),
        (500, 0.20), (1000, 0.24), (2000, 0.29), (float("inf"), 0.34),
    ]

    islr_usd = 0.0
    breakdown = []
    remaining = gain_in_ut

    for width, rate in brackets:
        if remaining <= 0:
            break
        taxable_ut = min(remaining, width)
        taxable_usd = taxable_ut * UT_VALUE_USD
        tax = taxable_usd * rate
        islr_usd += tax
        breakdown.append({
            "tramo_ut": f"hasta {int(taxable_ut)} UT",
            "rate_pct": round(rate * 100, 0),
            "taxable_usd": round(taxable_usd, 2),
            "tax_usd": round(tax, 2),
        })
        remaining -= taxable_ut

    effective_rate = (islr_usd / total_realized_usd * 100) if total_realized_usd > 0 else 0

    by_symbol = [
        {
            "symbol": sym,
            "realized_gain_usd": round(gain, 2),
            "realized_gain_bs": round(gain * bcv, 2),
            "is_gain": gain > 0,
        }
        for sym, gain in sorted(realized_by_symbol.items(), key=lambda x: x[1], reverse=True)
    ]

    return {
        "realized_gain_usd": round(total_realized_usd, 2),
        "realized_gain_bs": round(total_realized_usd * bcv, 2),
        "gain_in_ut": round(gain_in_ut, 2),
        "ut_value_bs": UT_VALUE_BS,
        "ut_value_usd": round(UT_VALUE_USD, 6),
        "islr_usd": round(islr_usd, 2),
        "islr_bs": round(islr_usd * bcv, 2),
        "effective_rate_pct": round(effective_rate, 2),
        "breakdown": breakdown,
        "by_symbol": by_symbol,
        "bcv_rate": bcv,
        "disclaimer": "Estimación orientativa. Consulta con un contador autorizado. UT referencial Bs 9.",
    }


# ── Seasonality ────────────────────────────────────────────────────────────────

@router.get("/seasonality")
async def get_seasonality(
    symbol: str,
    db: AsyncSession = Depends(get_db),
    _user_id: UUID = Depends(get_current_user_id),
):
    """
    Analiza cuáles meses del año han sido históricamente alcistas o bajistas
    para una acción usando su historial de precios en la BVC.
    """
    stock_r = await db.execute(select(Stock).where(Stock.symbol == symbol.upper()))
    stock = stock_r.scalar_one_or_none()
    if not stock:
        raise HTTPException(status_code=404, detail=f"Acción {symbol} no encontrada")

    ph_r = await db.execute(
        select(PriceHistory)
        .where(PriceHistory.stock_id == stock.id)
        .where(PriceHistory.close_price != None)
        .order_by(PriceHistory.price_date.asc())
    )
    rows = ph_r.scalars().all()
    if len(rows) < 20:
        raise HTTPException(status_code=422, detail="Datos insuficientes para análisis estacional")

    # Monthly returns: group by (year, month) → last_close / first_close - 1
    from collections import defaultdict
    monthly_groups: dict[tuple, list] = defaultdict(list)
    for r in rows:
        key = (r.price_date.year, r.price_date.month)
        monthly_groups[key].append(float(r.close_price))

    MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"]
    month_returns: dict[int, list[float]] = defaultdict(list)

    for (year, month), closes in sorted(monthly_groups.items()):
        if len(closes) >= 2:
            ret = (closes[-1] / closes[0] - 1) * 100
            month_returns[month].append(ret)

    seasonality = []
    for m in range(1, 13):
        rets = month_returns.get(m, [])
        if not rets:
            seasonality.append({
                "month": m, "month_name": MONTHS_ES[m-1],
                "avg_return_pct": None, "positive_years": 0,
                "negative_years": 0, "total_years": 0, "win_rate": None,
            })
            continue
        avg = sum(rets) / len(rets)
        pos = sum(1 for r in rets if r > 0)
        neg = len(rets) - pos
        seasonality.append({
            "month": m,
            "month_name": MONTHS_ES[m-1],
            "avg_return_pct": round(avg, 3),
            "positive_years": pos,
            "negative_years": neg,
            "total_years": len(rets),
            "win_rate": round(pos / len(rets) * 100, 1) if rets else None,
            "best_year_pct": round(max(rets), 2),
            "worst_year_pct": round(min(rets), 2),
        })

    best_month  = max(seasonality, key=lambda x: x["avg_return_pct"] or -999)
    worst_month = min(seasonality, key=lambda x: x["avg_return_pct"] or 999)

    return {
        "symbol": stock.symbol,
        "name": stock.name,
        "data_years": len({k[0] for k in monthly_groups}),
        "seasonality": seasonality,
        "best_month": best_month,
        "worst_month": worst_month,
    }


# ── Backtesting ────────────────────────────────────────────────────────────────

@router.get("/backtest")
async def get_backtest(
    symbol: str,
    months_ago: int = 12,
    amount_bs: float = 10000,
    db: AsyncSession = Depends(get_db),
    _user_id: UUID = Depends(get_current_user_id),
):
    """
    Simula qué hubiera pasado si hubieras comprado 'amount_bs' Bs de
    la acción 'symbol' hace 'months_ago' meses.
    """
    if months_ago < 1 or months_ago > 120:
        raise HTTPException(status_code=400, detail="months_ago debe estar entre 1 y 120")
    if amount_bs <= 0:
        raise HTTPException(status_code=400, detail="amount_bs debe ser positivo")

    stock_r = await db.execute(select(Stock).where(Stock.symbol == symbol.upper()))
    stock = stock_r.scalar_one_or_none()
    if not stock:
        raise HTTPException(status_code=404, detail=f"Acción {symbol} no encontrada")

    # All historical prices sorted ascending
    ph_r = await db.execute(
        select(PriceHistory)
        .where(PriceHistory.stock_id == stock.id)
        .where(PriceHistory.close_price != None)
        .order_by(PriceHistory.price_date.asc())
    )
    rows = ph_r.scalars().all()
    if not rows:
        raise HTTPException(status_code=422, detail="Sin datos históricos para esta acción")

    from datetime import date
    from dateutil.relativedelta import relativedelta

    today = date.today()
    target_date = today - relativedelta(months=months_ago)

    # Find entry price: closest price_date >= target_date
    entry_row = None
    for r in rows:
        if r.price_date >= target_date:
            entry_row = r
            break

    if not entry_row:
        raise HTTPException(status_code=422, detail="Sin datos para la fecha de entrada solicitada")

    exit_row = rows[-1]  # most recent price

    entry_price = float(entry_row.close_price)
    exit_price  = float(exit_row.close_price)

    shares_bought = int(amount_bs / entry_price) if entry_price > 0 else 0
    actual_invested_bs = shares_bought * entry_price
    current_value_bs   = shares_bought * exit_price
    gain_bs            = current_value_bs - actual_invested_bs
    return_pct         = (gain_bs / actual_invested_bs * 100) if actual_invested_bs > 0 else 0

    # BCV rates at entry and exit
    bcv_entry_r = await db.execute(
        select(BcvRate).where(BcvRate.rate_date <= entry_row.price_date)
        .order_by(BcvRate.rate_date.desc()).limit(1)
    )
    bcv_entry_row = bcv_entry_r.scalar_one_or_none()
    bcv_entry = float(bcv_entry_row.rate) if bcv_entry_row else 36.0

    bcv_exit_r = await db.execute(select(BcvRate).order_by(BcvRate.rate_date.desc()).limit(1))
    bcv_exit_row = bcv_exit_r.scalar_one_or_none()
    bcv_exit = float(bcv_exit_row.rate) if bcv_exit_row else bcv_entry

    entry_usd = actual_invested_bs / bcv_entry
    exit_usd  = current_value_bs / bcv_exit
    gain_usd  = exit_usd - entry_usd
    return_usd_pct = (gain_usd / entry_usd * 100) if entry_usd > 0 else 0

    # Price series for chart (monthly frequency)
    from collections import defaultdict as dd
    monthly: dict[str, float] = {}
    for r in rows:
        if r.price_date >= entry_row.price_date:
            key = r.price_date.strftime("%Y-%m")
            monthly[key] = float(r.close_price)  # last of month wins

    chart_series = [{"date": k, "price": v} for k, v in sorted(monthly.items())]

    return {
        "symbol": stock.symbol,
        "name": stock.name,
        "entry_date": entry_row.price_date.isoformat(),
        "exit_date": exit_row.price_date.isoformat(),
        "entry_price_bs": round(entry_price, 4),
        "exit_price_bs": round(exit_price, 4),
        "shares_bought": shares_bought,
        "invested_bs": round(actual_invested_bs, 2),
        "current_value_bs": round(current_value_bs, 2),
        "gain_bs": round(gain_bs, 2),
        "return_pct": round(return_pct, 2),
        "invested_usd": round(entry_usd, 2),
        "current_value_usd": round(exit_usd, 2),
        "gain_usd": round(gain_usd, 2),
        "return_usd_pct": round(return_usd_pct, 2),
        "bcv_entry": bcv_entry,
        "bcv_exit": bcv_exit,
        "chart_series": chart_series,
    }


# ── Liquidity Score ─────────────────────────────────────────────────────────────

@router.get("/liquidity")
async def get_liquidity_score(
    db: AsyncSession = Depends(get_db),
    _user_id: UUID = Depends(get_current_user_id),
):
    """
    Ranking de todas las acciones de la BVC por volumen promedio diario.
    Score 0-100 normalizado. Útil para evaluar qué tan fácil es entrar/salir.
    """
    # Get all stocks that have at least some price history with volume
    stocks_r = await db.execute(select(Stock))
    stocks = stocks_r.scalars().all()

    results = []
    for stock in stocks:
        ph_r = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.stock_id == stock.id)
            .where(PriceHistory.volume != None)
            .where(PriceHistory.volume > 0)
            .order_by(PriceHistory.price_date.desc())
            .limit(90)  # last ~3 months
        )
        rows = ph_r.scalars().all()
        if not rows:
            continue

        volumes = [r.volume for r in rows if r.volume]
        avg_vol  = sum(volumes) / len(volumes)
        max_vol  = max(volumes)
        trading_days = len(rows)

        # Last close price
        ph_last = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.stock_id == stock.id)
            .where(PriceHistory.close_price != None)
            .order_by(PriceHistory.price_date.desc())
            .limit(1)
        )
        last_row = ph_last.scalar_one_or_none()
        last_price = float(last_row.close_price) if last_row else None
        last_date  = last_row.price_date.isoformat() if last_row else None

        results.append({
            "symbol": stock.symbol,
            "name": stock.name,
            "avg_volume": round(avg_vol),
            "max_volume": round(max_vol),
            "trading_days_90d": trading_days,
            "last_price_bs": last_price,
            "last_date": last_date,
        })

    if not results:
        return {"stocks": [], "note": "Sin datos de volumen disponibles"}

    # Normalize score 0-100
    max_avg = max(r["avg_volume"] for r in results) or 1
    for r in results:
        r["liquidity_score"] = round(r["avg_volume"] / max_avg * 100, 1)

    results.sort(key=lambda x: x["avg_volume"], reverse=True)
    return {"stocks": results, "total": len(results)}


# ── Correlation Matrix ─────────────────────────────────────────────────────────

@router.get("/correlation")
async def get_correlation_matrix(
    months: int = Query(0, description="Meses de historial a usar. 0 = Todo."),
    db: AsyncSession = Depends(get_db),
    user_id: UUID = Depends(get_current_user_id),
):
    """
    Matriz de correlación entre las acciones del portafolio del usuario,
    usando retornos mensuales históricos. Pearson correlation.
    """
    import math

    # Obtener TODAS las acciones del sistema
    stocks_r = await db.execute(select(Stock))
    stocks   = {s.id: s for s in stocks_r.scalars().all()}
    sids = list(stocks.keys())

    if len(sids) < 2:
        return {"symbols": [], "matrix": [], "note": "Datos insuficientes en el mercado"}

    # Get monthly returns per symbol
    from collections import defaultdict
    symbol_monthly_returns: dict[str, dict[str, float]] = {}

    for sid in sids:
        stock = stocks.get(sid)
        if not stock:
            continue
        q = select(PriceHistory).where(PriceHistory.stock_id == sid, PriceHistory.close_price != None)
        if months > 0:
            cutoff = datetime.now(timezone.utc) - timedelta(days=30*months)
            q = q.where(PriceHistory.price_date >= cutoff)
            
        ph_r = await db.execute(q.order_by(PriceHistory.price_date.asc()))
        rows = ph_r.scalars().all()
        if len(rows) < 10:
            continue

        monthly: dict[str, float] = {}
        for r in rows:
            key = r.price_date.strftime("%Y-%m")
            monthly[key] = float(r.close_price)

        sorted_months = sorted(monthly.keys())
        returns: dict[str, float] = {}
        for i in range(1, len(sorted_months)):
            m_prev = sorted_months[i - 1]
            m_curr = sorted_months[i]
            p0 = monthly[m_prev]
            p1 = monthly[m_curr]
            if p0 > 0:
                returns[m_curr] = (p1 / p0 - 1) * 100
        symbol_monthly_returns[stock.symbol] = returns

    symbols_list = sorted(symbol_monthly_returns.keys())
    if len(symbols_list) < 2:
        return {"symbols": [], "matrix": [], "note": "Datos insuficientes para correlación"}
    
    # Enrich symbols with names
    enriched_symbols = []
    for sym in symbols_list:
        stock = next((s for s in stocks.values() if s.symbol == sym), None)
        enriched_symbols.append({"symbol": sym, "name": stock.name if stock else sym})

    # Pearson correlation helper
    def pearson(a: list[float], b: list[float]) -> float | None:
        n = len(a)
        if n < 3:
            return None
        ma = sum(a) / n
        mb = sum(b) / n
        num = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
        da  = math.sqrt(sum((x - ma) ** 2 for x in a))
        db  = math.sqrt(sum((x - mb) ** 2 for x in b))
        if da == 0 or db == 0:
            return None
        return round(num / (da * db), 3)

    matrix = []
    for s1 in symbols_list:
        row = []
        for s2 in symbols_list:
            if s1 == s2:
                row.append(1.0)
            else:
                # Intersección local por cada par
                common_pairwise = sorted(set(symbol_monthly_returns[s1].keys()) & set(symbol_monthly_returns[s2].keys()))
                a = [symbol_monthly_returns[s1][m] for m in common_pairwise]
                b = [symbol_monthly_returns[s2][m] for m in common_pairwise]
                row.append(pearson(a, b))
        matrix.append(row)

    return {
        "symbols": enriched_symbols,
        "matrix": matrix,
        "common_months": 0,
        "note": f"Correlación Pearson {'(Últimos ' + str(months) + ' meses)' if months > 0 else '(Histórico completo)'}",
    }


# ── Sharpe Ratio ───────────────────────────────────────────────────────────────

@router.get("/sharpe")
async def get_sharpe_ratio(
    db: AsyncSession = Depends(get_db),
    user_id: UUID = Depends(get_current_user_id),
):
    """
    Calcula el Ratio de Sharpe del portafolio vs tasa libre de riesgo (inflación BCV referencial).
    Usa retornos mensuales ponderados por peso de cartera actual.
    """
    import math

    # User transactions → portfolio weights
    txs_r = await db.execute(
        select(Transaction).where(Transaction.user_id == user_id).order_by(Transaction.transaction_date)
    )
    txs = txs_r.scalars().all()
    if not txs:
        return {"error": "Sin transacciones registradas"}

    sids = list({tx.stock_id for tx in txs if tx.stock_id})
    stocks_r = await db.execute(select(Stock).where(Stock.id.in_(sids)))
    stocks_map = {s.id: s for s in stocks_r.scalars().all()}

    # WAC current holdings (qty > 0)
    holdings: dict[str, dict] = {}
    running: dict[str, dict] = {}
    for tx in txs:
        stock = stocks_map.get(tx.stock_id)
        if not stock:
            continue
        sym = stock.symbol
        if sym not in running:
            running[sym] = {"qty": 0.0, "cost": 0.0}
        if tx.order_type == "Compra":
            running[sym]["qty"]  += tx.quantity
            running[sym]["cost"] += float(tx.amount_usd or 0)
        else:
            qty_sold = min(tx.quantity, running[sym]["qty"])
            if running[sym]["qty"] > 0:
                running[sym]["cost"] *= (1 - qty_sold / running[sym]["qty"])
            running[sym]["qty"] -= qty_sold

    for sym, data in running.items():
        if data["qty"] > 1e-6:
            holdings[sym] = {"qty": data["qty"], "cost_usd": data["cost"]}

    if not holdings:
        return {"error": "Sin posiciones abiertas"}

    total_cost = sum(h["cost_usd"] for h in holdings.values()) or 1
    weights    = {sym: h["cost_usd"] / total_cost for sym, h in holdings.items()}

    # Monthly returns per symbol
    symbol_returns: dict[str, dict[str, float]] = {}
    for sym in holdings:
        stock = next((s for s in stocks_map.values() if s.symbol == sym), None)
        if not stock:
            continue
        ph_r = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.stock_id == stock.id)
            .where(PriceHistory.close_price != None)
            .order_by(PriceHistory.price_date.asc())
        )
        rows = ph_r.scalars().all()
        if len(rows) < 5:
            continue

        monthly_close: dict[str, float] = {}
        for r in rows:
            key = r.price_date.strftime("%Y-%m")
            monthly_close[key] = float(r.close_price)

        sorted_m = sorted(monthly_close.keys())
        rets: dict[str, float] = {}
        for i in range(1, len(sorted_m)):
            m0, m1 = sorted_m[i-1], sorted_m[i]
            p0 = monthly_close[m0]
            if p0 > 0:
                rets[m1] = (monthly_close[m1] / p0 - 1) * 100
        symbol_returns[sym] = rets

    if not symbol_returns:
        return {"error": "Sin historial de precios suficiente"}

    # Common months
    all_months = set.intersection(*[set(v.keys()) for v in symbol_returns.values()])
    common = sorted(all_months)
    if len(common) < 6:
        return {"error": f"Solo {len(common)} meses comunes. Se necesitan al menos 6."}

    # Weighted portfolio monthly returns
    portfolio_rets = []
    for m in common:
        pr = sum(weights.get(sym, 0) * symbol_returns[sym][m]
                 for sym in symbol_returns if m in symbol_returns[sym])
        portfolio_rets.append(pr)

    mean_monthly = sum(portfolio_rets) / len(portfolio_rets)
    std_monthly  = math.sqrt(sum((r - mean_monthly) ** 2 for r in portfolio_rets) / len(portfolio_rets))

    # Annualized (monthly × 12)
    annualized_return  = mean_monthly * 12
    annualized_vol     = std_monthly * math.sqrt(12)

    # Risk-free rate: Venezuela inflation reference ~200% annual (very high)
    # We'll use 0% as floor (dollar-denominated perspective) and also show vs 180% Bs inflation
    risk_free_usd_pct   = 5.0   # ~US T-bill reference
    risk_free_bs_pct    = 180.0  # Venezuela referential inflation

    sharpe_usd = (annualized_return - risk_free_usd_pct) / annualized_vol if annualized_vol > 0 else None
    sharpe_bs  = (annualized_return - risk_free_bs_pct)  / annualized_vol if annualized_vol > 0 else None

    monthly_chart = [{"month": m, "return_pct": round(r, 3)} for m, r in zip(common, portfolio_rets)]

    per_stock = []
    for sym, rets in symbol_returns.items():
        sym_common = [rets[m] for m in common if m in rets]
        if len(sym_common) < 3:
            continue
        mu  = sum(sym_common) / len(sym_common)
        sig = math.sqrt(sum((r - mu) ** 2 for r in sym_common) / len(sym_common))
        ann_r = mu * 12
        ann_s = sig * math.sqrt(12)
        sr = (ann_r - risk_free_usd_pct) / ann_s if ann_s > 0 else None
        per_stock.append({
            "symbol": sym,
            "weight_pct": round(weights.get(sym, 0) * 100, 1),
            "avg_monthly_return_pct": round(mu, 2),
            "annualized_return_pct": round(ann_r, 2),
            "annualized_volatility_pct": round(ann_s, 2),
            "sharpe_usd": round(sr, 3) if sr is not None else None,
        })

    per_stock.sort(key=lambda x: x["sharpe_usd"] or -999, reverse=True)

    return {
        "months_used": len(common),
        "mean_monthly_return_pct": round(mean_monthly, 3),
        "annualized_return_pct": round(annualized_return, 2),
        "annualized_volatility_pct": round(annualized_vol, 2),
        "sharpe_usd": round(sharpe_usd, 3) if sharpe_usd is not None else None,
        "sharpe_bs_inflation": round(sharpe_bs, 3) if sharpe_bs is not None else None,
        "risk_free_usd_pct": risk_free_usd_pct,
        "risk_free_bs_pct": risk_free_bs_pct,
        "per_stock": per_stock,
        "monthly_chart": monthly_chart,
        "interpretation": (
            "Sharpe > 1: bueno · Sharpe > 2: muy bueno · Sharpe < 0: peor que la tasa libre de riesgo"
        ),
    }


# ── Advanced Metrics: Drawdown, Sortino, Beta, VaR ────────────────────────────

@router.get("/advanced-metrics")
async def get_advanced_metrics(
    symbol: str,
    db: AsyncSession = Depends(get_db),
    _user_id: UUID = Depends(get_current_user_id),
):
    """
    Calcula métricas avanzadas para una acción:
    - Max Drawdown (caída máxima desde pico)
    - Sortino Ratio (penaliza sólo volatilidad negativa)
    - CAGR (tasa de crecimiento anual compuesta)
    - VaR 95% mensual (Valor en Riesgo)
    - Volatilidad anualizada
    - Retorno acumulado total
    """
    import math

    stock_r = await db.execute(select(Stock).where(Stock.symbol == symbol.upper()))
    stock = stock_r.scalar_one_or_none()
    if not stock:
        raise HTTPException(status_code=404, detail=f"Acción {symbol} no encontrada")

    ph_r = await db.execute(
        select(PriceHistory)
        .where(PriceHistory.stock_id == stock.id)
        .where(PriceHistory.close_price != None)
        .order_by(PriceHistory.price_date.asc())
    )
    rows = ph_r.scalars().all()
    if len(rows) < 20:
        raise HTTPException(status_code=422, detail="Datos insuficientes para análisis")

    closes = [float(r.close_price) for r in rows]
    dates  = [r.price_date.isoformat() for r in rows]

    # Monthly returns
    from collections import defaultdict
    monthly_groups: dict[str, list] = defaultdict(list)
    for r in rows:
        key = r.price_date.strftime("%Y-%m")
        monthly_groups[key].append(float(r.close_price))

    sorted_months = sorted(monthly_groups.keys())
    monthly_returns: list[float] = []
    monthly_labels:  list[str]   = []
    for i in range(1, len(sorted_months)):
        m_prev = sorted_months[i - 1]
        m_curr = sorted_months[i]
        p0 = monthly_groups[m_prev][-1]
        p1 = monthly_groups[m_curr][-1]
        if p0 > 0:
            ret = (p1 / p0 - 1) * 100
            monthly_returns.append(ret)
            monthly_labels.append(m_curr)

    if len(monthly_returns) < 3:
        raise HTTPException(status_code=422, detail="Datos mensuales insuficientes")

    # ── Max Drawdown ─────────────────────────────────────────────────────────
    peak = closes[0]
    max_dd = 0.0
    peak_date = dates[0]
    trough_date = dates[0]
    curr_peak_date = dates[0]

    for i, price in enumerate(closes):
        if price > peak:
            peak = price
            curr_peak_date = dates[i]
        dd = (price - peak) / peak * 100
        if dd < max_dd:
            max_dd = dd
            peak_date = curr_peak_date
            trough_date = dates[i]

    # ── CAGR ─────────────────────────────────────────────────────────────────
    years = len(rows) / 252  # trading days
    if years > 0 and closes[0] > 0:
        cagr_pct = ((closes[-1] / closes[0]) ** (1 / years) - 1) * 100
    else:
        cagr_pct = 0.0

    total_return_pct = (closes[-1] / closes[0] - 1) * 100 if closes[0] > 0 else 0.0

    # ── Sortino ──────────────────────────────────────────────────────────────
    risk_free_monthly = 5.0 / 12  # 5% annual T-bill → monthly
    excess_returns = [r - risk_free_monthly for r in monthly_returns]
    mean_excess = sum(excess_returns) / len(excess_returns)
    downside_returns = [r for r in excess_returns if r < 0]
    if downside_returns:
        downside_dev_monthly = math.sqrt(sum(r**2 for r in downside_returns) / len(downside_returns))
        downside_dev_annual  = downside_dev_monthly * math.sqrt(12)
        mean_excess_annual   = mean_excess * 12
        sortino = mean_excess_annual / downside_dev_annual if downside_dev_annual > 0 else None
    else:
        sortino = None

    # ── Volatility ───────────────────────────────────────────────────────────
    mean_ret = sum(monthly_returns) / len(monthly_returns)
    variance = sum((r - mean_ret) ** 2 for r in monthly_returns) / len(monthly_returns)
    vol_monthly = math.sqrt(variance)
    vol_annual  = vol_monthly * math.sqrt(12)

    # ── VaR 95% ──────────────────────────────────────────────────────────────
    sorted_rets = sorted(monthly_returns)
    var_95_idx = int(len(sorted_rets) * 0.05)
    var_95 = sorted_rets[var_95_idx] if var_95_idx < len(sorted_rets) else sorted_rets[0]

    # ── Calmar Ratio (CAGR / |Max Drawdown|) ─────────────────────────────────
    calmar = cagr_pct / abs(max_dd) if max_dd < 0 else None

    # ── Heatmap: monthly return matrix (year × month) ─────────────────────────
    heatmap: dict[int, dict[int, float]] = {}
    for r in rows:
        yr = r.price_date.year
        mo = r.price_date.month
        if yr not in heatmap:
            heatmap[yr] = {}
        heatmap[yr][mo] = float(r.close_price)

    MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"]
    heatmap_rows = []
    years_list   = sorted(heatmap.keys())
    for yr in years_list:
        row_data = {"year": yr, "months": []}
        prices_by_month = heatmap[yr]
        for mo in range(1, 13):
            if mo in prices_by_month:
                # Find previous month's last close
                prev_mo = mo - 1
                prev_yr = yr
                if prev_mo == 0:
                    prev_mo = 12
                    prev_yr = yr - 1
                prev_price = heatmap.get(prev_yr, {}).get(prev_mo)
                curr_price = prices_by_month[mo]
                if prev_price and prev_price > 0:
                    ret = (curr_price / prev_price - 1) * 100
                    row_data["months"].append({"month": MONTHS_ES[mo - 1], "return_pct": round(ret, 2)})
                else:
                    row_data["months"].append({"month": MONTHS_ES[mo - 1], "return_pct": None})
            else:
                row_data["months"].append({"month": MONTHS_ES[mo - 1], "return_pct": None})
        heatmap_rows.append(row_data)

    return {
        "symbol": stock.symbol,
        "name": stock.name,
        "data_years": round(years, 2),
        "total_return_pct": round(total_return_pct, 2),
        "cagr_pct": round(cagr_pct, 2),
        "max_drawdown_pct": round(max_dd, 2),
        "max_drawdown_peak_date": peak_date,
        "max_drawdown_trough_date": trough_date,
        "vol_monthly_pct": round(vol_monthly, 2),
        "vol_annual_pct": round(vol_annual, 2),
        "sortino_ratio": round(sortino, 3) if sortino is not None else None,
        "calmar_ratio": round(calmar, 3) if calmar is not None else None,
        "var_95_monthly_pct": round(var_95, 2),
        "monthly_returns": [{"month": m, "return_pct": round(r, 2)} for m, r in zip(monthly_labels, monthly_returns)],
        "heatmap": heatmap_rows,
        "heatmap_months": MONTHS_ES,
        "first_date": dates[0],
        "last_date": dates[-1],
        "first_price_bs": round(closes[0], 4),
        "last_price_bs": round(closes[-1], 4),
    }


@router.get("/drawdown-history")
async def get_drawdown_history(
    symbol: str,
    db: AsyncSession = Depends(get_db),
    _user_id: UUID = Depends(get_current_user_id),
):
    """Serie de drawdown histórico (%) para graficar la caída desde máximos."""
    stock_r = await db.execute(select(Stock).where(Stock.symbol == symbol.upper()))
    stock = stock_r.scalar_one_or_none()
    if not stock:
        raise HTTPException(status_code=404, detail=f"Acción {symbol} no encontrada")

    ph_r = await db.execute(
        select(PriceHistory)
        .where(PriceHistory.stock_id == stock.id)
        .where(PriceHistory.close_price != None)
        .order_by(PriceHistory.price_date.asc())
    )
    rows = ph_r.scalars().all()
    if len(rows) < 5:
        raise HTTPException(status_code=422, detail="Datos insuficientes")

    peak = float(rows[0].close_price)
    series = []
    for r in rows:
        price = float(r.close_price)
        if price > peak:
            peak = price
        dd = (price - peak) / peak * 100 if peak > 0 else 0
        series.append({"date": r.price_date.isoformat(), "drawdown_pct": round(dd, 3)})

    return {"symbol": stock.symbol, "series": series}


# ── Rebalancing ────────────────────────────────────────────────────────────────

from pydantic import BaseModel as PydanticBaseModel
from typing import Dict as TypingDict

class RebalanceRequest(PydanticBaseModel):
    """
    Mapa símbolo → porcentaje objetivo (0-100).
    Ejemplo: {"ALZ.B": 40, "BNC": 30, "MVZ.A": 30}
    La suma debe ser ≈ 100.
    """
    targets: TypingDict[str, float]


@router.post("/rebalance")
async def get_rebalance_suggestions(
    body: RebalanceRequest,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Dado un objetivo de asignación (% por símbolo), calcula cuánto comprar/vender
    de cada acción para alcanzarlo basado en el portafolio actual del usuario.
    """
    targets = body.targets
    if not targets:
        raise HTTPException(status_code=400, detail="Debes indicar al menos un símbolo objetivo")

    total_target = sum(targets.values())
    if not (95.0 <= total_target <= 105.0):
        raise HTTPException(
            status_code=400,
            detail=f"La suma de porcentajes objetivo debe ser ~100% (recibido: {total_target:.1f}%)"
        )

    # 1. Current portfolio
    txs_r = await db.execute(
        select(Transaction).where(Transaction.user_id == user_id).order_by(Transaction.transaction_date)
    )
    txs = txs_r.scalars().all()
    if not txs:
        raise HTTPException(status_code=422, detail="Sin transacciones en el portafolio")

    sids = list({tx.stock_id for tx in txs if tx.stock_id})
    stocks_r = await db.execute(select(Stock).where(Stock.id.in_(sids)))
    stocks_map = {s.id: s for s in stocks_r.scalars().all()}

    bcv_r = await db.execute(select(BcvRate).order_by(BcvRate.rate_date.desc()).limit(1))
    bcv_row = bcv_r.scalar_one_or_none()
    bcv = float(bcv_row.rate) if bcv_row else 36.0

    # Net qty per symbol
    net_qty: dict[str, int] = {}
    sym_to_stock: dict[str, Stock] = {}
    for tx in txs:
        stock = stocks_map.get(tx.stock_id) if tx.stock_id else None
        if not stock:
            continue
        sym_to_stock[stock.symbol] = stock
        delta = tx.quantity if tx.order_type == "Compra" else -tx.quantity
        net_qty[stock.symbol] = net_qty.get(stock.symbol, 0) + delta

    open_positions = {sym: qty for sym, qty in net_qty.items() if qty > 0}
    if not open_positions:
        raise HTTPException(status_code=422, detail="Sin posiciones abiertas")

    # Current values in USD
    current_values_usd: dict[str, float] = {}
    current_prices_bs: dict[str, float] = {}
    for sym, qty in open_positions.items():
        stock = sym_to_stock.get(sym)
        if stock and stock.last_price and float(stock.last_price) > 0:
            price_bs = float(stock.last_price)
        else:
            # Fallback to latest price history
            ph_r = await db.execute(
                select(PriceHistory.close_price)
                .where(PriceHistory.stock_id == sym_to_stock[sym].id)
                .order_by(PriceHistory.price_date.desc())
                .limit(1)
            )
            ph_val = ph_r.scalar_one_or_none()
            price_bs = float(ph_val) if ph_val else 0.0

        current_prices_bs[sym] = price_bs
        current_values_usd[sym] = (price_bs / bcv * qty) if bcv > 0 else 0.0

    # Total portfolio value
    total_value_usd = sum(current_values_usd.values())
    if total_value_usd <= 0:
        raise HTTPException(status_code=422, detail="No se pudo calcular el valor del portafolio")

    # Also consider symbols in target that aren't currently held (new buys)
    all_symbols = set(list(open_positions.keys()) + list(targets.keys()))

    # Normalize targets to fraction
    target_fractions = {sym: pct / 100.0 for sym, pct in targets.items()}

    # Build suggestions
    suggestions = []
    for sym in sorted(all_symbols):
        target_frac   = target_fractions.get(sym, 0.0)
        target_usd    = total_value_usd * target_frac
        current_usd   = current_values_usd.get(sym, 0.0)
        current_qty   = open_positions.get(sym, 0)
        current_alloc = (current_usd / total_value_usd * 100) if total_value_usd > 0 else 0.0

        diff_usd = target_usd - current_usd

        # Shares to buy/sell
        price_bs  = current_prices_bs.get(sym, 0.0)
        price_usd = price_bs / bcv if bcv > 0 and price_bs > 0 else 0.0

        if price_usd > 0:
            shares_delta = diff_usd / price_usd
        else:
            shares_delta = 0.0

        if abs(shares_delta) < 0.5:
            action = "mantener"
        elif shares_delta > 0:
            action = "comprar"
        else:
            action = "vender"

        stock = sym_to_stock.get(sym)
        suggestions.append({
            "symbol": sym,
            "name": stock.name if stock else sym,
            "current_qty": current_qty,
            "current_value_usd": round(current_usd, 2),
            "current_alloc_pct": round(current_alloc, 2),
            "target_alloc_pct": round(target_frac * 100, 2),
            "target_value_usd": round(target_usd, 2),
            "diff_usd": round(diff_usd, 2),
            "shares_delta": round(shares_delta),
            "price_bs": round(price_bs, 4),
            "price_usd": round(price_usd, 6),
            "action": action,
        })

    # Summary
    suggestions.sort(key=lambda x: abs(x["diff_usd"]), reverse=True)

    return {
        "total_portfolio_usd": round(total_value_usd, 2),
        "bcv_rate": bcv,
        "suggestions": suggestions,
        "note": "Sugerencia orientativa. Los montos no incluyen comisiones. Verifica precios antes de operar.",
    }


# ──────────────────────────────────────────────────────────────────────────────
# CANDLE HEATMAP (day-of-week statistics)
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/candle-heatmap")
async def get_candle_heatmap(
    symbol: str = Query(..., description="Símbolo de la acción"),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Mapa de calor de velas por día de la semana.
    Retorna estadísticas (retorno prom, win rate, rango, volumen) agrupadas por Lun–Vie.
    """
    try:
        from collections import defaultdict

        stock_q = await db.execute(select(Stock).where(func.upper(Stock.symbol) == symbol.upper()))
        stock = stock_q.scalar_one_or_none()
        if not stock:
            raise HTTPException(status_code=404, detail=f"Acción {symbol} no encontrada")

        ph_q = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.stock_id == stock.id)
            .order_by(PriceHistory.price_date.asc())
        )
        history = ph_q.scalars().all()
        if len(history) < 10:
            raise HTTPException(status_code=422, detail="Datos insuficientes para el análisis (< 10 velas)")

        DOW_NAMES = {0: "Lunes", 1: "Martes", 2: "Miércoles", 3: "Jueves", 4: "Viernes"}

        buckets: dict[int, list] = defaultdict(list)
        for ph in history:
            if ph.open_price and ph.open_price > 0 and ph.close_price and ph.high_price and ph.low_price:
                dow = ph.price_date.weekday()  # 0=Mon … 4=Fri
                if dow > 4:
                    continue
                ret = (ph.close_price - ph.open_price) / ph.open_price * 100
                rng = (ph.high_price - ph.low_price) / ph.open_price * 100
                buckets[dow].append({
                    "ret": float(ret),
                    "rng": float(rng),
                    "vol": float(ph.volume or 0),
                })

        if not buckets:
            raise HTTPException(status_code=422, detail="Sin datos OHLC suficientes")

        total_candles = len(history)
        if len(history) >= 2:
            delta_days = (history[-1].price_date - history[0].price_date).days
            data_years = delta_days / 365.25
        else:
            data_years = 0.0

        days_out = []
        for dow in range(5):
            pts = buckets.get(dow, [])
            if not pts:
                days_out.append({
                    "dow": dow, "dow_name": DOW_NAMES[dow],
                    "candle_count": 0, "avg_return_pct": 0.0,
                    "win_rate": 50.0, "avg_range_pct": 0.0, "avg_volume": 0.0,
                    "is_best_return": False, "is_worst_return": False,
                })
                continue
            avg_ret = sum(p["ret"] for p in pts) / len(pts)
            win_rate = sum(1 for p in pts if p["ret"] > 0) / len(pts) * 100
            avg_rng = sum(p["rng"] for p in pts) / len(pts)
            avg_vol = sum(p["vol"] for p in pts) / len(pts)
            days_out.append({
                "dow": dow, "dow_name": DOW_NAMES[dow],
                "candle_count": len(pts),
                "avg_return_pct": round(avg_ret, 4),
                "win_rate": round(win_rate, 1),
                "avg_range_pct": round(avg_rng, 4),
                "avg_volume": round(avg_vol, 0),
                "is_best_return": False,
                "is_worst_return": False,
            })

        valid = [d for d in days_out if d["candle_count"] >= 5]
        if valid:
            best  = max(valid, key=lambda d: d["avg_return_pct"])
            worst = min(valid, key=lambda d: d["avg_return_pct"])
            best["is_best_return"]  = True
            worst["is_worst_return"] = True

        return {
            "symbol": stock.symbol,
            "name": stock.name,
            "total_candles": total_candles,
            "data_years": round(data_years, 2),
            "days": days_out,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculando heatmap de velas: {str(e)}")


# ── Rolling Correlation (30d vs 252d) + Pairs Trading Divergence ──────────────

@router.get("/rolling-correlation")
async def get_rolling_correlation(
    window: int = Query(30, ge=5, le=120, description="Ventana corta en días (default 30)"),
    long_window: int = Query(252, ge=30, le=756, description="Ventana larga en días (default 252)"),
    db: AsyncSession = Depends(get_db),
    user_id: UUID = Depends(get_current_user_id),
):
    """
    Correlación rodante entre acciones del portafolio del usuario.
    Detecta 'divorcios' de correlación → señal de Pairs Trading.
    """
    import math

    # Build user open positions
    txs_r = await db.execute(
        select(Transaction).where(Transaction.user_id == user_id).order_by(Transaction.transaction_date)
    )
    transactions = txs_r.scalars().all()
    if not transactions:
        raise HTTPException(status_code=422, detail="Sin posiciones en el portafolio")

    all_sids = list({tx.stock_id for tx in transactions if tx.stock_id})
    stocks_map: dict = {}
    if all_sids:
        sr = await db.execute(select(Stock).where(Stock.id.in_(all_sids)))
        stocks_map = {s.id: s for s in sr.scalars().all()}

    net_qty: dict[str, int] = {}
    sym_to_stock: dict[str, Stock] = {}
    for tx in transactions:
        stock = stocks_map.get(tx.stock_id) if tx.stock_id else None
        if not stock:
            continue
        sym_to_stock[stock.symbol] = stock
        delta = tx.quantity if tx.order_type == "Compra" else -tx.quantity
        net_qty[stock.symbol] = net_qty.get(stock.symbol, 0) + delta

    symbols = [s for s, q in net_qty.items() if q > 0]
    if len(symbols) < 2:
        raise HTTPException(status_code=422, detail="Se necesitan al menos 2 posiciones abiertas")

    # Load daily price series per symbol (sorted ascending)
    price_series: dict[str, dict[str, float]] = {}
    for sym in symbols:
        stock = sym_to_stock[sym]
        ph_r = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.stock_id == stock.id, PriceHistory.close_price != None)
            .order_by(PriceHistory.price_date.asc())
        )
        rows = ph_r.scalars().all()
        price_series[sym] = {r.price_date.isoformat(): float(r.close_price) for r in rows}

    # Compute daily returns per symbol
    def daily_returns(prices: dict[str, float]) -> dict[str, float]:
        sorted_dates = sorted(prices.keys())
        rets: dict[str, float] = {}
        for i in range(1, len(sorted_dates)):
            p0 = prices[sorted_dates[i - 1]]
            p1 = prices[sorted_dates[i]]
            if p0 > 0:
                rets[sorted_dates[i]] = (p1 / p0) - 1
        return rets

    returns_series: dict[str, dict[str, float]] = {sym: daily_returns(price_series[sym]) for sym in symbols}

    # Pearson correlation over a list of paired values
    def pearson(a: list, b: list) -> float | None:
        n = len(a)
        if n < 5:
            return None
        ma = sum(a) / n; mb = sum(b) / n
        num = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
        da  = math.sqrt(sum((x - ma) ** 2 for x in a))
        db  = math.sqrt(sum((x - mb) ** 2 for x in b))
        return round(num / (da * db), 3) if da > 0 and db > 0 else None

    pairs_result = []
    for i in range(len(symbols)):
        for j in range(i + 1, len(symbols)):
            s1, s2 = symbols[i], symbols[j]
            r1 = returns_series[s1]
            r2 = returns_series[s2]
            common_all  = sorted(set(r1.keys()) & set(r2.keys()))
            common_short = common_all[-window:]      if len(common_all) >= window     else common_all
            common_long  = common_all[-long_window:] if len(common_all) >= long_window else common_all

            a_s  = [r1[d] for d in common_short]; b_s  = [r2[d] for d in common_short]
            a_l  = [r1[d] for d in common_long];  b_l  = [r2[d] for d in common_long]

            corr_short = pearson(a_s, b_s)
            corr_long  = pearson(a_l, b_l)

            divergence = round(abs((corr_short or 0) - (corr_long or 0)), 3) if corr_short is not None and corr_long is not None else None
            signal = None
            if divergence is not None and corr_long is not None:
                if divergence >= 0.35 and (corr_long or 0) >= 0.5:
                    signal = "DIVERGENCIA_ALTA — Oportunidad Pairs Trading"
                elif divergence >= 0.20 and (corr_long or 0) >= 0.3:
                    signal = "DIVERGENCIA_MODERADA — Vigilar relación"
                elif (corr_short or 0) > 0.6 and (corr_long or 0) > 0.6:
                    signal = "CORRELADOS — Movimiento conjunto"
                elif (corr_short or 0) < -0.3:
                    signal = "INVERSAMENTE_CORRELADOS — Cobertura natural"
                else:
                    signal = "NORMAL — Sin señal especial"

            pairs_result.append({
                "sym_a": s1, "name_a": sym_to_stock[s1].name,
                "sym_b": s2, "name_b": sym_to_stock[s2].name,
                "corr_short":    corr_short,
                "corr_long":     corr_long,
                "window_short":  len(common_short),
                "window_long":   len(common_long),
                "divergence":    divergence,
                "signal":        signal,
            })

    pairs_result.sort(key=lambda p: -(p["divergence"] or 0))

    return {
        "window_short": window,
        "window_long": long_window,
        "pairs": pairs_result,
        "note": f"Correlación {window}d vs {long_window}d. Divergencia > 0.35 indica potencial Pairs Trading.",
    }


# ── Smart Beta Portfolio Optimizer ────────────────────────────────────────────

@router.get("/smart-beta")
async def get_smart_beta(
    db: AsyncSession = Depends(get_db),
    user_id: UUID = Depends(get_current_user_id),
):
    """
    Calcula pesos de Mínima Varianza y Momentum para el portafolio del usuario.
    Sugiere rebalanceo concreto: 'Reduce X en 5% y agrega Y para bajar el VaR 2%'.
    """
    import math

    # Build open positions with current value
    txs_r = await db.execute(
        select(Transaction).where(Transaction.user_id == user_id).order_by(Transaction.transaction_date)
    )
    transactions = txs_r.scalars().all()
    if not transactions:
        raise HTTPException(status_code=422, detail="Sin posiciones en el portafolio")

    all_sids = list({tx.stock_id for tx in transactions if tx.stock_id})
    stocks_map: dict = {}
    if all_sids:
        sr = await db.execute(select(Stock).where(Stock.id.in_(all_sids)))
        stocks_map = {s.id: s for s in sr.scalars().all()}

    net_qty: dict[str, int] = {}
    sym_to_stock: dict[str, Stock] = {}
    for tx in transactions:
        stock = stocks_map.get(tx.stock_id) if tx.stock_id else None
        if not stock:
            continue
        sym_to_stock[stock.symbol] = stock
        delta = tx.quantity if tx.order_type == "Compra" else -tx.quantity
        net_qty[stock.symbol] = net_qty.get(stock.symbol, 0) + delta

    open_syms = [s for s, q in net_qty.items() if q > 0]
    if len(open_syms) < 2:
        raise HTTPException(status_code=422, detail="Se necesitan al menos 2 posiciones abiertas")

    # Current price per symbol and portfolio value
    sym_price: dict[str, float] = {}
    for sym in open_syms:
        stock = sym_to_stock[sym]
        ph_r = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.stock_id == stock.id, PriceHistory.close_price != None)
            .order_by(PriceHistory.price_date.desc()).limit(1)
        )
        last = ph_r.scalar_one_or_none()
        sym_price[sym] = float(last.close_price) if last else 0

    current_values = {sym: net_qty[sym] * sym_price.get(sym, 0) for sym in open_syms}
    total_value = sum(current_values.values())
    if total_value <= 0:
        raise HTTPException(status_code=422, detail="Valor del portafolio es cero")

    current_weights = {sym: current_values[sym] / total_value for sym in open_syms}

    # Load 252d daily returns per symbol
    returns_by_sym: dict[str, list[float]] = {}
    for sym in open_syms:
        stock = sym_to_stock[sym]
        ph_r = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.stock_id == stock.id, PriceHistory.close_price != None)
            .order_by(PriceHistory.price_date.asc())
        )
        rows = ph_r.scalars().all()
        closes = [float(r.close_price) for r in rows[-253:]]
        rets = [(closes[i] - closes[i-1]) / closes[i-1] for i in range(1, len(closes)) if closes[i-1] > 0]
        returns_by_sym[sym] = rets

    # Volatility per symbol (annualised)
    def ann_vol(rets: list[float]) -> float:
        if len(rets) < 5:
            return 1.0
        m = sum(rets) / len(rets)
        std = math.sqrt(sum((r - m) ** 2 for r in rets) / len(rets))
        return std * math.sqrt(252)

    vols = {sym: ann_vol(returns_by_sym[sym]) for sym in open_syms}

    # ── Min-Variance weights (Inverse-Variance Weighting — analytical approx) ──
    inv_var = {sym: 1.0 / (vols[sym] ** 2) if vols[sym] > 0 else 0 for sym in open_syms}
    total_inv_var = sum(inv_var.values())
    minvol_weights = {sym: inv_var[sym] / total_inv_var if total_inv_var > 0 else 1/len(open_syms) for sym in open_syms}

    # ── Momentum weights (6-month return, positive only, normalised) ──────────
    mom_returns: dict[str, float] = {}
    for sym in open_syms:
        rets = returns_by_sym[sym]
        last_126 = rets[-126:] if len(rets) >= 126 else rets
        total_ret = sum(last_126)
        mom_returns[sym] = max(0.0, total_ret)

    total_mom = sum(mom_returns.values())
    if total_mom > 0:
        mom_weights = {sym: mom_returns[sym] / total_mom for sym in open_syms}
    else:
        mom_weights = {sym: 1 / len(open_syms) for sym in open_syms}

    # ── Portfolio VaR (95% parametric) ────────────────────────────────────────
    def portfolio_var(weights_map: dict[str, float]) -> float:
        # Weighted portfolio daily std
        port_variance = 0.0
        for sym in open_syms:
            w = weights_map.get(sym, 0)
            v = vols[sym] / math.sqrt(252)  # daily vol
            port_variance += (w * v) ** 2   # simplified (ignores cross-covariances)
        port_std = math.sqrt(port_variance)
        return port_std * 1.645             # 95% one-tail z-score

    var_current  = portfolio_var(current_weights)
    var_minvol   = portfolio_var(minvol_weights)
    var_momentum = portfolio_var(mom_weights)

    # ── Concrete rebalancing suggestion (min-vol) ─────────────────────────────
    suggestions = []
    for sym in open_syms:
        delta_pct = round((minvol_weights[sym] - current_weights[sym]) * 100, 1)
        if abs(delta_pct) >= 2.0:
            action = "AUMENTAR" if delta_pct > 0 else "REDUCIR"
            suggestions.append({
                "symbol": sym,
                "name": sym_to_stock[sym].name,
                "current_pct":  round(current_weights[sym] * 100, 1),
                "minvol_pct":   round(minvol_weights[sym] * 100, 1),
                "delta_pct":    delta_pct,
                "action":       action,
                "rationale":    f"{action} {sym} en {abs(delta_pct):.1f}% — vol. anual: {round(vols[sym]*100,1)}%",
            })
    suggestions.sort(key=lambda x: abs(x["delta_pct"]), reverse=True)

    var_reduction = round((var_current - var_minvol) / var_current * 100, 1) if var_current > 0 else 0

    return {
        "total_value_bs": round(total_value, 2),
        "stocks": [
            {
                "symbol": sym,
                "name": sym_to_stock[sym].name,
                "current_weight_pct":  round(current_weights[sym] * 100, 1),
                "minvol_weight_pct":   round(minvol_weights[sym] * 100, 1),
                "momentum_weight_pct": round(mom_weights[sym] * 100, 1),
                "annualized_vol_pct":  round(vols[sym] * 100, 1),
                "6m_return_pct":       round(mom_returns[sym] * 100, 1),
            }
            for sym in open_syms
        ],
        "portfolio_var_95": {
            "current_pct":  round(var_current * 100, 2),
            "minvol_pct":   round(var_minvol * 100, 2),
            "momentum_pct": round(var_momentum * 100, 2),
        },
        "var_reduction_if_minvol_pct": var_reduction,
        "rebalancing_suggestions": suggestions[:6],
        "note": "Mín. Varianza usa ponderación por inversa de varianza. Momentum usa retorno 6 meses.",
    }


# ── Historical Stress Test (Crisis Replay) ────────────────────────────────────

STRESS_SCENARIOS = {
    "hyperinflation_2021": {
        "name": "Hiper-Bache Venezuela (Jul–Sep 2021)",
        "start": "2021-07-01",
        "end":   "2021-09-30",
        "description": "Corrección aguda tras el pico hiperinflacionario — BVC cayó hasta 40% en algunos papeles",
    },
    "covid_2020": {
        "name": "Crash COVID-19 (Feb–Abr 2020)",
        "start": "2020-02-15",
        "end":   "2020-04-30",
        "description": "Pandemia global — el pánico bursátil sacudió incluso mercados emergentes aislados como BVC",
    },
    "petro_crash_2015": {
        "name": "Desplome Petróleo WTI (Sep 2014–Mar 2015)",
        "start": "2014-09-01",
        "end":   "2015-03-31",
        "description": "El WTI pasó de $100 a $50. Para Venezuela, una crisis fiscal masiva que comprimió la BVC",
    },
    "bvc_recovery_2022": {
        "name": "Rally Recuperación BVC (Ene–Jun 2022)",
        "start": "2022-01-01",
        "end":   "2022-06-30",
        "description": "Período de mayor crecimiento relativo de la BVC post-hiperinflación",
    },
}


@router.get("/stress-test")
async def get_stress_test(
    scenario: str = Query("hyperinflation_2021", description="Escenario de crisis predefinido"),
    custom_start: str = Query("", description="Fecha inicio personalizada YYYY-MM-DD"),
    custom_end:   str = Query("", description="Fecha fin personalizada YYYY-MM-DD"),
    db: AsyncSession = Depends(get_db),
    user_id: UUID = Depends(get_current_user_id),
):
    """
    Simula cómo se hubiera comportado el portafolio ACTUAL durante un período
    histórico de crisis. Aplica los retornos reales de ese período a la
    composición de hoy.
    """
    from datetime import date as _date

    # Resolve date range
    if custom_start and custom_end:
        try:
            test_start = _date.fromisoformat(custom_start)
            test_end   = _date.fromisoformat(custom_end)
            scenario_meta = {
                "name": f"Personalizado: {custom_start} → {custom_end}",
                "description": "Rango de fechas definido por el usuario",
            }
        except ValueError:
            raise HTTPException(status_code=400, detail="Fechas personalizadas inválidas (formato YYYY-MM-DD)")
    else:
        if scenario not in STRESS_SCENARIOS:
            raise HTTPException(status_code=400, detail=f"Escenario inválido. Opciones: {list(STRESS_SCENARIOS.keys())}")
        s = STRESS_SCENARIOS[scenario]
        test_start = _date.fromisoformat(s["start"])
        test_end   = _date.fromisoformat(s["end"])
        scenario_meta = s

    if test_end <= test_start:
        raise HTTPException(status_code=400, detail="La fecha de fin debe ser posterior a la de inicio")

    # Load user current open positions
    txs_r = await db.execute(
        select(Transaction).where(Transaction.user_id == user_id).order_by(Transaction.transaction_date)
    )
    transactions = txs_r.scalars().all()
    if not transactions:
        raise HTTPException(status_code=422, detail="Sin posiciones en el portafolio")

    all_sids = list({tx.stock_id for tx in transactions if tx.stock_id})
    stocks_map: dict = {}
    if all_sids:
        sr = await db.execute(select(Stock).where(Stock.id.in_(all_sids)))
        stocks_map = {s.id: s for s in sr.scalars().all()}

    net_qty: dict[str, int] = {}
    sym_to_stock: dict[str, Stock] = {}
    for tx in transactions:
        stock = stocks_map.get(tx.stock_id) if tx.stock_id else None
        if not stock:
            continue
        sym_to_stock[stock.symbol] = stock
        delta = tx.quantity if tx.order_type == "Compra" else -tx.quantity
        net_qty[stock.symbol] = net_qty.get(stock.symbol, 0) + delta

    open_syms = [s for s, q in net_qty.items() if q > 0]
    if not open_syms:
        raise HTTPException(status_code=422, detail="Sin posiciones abiertas")

    # Get current price for each symbol (to compute portfolio weights)
    sym_price: dict[str, float] = {}
    for sym in open_syms:
        stock = sym_to_stock[sym]
        ph_r = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.stock_id == stock.id, PriceHistory.close_price != None)
            .order_by(PriceHistory.price_date.desc()).limit(1)
        )
        last = ph_r.scalar_one_or_none()
        sym_price[sym] = float(last.close_price) if last else 0

    current_values = {sym: net_qty[sym] * sym_price.get(sym, 0) for sym in open_syms}
    total_value = sum(current_values.values())
    if total_value <= 0:
        raise HTTPException(status_code=422, detail="Valor del portafolio es cero")

    weights = {sym: current_values[sym] / total_value for sym in open_syms}

    # Get historical prices during the crisis window for each symbol
    all_dates: set[str] = set()
    sym_crisis_prices: dict[str, dict[str, float]] = {}
    for sym in open_syms:
        stock = sym_to_stock[sym]
        ph_r = await db.execute(
            select(PriceHistory)
            .where(
                PriceHistory.stock_id == stock.id,
                PriceHistory.close_price != None,
                PriceHistory.price_date >= test_start,
                PriceHistory.price_date <= test_end,
            )
            .order_by(PriceHistory.price_date.asc())
        )
        rows = ph_r.scalars().all()
        d = {r.price_date.isoformat(): float(r.close_price) for r in rows}
        sym_crisis_prices[sym] = d
        all_dates.update(d.keys())

    common_dates = sorted(all_dates)
    if len(common_dates) < 2:
        raise HTTPException(
            status_code=422,
            detail=f"Sin datos históricos para el período {test_start} – {test_end} en las acciones del portafolio"
        )

    # Forward-fill missing prices per symbol
    def ffill(prices: dict[str, float], dates: list[str]) -> list[float]:
        result, last = [], 0.0
        for d in dates:
            if d in prices:
                last = prices[d]
            result.append(last)
        return result

    # Compute portfolio equity curve during stress period
    equity_curve: list[dict] = []
    initial_port = 100.0  # normalised to 100
    prev_value = initial_port

    filled_prices = {sym: ffill(sym_crisis_prices[sym], common_dates) for sym in open_syms}

    for i, dt in enumerate(common_dates):
        if i == 0:
            equity_curve.append({"date": dt, "value": round(initial_port, 2)})
            continue
        # Daily portfolio return
        port_ret = 0.0
        for sym in open_syms:
            p0 = filled_prices[sym][i - 1]
            p1 = filled_prices[sym][i]
            if p0 > 0:
                port_ret += weights[sym] * (p1 / p0 - 1)

        prev_value = prev_value * (1 + port_ret)
        equity_curve.append({"date": dt, "value": round(prev_value, 2)})

    final_value = equity_curve[-1]["value"]
    total_return_pct = round((final_value / initial_port - 1) * 100, 2)
    max_val = max(p["value"] for p in equity_curve)
    min_val = min(p["value"] for p in equity_curve)
    max_drawdown_pct = round((min_val - max_val) / max_val * 100, 2)

    # Per-stock impact
    per_stock_impact = []
    for sym in open_syms:
        prices = filled_prices[sym]
        if prices[0] > 0:
            stock_ret = round((prices[-1] / prices[0] - 1) * 100, 2)
        else:
            stock_ret = 0.0
        per_stock_impact.append({
            "symbol": sym,
            "name": sym_to_stock[sym].name,
            "weight_pct": round(weights[sym] * 100, 1),
            "period_return_pct": stock_ret,
            "contribution_pct": round(weights[sym] * stock_ret, 2),
        })
    per_stock_impact.sort(key=lambda x: x["contribution_pct"])

    return {
        "scenario": scenario if not custom_start else "custom",
        "scenario_name": scenario_meta["name"],
        "scenario_description": scenario_meta["description"],
        "period_start": test_start.isoformat(),
        "period_end":   test_end.isoformat(),
        "trading_days": len(common_dates),
        "total_return_pct": total_return_pct,
        "max_drawdown_pct": max_drawdown_pct,
        "final_value": round(final_value, 2),
        "equity_curve": equity_curve,
        "per_stock_impact": per_stock_impact,
        "note": "Portafolio actual (composición de HOY) aplicado al período histórico seleccionado.",
    }


# ── Markowitz Efficient Frontier (Monte Carlo Simulation) ─────────────────────
# Generates N random weight portfolios and traces the Pareto-optimal frontier.
# Returns scatter data for Chart.js + key portfolios (Min-Vol, Max-Sharpe).

@router.get("/efficient-frontier")
async def get_efficient_frontier(
    n_portfolios: int = Query(6000, ge=500, le=12000, description="Número de portafolios Monte Carlo"),
    db: AsyncSession = Depends(get_db),
    user_id: UUID = Depends(get_current_user_id),
):
    """
    Frontera Eficiente de Markowitz vía simulación Monte Carlo.
    Muestra el conjunto de portafolios óptimos (mejor retorno dado el riesgo).
    """
    import math, random

    # 1. Load user open positions
    txs_r = await db.execute(
        select(Transaction).where(Transaction.user_id == user_id).order_by(Transaction.transaction_date)
    )
    transactions = txs_r.scalars().all()
    if not transactions:
        raise HTTPException(status_code=422, detail="Sin posiciones en el portafolio")

    all_sids = list({tx.stock_id for tx in transactions if tx.stock_id})
    stocks_map: dict = {}
    if all_sids:
        sr = await db.execute(select(Stock).where(Stock.id.in_(all_sids)))
        stocks_map = {s.id: s for s in sr.scalars().all()}

    net_qty: dict[str, int] = {}
    sym_to_stock: dict[str, Stock] = {}
    for tx in transactions:
        stock = stocks_map.get(tx.stock_id) if tx.stock_id else None
        if not stock:
            continue
        sym_to_stock[stock.symbol] = stock
        delta = tx.quantity if tx.order_type == "Compra" else -tx.quantity
        net_qty[stock.symbol] = net_qty.get(stock.symbol, 0) + delta

    open_syms = [s for s, q in net_qty.items() if q > 0]
    if len(open_syms) < 2:
        raise HTTPException(status_code=422, detail="Se necesitan al menos 2 posiciones para la frontera eficiente")

    # 2. Load daily returns per symbol (last 252 trading days)
    returns_by_sym: dict[str, list[float]] = {}
    for sym in open_syms:
        stock = sym_to_stock[sym]
        ph_r = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.stock_id == stock.id, PriceHistory.close_price != None)
            .order_by(PriceHistory.price_date.asc())
        )
        rows   = ph_r.scalars().all()
        closes = [float(r.close_price) for r in rows[-253:]]
        if len(closes) < 10:
            continue
        rets = [(closes[i] - closes[i-1]) / closes[i-1] for i in range(1, len(closes)) if closes[i-1] > 0]
        returns_by_sym[sym] = rets

    syms = [s for s in open_syms if s in returns_by_sym]
    if len(syms) < 2:
        raise HTTPException(status_code=422, detail="Datos de retornos insuficientes para 2+ acciones")

    n = len(syms)

    # 3. Expected daily return and covariance matrix per symbol
    def _mean(v: list) -> float:
        return sum(v) / len(v) if v else 0

    def _cov(a: list, b: list) -> float:
        na, nb = len(a), len(b)
        # Align by taking the shorter length
        mn = min(na, nb); a = a[-mn:]; b = b[-mn:]
        if mn < 2:
            return 0
        ma, mb = _mean(a), _mean(b)
        return sum((a[i] - ma) * (b[i] - mb) for i in range(mn)) / mn

    mu   = [_mean(returns_by_sym[s]) * 252 for s in syms]   # annualised
    cov  = [[_cov(returns_by_sym[syms[i]], returns_by_sym[syms[j]]) * 252
             for j in range(n)] for i in range(n)]

    # 4. Current portfolio weights
    sym_price: dict[str, float] = {}
    for sym in syms:
        ph_r = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.stock_id == sym_to_stock[sym].id, PriceHistory.close_price != None)
            .order_by(PriceHistory.price_date.desc()).limit(1)
        )
        last = ph_r.scalar_one_or_none()
        sym_price[sym] = float(last.close_price) if last else 0

    cur_vals  = {s: net_qty[s] * sym_price.get(s, 0) for s in syms}
    total_cur = sum(cur_vals.values())
    cur_w     = [cur_vals[s] / total_cur if total_cur > 0 else 1/n for s in syms]

    def _port_metrics(w: list) -> tuple[float, float]:
        ret = sum(w[i] * mu[i] for i in range(n))
        var = sum(w[i] * w[j] * cov[i][j] for i in range(n) for j in range(n))
        return ret, math.sqrt(max(var, 0))

    # 5. Monte Carlo: generate random portfolios
    random.seed(42)
    portfolios: list[dict] = []

    for _ in range(n_portfolios):
        raw  = [random.random() for _ in range(n)]
        tot  = sum(raw)
        w    = [r / tot for r in raw]
        ret, vol = _port_metrics(w)
        sharpe   = ret / vol if vol > 0 else 0
        portfolios.append({"w": w, "ret": ret, "vol": vol, "sharpe": sharpe})

    # 6. Identify key portfolios
    min_vol_p  = min(portfolios, key=lambda p: p["vol"])
    max_shr_p  = max(portfolios, key=lambda p: p["sharpe"])

    cur_ret, cur_vol = _port_metrics(cur_w)
    cur_sharpe = cur_ret / cur_vol if cur_vol > 0 else 0

    # 7. Efficient frontier envelope
    # Bin portfolios by vol, keep max-return in each bin
    n_bins = 30
    vols   = [p["vol"] for p in portfolios]
    v_min, v_max = min(vols), max(vols)
    bin_w = (v_max - v_min) / n_bins if v_max > v_min else 1
    frontier_bins: dict[int, dict] = {}
    for p in portfolios:
        b = int((p["vol"] - v_min) / bin_w)
        b = min(b, n_bins - 1)
        if b not in frontier_bins or p["ret"] > frontier_bins[b]["ret"]:
            frontier_bins[b] = p
    frontier = sorted(frontier_bins.values(), key=lambda p: p["vol"])

    # 8. Scatter (downsample to 1000 points max for frontend performance)
    step = max(1, len(portfolios) // 1000)
    scatter = [
        {"vol": round(p["vol"] * 100, 2), "ret": round(p["ret"] * 100, 2), "sharpe": round(p["sharpe"], 3)}
        for p in portfolios[::step]
    ]

    def _key_port(p: dict, label: str) -> dict:
        return {
            "label": label,
            "vol_pct":    round(p["vol"] * 100, 2),
            "ret_pct":    round(p["ret"] * 100, 2),
            "sharpe":     round(p["sharpe"], 3),
            "weights":    [{"symbol": syms[i], "name": sym_to_stock[syms[i]].name,
                            "weight_pct": round(p["w"][i] * 100, 1)} for i in range(n)],
        }

    return {
        "symbols": [{"symbol": s, "name": sym_to_stock[s].name} for s in syms],
        "scatter": scatter,
        "frontier": [
            {"vol": round(p["vol"] * 100, 2), "ret": round(p["ret"] * 100, 2)}
            for p in frontier
        ],
        "key_portfolios": {
            "current":    {
                "label": "Tu Portafolio Actual",
                "vol_pct":  round(cur_vol * 100, 2),
                "ret_pct":  round(cur_ret * 100, 2),
                "sharpe":   round(cur_sharpe, 3),
                "weights":  [{"symbol": syms[i], "name": sym_to_stock[syms[i]].name,
                              "weight_pct": round(cur_w[i] * 100, 1)} for i in range(n)],
            },
            "min_vol":    _key_port(min_vol_p, "Mínima Volatilidad"),
            "max_sharpe": _key_port(max_shr_p, "Máximo Sharpe (Óptimo)"),
        },
        "n_portfolios": n_portfolios,
        "note": (
            "Frontera Eficiente de Markowitz calculada por simulación Monte Carlo. "
            "Portafolios por encima y a la derecha de la frontera son subóptimos. "
            "En BVC: alta inflación significa que retornos en Bs deben ajustarse por tipo de cambio BCV."
        ),
    }


# ── CVaR / Expected Shortfall ─────────────────────────────────────────────────
# CVaR (Conditional VaR) = mean of the worst (1-α)% of returns.
# More informative than VaR alone: measures the EXPECTED loss in the tail.

@router.get("/cvar")
async def get_cvar(
    confidence: float = Query(0.95, ge=0.9, le=0.99, description="Nivel de confianza (0.90-0.99)"),
    db: AsyncSession = Depends(get_db),
    user_id: UUID = Depends(get_current_user_id),
):
    """
    CVaR (Expected Shortfall) del portafolio del usuario.
    Responde: en el peor X% de los días, ¿cuánto pierde el portafolio EN PROMEDIO?
    Incluye distribución de retornos y análisis de cola para el mercado venezolano.
    """
    import math

    # Build open positions
    txs_r = await db.execute(
        select(Transaction).where(Transaction.user_id == user_id).order_by(Transaction.transaction_date)
    )
    transactions = txs_r.scalars().all()
    if not transactions:
        raise HTTPException(status_code=422, detail="Sin posiciones en el portafolio")

    all_sids = list({tx.stock_id for tx in transactions if tx.stock_id})
    stocks_map: dict = {}
    if all_sids:
        sr = await db.execute(select(Stock).where(Stock.id.in_(all_sids)))
        stocks_map = {s.id: s for s in sr.scalars().all()}

    net_qty: dict[str, int] = {}
    sym_to_stock: dict[str, Stock] = {}
    for tx in transactions:
        stock = stocks_map.get(tx.stock_id) if tx.stock_id else None
        if not stock:
            continue
        sym_to_stock[stock.symbol] = stock
        delta = tx.quantity if tx.order_type == "Compra" else -tx.quantity
        net_qty[stock.symbol] = net_qty.get(stock.symbol, 0) + delta

    open_syms = [s for s, q in net_qty.items() if q > 0]
    if not open_syms:
        raise HTTPException(status_code=422, detail="Sin posiciones abiertas")

    # Current portfolio weights
    sym_price: dict[str, float] = {}
    for sym in open_syms:
        stock = sym_to_stock[sym]
        ph_r = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.stock_id == stock.id, PriceHistory.close_price != None)
            .order_by(PriceHistory.price_date.desc()).limit(1)
        )
        last = ph_r.scalar_one_or_none()
        sym_price[sym] = float(last.close_price) if last else 0

    cur_vals  = {s: net_qty[s] * sym_price.get(s, 0) for s in open_syms}
    total_val = sum(cur_vals.values())
    if total_val <= 0:
        raise HTTPException(status_code=422, detail="Valor del portafolio es cero")
    weights = {s: cur_vals[s] / total_val for s in open_syms}

    # Align daily portfolio return series
    sym_rets: dict[str, dict[str, float]] = {}
    for sym in open_syms:
        stock = sym_to_stock[sym]
        ph_r = await db.execute(
            select(PriceHistory)
            .where(PriceHistory.stock_id == stock.id, PriceHistory.close_price != None)
            .order_by(PriceHistory.price_date.asc())
        )
        rows = ph_r.scalars().all()
        d: dict[str, float] = {}
        for i in range(1, len(rows)):
            p0 = float(rows[i-1].close_price)
            p1 = float(rows[i].close_price)
            if p0 > 0:
                d[rows[i].price_date.isoformat()] = (p1 / p0) - 1
        sym_rets[sym] = d

    # Build portfolio daily return series (intersection of all dates)
    all_dates = set.intersection(*[set(sym_rets[s].keys()) for s in open_syms])
    common_dates = sorted(all_dates)
    if len(common_dates) < 30:
        raise HTTPException(status_code=422, detail="Datos históricos insuficientes (< 30 días comunes)")

    port_rets = []
    for dt in common_dates:
        pr = sum(weights[s] * sym_rets[s][dt] for s in open_syms)
        port_rets.append(pr)

    n = len(port_rets)
    sorted_rets = sorted(port_rets)

    # VaR and CVaR
    cutoff_idx = max(1, int(n * (1 - confidence)))
    var_ret   = sorted_rets[cutoff_idx]                     # VaR: the threshold
    cvar_rets = sorted_rets[:cutoff_idx]                    # worst tail returns
    cvar_ret  = sum(cvar_rets) / len(cvar_rets)             # CVaR: mean of tail

    # Distribution stats
    mean_r  = sum(port_rets) / n
    std_r   = math.sqrt(sum((r - mean_r)**2 for r in port_rets) / n)
    skew_r  = sum(((r - mean_r)/std_r)**3 for r in port_rets) / n if std_r > 0 else 0
    kurt_r  = sum(((r - mean_r)/std_r)**4 for r in port_rets) / n - 3 if std_r > 0 else 0

    # Annualised
    ann_vol  = std_r * math.sqrt(252) * 100
    ann_ret  = mean_r * 252 * 100

    # Per-stock CVaR contribution
    stock_contributions = []
    for sym in open_syms:
        bad_rets = [sym_rets[sym].get(dt, 0) for dt in common_dates[:cutoff_idx]]
        avg_bad  = sum(bad_rets) / len(bad_rets) if bad_rets else 0
        contrib  = weights[sym] * avg_bad * 100
        stock_contributions.append({
            "symbol": sym,
            "name":   sym_to_stock[sym].name,
            "weight_pct": round(weights[sym] * 100, 1),
            "cvar_contribution_pct": round(contrib, 3),
        })
    stock_contributions.sort(key=lambda x: x["cvar_contribution_pct"])

    # BVC-specific interpretation
    cvar_pct = cvar_ret * 100
    if cvar_pct < -5:
        tail_label = "RIESGO DE COLA EXTREMO — En el peor escenario, pérdidas mayores al 5% diario"
    elif cvar_pct < -2:
        tail_label = "RIESGO DE COLA ALTO — Pérdidas severas en los peores días"
    elif cvar_pct < -1:
        tail_label = "RIESGO DE COLA MODERADO"
    else:
        tail_label = "RIESGO DE COLA CONTROLADO"

    return {
        "confidence_pct": round(confidence * 100, 0),
        "data_days":      n,
        "date_range":     {"from": common_dates[0], "to": common_dates[-1]},
        "var_pct":        round(var_ret * 100, 3),
        "cvar_pct":       round(cvar_ret * 100, 3),
        "cvar_usd":       round(cvar_ret * total_val, 2) if total_val > 0 else None,
        "tail_observations": cutoff_idx,
        "tail_label":     tail_label,
        "distribution": {
            "mean_daily_pct":   round(mean_r * 100, 3),
            "std_daily_pct":    round(std_r  * 100, 3),
            "ann_vol_pct":      round(ann_vol, 2),
            "ann_return_pct":   round(ann_ret, 2),
            "skewness":         round(skew_r, 3),
            "excess_kurtosis":  round(kurt_r, 3),
            "is_fat_tailed":    kurt_r > 1.0,
        },
        "stock_cvar_contributions": stock_contributions,
        "histogram": [
            {"bucket": round(sorted_rets[i]*100, 2)}
            for i in range(0, min(n, 200), max(1, n//200))
        ],
        "note": (
            "CVaR (Expected Shortfall) = pérdida ESPERADA en el peor (1-α)% de los días. "
            "Más conservador que el VaR, captura el riesgo de cola real. "
            "Exceso de curtosis > 1 indica distribución de colas gruesas — común en BVC."
        ),
    }