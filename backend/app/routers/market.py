from fastapi import APIRouter, HTTPException
import httpx

router = APIRouter()

@router.get("/order-books/{symbol}")
async def get_order_book(symbol: str):
    url = f"https://market.bolsadecaracas.com/api/mercado/resumen/simbolos/{symbol}/libroOrdenes"
    # Crea un cliente HTTPX que no verifica SSL (solo para desarrollo)
    async with httpx.AsyncClient(verify=False) as client:   # ← verify=False
        resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="Error fetching order book")
        data = resp.json()
        entries = [
            {
                "buy_volume": item["VOL_CMP"],
                "buy_price": item["PRE_CMP"],
                "sell_price": item["PRE_VTA"],
                "sell_volume": item["VOL_VTA"]
            }
            for item in data
        ]
        return {"symbol": symbol, "entries": entries}