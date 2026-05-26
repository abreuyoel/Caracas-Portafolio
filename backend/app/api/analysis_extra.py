"""
Extra analysis endpoints: cointegration and walk-forward validation.
Registered in __init__.py under the /stocks prefix.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.stock import Stock, PriceHistory
from app.utils.security import decode_token
from fastapi import Header
from uuid import UUID
import math as _m
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


async def _get_uid(authorization: str = Header(...)) -> UUID:
    payload = decode_token(authorization.replace("Bearer ", ""))
    return UUID(payload["sub"])


# ─────────────────────────────────────────────────────────────────────────────
# Cointegration (Statistical Arbitrage)
# ─────────────────────────────────────────────────────────────────────────────

def _ols(x: list, y: list):
    n = len(x)
    sx, sy = sum(x), sum(y)
    sxy = sum(xi * yi for xi, yi in zip(x, y))
    sxx = sum(xi ** 2 for xi in x)
    denom = n * sxx - sx ** 2
    if abs(denom) < 1e-12:
        return None, None, []
    b = (n * sxy - sx * sy) / denom
    a = (sy - b * sx) / n
    resid = [yi - (a + b * xi) for xi, yi in zip(x, y)]
    return a, b, resid


def _adf_t(resid: list) -> float:
    if len(resid) < 5:
        return 0.0
    delta  = [resid[i] - resid[i - 1] for i in range(1, len(resid))]
    lagged = resid[:-1]
    _, b, _ = _ols(lagged, delta)
    if b is None:
        return 0.0
    sse = sum((d - b * lg) ** 2 for d, lg in zip(delta, lagged))
    n   = len(lagged)
    var = sse / max(n - 2, 1)
    sxx = sum(lg ** 2 for lg in lagged)
    se  = _m.sqrt(max(var, 0) / max(sxx, 1e-12))
    return b / max(se, 1e-12)


def _zscore(resid: list, lookback: int = 20) -> float:
    w = resid[-lookback:] if len(resid) >= lookback else resid
    if len(w) < 3:
        return 0.0
    mu  = sum(w) / len(w)
    std = _m.sqrt(sum((r - mu) ** 2 for r in w) / len(w))
    return (resid[-1] - mu) / max(std, 1e-12)


@router.get("/analysis/cointegration")
async def get_cointegration(
    min_months: int = 12,
    user_id: UUID = Depends(_get_uid),
    db: AsyncSession = Depends(get_db),
):
    try:
        stocks_r = await db.execute(select(Stock).where(Stock.is_active == True))
        stocks   = stocks_r.scalars().all()

        series: dict = {}
        for stock in stocks:
            hist_r = await db.execute(
                select(PriceHistory)
                .where(PriceHistory.stock_id == stock.id)
                .where(PriceHistory.close_price.isnot(None))
                .order_by(PriceHistory.price_date.asc())
            )
            hist = hist_r.scalars().all()
            if len(hist) < min_months * 15:
                continue
            monthly: dict = {}
            for h in hist:
                key = h.price_date.strftime("%Y-%m")
                monthly[key] = float(h.close_price)
            if len(monthly) < min_months:
                continue
            keys = sorted(monthly.keys())
            series[stock.symbol] = {
                "name":   stock.name,
                "dates":  keys,
                "closes": [monthly[k] for k in keys],
            }

        syms = list(series.keys())
        if len(syms) < 2:
            return {"pairs": [], "note": "Insuficientes acciones con historial."}

        ADF_CRITICAL = -3.0
        pairs = []

        for i in range(len(syms)):
            for j in range(i + 1, len(syms)):
                try:
                    sa, sb = syms[i], syms[j]
                    data_a, data_b = series[sa], series[sb]
                    ma = dict(zip(data_a["dates"], data_a["closes"]))
                    mb = dict(zip(data_b["dates"], data_b["closes"]))
                    common = sorted(
                        d for d in set(data_a["dates"]) & set(data_b["dates"])
                        if ma.get(d, 0) > 0 and mb.get(d, 0) > 0
                    )
                    if len(common) < min_months:
                        continue
                    y  = [_m.log(ma[d]) for d in common]
                    x  = [_m.log(mb[d]) for d in common]
                    _, hr, resid = _ols(x, y)
                    if hr is None or not resid:
                        continue
                    t = _adf_t(resid)
                    if t > ADF_CRITICAL:
                        continue
                    z = _zscore(resid)
                    _, lam, _ = _ols(resid[:-1], [resid[k] - resid[k-1] for k in range(1, len(resid))])
                    half_life = round(-_m.log(2) / lam, 1) if (lam and lam < 0) else None
                except Exception:
                    continue
                pairs.append({
                    "sym_a": sa, "name_a": data_a["name"],
                    "sym_b": sb, "name_b": data_b["name"],
                    "hedge_ratio": round(hr, 4),
                    "adf_t_stat":  round(t,  3),
                    "z_score":     round(z,  3),
                    "half_life_months": half_life,
                    "common_months": len(common),
                    "signal":   "LONG A / SHORT B" if z < -1.5 else "SHORT A / LONG B" if z > 1.5 else "NEUTRAL",
                    "signal_strength": round(abs(z), 2),
                })

        pairs.sort(key=lambda p: p["adf_t_stat"])
        return {
            "pairs": pairs[:30],
            "total_pairs_tested": len(syms) * (len(syms) - 1) // 2,
            "cointegrated_found": len(pairs),
            "note": "Engle-Granger. ADF t-stat < -3.0 → cointegrado al 5%. Z-score del spread en últimos 20 meses.",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculando cointegración: {str(e)}")


# ─────────────────────────────────────────────────────────────────────────────
# Walk-Forward Validation
# ─────────────────────────────────────────────────────────────────────────────

def _sma(prices: list, period: int) -> list:
    result = []
    for i in range(len(prices)):
        if i < period - 1:
            result.append(None)
        else:
            result.append(sum(prices[i - period + 1:i + 1]) / period)
    return result


def _rsi(prices: list, period: int = 6) -> list:
    result = [None] * period
    for i in range(period, len(prices)):
        gains  = [max(prices[j] - prices[j-1], 0) for j in range(i - period + 1, i + 1)]
        losses = [max(prices[j-1] - prices[j], 0) for j in range(i - period + 1, i + 1)]
        ag = sum(gains)  / period
        al = sum(losses) / period
        rs = ag / max(al, 1e-9)
        result.append(100 - 100 / (1 + rs))
    return result


def _simulate(prices: list, strat: str) -> dict:
    if len(prices) < 8:
        return {"total_return_pct": 0.0, "trades": 0, "win_rate": 0.0}
    signals = [0] * len(prices)

    if strat == "ma_cross":
        fast = _sma(prices, 3)
        slow = _sma(prices, 6)
        for i in range(1, len(prices)):
            if fast[i] is not None and slow[i] is not None:
                signals[i] = 1 if fast[i] > slow[i] else 0

    elif strat == "rsi_mean_reversion":
        r = _rsi(prices, 6)
        for i in range(1, len(prices)):
            if r[i] is not None:
                if r[i] < 35:
                    signals[i] = 1
                elif r[i] > 65:
                    signals[i] = 0
                else:
                    signals[i] = signals[i - 1]

    portfolio = 1.0
    trades = wins = 0
    prev = 0
    for i in range(1, len(prices)):
        ret = (prices[i] - prices[i-1]) / prices[i-1]
        if signals[i] == 1:
            portfolio *= (1 + ret)
        if signals[i] != prev:
            if prev == 1 and signals[i] == 0:
                trades += 1
                if ret >= 0:
                    wins += 1
        prev = signals[i]

    total = (portfolio - 1) * 100
    wr    = (wins / trades * 100) if trades > 0 else 0.0
    return {"total_return_pct": round(total, 2), "trades": trades, "win_rate": round(wr, 1)}


@router.get("/analysis/walk-forward")
async def get_walk_forward(
    symbol: str,
    strategy: str = "ma_cross",
    train_months: int = 36,
    val_months: int = 12,
    user_id: UUID = Depends(_get_uid),
    db: AsyncSession = Depends(get_db),
):
    stock_r = await db.execute(select(Stock).where(Stock.symbol == symbol))
    stock   = stock_r.scalar_one_or_none()
    if not stock:
        raise HTTPException(status_code=404, detail="Símbolo no encontrado")

    hist_r = await db.execute(
        select(PriceHistory)
        .where(PriceHistory.stock_id == stock.id)
        .where(PriceHistory.close_price.isnot(None))
        .order_by(PriceHistory.price_date.asc())
    )
    hist = hist_r.scalars().all()

    monthly: dict = {}
    for h in hist:
        key = h.price_date.strftime("%Y-%m")
        monthly[key] = float(h.close_price)

    months_list = sorted(monthly.keys())
    closes      = [monthly[m] for m in months_list]
    n           = len(closes)

    min_needed = (train_months + val_months)
    if n < min_needed:
        raise HTTPException(status_code=422, detail=f"Se necesitan {min_needed} meses de datos. Disponibles: {n}.")

    windows = []
    pos = 0
    while pos + train_months + val_months <= n:
        tp = closes[pos: pos + train_months]
        vp = closes[pos + train_months: pos + train_months + val_months]
        tl = months_list[pos: pos + train_months]
        vl = months_list[pos + train_months: pos + train_months + val_months]

        ins  = _simulate(tp, strategy)
        outs = _simulate(vp, strategy)
        bh_t = round((tp[-1] - tp[0]) / tp[0] * 100, 2)
        bh_v = round((vp[-1] - vp[0]) / vp[0] * 100, 2)
        eff  = round(outs["total_return_pct"] / max(abs(ins["total_return_pct"]), 1), 3)

        windows.append({
            "window": len(windows) + 1,
            "train_start": tl[0],  "train_end": tl[-1],
            "val_start":   vl[0],  "val_end":   vl[-1],
            "in_sample":  ins,     "out_sample": outs,
            "bh_train_pct": bh_t,  "bh_val_pct": bh_v,
            "efficiency_ratio": eff,
        })
        pos += val_months

    if not windows:
        raise HTTPException(status_code=422, detail="Datos insuficientes para ventanas de validación.")

    avg_in  = sum(w["in_sample"]["total_return_pct"]  for w in windows) / len(windows)
    avg_out = sum(w["out_sample"]["total_return_pct"] for w in windows) / len(windows)
    avg_eff = sum(w["efficiency_ratio"] for w in windows) / len(windows)

    verdict = (
        "SOBREAJUSTADO" if avg_eff < 0.2 else
        "SOSPECHOSO"    if avg_eff < 0.5 else
        "ACEPTABLE"     if avg_eff < 0.8 else
        "ROBUSTO"
    )
    notes = {
        "SOBREAJUSTADO": "El modelo falla out-of-sample (eficiencia <20%). NO usar para trading real.",
        "SOSPECHOSO":    "Rendimiento marginal fuera de muestra. Validar con más períodos antes de operar.",
        "ACEPTABLE":     "La estrategia generaliza razonablemente. Proceder con tamaño de posición reducido.",
        "ROBUSTO":       "La estrategia es consistente fuera de muestra. Mayor confianza para operar.",
    }

    return {
        "symbol": symbol,
        "name":   stock.name,
        "strategy": strategy,
        "train_months": train_months,
        "val_months":   val_months,
        "windows": windows,
        "summary": {
            "avg_in_sample_pct":  round(avg_in,  2),
            "avg_out_sample_pct": round(avg_out, 2),
            "avg_efficiency":     round(avg_eff, 3),
            "verdict":      verdict,
            "verdict_note": notes[verdict],
            "total_windows": len(windows),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# GARCH(1,1) Conditional Volatility Model
# σ²_t = ω + α·ε²_{t-1} + β·σ²_{t-1}
# Fit via MLE (grid search + gradient ascent) — pure Python, no scipy needed.
# ─────────────────────────────────────────────────────────────────────────────

def _fit_garch11(returns: list[float], n_iter: int = 500) -> dict | None:
    """
    GARCH(1,1) fit via MLE — stationarity-constrained parameterisation.

    Key design decision: omega is NOT a free parameter.  It is derived from
    the stationarity constraint  ω = σ²_unc × (1 − α − β)  at every step.
    This guarantees:
      • omega never blows up (common failure mode with naive gradient ascent)
      • the unconditional variance equals var_unc by construction
      • only (α, β) ∈ (0,1)² with α+β < 1 need to be optimised

    The old code used  lr_ω = |ω| × 0.005  which causes exponential blowup
    when the LL gradient w.r.t. ω is large (i.e. whenever data has big moves).
    """
    n = len(returns)
    if n < 30:
        return None

    # Centre returns — GARCH models zero-mean innovations
    mu = sum(returns) / n
    eps = [r - mu for r in returns]

    var_unc = sum(e * e for e in eps) / n
    if var_unc <= 1e-14:
        return None

    # ── Log-likelihood with ω enforced by stationarity ───────────────────────
    def _ll(alpha: float, beta: float) -> float:
        if alpha <= 0 or beta <= 0 or alpha + beta >= 0.9999:
            return -1e15
        omega = var_unc * (1.0 - alpha - beta)
        if omega <= 0:
            return -1e15
        ll = 0.0
        h  = var_unc            # initialise at unconditional variance
        for e_t in eps:
            h = omega + alpha * e_t * e_t + beta * h
            if h <= 1e-16 or not _m.isfinite(h):
                return -1e15
            ll += -0.5 * (_m.log(h) + e_t * e_t / h)
        return ll if _m.isfinite(ll) else -1e15

    # ── Phase 1 — coarse grid search ─────────────────────────────────────────
    best_ll = -1e15
    alpha, beta = 0.10, 0.85

    for a in (0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.15, 0.18, 0.20, 0.25, 0.30):
        for b in (0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.84, 0.87, 0.90, 0.93, 0.95):
            if a + b >= 0.999:
                continue
            ll = _ll(a, b)
            if ll > best_ll:
                best_ll, alpha, beta = ll, a, b

    # ── Phase 2 — gradient ascent on (α, β) with clipped gradients ───────────
    lr = 3e-4
    prev_ll = best_ll
    no_improve = 0

    for _ in range(n_iter):
        ll0 = _ll(alpha, beta)
        if not _m.isfinite(ll0) or ll0 < -1e14:
            break

        d = 1e-5
        ga = (_ll(alpha + d, beta) - ll0) / d
        gb = (_ll(alpha, beta + d) - ll0) / d

        # Hard gradient clip — prevents oscillation / divergence
        ga = max(-500.0, min(500.0, ga))
        gb = max(-500.0, min(500.0, gb))

        a_new = max(0.005, min(0.45, alpha + lr * ga))
        b_new = max(0.005, min(0.97, beta  + lr * gb))
        if a_new + b_new >= 0.9999:
            s = a_new + b_new
            a_new *= 0.998 / s
            b_new *= 0.998 / s

        ll_new = _ll(a_new, b_new)
        if ll_new > ll0:
            alpha, beta = a_new, b_new
            no_improve = 0
        else:
            no_improve += 1

        if abs(ll_new - prev_ll) < 1e-6:
            lr *= 0.95
        if no_improve > 40:
            break
        prev_ll = max(prev_ll, ll_new)

    # ── Final parameters (omega bounded by construction) ─────────────────────
    omega       = var_unc * (1.0 - alpha - beta)
    persistence = alpha + beta
    lr_var      = var_unc           # == omega / (1 − persistence) by construction

    # Conditional variance series over all data
    h = var_unc
    h_series: list[float] = []
    for e_t in eps:
        h = omega + alpha * e_t * e_t + beta * h
        h_series.append(max(h, 1e-14))

    h_now = h_series[-1]

    # Multi-step forecasts
    h_1d  = omega + alpha * eps[-1] ** 2 + beta * h_now
    h_5d  = lr_var + persistence ** 5  * (h_now - lr_var)
    h_22d = lr_var + persistence ** 22 * (h_now - lr_var)

    def _av(hv: float) -> float:        # annualised vol %  (daily data → ×252)
        return _m.sqrt(max(hv, 1e-14) * 252) * 100

    cur_vol = _av(h_now);  lr_vol  = _av(lr_var)
    f1_vol  = _av(h_1d);   f5_vol  = _av(h_5d);  f22_vol = _av(h_22d)

    if cur_vol > lr_vol * 1.6:
        regime = "ALTA_VOLATILIDAD"
        interp = (f"Volatilidad actual ({cur_vol:.1f}%) > 1.6× media de largo plazo ({lr_vol:.1f}%). "
                  "Mercado en estrés — considera reducir tamaño de posición.")
    elif cur_vol < lr_vol * 0.65:
        regime = "BAJA_VOLATILIDAD"
        interp = (f"Volatilidad comprimida ({cur_vol:.1f}%). "
                  "Históricamente precede explosiones de movimiento — monitorear de cerca.")
    elif f1_vol > cur_vol * 1.15:
        regime = "VOLATILIDAD_CRECIENTE"
        interp = (f"GARCH anticipa aumento ({cur_vol:.1f}% → {f1_vol:.1f}% mañana). "
                  "Posible inicio de cluster de volatilidad.")
    else:
        regime = "NORMAL"
        interp = f"Volatilidad dentro del rango normal ({cur_vol:.1f}% vs. media {lr_vol:.1f}%)."

    return {
        "omega":       round(omega, 10),
        "alpha":       round(alpha, 4),
        "beta":        round(beta,  4),
        "persistence": round(persistence, 4),
        "half_life_days": round(_m.log(0.5) / _m.log(persistence), 1) if 0 < persistence < 1 else None,
        "long_run_vol_pct":     round(lr_vol,  2),
        "current_vol_pct":      round(cur_vol, 2),
        "forecast_1d_vol_pct":  round(f1_vol,  2),
        "forecast_5d_vol_pct":  round(f5_vol,  2),
        "forecast_22d_vol_pct": round(f22_vol, 2),
        "vol_regime":           regime,
        "interpretation":       interp,
        "vol_series_60d": [round(_av(hv), 2) for hv in h_series[-60:]],
    }


@router.get("/garch/{symbol}")
async def get_garch(
    symbol: str,
    uid: UUID = Depends(_get_uid),
    db:  AsyncSession = Depends(get_db),
):
    """
    GARCH(1,1) conditional volatility model for a BVC stock.
    Returns parameters, current regime, and multi-step forecasts.
    Particularly useful for Venezuela where vol comes in sharp clusters.
    """
    stock_r = await db.execute(select(Stock).where(Stock.symbol == symbol.upper()))
    stock   = stock_r.scalar_one_or_none()
    if not stock:
        raise HTTPException(status_code=404, detail=f"Acción {symbol} no encontrada")

    ph_r = await db.execute(
        select(PriceHistory)
        .where(PriceHistory.stock_id == stock.id, PriceHistory.close_price != None)
        .order_by(PriceHistory.price_date.asc())
    )
    rows   = ph_r.scalars().all()
    closes = [float(r.close_price) for r in rows]
    dates  = [r.price_date.isoformat() for r in rows]

    if len(closes) < 40:
        raise HTTPException(status_code=422, detail="Datos insuficientes para GARCH (< 40 observaciones)")

    # Use log returns and clip extremes caused by BVC currency redenominations
    # (price jumps of 100x+ in a single day are redenomination artifacts, not real moves)
    log_returns: list[float] = []
    for i in range(1, len(closes)):
        if closes[i - 1] > 0 and closes[i] > 0:
            r = _m.log(closes[i] / closes[i - 1])
            if abs(r) <= 1.5:   # keeps up to ±350% real daily moves; removes redenomination spikes
                log_returns.append(r)
    returns = log_returns
    if len(returns) < 30:
        raise HTTPException(status_code=422, detail="Retornos insuficientes para GARCH")

    result = _fit_garch11(returns)
    if not result:
        raise HTTPException(status_code=422, detail="No se pudo ajustar el modelo GARCH(1,1)")

    # Attach date labels to the vol series
    vol_dates = dates[-(len(result["vol_series_60d"])):]

    return {
        "symbol": stock.symbol,
        "name":   stock.name,
        "model":  "GARCH(1,1)",
        "data_points": len(returns),
        **result,
        "vol_series_dates": vol_dates,
        "note": (
            "GARCH(1,1) ajustado por MLE. "
            "Persistencia = α + β: cerca de 1 indica shocks duraderos (típico en BVC). "
            "Semivida = días que tarda la volatilidad en volver a la mitad del exceso actual."
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# ML Price Direction Prediction
# Logistic Ridge Regression (gradient descent, pure Python)
# + Walk-Forward cross-validation (out-of-sample accuracy)
# Features: momentum (5d/20d), price percentile, RSI-proxy, vol-z, vol-daily
# ─────────────────────────────────────────────────────────────────────────────

def _sigmoid(z: float) -> float:
    if z > 500:  return 1.0
    if z < -500: return 0.0
    return 1.0 / (1.0 + _m.exp(-z))

def _build_ml_features(closes: list[float], volumes: list[float]) -> tuple[list, list]:
    """Return (X, y) where X[t] has 6 features and y[t] = 1 if next-day return > 0."""
    n  = len(closes)
    X, y = [], []
    for t in range(22, n - 1):
        # 1. Momentum 5d
        m5  = (closes[t] - closes[t-5])  / closes[t-5]  if closes[t-5]  > 0 else 0
        # 2. Momentum 20d
        m20 = (closes[t] - closes[t-20]) / closes[t-20] if closes[t-20] > 0 else 0
        # 3. Price position in 20d High-Low range (−1 to +1)
        hi20 = max(closes[t-19:t+1]);  lo20 = min(closes[t-19:t+1])
        pp   = ((closes[t] - lo20) / (hi20 - lo20) * 2 - 1) if hi20 > lo20 else 0.0
        # 4. RSI-proxy (14d, centered at 0)
        rets14 = [closes[i]/closes[i-1] - 1 for i in range(t-13, t+1) if closes[i-1] > 0]
        g = [r for r in rets14 if r > 0]; l = [-r for r in rets14 if r < 0]
        avg_g = sum(g)/len(g) if g else 1e-9; avg_l = sum(l)/len(l) if l else 1e-9
        rsi_c = (100 - 100/(1 + avg_g/avg_l) - 50) / 50   # centred, scaled -1..+1
        # 5. Volume z-score (clamped ±2)
        vols20 = volumes[t-19:t+1]
        avg_v  = sum(vols20) / 20
        std_v  = _m.sqrt(sum((v-avg_v)**2 for v in vols20) / 20)
        vol_z  = max(-2.0, min(2.0, (volumes[t] - avg_v) / std_v)) / 2 if std_v > 0 else 0.0
        # 6. Realised daily volatility (10d, scaled)
        r10 = [closes[i]/closes[i-1]-1 for i in range(t-9, t+1) if closes[i-1] > 0]
        rv  = _m.sqrt(sum(rr**2 for rr in r10) / len(r10)) * 100 if r10 else 0.0

        X.append([m5*10, m20*10, pp, rsi_c, vol_z, min(rv, 5)/5])
        y.append(1 if closes[t+1] > closes[t] else 0)
    return X, y

def _ridge_logistic(X: list, y: list, lam: float = 0.05,
                    lr: float = 0.05, epochs: int = 300) -> tuple[list, float]:
    """Logistic Ridge Regression — gradient descent."""
    nf = len(X[0]); n = len(X)
    w = [0.0] * nf; b = 0.0
    for _ in range(epochs):
        dw = [0.0] * nf; db = 0.0
        for i in range(n):
            z = sum(w[j] * X[i][j] for j in range(nf)) + b
            err = _sigmoid(z) - y[i]
            for j in range(nf): dw[j] += err * X[i][j]
            db += err
        for j in range(nf):
            w[j] -= lr / n * (dw[j] + lam * w[j])
        b -= lr / n * db
    return w, b

def _accuracy(y_true: list, probs: list, thresh: float = 0.5) -> float:
    correct = sum(1 for yt, p in zip(y_true, probs) if (p >= thresh) == bool(yt))
    return correct / len(y_true) if y_true else 0.0


@router.get("/ml-predict/{symbol}")
async def get_ml_predict(
    symbol: str,
    uid: UUID = Depends(_get_uid),
    db:  AsyncSession = Depends(get_db),
):
    """
    ML price-direction prediction for a BVC stock.
    Model: Logistic Ridge Regression (6 technical features).
    Validation: Walk-Forward with 3 expanding windows.
    Returns: direction forecast, confidence, OOS accuracy, feature weights.

    Note — Venezuelan market disclaimer: no model survives an Asamblea Nacional
    announcement. Always combine with macro context. OOS accuracy < 55% = discard.
    """
    stock_r = await db.execute(select(Stock).where(Stock.symbol == symbol.upper()))
    stock   = stock_r.scalar_one_or_none()
    if not stock:
        raise HTTPException(status_code=404, detail=f"Acción {symbol} no encontrada")

    ph_r = await db.execute(
        select(PriceHistory)
        .where(PriceHistory.stock_id == stock.id, PriceHistory.close_price != None)
        .order_by(PriceHistory.price_date.asc())
    )
    rows    = ph_r.scalars().all()
    closes  = [float(r.close_price) for r in rows]
    volumes = [float(r.volume or 0)  for r in rows]
    dates   = [r.price_date.isoformat() for r in rows]

    if len(closes) < 60:
        raise HTTPException(status_code=422, detail="Datos insuficientes para ML (< 60 observaciones)")

    X, y = _build_ml_features(closes, volumes)
    if len(X) < 30:
        raise HTTPException(status_code=422, detail="Features insuficientes para ML")

    n = len(X)
    FEATURE_NAMES = ["Momentum 5d", "Momentum 20d", "Pos. en Rango", "RSI-Proxy", "Vol Z-Score", "Vol Realizada"]

    # ── Walk-Forward validation (3 windows: 60/20, 70/15, 80/10 % splits) ──
    wf_results = []
    for train_pct in (0.60, 0.72, 0.84):
        t_end = int(n * train_pct)
        v_end = min(n, t_end + max(10, int(n * 0.12)))
        if v_end <= t_end + 5:
            continue
        X_tr, y_tr = X[:t_end], y[:t_end]
        X_va, y_va = X[t_end:v_end], y[t_end:v_end]
        if len(X_tr) < 20 or len(X_va) < 5:
            continue
        w, b = _ridge_logistic(X_tr, y_tr)
        p_tr = [_sigmoid(sum(w[j]*X_tr[i][j] for j in range(6)) + b) for i in range(len(X_tr))]
        p_va = [_sigmoid(sum(w[j]*X_va[i][j] for j in range(6)) + b) for i in range(len(X_va))]
        wf_results.append({
            "train_size":   t_end,
            "val_size":     v_end - t_end,
            "in_sample_acc_pct":  round(_accuracy(y_tr, p_tr) * 100, 1),
            "out_sample_acc_pct": round(_accuracy(y_va, p_va) * 100, 1),
        })

    # ── Full-data model for current prediction ───────────────────────────────
    w_full, b_full = _ridge_logistic(X, y)
    latest_x  = X[-1]
    latest_z  = sum(w_full[j] * latest_x[j] for j in range(6)) + b_full
    prob_up   = round(_sigmoid(latest_z), 3)

    avg_oos  = (sum(r["out_sample_acc_pct"] for r in wf_results) / len(wf_results)) if wf_results else 0.0
    usable   = avg_oos >= 52.0  # better than noise threshold for BVC

    direction = "ALZA" if prob_up >= 0.5 else "BAJA"
    confidence = abs(prob_up - 0.5) * 2 * 100   # 0-100 %

    if not usable:
        warning = (f"OOS accuracy = {avg_oos:.1f}% ≤ 52% — modelo no supera umbral de ruido. "
                   "NO operar con esta señal. Venezuela: noticias macro dominan sobre patrones técnicos.")
    elif avg_oos < 55.0:
        warning = f"OOS accuracy = {avg_oos:.1f}% — señal débil. Usar solo como confirmación secundaria."
    else:
        warning = f"OOS accuracy = {avg_oos:.1f}% — señal estadísticamente aceptable para BVC."

    # Feature importance: |weight| normalised to %
    abs_w = [abs(w) for w in w_full]; total_w = sum(abs_w) or 1
    feature_importance = [
        {"feature": FEATURE_NAMES[j], "weight": round(w_full[j], 4),
         "importance_pct": round(abs_w[j] / total_w * 100, 1)}
        for j in range(6)
    ]
    feature_importance.sort(key=lambda x: -x["importance_pct"])

    # Recent accuracy on last 30 samples
    n30  = min(30, len(X))
    p30  = [_sigmoid(sum(w_full[j]*X[-n30+i][j] for j in range(6)) + b_full) for i in range(n30)]
    acc30 = round(_accuracy(y[-n30:], p30) * 100, 1)

    return {
        "symbol":     stock.symbol,
        "name":       stock.name,
        "model":      "Logistic Ridge Regression",
        "features":   FEATURE_NAMES,
        "data_points": n,
        "prediction": {
            "direction":    direction,
            "prob_up":      prob_up,
            "prob_down":    round(1 - prob_up, 3),
            "confidence_pct": round(confidence, 1),
            "last_close":   closes[-1],
            "last_date":    dates[-1],
        },
        "walk_forward": wf_results,
        "avg_oos_accuracy_pct": round(avg_oos, 1),
        "recent_30d_accuracy_pct": acc30,
        "is_usable":     usable,
        "warning":       warning,
        "feature_importance": feature_importance,
        "note": (
            "Modelo entrenado sobre retornos históricos de precios BVC usando 6 indicadores técnicos. "
            "Walk-Forward asegura que la métrica OOS sea real (sin data leakage). "
            "BVC disclaimer: volatilidad política/macroeconómica puede invalidar señales técnicas."
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# PE Relativo / CAPE Ratio (Cyclically Adjusted Price-Earnings proxy)
# ─────────────────────────────────────────────────────────────────────────────
# In BVC many issuers don't publish reliable EPS, so we approximate the
# "fair value" via the inflation-adjusted historical price average — the same
# spirit Shiller used for CAPE: smooth out cyclical noise to detect bubbles.
#
#   PE_relative_5y  = current_price / avg(price_last_5y)
#   CAPE_proxy_10y  = current_price / avg(price_last_10y_adjusted_by_BCV_FX)
#
# Values >> 1 → expensive vs history, << 1 → cheap.

@router.get("/cape/{symbol}")
async def get_cape_ratio(
    symbol: str,
    user_id: UUID = Depends(_get_uid),
    db: AsyncSession = Depends(get_db),
):
    """Relative PE + CAPE proxy for a BVC symbol."""
    from app.models.stock import BcvRate
    from datetime import date as _date, timedelta as _td

    sym = symbol.upper().strip()
    res = await db.execute(select(Stock).where(Stock.symbol == sym))
    stock = res.scalar_one_or_none()
    if not stock:
        raise HTTPException(status_code=404, detail=f"{sym} no encontrado")

    today = _date.today()
    cutoff_10y = today - _td(days=365 * 10)

    res = await db.execute(
        select(PriceHistory.price_date, PriceHistory.close_price)
        .where(PriceHistory.stock_id == stock.id)
        .where(PriceHistory.price_date >= cutoff_10y)
        .order_by(PriceHistory.price_date.asc())
    )
    rows = res.all()
    if len(rows) < 60:
        raise HTTPException(status_code=422, detail="Histórico insuficiente (<60 días)")

    # Load BCV rates to deflate Bs prices (USD-equivalent series for CAPE)
    res = await db.execute(
        select(BcvRate.rate_date, BcvRate.rate)
        .where(BcvRate.rate_date >= cutoff_10y)
        .order_by(BcvRate.rate_date.asc())
    )
    bcv_rows = res.all()
    bcv_map = {r.rate_date: float(r.rate) for r in bcv_rows if r.rate}

    # Find nearest BCV rate ≤ a given date
    sorted_bcv_dates = sorted(bcv_map.keys())
    def _bcv_for(d):
        if not sorted_bcv_dates:
            return None
        # binary-ish: walk backward until found
        for bd in reversed(sorted_bcv_dates):
            if bd <= d:
                return bcv_map[bd]
        return None

    closes_bs:  list[float] = []
    closes_usd: list[float] = []
    dates_:     list = []
    for r in rows:
        c = float(r.close_price) if r.close_price else None
        if c is None or c <= 0:
            continue
        closes_bs.append(c)
        dates_.append(r.price_date)
        bcv = _bcv_for(r.price_date)
        closes_usd.append(c / bcv if bcv and bcv > 0 else None)

    current_price_bs = closes_bs[-1]
    current_bcv      = _bcv_for(dates_[-1]) or (sorted_bcv_dates and bcv_map[sorted_bcv_dates[-1]]) or None
    current_price_usd = (current_price_bs / current_bcv) if current_bcv else None

    cutoff_5y = today - _td(days=365 * 5)
    bs_5y  = [c for c, d in zip(closes_bs,  dates_) if d >= cutoff_5y]
    usd_5y = [c for c, d in zip(closes_usd, dates_) if d >= cutoff_5y and c is not None]
    usd_10y = [c for c in closes_usd if c is not None]

    avg_bs_5y   = sum(bs_5y)  / len(bs_5y)  if bs_5y  else None
    avg_usd_5y  = sum(usd_5y) / len(usd_5y) if usd_5y else None
    avg_usd_10y = sum(usd_10y) / len(usd_10y) if usd_10y else None

    pe_relative_5y = (current_price_bs  / avg_bs_5y)   if avg_bs_5y  else None
    cape_5y_usd    = (current_price_usd / avg_usd_5y)  if (current_price_usd and avg_usd_5y)  else None
    cape_10y_usd   = (current_price_usd / avg_usd_10y) if (current_price_usd and avg_usd_10y) else None

    def _verdict(r):
        if r is None: return "N/A"
        if r > 2.0:   return "BURBUJA"
        if r > 1.4:   return "CARO"
        if r >= 0.8:  return "JUSTO"
        if r >= 0.5:  return "BARATO"
        return "MUY_BARATO"

    return {
        "symbol": sym,
        "name": stock.name,
        "current_price_bs": round(current_price_bs, 4),
        "current_price_usd": round(current_price_usd, 4) if current_price_usd else None,
        "pe_relative_5y_bs": {
            "ratio": round(pe_relative_5y, 3) if pe_relative_5y else None,
            "avg_5y": round(avg_bs_5y, 4) if avg_bs_5y else None,
            "verdict": _verdict(pe_relative_5y),
            "samples": len(bs_5y),
        },
        "cape_5y_usd": {
            "ratio": round(cape_5y_usd, 3) if cape_5y_usd else None,
            "avg_5y_usd": round(avg_usd_5y, 4) if avg_usd_5y else None,
            "verdict": _verdict(cape_5y_usd),
            "samples": len(usd_5y),
        },
        "cape_10y_usd": {
            "ratio": round(cape_10y_usd, 3) if cape_10y_usd else None,
            "avg_10y_usd": round(avg_usd_10y, 4) if avg_usd_10y else None,
            "verdict": _verdict(cape_10y_usd),
            "samples": len(usd_10y),
        },
        "note": (
            "Sin EPS confiables en BVC, este CAPE proxy compara el precio actual "
            "contra el precio promedio histórico (deflactado por la tasa BCV) — "
            "estilo Shiller adaptado al mercado venezolano."
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Month-End Effect Indicator
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/month-end-effect/{symbol}")
async def get_month_end_effect(
    symbol: str,
    user_id: UUID = Depends(_get_uid),
    db: AsyncSession = Depends(get_db),
):
    """
    Detects whether a symbol shows a measurable month-end pattern.
    Groups historical daily returns by day-of-month and compares the
    average return of last-3 days vs all-other-days.
    """
    sym = symbol.upper().strip()
    res = await db.execute(select(Stock).where(Stock.symbol == sym))
    stock = res.scalar_one_or_none()
    if not stock:
        raise HTTPException(status_code=404, detail=f"{sym} no encontrado")

    res = await db.execute(
        select(PriceHistory.price_date, PriceHistory.close_price)
        .where(PriceHistory.stock_id == stock.id)
        .order_by(PriceHistory.price_date.asc())
    )
    rows = res.all()
    if len(rows) < 60:
        raise HTTPException(status_code=422, detail="Histórico insuficiente (<60 días)")

    # daily returns
    closes = [float(r.close_price) for r in rows if r.close_price]
    dates_ = [r.price_date for r in rows if r.close_price]
    rets = []
    for i in range(1, len(closes)):
        if closes[i-1] > 0:
            rets.append((dates_[i], (closes[i] - closes[i-1]) / closes[i-1]))

    # bucket by day-of-month
    by_dom: dict[int, list[float]] = {d: [] for d in range(1, 32)}
    for d, r in rets:
        by_dom[d.day].append(r)

    me_dom_set = {28, 29, 30, 31}
    me_returns:   list[float] = []
    other_returns: list[float] = []
    for dom, lst in by_dom.items():
        if dom in me_dom_set:
            me_returns.extend(lst)
        else:
            other_returns.extend(lst)

    if not me_returns or not other_returns:
        return {"symbol": sym, "has_signal": False, "note": "Datos insuficientes"}

    avg_me    = sum(me_returns)    / len(me_returns)
    avg_other = sum(other_returns) / len(other_returns)
    diff_pct  = (avg_me - avg_other) * 100
    win_rate_me = sum(1 for r in me_returns if r > 0) / len(me_returns)

    # By day of month chart
    per_dom = []
    for dom in range(1, 32):
        lst = by_dom[dom]
        if lst:
            per_dom.append({
                "day": dom,
                "avg_return_pct": round(sum(lst) / len(lst) * 100, 4),
                "win_rate": round(sum(1 for r in lst if r > 0) / len(lst), 3),
                "samples": len(lst),
            })

    signal = "ALCISTA_FIN_MES" if diff_pct > 0.10 else (
             "BAJISTA_FIN_MES" if diff_pct < -0.10 else "SIN_EFECTO")
    today = max(dates_).day if dates_ else 0
    is_now_meo = today in me_dom_set

    return {
        "symbol": sym,
        "name": stock.name,
        "has_signal": signal != "SIN_EFECTO",
        "signal": signal,
        "avg_return_month_end_pct":  round(avg_me    * 100, 4),
        "avg_return_other_days_pct": round(avg_other * 100, 4),
        "diff_pct": round(diff_pct, 4),
        "win_rate_month_end": round(win_rate_me, 3),
        "samples_month_end":   len(me_returns),
        "samples_other_days":  len(other_returns),
        "per_day_of_month": per_dom,
        "today_is_month_end_window": is_now_meo,
        "note": (
            "Compara el retorno promedio de los últimos 3 días del mes vs el resto. "
            "En Venezuela el cierre de mes mueve flujo por nóminas e impuestos."
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Range Breakout Scanner
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/breakout-scanner")
async def breakout_scanner(
    user_id: UUID = Depends(_get_uid),
    db: AsyncSession = Depends(get_db),
    window: int = 20,
):
    """
    Escanea TODAS las acciones activas y devuelve las que rompieron el alto/bajo
    de los últimos N días con volumen confirmatorio.
    """
    from datetime import date as _date, timedelta as _td

    if window < 5 or window > 252:
        window = 20

    res = await db.execute(select(Stock).where(Stock.is_active == True))
    stocks = res.scalars().all()

    today = _date.today()
    cutoff = today - _td(days=window * 2 + 5)

    breakouts_up:   list[dict] = []
    breakouts_down: list[dict] = []

    for s in stocks:
        res = await db.execute(
            select(PriceHistory.price_date,
                   PriceHistory.high_price,
                   PriceHistory.low_price,
                   PriceHistory.close_price,
                   PriceHistory.volume)
            .where(PriceHistory.stock_id == s.id)
            .where(PriceHistory.price_date >= cutoff)
            .order_by(PriceHistory.price_date.asc())
        )
        rows = res.all()
        if len(rows) < window + 1:
            continue

        recent = rows[-(window + 1):]
        prior  = recent[:-1]
        last   = recent[-1]
        last_close = float(last.close_price or 0)
        last_vol   = float(last.volume or 0)
        if last_close <= 0:
            continue

        prior_high = max(float(r.high_price or r.close_price or 0) for r in prior)
        prior_low_vals = [float(r.low_price or r.close_price or 0) for r in prior if (r.low_price or r.close_price)]
        prior_low  = min(prior_low_vals) if prior_low_vals else None
        avg_vol    = sum(float(r.volume or 0) for r in prior) / max(len(prior), 1)
        vol_ratio  = (last_vol / avg_vol) if avg_vol > 0 else 0

        if last_close > prior_high * 1.001:
            breakouts_up.append({
                "symbol": s.symbol,
                "name": s.name,
                "close": round(last_close, 4),
                "prior_high": round(prior_high, 4),
                "breakout_pct": round((last_close / prior_high - 1) * 100, 3),
                "volume_ratio": round(vol_ratio, 2),
                "high_volume_confirm": vol_ratio >= 1.5,
                "date": str(last.price_date),
            })
        elif prior_low and last_close < prior_low * 0.999:
            breakouts_down.append({
                "symbol": s.symbol,
                "name": s.name,
                "close": round(last_close, 4),
                "prior_low": round(prior_low, 4),
                "breakout_pct": round((last_close / prior_low - 1) * 100, 3),
                "volume_ratio": round(vol_ratio, 2),
                "high_volume_confirm": vol_ratio >= 1.5,
                "date": str(last.price_date),
            })

    breakouts_up.sort(key=lambda x: x["breakout_pct"], reverse=True)
    breakouts_down.sort(key=lambda x: x["breakout_pct"])

    # Calendar flag: end of month window or last 3 trading days of month
    is_month_end = today.day >= 26
    return {
        "window": window,
        "scanned": len(stocks),
        "breakouts_up":   breakouts_up,
        "breakouts_down": breakouts_down,
        "calendar_flag": {
            "is_month_end": is_month_end,
            "warning": (
                "ATENCIÓN: ventana de fin de mes — vigila manipulaciones por flujo de caja."
                if is_month_end else None
            ),
        },
        "note": (
            f"Detecta cierre del día por encima del máximo (o por debajo del mínimo) "
            f"de los últimos {window} días. Volumen >1.5× confirma la ruptura."
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# What-If Portfolio Comparator (hypothetical reweighting)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/what-if-portfolio")
async def what_if_portfolio(
    payload: dict,
    user_id: UUID = Depends(_get_uid),
    db: AsyncSession = Depends(get_db),
):
    """
    Compara el portafolio real del usuario vs un portafolio hipotético.
    payload = {
      "current_holdings": [{"symbol": "BNC", "qty": 100, "avg_cost_bs": 12.5}, ...],
      "what_if_weights":  {"BNC": 0.5, "MVZ.A": 0.5},
      "lookback_days":    365
    }
    """
    from datetime import date as _date, timedelta as _td

    holdings = payload.get("current_holdings") or []
    what_if  = payload.get("what_if_weights")  or {}
    lookback = int(payload.get("lookback_days") or 365)

    w_total = sum(max(float(v), 0) for v in what_if.values())
    if w_total <= 0:
        raise HTTPException(status_code=400, detail="what_if_weights vacío o inválido")
    what_if = {k.upper(): float(v) / w_total for k, v in what_if.items() if float(v) > 0}

    today = _date.today()
    cutoff = today - _td(days=lookback)

    all_syms = set([h.get("symbol", "").upper() for h in holdings if h.get("symbol")])
    all_syms.update(what_if.keys())

    closes_by_sym: dict[str, dict] = {}
    for sym in all_syms:
        res = await db.execute(select(Stock).where(Stock.symbol == sym))
        st = res.scalar_one_or_none()
        if not st:
            continue
        res = await db.execute(
            select(PriceHistory.price_date, PriceHistory.close_price)
            .where(PriceHistory.stock_id == st.id)
            .where(PriceHistory.price_date >= cutoff)
            .order_by(PriceHistory.price_date.asc())
        )
        rows = res.all()
        closes_by_sym[sym] = {r.price_date: float(r.close_price) for r in rows if r.close_price}

    # Aligned date axis = intersection
    common_dates = None
    for sym, mp in closes_by_sym.items():
        s = set(mp.keys())
        common_dates = s if common_dates is None else (common_dates & s)
    common_dates = sorted(common_dates or [])
    if len(common_dates) < 20:
        raise HTTPException(status_code=422, detail="Sin suficiente histórico común (<20 días)")

    # Real portfolio weights from current holdings (current value-weighted)
    last_d = common_dates[-1]
    real_value_total = 0.0
    real_pos_value: dict[str, float] = {}
    for h in holdings:
        sym = (h.get("symbol") or "").upper()
        qty = float(h.get("qty") or 0)
        if not sym or qty <= 0 or sym not in closes_by_sym:
            continue
        last_close = closes_by_sym[sym].get(last_d)
        if not last_close:
            continue
        v = qty * last_close
        real_pos_value[sym] = v
        real_value_total += v
    real_weights = {s: v / real_value_total for s, v in real_pos_value.items()} if real_value_total > 0 else {}

    def _curve(weights: dict) -> list[dict]:
        if not weights:
            return []
        base = 100.0
        out  = [{"date": str(common_dates[0]), "value": base}]
        for i in range(1, len(common_dates)):
            d_prev = common_dates[i-1]
            d_now  = common_dates[i]
            day_ret = 0.0
            for sym, w in weights.items():
                if sym not in closes_by_sym: continue
                p_prev = closes_by_sym[sym].get(d_prev)
                p_now  = closes_by_sym[sym].get(d_now)
                if not (p_prev and p_now): continue
                day_ret += w * ((p_now - p_prev) / p_prev)
            base *= (1 + day_ret)
            out.append({"date": str(d_now), "value": round(base, 4)})
        return out

    def _stats(curve: list[dict]) -> dict:
        if len(curve) < 2:
            return {"total_return_pct": 0.0, "volatility_pct": 0.0, "max_drawdown_pct": 0.0, "sharpe": 0.0}
        vals = [p["value"] for p in curve]
        rets = [(vals[i] - vals[i-1]) / vals[i-1] for i in range(1, len(vals))]
        mu = sum(rets) / len(rets)
        var = sum((r - mu) ** 2 for r in rets) / len(rets)
        sd = var ** 0.5
        peak = vals[0]; mdd = 0.0
        for v in vals:
            if v > peak: peak = v
            dd = (v - peak) / peak
            if dd < mdd: mdd = dd
        ann_ret = mu * 252
        ann_vol = sd * (252 ** 0.5)
        sharpe = (ann_ret / ann_vol) if ann_vol > 1e-9 else 0.0
        return {
            "total_return_pct": round((vals[-1] / vals[0] - 1) * 100, 3),
            "volatility_pct":   round(ann_vol * 100, 3),
            "max_drawdown_pct": round(mdd * 100, 3),
            "sharpe":           round(sharpe, 3),
        }

    real_curve   = _curve(real_weights)
    whatif_curve = _curve(what_if)

    return {
        "lookback_days": lookback,
        "common_dates":  len(common_dates),
        "real_weights":  {k: round(v, 4) for k, v in real_weights.items()},
        "what_if_weights": {k: round(v, 4) for k, v in what_if.items()},
        "real_curve":   real_curve,
        "whatif_curve": whatif_curve,
        "real_stats":   _stats(real_curve),
        "whatif_stats": _stats(whatif_curve),
        "note": (
            "Compara la evolución (base 100) de tu portafolio actual vs un escenario "
            "hipotético con los pesos que escojas. No es asesoría financiera."
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Confirmation Bias — AI counter-arguments
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/confirmation-bias")
async def confirmation_bias(
    payload: dict,
    user_id: UUID = Depends(_get_uid),
    db: AsyncSession = Depends(get_db),
):
    """
    Genera 3 contra-argumentos vía Gemini para forzar al usuario a pensar
    en el lado opuesto de su sesgo.

    payload = {
      "symbol":        "BNC",
      "user_view":     "BULLISH" | "BEARISH",
      "indicators":    { "rsi": 72, "ema20": ..., "macd_signal": "alcista", ... },
      "recent_change_pct": 8.4
    }
    """
    import google.generativeai as genai
    from app.config import settings

    sym       = (payload.get("symbol") or "").upper().strip()
    user_view = (payload.get("user_view") or "BULLISH").upper()
    indicators = payload.get("indicators") or {}
    recent_chg = payload.get("recent_change_pct")

    if not sym:
        raise HTTPException(status_code=400, detail="symbol requerido")
    if user_view not in ("BULLISH", "BEARISH"):
        user_view = "BULLISH"

    res = await db.execute(select(Stock).where(Stock.symbol == sym))
    stock = res.scalar_one_or_none()
    name = stock.name if stock else sym

    counter = "BAJISTAS" if user_view == "BULLISH" else "ALCISTAS"
    prompt = (
        f"Eres un analista escéptico de la BVC (Bolsa de Valores de Caracas). "
        f"El usuario está viendo {sym} ({name}) y tiene una visión {user_view}. "
        f"Tu trabajo es mostrarle 3 argumentos {counter} sólidos, basados en datos, "
        f"para forzar al usuario a cuestionar su sesgo de confirmación.\n\n"
        f"Contexto técnico actual:\n"
        f"- Cambio reciente: {recent_chg}%\n"
        f"- Indicadores: {indicators}\n\n"
        f"FORMATO DE RESPUESTA (JSON estricto, sin texto extra):\n"
        f'{{"arguments": [\n'
        f'  {{"thesis": "...", "evidence": "...", "risk_level": "ALTO|MEDIO|BAJO"}},\n'
        f'  ...3 argumentos...\n'
        f"]}}"
    )

    try:
        genai.configure(api_key=settings.gemini_api_key_clean, transport="rest")
        model = genai.GenerativeModel("gemini-2.5-flash")
        resp  = model.generate_content(prompt)
        raw   = (resp.text or "").strip()
        # quitar fences markdown si los hay
        if raw.startswith("```"):
            raw = raw.split("```", 2)[1]
            if raw.lower().startswith("json"):
                raw = raw[4:].strip()
        import json as _json
        data = _json.loads(raw)
        args = data.get("arguments", []) if isinstance(data, dict) else []
    except Exception as e:
        logger.warning(f"[CONFIRMATION-BIAS] Gemini parse error: {e}")
        # Fallback heurístico: argumentos genéricos basados en indicadores
        args = []
        rsi = indicators.get("rsi")
        if user_view == "BULLISH":
            if isinstance(rsi, (int, float)) and rsi > 70:
                args.append({"thesis": "RSI sobrecomprado", "evidence": f"RSI={rsi:.0f} sugiere agotamiento de momentum.", "risk_level": "ALTO"})
            args.append({"thesis": "Volatilidad política BVC", "evidence": "Anuncios regulatorios o cambios de gabinete pueden invertir tendencias en horas.", "risk_level": "ALTO"})
            args.append({"thesis": "Liquidez limitada", "evidence": "El bid/ask spread puede ampliarse rápido en venta agresiva.", "risk_level": "MEDIO"})
        else:
            args.append({"thesis": "Hiperinflación protege equity", "evidence": "Acciones en Bs son refugio relativo vs efectivo en bolívares.", "risk_level": "MEDIO"})
            args.append({"thesis": "Soporte técnico cercano", "evidence": "Si el precio toca soporte de 20d, hay rebote técnico probable.", "risk_level": "BAJO"})
            args.append({"thesis": "Devaluación bolívar", "evidence": "Presión devaluatoria empuja precios nominales al alza por reprice.", "risk_level": "MEDIO"})

    return {
        "symbol": sym,
        "name":   name,
        "user_view": user_view,
        "counter_view": "BEARISH" if user_view == "BULLISH" else "BULLISH",
        "arguments": args[:3],
        "note": (
            "El sesgo de confirmación nos hace ignorar evidencia contraria. "
            "Estos contra-argumentos son una herramienta de pensamiento crítico, "
            "no una recomendación de operación."
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Algorithmic Candle Pattern Detector
# ─────────────────────────────────────────────────────────────────────────────
# Detects classic Japanese candlestick patterns on the most recent N candles.
# Pure-python — no external TA libs.

def _candle_features(o: float, h: float, l: float, c: float):
    body  = abs(c - o)
    rng   = max(h - l, 1e-12)
    upper = h - max(o, c)
    lower = min(o, c) - l
    bullish = c > o
    return {
        "body": body, "range": rng, "upper": upper, "lower": lower,
        "body_ratio": body / rng, "bullish": bullish,
        "mid": (o + c) / 2.0,
    }


def _detect_patterns(candles: list[dict]) -> list[dict]:
    """`candles` = list of dicts {date, open, high, low, close, volume} (oldest→newest).
    Returns list of detected patterns with index + label + bias."""
    out: list[dict] = []
    n = len(candles)
    if n < 3:
        return out

    def _f(i):
        c = candles[i]
        return _candle_features(c["open"], c["high"], c["low"], c["close"])

    for i in range(2, n):
        c0, c1, c2 = candles[i - 2], candles[i - 1], candles[i]
        f0, f1, f2 = _f(i - 2), _f(i - 1), _f(i)
        date = c2["date"]

        # ── Doji ─────────────────────────────────────────────────────────────
        if f2["body_ratio"] < 0.10 and f2["range"] > 0:
            out.append({"date": date, "index": i, "name": "Doji",
                        "bias": "neutral",
                        "desc": "Indecisión: cierre ≈ apertura. Reversión potencial."})

        # ── Hammer / Hanging Man ─────────────────────────────────────────────
        if f2["lower"] >= 2 * f2["body"] and f2["upper"] <= f2["body"] * 0.5 and f2["body_ratio"] > 0.05:
            prior_trend = (candles[i - 1]["close"] - candles[max(0, i - 5)]["close"])
            if prior_trend < 0:
                out.append({"date": date, "index": i, "name": "Hammer",
                            "bias": "bullish",
                            "desc": "Tras tendencia bajista: posible reversión alcista."})
            else:
                out.append({"date": date, "index": i, "name": "Hanging Man",
                            "bias": "bearish",
                            "desc": "Tras tendencia alcista: posible reversión bajista."})

        # ── Shooting Star ────────────────────────────────────────────────────
        if f2["upper"] >= 2 * f2["body"] and f2["lower"] <= f2["body"] * 0.5 and f2["body_ratio"] > 0.05:
            prior_trend = (candles[i - 1]["close"] - candles[max(0, i - 5)]["close"])
            if prior_trend > 0:
                out.append({"date": date, "index": i, "name": "Shooting Star",
                            "bias": "bearish",
                            "desc": "Tras alza: rechazo en máximos, reversión bajista."})

        # ── Bullish Engulfing ────────────────────────────────────────────────
        if (not f1["bullish"]) and f2["bullish"] \
           and c2["close"] > c1["open"] and c2["open"] < c1["close"] \
           and f2["body"] > f1["body"]:
            out.append({"date": date, "index": i, "name": "Bullish Engulfing",
                        "bias": "bullish",
                        "desc": "Vela alcista envuelve a la previa bajista."})

        # ── Bearish Engulfing ────────────────────────────────────────────────
        if f1["bullish"] and (not f2["bullish"]) \
           and c2["open"] > c1["close"] and c2["close"] < c1["open"] \
           and f2["body"] > f1["body"]:
            out.append({"date": date, "index": i, "name": "Bearish Engulfing",
                        "bias": "bearish",
                        "desc": "Vela bajista envuelve a la previa alcista."})

        # ── Three White Soldiers ─────────────────────────────────────────────
        if f0["bullish"] and f1["bullish"] and f2["bullish"] \
           and c1["close"] > c0["close"] and c2["close"] > c1["close"] \
           and c1["open"] > c0["open"] and c2["open"] > c1["open"] \
           and f0["body_ratio"] > 0.55 and f1["body_ratio"] > 0.55 and f2["body_ratio"] > 0.55:
            out.append({"date": date, "index": i, "name": "Three White Soldiers",
                        "bias": "bullish",
                        "desc": "Tres velas alcistas consecutivas con cierres ascendentes."})

        # ── Three Black Crows ────────────────────────────────────────────────
        if (not f0["bullish"]) and (not f1["bullish"]) and (not f2["bullish"]) \
           and c1["close"] < c0["close"] and c2["close"] < c1["close"] \
           and c1["open"] < c0["open"] and c2["open"] < c1["open"] \
           and f0["body_ratio"] > 0.55 and f1["body_ratio"] > 0.55 and f2["body_ratio"] > 0.55:
            out.append({"date": date, "index": i, "name": "Three Black Crows",
                        "bias": "bearish",
                        "desc": "Tres velas bajistas consecutivas con cierres descendentes."})

        # ── Morning Star ─────────────────────────────────────────────────────
        if (not f0["bullish"]) and f0["body_ratio"] > 0.5 \
           and f1["body_ratio"] < 0.3 \
           and f2["bullish"] and f2["body_ratio"] > 0.5 \
           and c2["close"] > (c0["open"] + c0["close"]) / 2.0:
            out.append({"date": date, "index": i, "name": "Morning Star",
                        "bias": "bullish",
                        "desc": "Reversión alcista de 3 velas tras tendencia bajista."})

        # ── Evening Star ─────────────────────────────────────────────────────
        if f0["bullish"] and f0["body_ratio"] > 0.5 \
           and f1["body_ratio"] < 0.3 \
           and (not f2["bullish"]) and f2["body_ratio"] > 0.5 \
           and c2["close"] < (c0["open"] + c0["close"]) / 2.0:
            out.append({"date": date, "index": i, "name": "Evening Star",
                        "bias": "bearish",
                        "desc": "Reversión bajista de 3 velas tras tendencia alcista."})

        # ── Piercing Line ────────────────────────────────────────────────────
        if (not f1["bullish"]) and f2["bullish"] \
           and c2["open"] < c1["low"] \
           and c2["close"] > (c1["open"] + c1["close"]) / 2.0 \
           and c2["close"] < c1["open"]:
            out.append({"date": date, "index": i, "name": "Piercing Line",
                        "bias": "bullish",
                        "desc": "Penetración alcista sobre el cuerpo de la vela bajista previa."})

        # ── Dark Cloud Cover ─────────────────────────────────────────────────
        if f1["bullish"] and (not f2["bullish"]) \
           and c2["open"] > c1["high"] \
           and c2["close"] < (c1["open"] + c1["close"]) / 2.0 \
           and c2["close"] > c1["open"]:
            out.append({"date": date, "index": i, "name": "Dark Cloud Cover",
                        "bias": "bearish",
                        "desc": "Penetración bajista sobre el cuerpo de la vela alcista previa."})

    return out


@router.get("/candle-patterns/{symbol}")
async def get_candle_patterns(
    symbol: str,
    lookback: int = 60,
    user_id: UUID = Depends(_get_uid),
    db: AsyncSession = Depends(get_db),
):
    """Detect classic candlestick patterns over the last `lookback` daily candles."""
    sym = symbol.upper().strip()
    res = await db.execute(select(Stock).where(Stock.symbol == sym))
    stock = res.scalar_one_or_none()
    if not stock:
        raise HTTPException(status_code=404, detail=f"{sym} no encontrado")

    res = await db.execute(
        select(PriceHistory.price_date, PriceHistory.open_price,
               PriceHistory.high_price, PriceHistory.low_price,
               PriceHistory.close_price, PriceHistory.volume)
        .where(PriceHistory.stock_id == stock.id)
        .order_by(PriceHistory.price_date.desc())
        .limit(max(10, min(lookback, 365)))
    )
    rows = list(reversed(res.all()))
    if len(rows) < 5:
        raise HTTPException(status_code=422, detail="Histórico insuficiente (<5 velas)")

    candles = []
    for r in rows:
        try:
            candles.append({
                "date":   r.price_date.isoformat(),
                "open":   float(r.open_price),
                "high":   float(r.high_price),
                "low":    float(r.low_price),
                "close":  float(r.close_price),
                "volume": float(r.volume) if r.volume else 0.0,
            })
        except Exception:
            continue

    patterns = _detect_patterns(candles)

    # Aggregate signal: most recent 5 candles' bias score
    recent = [p for p in patterns if p["index"] >= len(candles) - 5]
    score = sum((1 if p["bias"] == "bullish" else -1 if p["bias"] == "bearish" else 0) for p in recent)
    signal = "ALCISTA" if score >= 2 else "BAJISTA" if score <= -2 else "NEUTRAL"

    return {
        "symbol": sym,
        "candles_count": len(candles),
        "patterns": patterns,
        "recent_count": len(recent),
        "score": score,
        "signal": signal,
        "note": "Detección puramente algorítmica de patrones japoneses clásicos sobre velas diarias.",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Candle Heatmap by hour (today's intraday in-memory buckets)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/intraday-hourly")
async def intraday_hourly(
    symbol: str | None = None,
    user_id: UUID = Depends(_get_uid),
):
    """Today's per-hour OHLCV from the in-memory aggregator fed by the BVC socket.
    Returns empty rows until the proxy receives at least one serverDataExt."""
    from app.websocket.bvc_proxy import get_intraday_hourly
    return get_intraday_hourly(symbol)
