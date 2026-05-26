import httpx
import logging
from app.config import settings

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"
FROM_ADDRESS = "Caracas Portafolio <privacy@caracasportafolio.com>"


async def _send(to_email: str, subject: str, html: str) -> bool:
    """Envía un email via Resend API."""
    if not settings.resend_api_key:
        logger.warning("RESEND_API_KEY no configurado — email no enviado")
        return False

    payload = {
        "from": FROM_ADDRESS,
        "to": [to_email],
        "subject": subject,
        "html": html,
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                RESEND_URL,
                json=payload,
                headers={
                    "Authorization": f"Bearer {settings.resend_api_key.strip()}",
                    "Content-Type": "application/json",
                },
            )
        if resp.status_code in (200, 201):
            logger.info(f"✅ Email enviado a {to_email} | id={resp.json().get('id')}")
            return True
        else:
            logger.error(f"❌ Resend error {resp.status_code}: {resp.text}")
            return False
    except Exception as e:
        logger.error(f"❌ Error enviando email a {to_email}: {e}")
        return False


def _email_wrapper(title_color: str, icon: str, body_html: str) -> str:
    """Plantilla base compartida para todos los emails."""
    return f"""<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#060b14;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#060b14;min-height:100vh;">
    <tr><td align="center" style="padding:48px 20px;">
      <table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;background:#0d1525;border-radius:20px;border:1px solid #1e2a40;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0f1e3a 0%,#0d1525 100%);padding:32px 40px 24px;text-align:center;border-bottom:1px solid #1e2a40;">
            <div style="font-size:2.4rem;margin-bottom:10px;">{icon}</div>
            <div style="font-size:1.35rem;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">
              Caracas <span style="color:#4C62FF;">Portafolio</span>
            </div>
            <div style="width:48px;height:3px;background:linear-gradient(90deg,#4C62FF,#8b5cf6);border-radius:2px;margin:14px auto 0;"></div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px 32px;">
            {body_html}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:18px 40px 24px;border-top:1px solid #141e30;text-align:center;">
            <p style="color:#2a3a58;font-size:0.72rem;margin:0;line-height:1.5;">
              © 2026 Caracas Portafolio · Plataforma independiente, no afiliada a la BVC<br>
              Recibiste este correo porque tienes una cuenta en caracasportafolio.com
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


async def send_verification_email(to_email: str, token: str) -> bool:
    """Envía el correo de verificación de cuenta."""
    verify_url = f"{settings.frontend_url}/auth/verify-email?token={token}"

    body = f"""
      <h2 style="color:#e0e6f0;font-size:1.25rem;font-weight:700;margin:0 0 10px;">
        Confirma tu dirección de correo
      </h2>
      <p style="color:#7090a8;font-size:0.9rem;line-height:1.7;margin:0 0 28px;">
        Para empezar a gestionar tu portafolio en la Bolsa de Caracas, necesitas
        verificar que este correo te pertenece. El enlace expira en <strong style="color:#c0d0e0;">24 horas</strong>.
      </p>

      <div style="text-align:center;margin-bottom:28px;">
        <a href="{verify_url}"
           style="display:inline-block;background:linear-gradient(135deg,#3a5fc0,#5040c0);color:#ffffff;
                  text-decoration:none;padding:15px 36px;border-radius:12px;font-size:0.95rem;
                  font-weight:700;letter-spacing:0.02em;box-shadow:0 4px 20px rgba(76,98,255,0.35);">
          ✓ &nbsp;Verificar mi cuenta
        </a>
      </div>

      <p style="color:#3a5070;font-size:0.78rem;text-align:center;margin:0 0 6px;">
        Si el botón no funciona, copia este enlace en tu navegador:
      </p>
      <p style="background:#0a0f1e;border:1px solid #1e2a40;border-radius:8px;padding:10px 14px;
                font-size:0.72rem;color:#4a6090;word-break:break-all;margin:0;text-align:center;">
        {verify_url}
      </p>

      <p style="color:#2a3a50;font-size:0.78rem;margin:20px 0 0;text-align:center;">
        Si no creaste esta cuenta, ignora este mensaje.
      </p>
    """

    html = _email_wrapper("#4C62FF", "📩", body)
    return await _send(to_email, "Verifica tu cuenta – Caracas Portafolio", html)


async def send_password_reset_email(to_email: str, code: str, username: str) -> bool:
    """Envía el código OTP de 6 dígitos para restablecer contraseña."""
    body = f"""
      <h2 style="color:#e0e6f0;font-size:1.25rem;font-weight:700;margin:0 0 8px;">
        Código para restablecer tu contraseña
      </h2>
      <p style="color:#7090a8;font-size:0.9rem;line-height:1.7;margin:0 0 24px;">
        Hola <strong style="color:#c0d0e0;">{username}</strong>, recibimos una solicitud para restablecer
        la contraseña de tu cuenta. Usa el siguiente código:
      </p>

      <!-- OTP Code -->
      <div style="text-align:center;margin-bottom:28px;">
        <div style="display:inline-block;background:#0a0f1e;border:2px solid #3a5fc0;border-radius:16px;
                    padding:20px 40px;">
          <div style="font-size:2.4rem;font-weight:800;letter-spacing:0.22em;color:#7eb8ff;
                      font-family:'Courier New',monospace;">
            {code}
          </div>
        </div>
      </div>

      <p style="color:#3a5070;font-size:0.82rem;text-align:center;margin:0 0 6px;">
        Este código expira en <strong style="color:#c0d0e0;">15 minutos</strong>.
      </p>
      <p style="color:#2a3a50;font-size:0.78rem;text-align:center;margin:0;">
        Si no solicitaste este cambio, ignora este correo. Tu contraseña no cambiará.
      </p>
    """
    html = _email_wrapper("#ef5350", "🔐", body)
    return await _send(to_email, "Tu código para restablecer contraseña – Caracas Portafolio", html)


async def send_welcome_email(to_email: str, username: str) -> bool:
    """Envía el correo de bienvenida tras verificar el email."""
    dashboard_url    = f"{settings.frontend_url}/dashboard"
    transactions_url = f"{settings.frontend_url}/transactions/new"
    montecarlo_url   = f"{settings.frontend_url}/montecarlo"

    body = f"""
      <!-- Saludo principal -->
      <h2 style="color:#e0e6f0;font-size:1.35rem;font-weight:800;margin:0 0 6px;letter-spacing:-0.01em;">
        ¡Bienvenido a la comunidad, {username}! 🎉
      </h2>
      <p style="color:#7090a8;font-size:0.9rem;line-height:1.7;margin:0 0 20px;">
        Estamos muy contentos de que formes parte de <strong style="color:#c0d0e0;">Caracas Portafolio</strong>.
        Cada nuevo inversor que se suma fortalece nuestra comunidad y nos ayuda a construir
        mejores herramientas para todos. ¡Gracias por confiar en nosotros!
      </p>

      <!-- Divider -->
      <div style="height:1px;background:linear-gradient(90deg,transparent,#2a3a58,transparent);margin:0 0 20px;"></div>

      <!-- 3 pasos -->
      <p style="color:#8090a8;font-size:0.78rem;font-weight:700;text-transform:uppercase;
                letter-spacing:0.08em;margin:0 0 12px;">Por dónde empezar</p>

      <!-- Paso 1 -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
        <tr>
          <td width="44" valign="top" style="padding-top:2px;">
            <div style="width:36px;height:36px;background:#1a2a48;border:1px solid #2a3a58;border-radius:10px;
                        text-align:center;line-height:36px;font-size:1.1rem;">📈</div>
          </td>
          <td style="padding-left:14px;vertical-align:top;">
            <div style="color:#c0d0e0;font-size:0.88rem;font-weight:700;margin-bottom:3px;">Registra tus transacciones</div>
            <div style="color:#556070;font-size:0.8rem;line-height:1.5;">
              Agrega tus compras y ventas una por una, o de manera masiva usando nuestra
              <strong style="color:#7eb8ff;">plantilla Excel</strong>. La encontrarás en el módulo
              de Transacciones → Importar. El sistema calculará tu rendimiento real automáticamente.
            </div>
          </td>
        </tr>
      </table>

      <!-- Paso 2 -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
        <tr>
          <td width="44" valign="top" style="padding-top:2px;">
            <div style="width:36px;height:36px;background:#1a2a48;border:1px solid #2a3a58;border-radius:10px;
                        text-align:center;line-height:36px;font-size:1.1rem;">📊</div>
          </td>
          <td style="padding-left:14px;vertical-align:top;">
            <div style="color:#c0d0e0;font-size:0.88rem;font-weight:700;margin-bottom:3px;">Analiza tu portafolio</div>
            <div style="color:#556070;font-size:0.8rem;line-height:1.5;">
              Visualiza tu P&amp;L, asignación por acción, rendimiento histórico y mucho más
              en la sección de Portafolio. Todo en tiempo real con precios de la BVC.
            </div>
          </td>
        </tr>
      </table>

      <!-- Paso 3 -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td width="44" valign="top" style="padding-top:2px;">
            <div style="width:36px;height:36px;background:#1a2a48;border:1px solid #2a3a58;border-radius:10px;
                        text-align:center;line-height:36px;font-size:1.1rem;">🔮</div>
          </td>
          <td style="padding-left:14px;vertical-align:top;">
            <div style="color:#c0d0e0;font-size:0.88rem;font-weight:700;margin-bottom:3px;">Simula el futuro con Monte Carlo</div>
            <div style="color:#556070;font-size:0.8rem;line-height:1.5;">
              Proyecta miles de escenarios futuros de tu portafolio usando retornos históricos
              reales de la BVC. Una herramienta profesional al alcance de todos.
            </div>
          </td>
        </tr>
      </table>

      <!-- CTAs -->
      <div style="text-align:center;margin-bottom:12px;">
        <a href="{transactions_url}"
           style="display:inline-block;background:linear-gradient(135deg,#3a5fc0,#5040c0);color:#ffffff;
                  text-decoration:none;padding:14px 28px;border-radius:12px;font-size:0.9rem;
                  font-weight:700;box-shadow:0 4px 20px rgba(76,98,255,0.35);margin-right:8px;">
          + Registrar transacción
        </a>
        <a href="{dashboard_url}"
           style="display:inline-block;background:#111c30;border:1px solid #2a3a58;color:#7eb8ff;
                  text-decoration:none;padding:13px 24px;border-radius:12px;font-size:0.88rem;font-weight:600;">
          Ver mi panel
        </a>
      </div>

      <!-- Divider + comunidad -->
      <div style="height:1px;background:linear-gradient(90deg,transparent,#2a3a58,transparent);margin:20px 0;"></div>
      <p style="color:#3a4a60;font-size:0.8rem;text-align:center;margin:0 0 6px;line-height:1.6;">
        Somos una plataforma independiente construida por y para inversores venezolanos.
        Tu participación nos impulsa a seguir mejorando. 🇻🇪
      </p>
      <p style="color:#2a3a50;font-size:0.75rem;text-align:center;margin:0;">
        ¿Preguntas o sugerencias? →
        <a href="mailto:privacy@caracasportafolio.com" style="color:#4C62FF;text-decoration:none;">
          privacy@caracasportafolio.com
        </a>
      </p>
    """

    html = _email_wrapper("#4C62FF", "🎊", body)
    return await _send(to_email, f"¡Bienvenido a Caracas Portafolio, {username}! Tu cuenta está activa", html)


async def send_release_notes_email(to_email: str, username: str) -> bool:
    """Envía el correo con las novedades de la versión 2.0."""
    release_notes_url = f"{settings.frontend_url}/release-notes"
    dashboard_url     = f"{settings.frontend_url}/dashboard"

    body = f"""
      <h2 style="color:#e0e6f0;font-size:1.4rem;font-weight:800;margin:0 0 10px;text-align:center;">
        ¡Llegó la Versión 2.0! 🚀
      </h2>
      <p style="color:#7090a8;font-size:0.95rem;line-height:1.7;margin:0 0 24px;text-align:center;">
        Hola <strong style="color:#c0d0e0;">{username}</strong>, hemos lanzado la mayor actualización en la historia de 
        <strong style="color:#c0d0e0;">Caracas Portafolio</strong>. Aquí tienes lo más destacado:
      </p>

      <!-- Comunidad -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;background:#0f172a;border-radius:12px;padding:16px;border:1px solid #1e2a40;">
        <tr>
          <td width="40" valign="top">
            <div style="font-size:1.8rem;">👥</div>
          </td>
          <td style="padding-left:12px;">
            <div style="color:#fff;font-size:1rem;font-weight:700;margin-bottom:4px;">Comunidad Social</div>
            <div style="color:#7090a8;font-size:0.85rem;line-height:1.5;">
              Publica en modo anónimo, participa en encuestas diarias y compite en el ranking de reputación y ROI.
            </div>
          </td>
        </tr>
      </table>

      <!-- Análisis Avanzado -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;background:#0f172a;border-radius:12px;padding:16px;border:1px solid #1e2a40;">
        <tr>
          <td width="40" valign="top">
            <div style="font-size:1.8rem;">🔬</div>
          </td>
          <td style="padding-left:12px;">
            <div style="color:#fff;font-size:1rem;font-weight:700;margin-bottom:4px;">Análisis Quant Avanzado</div>
            <div style="color:#7090a8;font-size:0.85rem;line-height:1.5;">
              Predicción de precios con IA (ML), Cointegración, Frontera de Markowitz y más de 20 indicadores técnicos.
            </div>
          </td>
        </tr>
      </table>

      <!-- Paper Trading -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;background:#0f172a;border-radius:12px;padding:16px;border:1px solid #1e2a40;">
        <tr>
          <td width="40" valign="top">
            <div style="font-size:1.8rem;">🎮</div>
          </td>
          <td style="padding-left:12px;">
            <div style="color:#fff;font-size:1rem;font-weight:700;margin-bottom:4px;">Simulador Paper Trading</div>
            <div style="color:#7090a8;font-size:0.85rem;line-height:1.5;">
              Opera con dinero ficticio usando el libro de órdenes real de la BVC. Sin riesgos, puro aprendizaje.
            </div>
          </td>
        </tr>
      </table>

      <!-- Aprende -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;background:#0f172a;border-radius:12px;padding:16px;border:1px solid #1e2a40;">
        <tr>
          <td width="40" valign="top">
            <div style="font-size:1.8rem;">🎓</div>
          </td>
          <td style="padding-left:12px;">
            <div style="color:#fff;font-size:1rem;font-weight:700;margin-bottom:4px;">Academia Caracas Portafolio</div>
            <div style="color:#7090a8;font-size:0.85rem;line-height:1.5;">
              Nuevas lecciones para dominar el análisis fundamental y técnico aplicado al mercado venezolano.
            </div>
          </td>
        </tr>
      </table>

      <div style="text-align:center;margin-bottom:12px;">
        <a href="{release_notes_url}"
           style="display:inline-block;background:linear-gradient(135deg,#3a5fc0,#5040c0);color:#ffffff;
                  text-decoration:none;padding:14px 28px;border-radius:12px;font-size:0.95rem;
                  font-weight:700;box-shadow:0 4px 20px rgba(76,98,255,0.35);margin-bottom:10px;">
          🚀 Ver todas las novedades
        </a>
        <br>
        <a href="{dashboard_url}"
           style="display:inline-block;color:#7eb8ff;font-size:0.85rem;text-decoration:none;font-weight:600;">
          Ir a mi Dashboard →
        </a>
      </div>

      <div style="height:1px;background:linear-gradient(90deg,transparent,#2a3a58,transparent);margin:24px 0;"></div>
      <p style="color:#3a4a60;font-size:0.8rem;text-align:center;margin:0;line-height:1.6;">
        Estamos construyendo el futuro de la inversión en Venezuela. <br>
        Tu feedback es nuestra mayor ventaja. 🇻🇪
      </p>
    """

    html = _email_wrapper("#4C62FF", "⚡", body)
    return await _send(to_email, f"¡Actualización v2.0 disponible, {username}! Caracas Portafolio ha evolucionado", html)
