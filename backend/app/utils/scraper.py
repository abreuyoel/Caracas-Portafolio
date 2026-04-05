import httpx
from bs4 import BeautifulSoup
from datetime import datetime
from typing import List, Dict, Optional
from app.config import settings
import logging

logger = logging.getLogger(__name__)

BVC_BASE_URL = "https://www.bolsadecaracas.com"
HISTORICOS_URL = f"{BVC_BASE_URL}/historicos/"


async def get_active_stocks() -> List[Dict]:
    """Obtener lista de acciones activas de la BVC"""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(HISTORICOS_URL)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'lxml')
            
            stocks = []
            select = soup.find('select', {'id': 'simbolo'})
            if select:
                for option in select.find_all('option'):
                    if option.get('value'):
                        stocks.append({
                            'symbol': option.get('value'),
                            'name': option.get_text(strip=True)
                        })
            
            return stocks
        except Exception as e:
            logger.error(f"Error scraping stocks: {e}")
            return []


async def get_stock_history(symbol: str) -> Optional[Dict]:
    """Obtener histórico de una acción específica"""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.post(
                HISTORICOS_URL,
                data={'simbolo': symbol},
                headers={'Content-Type': 'application/x-www-form-urlencoded'}
            )
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'lxml')
            
            # Buscar tabla de últimos datos
            table = soup.find('tbody', {'id': 'ult3'})
            if not table:
                return None
            
            rows = table.find_all('tr')
            if not rows:
                return None
            
            # Primera fila = dato más reciente
            cells = rows[0].find_all('td')
            if len(cells) >= 10:
                return {
                    'symbol': symbol,
                    'date': cells[0].get_text(strip=True),
                    'open': float(cells[1].get_text(strip=True).replace(',', '')),
                    'close': float(cells[2].get_text(strip=True).replace(',', '')),
                    'change': float(cells[3].get_text(strip=True).replace(',', '')),
                    'change_pct': float(cells[4].get_text(strip=True).replace(',', '')),
                    'high': float(cells[5].get_text(strip=True).replace(',', '')),
                    'low': float(cells[6].get_text(strip=True).replace(',', '')),
                    'trades': int(cells[7].get_text(strip=True)),
                    'volume': int(cells[8].get_text(strip=True).replace(',', '')),
                    'amount': float(cells[9].get_text(strip=True).replace(',', ''))
                }
            
            return None
        except Exception as e:
            logger.error(f"Error scraping stock {symbol}: {e}")
            return None


async def get_bcv_rate() -> Optional[float]:
    """Obtener tasa BCV del día"""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get("https://www.bcv.org.ve/")
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'lxml')
            
            # Buscar el elemento con la tasa
            rate_element = soup.find('strong', string=lambda x: x and 'USD' in x if x else False)
            if rate_element:
                rate_text = rate_element.parent.get_text()
                rate = float(rate_text.replace(',', '').replace('$', '').strip())
                return rate
            
            return None
        except Exception as e:
            logger.error(f"Error scraping BCV rate: {e}")
            return None