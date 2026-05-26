import asyncio
import sys
import os
from sqlalchemy import select

# Añadir el directorio raíz del backend al path para que funcionen los imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import AsyncSessionLocal
from app.models.user import User
from app.utils.email import send_release_notes_email

async def main():
    print("🚀 Iniciando envío masivo de Release Notes v2.0...")
    
    async with AsyncSessionLocal() as session:
        # Obtener todos los usuarios activos y verificados
        query = select(User).where(User.is_active == True, User.is_verified == True)
        result = await session.execute(query)
        users = result.scalars().all()
        
        total = len(users)
        print(f"📦 Encontrados {total} usuarios elegibles.")
        
        sent_count = 0
        error_count = 0
        
        for i, user in enumerate(users):
            print(f"[{i+1}/{total}] Enviando a {user.email}...", end=" ", flush=True)
            try:
                success = await send_release_notes_email(user.email, user.username)
                if success:
                    print("✅")
                    sent_count += 1
                else:
                    print("❌ (Error en Resend)")
                    error_count += 1
            except Exception as e:
                print(f"💥 (Excepción: {e})")
                error_count += 1
            
            # Pequeño delay para no saturar la API
            await asyncio.sleep(0.1)
            
    print("\n" + "="*40)
    print(f"🏁 Envío completado.")
    print(f"✅ Exitosos: {sent_count}")
    print(f"❌ Fallidos: {error_count}")
    print("="*40)

if __name__ == "__main__":
    asyncio.run(main())
