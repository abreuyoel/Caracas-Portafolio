"""
Admin endpoints — acceso restringido al administrador de la plataforma.
"""
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from app.database import get_db
from app.models.user import User
from app.models.transaction import Transaction
from app.models.stock import Stock
from app.utils.email import _send, _email_wrapper
from app.utils.security import decode_token
from typing import Optional
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

# Email del admin autorizado
ADMIN_EMAIL = "abreuyoel22@gmail.com"

MIN_AMOUNT_USD = 500.0


async def require_admin(authorization: str = Header(...)) -> str:
    """Valida que el token pertenezca al administrador."""
    try:
        payload = decode_token(authorization.replace("Bearer ", "").strip())
        email = payload.get("email") or ""
        if email.lower() != ADMIN_EMAIL.lower():
            raise HTTPException(status_code=403, detail="Acceso denegado — solo el administrador puede usar esta ruta")
        return email
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido")


def _build_big_investor_email(username: str, symbol: str, amount_usd: float) -> str:
    """Construye el HTML del correo motivacional para grandes inversores."""
    body = f"""
      <!-- Saludo principal -->
      <h2 style="color:#e0e6f0;font-size:1.4rem;font-weight:900;margin:0 0 8px;letter-spacing:-0.02em;">
        🎉 ¡Guao, mi pana inversor!
      </h2>
      <p style="color:#7090a8;font-size:0.92rem;line-height:1.7;margin:0 0 20px;">
        Hola <strong style="color:#c0d0e0;">{username}</strong>,
        acabas de registrar una de tus inversiones más importantes en
        <strong style="color:#818cf8;">{symbol}</strong> dentro de
        <strong style="color:#c0d0e0;">Caracas Portafolio</strong>. ¡Felicitaciones!
      </p>

      <!-- Divider gradient -->
      <div style="height:1px;background:linear-gradient(90deg,transparent,#4C62FF,transparent);margin:0 0 22px;"></div>

      <!-- Mensaje central -->
      <p style="color:#a0b0c8;font-size:0.92rem;line-height:1.75;margin:0 0 22px;">
        Cada Bolívar que inviertes en la Bolsa de Caracas es un paso hacia la libertad financiera
        en Venezuela. Eres parte de una comunidad de inversores que creen en el mercado local
        y trabajan para construir riqueza en su propio país. 🇻🇪
      </p>

      <p style="color:#a0b0c8;font-size:0.92rem;line-height:1.75;margin:0 0 24px;">
        Sigue registrando tus transacciones en <strong style="color:#c0d0e0;">Caracas Portafolio</strong>
        de manera manual o a través de la <strong style="color:#818cf8;">Subida Masiva desde Excel</strong>:
      </p>

      <!-- Pasos -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
        <tr>
          <td width="36" valign="top">
            <div style="width:28px;height:28px;background:linear-gradient(135deg,#4C62FF,#7c4dff);border-radius:8px;
                        text-align:center;line-height:28px;font-size:0.85rem;font-weight:700;color:#fff;">1</div>
          </td>
          <td style="padding-left:12px;vertical-align:top;">
            <div style="color:#c0d0e0;font-size:0.87rem;font-weight:700;margin-bottom:2px;">Descarga la plantilla Excel</div>
            <div style="color:#556070;font-size:0.8rem;line-height:1.5;">
              Ve a Transacciones → Importar y descarga la plantilla con el formato correcto.
            </div>
          </td>
        </tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
        <tr>
          <td width="36" valign="top">
            <div style="width:28px;height:28px;background:linear-gradient(135deg,#4C62FF,#7c4dff);border-radius:8px;
                        text-align:center;line-height:28px;font-size:0.85rem;font-weight:700;color:#fff;">2</div>
          </td>
          <td style="padding-left:12px;vertical-align:top;">
            <div style="color:#c0d0e0;font-size:0.87rem;font-weight:700;margin-bottom:2px;">Llena tus operaciones</div>
            <div style="color:#556070;font-size:0.8rem;line-height:1.5;">
              Agrega símbolo, fecha, cantidad, precio y la tasa BCV del día.
            </div>
          </td>
        </tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td width="36" valign="top">
            <div style="width:28px;height:28px;background:linear-gradient(135deg,#4C62FF,#7c4dff);border-radius:8px;
                        text-align:center;line-height:28px;font-size:0.85rem;font-weight:700;color:#fff;">3</div>
          </td>
          <td style="padding-left:12px;vertical-align:top;">
            <div style="color:#c0d0e0;font-size:0.87rem;font-weight:700;margin-bottom:2px;">Sube el archivo y listo</div>
            <div style="color:#556070;font-size:0.8rem;line-height:1.5;">
              El sistema importa todas las transacciones en segundos y actualiza tu portafolio.
            </div>
          </td>
        </tr>
      </table>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:24px;">
        <a href="https://caracasportafolio.com/transactions/new"
           style="display:inline-block;background:linear-gradient(135deg,#4C62FF,#7c4dff);color:#ffffff;
                  text-decoration:none;padding:14px 32px;border-radius:12px;font-size:0.92rem;
                  font-weight:700;box-shadow:0 4px 20px rgba(76,98,255,0.4);letter-spacing:0.01em;">
          + Registrar nueva transacción
        </a>
      </div>

      <div style="height:1px;background:linear-gradient(90deg,transparent,#2a3a58,transparent);margin:0 0 18px;"></div>

      <p style="color:#3a4a60;font-size:0.8rem;text-align:center;margin:0;line-height:1.7;">
        Construyendo juntos la comunidad de inversores venezolanos más grande. 💙<br>
        <span style="color:#2a3a50;">¿Dudas? →
          <a href="mailto:privacy@caracasportafolio.com" style="color:#4C62FF;text-decoration:none;">privacy@caracasportafolio.com</a>
        </span>
      </p>
    """
    return _email_wrapper("#4C62FF", "🚀", body)


def _build_bcv_mismatch_email(username: str, conflicts: list[dict]) -> str:
    """Email personalizado para usuarios con tasas BCV inconsistentes en sus transacciones."""
    rows_html = ""
    for c in conflicts:
        diff_pct = abs(float(c['tx_rate']) - float(c['official_rate'])) / float(c['official_rate']) * 100
        rows_html += f"""
        <tr>
          <td style="padding:9px 12px;color:#c0d0e0;font-size:0.82rem;border-bottom:1px solid #1a2a40;
                     font-family:'Courier New',monospace;">{c['transaction_date']}</td>
          <td style="padding:9px 12px;color:#818cf8;font-size:0.82rem;border-bottom:1px solid #1a2a40;
                     font-weight:700;">{c['symbol']}</td>
          <td style="padding:9px 12px;color:#fbbf24;font-size:0.82rem;border-bottom:1px solid #1a2a40;
                     text-align:right;">{float(c['tx_rate']):.2f}</td>
          <td style="padding:9px 12px;color:#34d399;font-size:0.82rem;border-bottom:1px solid #1a2a40;
                     text-align:right;">{float(c['official_rate']):.2f}</td>
          <td style="padding:9px 12px;color:#f87171;font-size:0.82rem;border-bottom:1px solid #1a2a40;
                     text-align:right;font-weight:700;">+{diff_pct:.1f}%</td>
        </tr>"""

    body = f"""
      <h2 style="color:#e0e6f0;font-size:1.3rem;font-weight:900;margin:0 0 6px;letter-spacing:-0.02em;">
        ⚠️ Revisión de tasas BCV en tu portafolio
      </h2>
      <p style="color:#7090a8;font-size:0.9rem;line-height:1.7;margin:0 0 20px;">
        Hola <strong style="color:#c0d0e0;">{username}</strong>,<br>
        queremos ayudarte a preservar la integridad de tu portafolio. Detectamos que algunas de
        tus transacciones registradas tienen una <strong style="color:#fbbf24;">tasa BCV</strong>
        que no coincide con la tasa oficial del día registrada en nuestro sistema.
      </p>

      <div style="height:1px;background:linear-gradient(90deg,transparent,#fbbf2440,transparent);margin:0 0 22px;"></div>

      <p style="color:#8090a8;font-size:0.75rem;font-weight:700;text-transform:uppercase;
                letter-spacing:0.08em;margin:0 0 12px;">Transacciones con discrepancia detectada</p>

      <!-- Tabla de conflictos -->
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:#080e1c;border-radius:12px;border:1px solid #1e2a40;
                    overflow:hidden;margin-bottom:24px;">
        <thead>
          <tr style="background:#0f1a30;">
            <th style="padding:9px 12px;color:#4a6090;font-size:0.73rem;font-weight:700;
                       text-align:left;text-transform:uppercase;letter-spacing:0.06em;">Fecha</th>
            <th style="padding:9px 12px;color:#4a6090;font-size:0.73rem;font-weight:700;
                       text-align:left;text-transform:uppercase;letter-spacing:0.06em;">Acción</th>
            <th style="padding:9px 12px;color:#4a6090;font-size:0.73rem;font-weight:700;
                       text-align:right;text-transform:uppercase;letter-spacing:0.06em;">Tasa registrada</th>
            <th style="padding:9px 12px;color:#4a6090;font-size:0.73rem;font-weight:700;
                       text-align:right;text-transform:uppercase;letter-spacing:0.06em;">Tasa oficial BCV</th>
            <th style="padding:9px 12px;color:#4a6090;font-size:0.73rem;font-weight:700;
                       text-align:right;text-transform:uppercase;letter-spacing:0.06em;">Diferencia</th>
          </tr>
        </thead>
        <tbody>{rows_html}</tbody>
      </table>

      <p style="color:#a0b0c8;font-size:0.88rem;line-height:1.75;margin:0 0 20px;">
        Una tasa BCV incorrecta afecta el cálculo de tu <strong style="color:#c0d0e0;">valor en USD</strong>,
        tu P&amp;L real y los reportes históricos de tu portafolio. Te recomendamos revisar y actualizar
        estas transacciones para mantener la precisión de tus datos.
      </p>

      <!-- CTAs -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td style="text-align:center;">
            <a href="https://caracasportafolio.com/transactions"
               style="display:inline-block;background:linear-gradient(135deg,#4C62FF,#7c4dff);color:#ffffff;
                      text-decoration:none;padding:13px 28px;border-radius:12px;font-size:0.88rem;
                      font-weight:700;box-shadow:0 4px 20px rgba(76,98,255,0.4);margin-right:8px;">
              ✏️ Actualizar mis transacciones
            </a>
            <a href="mailto:privacy@caracasportafolio.com?subject=Soporte%3A%20Tasas%20BCV&body=Hola%2C%20necesito%20ayuda%20con%20las%20tasas%20BCV%20de%20mis%20transacciones."
               style="display:inline-block;background:#111c30;border:1px solid #2a3a58;color:#7eb8ff;
                      text-decoration:none;padding:12px 22px;border-radius:12px;font-size:0.85rem;font-weight:600;">
              💬 Contactar soporte
            </a>
          </td>
        </tr>
      </table>

      <div style="height:1px;background:linear-gradient(90deg,transparent,#2a3a58,transparent);margin:0 0 18px;"></div>

      <p style="color:#3a4a60;font-size:0.8rem;text-align:center;margin:0;line-height:1.7;">
        Respondiendo este correo puedes obtener soporte personalizado para tu caso. 💙<br>
        <span style="color:#2a3a50;">¿Dudas? →
          <a href="mailto:privacy@caracasportafolio.com" style="color:#4C62FF;text-decoration:none;">
            privacy@caracasportafolio.com
          </a>
        </span>
      </p>
    """
    return _email_wrapper("#fbbf24", "⚠️", body)


@router.get("/big-investors/preview")
async def preview_big_investors(
    admin_email: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Devuelve la lista de usuarios con al menos una transacción >= $500 USD.
    No envía emails. Útil para ver a quién se enviará el correo antes de confirmar.
    """
    rows = await db.execute(
        select(
            Transaction.user_id,
            User.email,
            User.username,
            func.max(Transaction.amount_usd).label("max_amount_usd"),
            func.count(Transaction.id).label("tx_count"),
        )
        .join(User, User.id == Transaction.user_id)
        .where(Transaction.amount_usd >= MIN_AMOUNT_USD)
        .group_by(Transaction.user_id, User.email, User.username)
        .order_by(func.max(Transaction.amount_usd).desc())
    )
    results = rows.all()

    return {
        "count": len(results),
        "min_amount_usd": MIN_AMOUNT_USD,
        "users": [
            {
                "user_id": str(r.user_id),
                "email": r.email,
                "username": r.username,
                "max_amount_usd": float(r.max_amount_usd),
                "tx_count": r.tx_count,
            }
            for r in results
        ],
    }


@router.post("/big-investors/send-emails")
async def send_big_investor_emails(
    admin_email: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Envía correo motivacional a todos los usuarios que tienen al menos
    una transacción >= $500 USD.
    """
    # Obtener usuarios con su mayor transacción y el símbolo asociado
    rows = await db.execute(
        select(
            Transaction.user_id,
            User.email,
            User.username,
            func.max(Transaction.amount_usd).label("max_amount_usd"),
        )
        .join(User, User.id == Transaction.user_id)
        .where(Transaction.amount_usd >= MIN_AMOUNT_USD)
        .group_by(Transaction.user_id, User.email, User.username)
        .order_by(func.max(Transaction.amount_usd).desc())
    )
    targets = rows.all()

    if not targets:
        return {"sent": 0, "errors": 0, "message": "No hay usuarios con transacciones >= $500"}

    sent = 0
    errors = 0
    details = []

    for row in targets:
        try:
            # Obtener el símbolo de la transacción más grande de ese usuario
            sym_row = await db.execute(
                select(Stock.symbol)
                .join(Transaction, Transaction.stock_id == Stock.id)
                .where(
                    Transaction.user_id == row.user_id,
                    Transaction.amount_usd == row.max_amount_usd,
                )
                .limit(1)
            )
            symbol = sym_row.scalar_one_or_none() or "BVC"

            html = _build_big_investor_email(
                username=row.username,
                symbol=symbol,
                amount_usd=float(row.max_amount_usd),
            )

            ok = await _send(
                to_email=row.email,
                subject=f"¡Guao, {row.username}! Ya eres un gran inversor en la BVC 🚀",
                html=html,
            )

            if ok:
                sent += 1
                details.append({"email": row.email, "status": "sent", "symbol": symbol})
            else:
                errors += 1
                details.append({"email": row.email, "status": "error"})
        except Exception as e:
            logger.error(f"Error enviando a {row.email}: {e}")
            errors += 1
            details.append({"email": row.email, "status": "error", "detail": str(e)})

    logger.info(f"Admin email campaign: {sent} sent, {errors} errors")
    return {
        "sent": sent,
        "errors": errors,
        "total": len(targets),
        "details": details,
    }


@router.get("/bcv-rate-mismatch/preview")
async def preview_bcv_rate_mismatch(
    admin_email: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Devuelve usuarios cuyas transacciones tienen un bcv_rate distinto
    a la tasa oficial BCV registrada para esa misma fecha (tolerancia ±0.01).
    """
    rows = await db.execute(text("""
        SELECT
            t.user_id::text,
            u.email,
            u.username,
            t.transaction_date::text,
            t.bcv_rate      AS tx_rate,
            b.rate          AS official_rate,
            s.symbol,
            t.id            AS tx_id
        FROM transactions t
        JOIN users u     ON u.id   = t.user_id
        JOIN bcv_rates b ON b.rate_date = t.transaction_date
        JOIN stocks s    ON s.id   = t.stock_id
        WHERE t.bcv_rate IS NOT NULL
          AND b.rate IS NOT NULL
          AND ABS(t.bcv_rate - b.rate) > 0.01
        ORDER BY u.username, t.transaction_date
    """))
    data = rows.mappings().all()

    # Group by user
    users: dict = {}
    for r in data:
        uid = r["user_id"]
        if uid not in users:
            users[uid] = {
                "user_id": uid,
                "email": r["email"],
                "username": r["username"],
                "conflicts": [],
            }
        users[uid]["conflicts"].append({
            "tx_id": r["tx_id"],
            "transaction_date": r["transaction_date"],
            "symbol": r["symbol"],
            "tx_rate": float(r["tx_rate"]),
            "official_rate": float(r["official_rate"]),
        })

    result = list(users.values())
    return {
        "count": len(result),
        "total_conflicts": len(data),
        "users": result,
    }


@router.post("/bcv-rate-mismatch/send-emails")
async def send_bcv_mismatch_emails(
    admin_email: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Envía correo de alerta de tasa BCV a cada usuario afectado.
    """
    rows = await db.execute(text("""
        SELECT
            t.user_id::text,
            u.email,
            u.username,
            t.transaction_date::text,
            t.bcv_rate      AS tx_rate,
            b.rate          AS official_rate,
            s.symbol,
            t.id            AS tx_id
        FROM transactions t
        JOIN users u     ON u.id   = t.user_id
        JOIN bcv_rates b ON b.rate_date = t.transaction_date
        JOIN stocks s    ON s.id   = t.stock_id
        WHERE t.bcv_rate IS NOT NULL
          AND b.rate IS NOT NULL
          AND ABS(t.bcv_rate - b.rate) > 0.01
        ORDER BY u.username, t.transaction_date
    """))
    data = rows.mappings().all()

    users: dict = {}
    for r in data:
        uid = r["user_id"]
        if uid not in users:
            users[uid] = {
                "email": r["email"],
                "username": r["username"],
                "conflicts": [],
            }
        users[uid]["conflicts"].append({
            "transaction_date": r["transaction_date"],
            "symbol": r["symbol"],
            "tx_rate": float(r["tx_rate"]),
            "official_rate": float(r["official_rate"]),
        })

    if not users:
        return {"sent": 0, "errors": 0, "message": "No hay transacciones con tasa BCV inconsistente"}

    sent = 0
    errors = 0
    details = []

    for uid, info in users.items():
        try:
            html = _build_bcv_mismatch_email(
                username=info["username"],
                conflicts=info["conflicts"],
            )
            ok = await _send(
                to_email=info["email"],
                subject=f"⚠️ Revisión de tasas BCV en tu portafolio — Caracas Portafolio",
                html=html,
            )
            if ok:
                sent += 1
                details.append({"email": info["email"], "status": "sent", "conflicts": len(info["conflicts"])})
            else:
                errors += 1
                details.append({"email": info["email"], "status": "error"})
        except Exception as e:
            logger.error(f"Error enviando BCV mismatch a {info['email']}: {e}")
            errors += 1
            details.append({"email": info["email"], "status": "error", "detail": str(e)})

    return {"sent": sent, "errors": errors, "total": len(users), "details": details}
