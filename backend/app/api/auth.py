from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.database import get_db
from app.models.user import User
from app.models.email_verification import EmailVerification
from app.schemas.user import UserCreate, UserResponse, Token, RefreshToken, PasswordReset, PasswordResetConfirm
from app.utils.security import verify_password, get_password_hash, create_access_token, create_refresh_token, decode_token
from app.utils.email import send_verification_email, send_welcome_email, send_password_reset_email
from app.models.password_reset import PasswordResetCode
from app.config import settings
from datetime import timedelta, timezone, datetime
from uuid import UUID
import asyncio
import uuid
import re
import secrets
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(user_data: UserCreate, db: AsyncSession = Depends(get_db)):
    # Verificar si el email ya existe
    result = await db.execute(select(User).where(User.email == user_data.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email ya registrado")

    # Generar username único a partir del email si no se proporcionó
    base_username = user_data.username or re.sub(r'[^a-z0-9_]', '', user_data.email.split('@')[0].lower())[:30] or "user"
    username = base_username
    suffix = 1
    while True:
        result = await db.execute(select(User).where(User.username == username))
        if not result.scalar_one_or_none():
            break
        username = f"{base_username}{suffix}"
        suffix += 1

    # Crear usuario (no verificado aún)
    user = User(
        email=user_data.email,
        username=username,
        password_hash=get_password_hash(user_data.password),
        is_verified=False,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Generar token de verificación
    token = secrets.token_urlsafe(48)
    expires = datetime.now(timezone.utc) + timedelta(hours=24)
    verification = EmailVerification(user_id=user.id, token=token, expires_at=expires)
    db.add(verification)
    await db.commit()

    # Enviar email de verificación
    try:
        sent = await send_verification_email(user.email, token)
        if not sent:
            logger.warning(f"⚠️  Email de verificación no enviado a {user.email}")
        else:
            logger.info(f"✅ Email de verificación enviado a {user.email}")
    except Exception as e:
        logger.error(f"❌ Error enviando email de verificación: {e}")

    return user


@router.post("/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == form_data.username))
    user = result.scalar_one_or_none()
    
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(status_code=400, detail="Usuario inactivo")

    # ELIMINADO: Ya no bloqueamos el inicio de sesión a usuarios no verificados.
    # Queremos que puedan entrar aunque hayan puesto un correo falso o no les haya llegado.
    # if not user.is_verified:
    #     pending = await db.execute(
    #         select(EmailVerification).where(EmailVerification.user_id == user.id)
    #     )
    #     if pending.scalar_one_or_none():
    #         raise HTTPException(status_code=403, detail="email_not_verified")
    
    access_token = create_access_token(
        data={"sub": str(user.id), "email": user.email},
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes)
    )
    refresh_token = create_refresh_token(data={"sub": str(user.id)})
    
    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.access_token_expire_minutes * 60
    )


@router.post("/refresh", response_model=Token)
async def refresh_token(token_data: RefreshToken, db: AsyncSession = Depends(get_db)):
    payload = decode_token(token_data.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Token inválido")
    
    user_id = UUID(payload.get("sub"))
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Usuario no encontrado")
    
    access_token = create_access_token(
        data={"sub": str(user.id), "email": user.email},
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes)
    )
    new_refresh_token = create_refresh_token(data={"sub": str(user.id)})
    
    return Token(
        access_token=access_token,
        refresh_token=new_refresh_token,
        expires_in=settings.access_token_expire_minutes * 60
    )


@router.get("/verify-email")
async def verify_email(token: str, db: AsyncSession = Depends(get_db)):
    """Verifica el email del usuario usando el token del correo."""
    now = datetime.now(timezone.utc)
    result = await db.execute(select(EmailVerification).where(EmailVerification.token == token))
    record = result.scalar_one_or_none()

    if not record:
        raise HTTPException(status_code=400, detail="Token inválido o ya fue usado")

    if record.expires_at.replace(tzinfo=timezone.utc) < now:
        await db.execute(delete(EmailVerification).where(EmailVerification.token == token))
        await db.commit()
        raise HTTPException(status_code=400, detail="El token ha expirado. Solicita un nuevo correo de verificación.")

    # Marcar usuario como verificado
    user_result = await db.execute(select(User).where(User.id == record.user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    user.is_verified = True
    await db.execute(delete(EmailVerification).where(EmailVerification.user_id == user.id))
    await db.commit()

    # Enviar bienvenida
    try:
        await send_welcome_email(user.email, user.username)
    except Exception as e:
        logger.error(f"❌ Error enviando bienvenida: {e}")

    return {"message": "Correo verificado correctamente. Ya puedes iniciar sesión."}


class ResendVerificationRequest(BaseModel):
    email: str


@router.post("/resend-verification")
async def resend_verification(body: ResendVerificationRequest, db: AsyncSession = Depends(get_db)):
    """Reenvía el correo de verificación."""
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    # Respuesta genérica para no revelar si el email existe
    if not user or user.is_verified:
        return {"message": "Si el email existe y no está verificado, recibirás un correo."}

    # Eliminar tokens anteriores y crear uno nuevo
    await db.execute(delete(EmailVerification).where(EmailVerification.user_id == user.id))
    token = secrets.token_urlsafe(48)
    expires = datetime.now(timezone.utc) + timedelta(hours=24)
    verification = EmailVerification(user_id=user.id, token=token, expires_at=expires)
    db.add(verification)
    await db.commit()

    try:
        await send_verification_email(user.email, token)
    except Exception as e:
        logger.error(f"❌ Error reenviando verificación: {e}")

    return {"message": "Si el email existe y no está verificado, recibirás un correo."}


@router.get("/test-email")
async def test_email(to: str = "abreuyoel22@gmail.com"):
    """Endpoint de prueba — eliminar en producción."""
    from app.utils.email import send_verification_email
    result = await send_verification_email(to, "token-de-prueba-12345")
    return {"sent": result, "to": to, "resend_key_loaded": bool(settings.resend_api_key)}


@router.get("/resend-all-pending")
async def resend_all_pending(db: AsyncSession = Depends(get_db)):
    """Temporary endpoint to resend pending emails."""
    result = await db.execute(select(User).where(User.is_verified == False))
    unverified_users = result.scalars().all()
    count = 0
    errors = 0
    for user in unverified_users:
        await db.execute(delete(EmailVerification).where(EmailVerification.user_id == user.id))
        token = secrets.token_urlsafe(48)
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        verification = EmailVerification(user_id=user.id, token=token, expires_at=expires)
        db.add(verification)
        await db.commit()
        try:
            await send_verification_email(user.email, token)
            await asyncio.sleep(0.2)
            count += 1
        except Exception as e:
            logger.error(f"Error resending to {user.email}: {e}")
            errors += 1
            
    return {"sent": count, "errors": errors, "total_unverified": len(unverified_users)}

@router.post("/forgot-password")
async def forgot_password(reset_data: PasswordReset, db: AsyncSession = Depends(get_db)):
    """Genera y envía un código OTP de 6 dígitos para restablecer la contraseña."""
    result = await db.execute(select(User).where(User.email == reset_data.email))
    user = result.scalar_one_or_none()

    if user and user.is_active:
        # Eliminar códigos anteriores del usuario
        await db.execute(delete(PasswordResetCode).where(PasswordResetCode.user_id == user.id))
        # Generar OTP de 6 dígitos
        import random
        code = f"{random.randint(0, 999999):06d}"
        expires = datetime.now(timezone.utc) + timedelta(minutes=15)
        reset = PasswordResetCode(user_id=user.id, code=code, expires_at=expires)
        db.add(reset)
        await db.commit()
        try:
            await send_password_reset_email(user.email, code, user.username)
        except Exception as e:
            logger.error(f"Error enviando código reset: {e}")

    # Siempre 200 para no revelar si el email existe
    return {"message": "Si el email existe, recibirás un código de 6 dígitos."}


class PasswordResetWithCode(BaseModel):
    email: str
    code: str
    new_password: str


@router.post("/reset-password")
async def reset_password(data: PasswordResetWithCode, db: AsyncSession = Depends(get_db)):
    """Verifica el código OTP y actualiza la contraseña."""
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=400, detail="Código inválido o expirado")

    now = datetime.now(timezone.utc)
    reset_result = await db.execute(
        select(PasswordResetCode).where(
            PasswordResetCode.user_id == user.id,
            PasswordResetCode.code == data.code,
            PasswordResetCode.used == False
        )
    )
    reset = reset_result.scalar_one_or_none()
    if not reset:
        raise HTTPException(status_code=400, detail="Código inválido o expirado")

    if reset.expires_at.replace(tzinfo=timezone.utc) < now:
        await db.execute(delete(PasswordResetCode).where(PasswordResetCode.id == reset.id))
        await db.commit()
        raise HTTPException(status_code=400, detail="El código ha expirado. Solicita uno nuevo.")

    if len(data.new_password) < 8:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 8 caracteres")

    user.password_hash = get_password_hash(data.new_password)
    reset.used = True
    await db.execute(delete(PasswordResetCode).where(PasswordResetCode.user_id == user.id))
    await db.commit()

    return {"message": "Contraseña actualizada correctamente. Ya puedes iniciar sesión."}


class GoogleTokenRequest(BaseModel):
    credential: str  # Google ID token (JWT)

@router.post("/google", response_model=Token)
async def google_login(body: GoogleTokenRequest, db: AsyncSession = Depends(get_db)):
    """
    Verifica el ID token de Google y crea/recupera el usuario correspondiente.
    Requiere que GOOGLE_CLIENT_ID esté configurado en .env
    """
    import httpx
    from pydantic import BaseModel as _BM

    google_client_id = settings.google_client_id.strip()
    if not google_client_id:
        raise HTTPException(status_code=503, detail="Google OAuth no configurado en este servidor")

    # Verificar el token con Google
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://oauth2.googleapis.com/tokeninfo",
                params={"id_token": body.credential},
                timeout=10,
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Token de Google inválido")
        info = resp.json()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Error verificando token de Google: {exc}")

    if info.get("aud") != google_client_id:
        raise HTTPException(status_code=401, detail="Token de Google no corresponde a esta aplicación")

    email = info.get("email")
    if not email or not info.get("email_verified"):
        raise HTTPException(status_code=400, detail="El email de Google no está verificado")

    # Buscar o crear usuario
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if not user:
        base = re.sub(r'[^a-z0-9_]', '', email.split('@')[0].lower())[:30] or "user"
        username = base
        suffix = 1
        while True:
            r2 = await db.execute(select(User).where(User.username == username))
            if not r2.scalar_one_or_none():
                break
            username = f"{base}{suffix}"
            suffix += 1

        user = User(
            email=email,
            username=username,
            password_hash=get_password_hash(uuid.uuid4().hex),  # contraseña aleatoria (no usable)
            full_name=info.get("name"),
            avatar_url=info.get("picture"),
            is_verified=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    if not user.is_active:
        raise HTTPException(status_code=400, detail="Usuario inactivo")

    access_token = create_access_token(
        data={"sub": str(user.id), "email": user.email},
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
    )
    refresh_token_val = create_refresh_token(data={"sub": str(user.id)})
    return Token(
        access_token=access_token,
        refresh_token=refresh_token_val,
        expires_in=settings.access_token_expire_minutes * 60,
    )


