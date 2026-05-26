import asyncio
import os
import sys

# Add the parent directory to sys.path so app can be resolved
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.database import AsyncSessionLocal
from sqlalchemy import update
from app.models.stock import Stock

async def main():
    async with AsyncSessionLocal() as session:
        await session.execute(update(Stock).where(Stock.symbol == "CIE").values(is_active=False))
        await session.commit()
    print("CIE deactivated")

if __name__ == "__main__":
    asyncio.run(main())
