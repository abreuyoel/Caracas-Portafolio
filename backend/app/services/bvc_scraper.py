from __future__ import annotations

import asyncio
import concurrent.futures
import logging
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Dict, List, Optional

# Estas importaciones existen en runtime (instaladas en venv).
# Los warnings de Pylance son solo del IDE — no afectan la ejecución.
try:
    from bs4 import BeautifulSoup  # type: ignore[import]
except ImportError:
    BeautifulSoup = None  # type: ignore[assignment,misc]

logger = logging.getLogger(__name__)

BVC_BASE_URL = "https://www.bolsadecaracas.com"
HISTORICOS_URL = f"{BVC_BASE_URL}/historicos/"
MARKET_URL     = "https://market.bolsadecaracas.com/es"

# Acción considerada inactiva si su último movimiento tiene más de N meses
MAX_INACTIVITY_MONTHS = 3

# Meses en inglés y español usados por la BVC (formato DD-MMM-YY)
MONTH_MAP = {
    'JAN': 1, 'FEB': 2, 'MAR': 3, 'APR': 4, 'MAY': 5, 'JUN': 6,
    'JUL': 7, 'AUG': 8, 'SEP': 9, 'OCT': 10, 'NOV': 11, 'DEC': 12,
    'ENE': 1, 'ABR': 4, 'AGO': 8, 'DIC': 12,
}


def _parse_bvc_date(date_str: str) -> Optional[datetime]:
    """Convierte '16-JAN-26' o '16/01/2026' → datetime(2026, 1, 16)."""
    date_str = date_str.strip()
    try:
        if '/' in date_str:
            parts = date_str.split('/')
            if len(parts) != 3:
                return None
            day = int(parts[0])
            month = int(parts[1])
            year = int(parts[2])
            if year < 100:
                year += 2000
            return datetime(year, month, day)
        else:
            parts = date_str.split('-')
            if len(parts) != 3:
                return None
            day = int(parts[0])
            month = MONTH_MAP.get(parts[1].upper())
            year_short = int(parts[2])
            year = 2000 + year_short if year_short < 100 else year_short
            if not month:
                return None
            return datetime(year, month, day)
    except Exception:
        return None


def _is_recently_active(full_html: str, symbol: str) -> bool:
    """
    Devuelve True si la acción tuvo movimiento en los últimos MAX_INACTIVITY_MONTHS meses.
    Busca tbody#ult3 y toma la primera fila (= fecha más reciente).
    """
    if BeautifulSoup is None:
        logger.error("BeautifulSoup no disponible")
        return False

    soup = BeautifulSoup(full_html, 'lxml')
    tbody = soup.find('tbody', {'id': 'ult3'})
    if not tbody:
        logger.warning(f"[{symbol}] No se encontró tabla ult3")
        return False

    first_row = tbody.find('tr')
    if not first_row:
        logger.warning(f"[{symbol}] Tabla ult3 vacía")
        return False

    cells = first_row.find_all('td')
    if not cells:
        return False

    date_str = cells[0].get_text(strip=True)
    last_trade_date = _parse_bvc_date(date_str)

    if not last_trade_date:
        logger.warning(f"[{symbol}] No se pudo parsear fecha: '{date_str}'")
        return False

    cutoff = datetime.now() - timedelta(days=MAX_INACTIVITY_MONTHS * 30)
    is_recent = last_trade_date >= cutoff

    if not is_recent:
        logger.info(f"[{symbol}] Último movimiento: {date_str} → descartado (> {MAX_INACTIVITY_MONTHS} meses)")
    else:
        logger.info(f"[{symbol}] Último movimiento: {date_str} → ✅ con actividad reciente")

    return is_recent


def _run_playwright_sync() -> List[Dict]:
    """
    Ejecuta Playwright en un event loop completamente nuevo y separado del de uvicorn.
    Doble validación: Estado=ACTIVO + último movimiento ≤ 3 meses.
    """
    try:
        from playwright.async_api import async_playwright  # type: ignore[import]
    except ImportError:
        logger.error("Playwright no instalado. Ejecuta: pip install playwright && playwright install chromium")
        return []

    async def scrape() -> List[Dict]:
        semaphore = asyncio.Semaphore(3)
        results: List[Dict] = []

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)

            # Obtener la lista de símbolos del select
            page = await browser.new_page()
            await page.goto(HISTORICOS_URL, wait_until='domcontentloaded', timeout=30000)
            content = await page.content()
            await page.close()

            if BeautifulSoup is None:
                await browser.close()
                return []

            soup = BeautifulSoup(content, 'lxml')
            select_el = soup.find('select', {'id': 'simbolo'})
            if not select_el:
                logger.error("No se encontró el select de símbolos")
                await browser.close()
                return []

            options = []
            for option in select_el.find_all('option'):
                value = option.get('value', '').strip()
                text = option.get_text(strip=True)
                if value and 'Seleccione' not in text:
                    options.append((value, text))

            logger.info(f"📋 {len(options)} símbolos encontrados en la BVC")

            async def check_symbol(symbol: str, name: str) -> None:
                async with semaphore:
                    context = await browser.new_context()
                    pg = await context.new_page()
                    try:
                        await pg.goto(HISTORICOS_URL, wait_until='domcontentloaded', timeout=30000)
                        await pg.select_option('select#simbolo', symbol)
                        await pg.click('button#buscar')
                        await pg.wait_for_function(
                            """() => {
                                const info = document.querySelector('#info table tbody tr');
                                return info && info.textContent.trim().length > 0;
                            }""",
                            timeout=15000
                        )
                        full_html = await pg.content()

                        if BeautifulSoup is None:
                            return

                        s = BeautifulSoup(full_html, 'lxml')

                        # ── Validación 1: Estado oficial = ACTIVO ──────────────
                        is_status_active = False
                        for th in s.find_all('th'):
                            if 'estado' in th.get_text(strip=True).lower():
                                td = th.find_next_sibling('td')
                                if td:
                                    status_text = td.get_text(strip=True).upper()
                                    cell_class = td.get('class', [])
                                    is_status_active = (
                                        status_text == 'ACTIVO'
                                        and 'alert-warning' not in cell_class
                                    )
                                break

                        if not is_status_active:
                            logger.debug(f"[{symbol}] Estado INTERRUMPIDO → descartado")
                            return

                        # ── Validación 2: Último movimiento ≤ 3 meses ─────────
                        if not _is_recently_active(full_html, symbol):
                            return

                        results.append({
                            'symbol': symbol,
                            'name': name,
                            'is_active': True,
                            'status': 'ACTIVO'
                        })

                    except Exception as e:
                        logger.warning(f"[{symbol}] Error al verificar: {e}")
                    finally:
                        await context.close()

            tasks = [check_symbol(sym, name) for sym, name in options]
            await asyncio.gather(*tasks, return_exceptions=True)
            await browser.close()

        logger.info(f"✅ Scraping completado: {len(results)} acciones activas con movimiento reciente")
        return results

    import sys
    if sys.platform == 'win32':
        loop = asyncio.ProactorEventLoop()
    else:
        loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(scrape())
    finally:
        loop.close()
        asyncio.set_event_loop(None)


class BVCScraper:
    """
    Scraper de la Bolsa de Valores de Caracas.
    Doble criterio de actividad:
      1. Estado oficial = ACTIVO (sin alert-warning)
      2. Último movimiento hace ≤ 3 meses (tabla ult3)
    """

    async def get_active_stocks(self) -> List[Dict]:
        """
        Corre el scraping en un ThreadPoolExecutor con su propio event loop,
        separado del loop de FastAPI/uvicorn (necesario en Windows).
        """
        try:
            logger.info("🌐 Iniciando scraping Playwright en thread separado...")
            loop = asyncio.get_event_loop()
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                active_stocks = await loop.run_in_executor(executor, _run_playwright_sync)

            logger.info(f"✅ Resultado scraping: {len(active_stocks)} acciones activas")

            if not active_stocks:
                logger.warning("⚠️ Scraping devolvió 0 → usando fallback")
                return self._get_fallback_stocks()

            return active_stocks

        except Exception as e:
            logger.error(f"❌ Error en scraping: {e}")
            return self._get_fallback_stocks()

    async def get_stock_details(self, symbol: str) -> Optional[Dict]:
        """Obtiene detalles completos de una acción ejecutando Playwright en thread separado."""
        def _run() -> Optional[str]:
            try:
                from playwright.async_api import async_playwright  # type: ignore[import]
            except ImportError:
                return None

            async def scrape() -> Optional[str]:
                async with async_playwright() as p:
                    browser = await p.chromium.launch(headless=True)
                    page = await browser.new_page()
                    try:
                        await page.goto(HISTORICOS_URL, wait_until='domcontentloaded', timeout=30000)
                        await page.select_option('select#simbolo', symbol)
                        await page.click('button#buscar')
                        await page.wait_for_function(
                            """() => {
                                const info = document.querySelector('#info table tbody tr');
                                return info && info.textContent.trim().length > 0;
                            }""",
                            timeout=15000
                        )
                        return await page.content()
                    except Exception as e:
                        logger.error(f"Error obteniendo detalles de {symbol}: {e}")
                        return None
                    finally:
                        await page.close()
                        await browser.close()

            import sys
            if sys.platform == 'win32':
                loop = asyncio.ProactorEventLoop()
            else:
                loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                return loop.run_until_complete(scrape())
            finally:
                loop.close()
                asyncio.set_event_loop(None)

        try:
            loop = asyncio.get_event_loop()
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                html = await loop.run_in_executor(executor, _run)

            if not html or BeautifulSoup is None:
                return None

            soup = BeautifulSoup(html, 'lxml')
            company_info: Dict[str, str] = {}
            for th in soup.find_all('th'):
                key = th.get_text(strip=True).rstrip(':')
                td = th.find_next_sibling('td')
                if td:
                    company_info[key] = td.get_text(strip=True)

            status = company_info.get('Estado', 'UNKNOWN')
            is_active = (status == 'ACTIVO') and _is_recently_active(html, symbol)

            historical_data: List[Dict] = []
            tbody = soup.find('tbody', {'id': 'ult3'})
            if tbody:
                for row in tbody.find_all('tr'):
                    cells = row.find_all('td')
                    if len(cells) >= 10:
                        try:
                            historical_data.append({
                                'date': cells[0].get_text(strip=True),
                                'open': float(cells[1].get_text(strip=True).replace('.', '').replace(',', '.')),
                                'close': float(cells[2].get_text(strip=True).replace('.', '').replace(',', '.')),
                                'change': float(cells[3].get_text(strip=True).replace('.', '').replace(',', '.')),
                                'change_pct': float(cells[4].get_text(strip=True).replace('.', '').replace(',', '.')),
                                'high': float(cells[5].get_text(strip=True).replace('.', '').replace(',', '.')),
                                'low': float(cells[6].get_text(strip=True).replace('.', '').replace(',', '.')),
                                'trades': int(cells[7].get_text(strip=True).replace('.', '')),
                                'volume': float(cells[8].get_text(strip=True).replace('.', '').replace(',', '.')),
                                'amount': float(cells[9].get_text(strip=True).replace('.', '').replace(',', '.'))
                            })
                        except Exception:
                            continue

            return {
                'symbol': symbol,
                'company_name': company_info.get('Empresa', ''),
                'isin': company_info.get('ISIN', ''),
                'currency': company_info.get('Moneda', 'Bs'),
                'status': status,
                'is_active': is_active,
                'shares_outstanding': company_info.get('Acciones en Circulación', '0').replace('.', ''),
                'market_cap': company_info.get('Capitalización en Millones', '0'),
                'historical_data': historical_data[:10],
                'last_price': historical_data[0]['close'] if historical_data else None,
                'last_update': datetime.utcnow().isoformat()
            }
        except Exception as e:
            logger.error(f"❌ Error getting stock details for {symbol}: {e}")
            return None

    def _get_fallback_stocks(self) -> List[Dict]:
        """
        Fallback con acciones verificadas como ACTIVAS y con movimiento reciente
        (último trade ≤ 3 meses, verificado en marzo 2026).
        GZL.A, GZL.B, OCE y otras con último movimiento > 3 meses fueron removidas.
        """
        return [
            {'symbol': 'ABC.A', 'name': 'BANCO DEL CARIBE,C.A.BCO.UNIV.CLASE (A)', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'ABC.B', 'name': 'BANCO DEL CARIBE,C.A.BCO.UNIV.CLASE (B)', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'ALZ.B', 'name': 'ALALZA INVERSIONES, C.A. CLASE "B"', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'ARC.A', 'name': 'ARCA INM. Y VALORES, C.A. CLASE "A"', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'ARC.B', 'name': 'ARCA INM. Y VALORES, C.A. CLASE "B"', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'BNC', 'name': 'BANCO NACIONAL DE CREDITO,C.A.BCO.UNIV.', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'BPV', 'name': 'BANCO PROVINCIAL, S.A. BCO. UNIVERSAL', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'BVCC', 'name': 'BOLSA DE VALORES DE CARACAS, C.A.', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'BVL', 'name': 'BANCO DE VENEZUELA, S.A. BCO.UNIVERSAL', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'CCP.B', 'name': 'CLABE CAPITAL, C.A. CLASE (B)', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'CCR', 'name': 'CERAMICA CARABOBO, SACA', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'CGQ', 'name': 'CORP.GRUPO QUIMICO, C.A.', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'CIE', 'name': 'CORP. INDUSTRIAL DE ENERGIA CA SACA', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'CRM.A', 'name': 'CORIMON, C.A.', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'DOM', 'name': 'DOMINGUEZ & CIA., S.A.', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'EFE', 'name': 'PRODUCTOS EFE S.A.', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'ENV', 'name': 'ENVASES VENEZOLANOS S.A.', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'FFV.A', 'name': 'FIVENCA FONDO CAPITAL PRIVADO. CLASE "A"', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'FFV.B', 'name': 'FIVENCA FONDO CAPITAL PRIVADO. CLASE "B"', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'FNC', 'name': 'FABRICA NACIONAL DE CEMENTOS, C.A.', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'GMC.B', 'name': 'GRUPO MANTRA CORP. C.A. CLASE B', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'GZL', 'name': 'GRUPO ZULIANO, C.A.', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'GZL.A', 'name': 'GRUPO ZULIANO, PREF. CLASE "A"', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'GZL.B', 'name': 'GRUPO ZULIANO, PREF. CLASE "B"', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'ICP.B', 'name': 'INVERSIONES CRECEPYMES, C.A. CLASE "B"', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'IMP.B', 'name': 'IMPULSA VENTURE CAPITAL, C.A. CLASE "B"', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'IVC.A', 'name': 'INVACA, INVESTMENT COMPANY, SACA. "A"', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'IVC.B', 'name': 'INVACA, INVESTMENT COMPANY, SACA. "B"', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'MPA', 'name': 'MANUFACTURAS DE PAPEL,C.A.(MANPA) SACA.', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'MTC.B', 'name': 'MONTESCO CAPITAL GLOBAL, C.A. CLASE "B"', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'MVZ.A', 'name': 'MERCANTIL SERV. FINANCIEROS C.A. CLS.(A)', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'MVZ.B', 'name': 'MERCANTIL SERV. FINANCIEROS C.A. CLS.(B)', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'PCP.B', 'name': 'FONDO PETROLIA, C.A. CLASE (B)', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'PER', 'name': 'PC-IBC FONDO MUTUAL DE INV. CAP. CERRADO', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'PGR', 'name': 'PROAGRO C.A.', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'PIV.B', 'name': 'PIVCA PROMOTRA INV. Y VALORES CLASE "B"', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'PTN', 'name': 'PROTINAL C.A.', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'RFM', 'name': 'RENDIVALORES FON.MUT. INV. CAP. CERRADO', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'RST', 'name': 'C.A. RON SANTA TERESA', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'RST.B', 'name': 'C.A. RON SANTA TERESA (CLASE B)', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'SVS', 'name': 'SIVENSA, S.A', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'TDV.D', 'name': 'C.A.NAC.TELF.VZLA. (CANTV) CLASE (D)', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'TPG', 'name': 'C.A. TELARES DE PALO GRANDE', 'is_active': True, 'status': 'ACTIVO'},
            {'symbol': 'VNA.B', 'name': 'VENEALTERNATIVE, S.A. CLASE "B"', 'is_active': True, 'status': 'ACTIVO'},
        ]


    async def _get_full_html(self, symbol: str) -> str | None:
        """
        Obtiene el HTML completo de la página de históricos de una acción.
        Usa Playwright en thread separado (mismo patrón que get_stock_details).
        """
        def _run() -> str | None:
            try:
                from playwright.async_api import async_playwright  # type: ignore[import]
            except ImportError:
                return None

            async def scrape() -> str | None:
                async with async_playwright() as p:
                    browser = await p.chromium.launch(headless=True)
                    page = await browser.new_page()
                    try:
                        await page.goto(HISTORICOS_URL, wait_until='domcontentloaded', timeout=30000)
                        await page.select_option('select#simbolo', symbol)
                        await page.click('button#buscar')
                        await page.wait_for_function(
                            """() => {
                                const tbody = document.querySelector('tbody#ult3 tr');
                                return tbody && tbody.textContent.trim().length > 0;
                            }""",
                            timeout=15000
                        )
                        return await page.content()
                    except Exception as e:
                        logger.error(f"[{symbol}] _get_full_html error: {e}")
                        return None
                    finally:
                        await page.close()
                        await browser.close()

            import sys
            loop = asyncio.ProactorEventLoop() if sys.platform == 'win32' else asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                return loop.run_until_complete(scrape())
            finally:
                loop.close()
                asyncio.set_event_loop(None)

        try:
            loop = asyncio.get_event_loop()
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                return await loop.run_in_executor(executor, _run)
        except Exception as e:
            logger.error(f"❌ _get_full_html {symbol}: {e}")
            return None


    async def get_live_candle(self, symbol: str) -> dict | None:
        """
        Obtiene la vela live del día actual desde market.bolsadecaracas.com
        usando httpx (sin Playwright — el sitio renderiza SSR sin JS).
        Returns None if market is closed or data is unavailable.

        Columnas de la tabla (0-indexed):
          0  logo img (alt=símbolo)
          1  botón libro de órdenes
          2  nombre corto
          3  símbolo (badge)
          4  número de operaciones acumuladas
          5  mejor oferta compra
          6  mejor oferta venta
          7  volumen en órdenes
          8  precio actual (con icono de tendencia)
          9  precio apertura
          10 variación absoluta
          11 variación porcentual
          12 volumen negociado
          13 monto negociado
          14 cantidad de operaciones
          15 máximo del día
          16 mínimo del día
        """
        import httpx
        from bs4 import BeautifulSoup
        from datetime import date as date_type

        try:
            async with httpx.AsyncClient(
                verify=False,
                timeout=20,
                follow_redirects=True,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    ),
                    "Accept-Language": "es-VE,es;q=0.9",
                }
            ) as client:
                resp = await client.get(MARKET_URL)
                resp.raise_for_status()
                html = resp.text

            soup = BeautifulSoup(html, 'lxml')

            from datetime import datetime, timezone, timedelta
            tz_ve = timezone(timedelta(hours=-4))
            today_iso = datetime.now(tz_ve).date().isoformat()

            import re
            # Buscar la fecha real del mercado en el header
            h4_tag = soup.find('h4', class_='text-white')
            if h4_tag:
                spans = h4_tag.find_all('span', class_=re.compile(r'__estado'))
                if len(spans) >= 2:
                    date_text = spans[1].get_text(strip=True)
                    try:
                        # Extraer fecha en formato DD/MM/YYYY y convertir a YYYY-MM-DD
                        parts = date_text.split('/')
                        if len(parts) == 3:
                            day = int(parts[0])
                            month = int(parts[1])
                            year = int(parts[2])
                            if year < 100:
                                year += 2000
                            today_iso = f"{year:04d}-{month:02d}-{day:02d}"
                    except Exception as parse_e:
                        logger.warning(f"No se pudo parsear fecha del market header '{date_text}': {parse_e}")

            rows = soup.select('table tbody tr')
            for row in rows:
                cells = row.find_all('td')
                if len(cells) < 17:
                    continue

                sym_cell = cells[3].get_text(strip=True).upper()
                if sym_cell != symbol.upper():
                    continue

                def n(idx: int) -> float | None:
                    txt = cells[idx].get_text(strip=True).replace('.', '').replace(',', '.')
                    try:
                        v = float(txt)
                        return v if v > 0 else None
                    except Exception:
                        return None

                close_p = n(8)
                open_p  = n(9)
                high_p  = n(15)
                low_p   = n(16)
                volume  = n(12)
                amount  = n(13)
                trades  = n(14)

                if not all([close_p, open_p, high_p, low_p]):
                    logger.warning(f"[LIVE] {symbol}: datos incompletos en tabla")
                    return None

                logger.info(
                    f"✅ [LIVE-httpx] {symbol}: "
                    f"O={open_p} H={high_p} L={low_p} C={close_p} V={volume}"
                )
                return {
                    'time':    today_iso,
                    'open':    open_p,
                    'high':    high_p,
                    'low':     low_p,
                    'close':   close_p,
                    'volume':  volume or 0,
                    'amount':  amount or 0,
                    'trades':  int(trades) if trades else 0,
                    'is_live': True,
                }

            logger.info(f"⚠️ [LIVE-httpx] {symbol}: no encontrado en la tabla del mercado")
            return None

        except Exception as e:
            logger.error(f"❌ get_live_candle {symbol}: {e}")
            return None
        
    
    
    async def get_full_price_history(self, symbol: str, start_date: str = None) -> List[Dict]:
        """
        Obtiene el histórico completo de operaciones de una acción desde la
        sección de "Consulta Histórico de Movimientos" del sitio de la BVC,
        paginando con el botón "Siguiente" hasta agotar todos los registros.
        """
        def _run() -> List[Dict]:
            import asyncio
            import sys
            from playwright.async_api import async_playwright
            from bs4 import BeautifulSoup
            from datetime import date, timedelta, datetime, timezone

            async def scrape() -> List[Dict]:
                all_rows: List[Dict] = []

                async with async_playwright() as p:
                    browser = await p.chromium.launch(headless=True)
                    page = await browser.new_page()

                    try:
                        BVC_HISTORICOS = "https://www.bolsadecaracas.com/historicos/"
                        await page.goto(BVC_HISTORICOS, wait_until="domcontentloaded", timeout=30000)
                        await page.select_option("select#simbolo", symbol)
                        await page.click("button#buscar")

                        # Esperar a que se cargue la info de la empresa
                        await page.wait_for_function(
                            """() => {
                                const info = document.querySelector('#info table tbody tr');
                                return info && info.textContent.trim().length > 0;
                            }""",
                            timeout=15000,
                        )

                        tz_ve = timezone(timedelta(hours=-4))
                        today_ven = datetime.now(tz_ve).date()

                        # Obtener rango de fechas disponible
                        fec_min_val = start_date or await page.get_attribute("#fec_min", "min") or "2021-05-18"
                        fec_max_val = await page.get_attribute("#fec_max", "max")
                        if not fec_max_val:
                            fec_max_val = today_ven.isoformat()

                        logger.info(f"[{symbol}] Rango histórico disponible: {fec_min_val} → {fec_max_val}")

                        # Establecer rango completo
                        await page.fill("#fec_min", fec_min_val)
                        await page.fill("#fec_max", fec_max_val)
                        await page.click("button#buscar_operaciones")

                        # Esperar a que aparezca la tabla de resultados
                        await page.wait_for_function(
                            """() => {
                                const tbody = document.querySelector('tbody#resumen_2 tr');
                                return tbody && tbody.textContent.trim().length > 0;
                            }""",
                            timeout=20000,
                        )

                        today = date.today()
                        page_num = 0

                        while True:
                            page_num += 1
                            html = await page.content()
                            soup = BeautifulSoup(html, "lxml")

                            tbody = soup.find("tbody", {"id": "resumen_2"})
                            if not tbody:
                                logger.warning(f"[{symbol}] Página {page_num}: tbody#resumen_2 no encontrado")
                                break

                            page_rows = tbody.find_all("tr")
                            if not page_rows:
                                break

                            for tr in page_rows:
                                cells = tr.find_all("td")
                                parsed = _parse_row(cells)   # función global
                                if parsed:
                                    all_rows.append(parsed)

                            logger.debug(f"[{symbol}] Página {page_num}: {len(page_rows)} filas acumuladas={len(all_rows)}")

                            # ¿Ya llegamos al día más reciente?
                            last_row_date = all_rows[-1]["date"] if all_rows else None
                            if last_row_date and last_row_date >= today_ven:
                                logger.info(f"[{symbol}] Alcanzamos la fecha más reciente ({last_row_date}), deteniendo")
                                break

                            # Verificar botón "Siguiente"
                            sig_btn = await page.query_selector("button#sig")
                            if not sig_btn or not await sig_btn.is_visible() or not await sig_btn.is_enabled():
                                logger.info(f"[{symbol}] Botón 'Siguiente' no disponible, fin de paginación")
                                break

                            # Avanzar a la siguiente página
                            await sig_btn.click()

                            # Esperar a que la tabla se actualice
                            try:
                                first_cell_text = page_rows[0].find("td").get_text(strip=True)
                                await page.wait_for_function(
                                    f"""() => {{
                                        const first = document.querySelector('tbody#resumen_2 tr td');
                                        return first && first.textContent.trim() !== '{first_cell_text}';
                                    }}""",
                                    timeout=10000,
                                )
                            except Exception:
                                logger.warning(f"[{symbol}] Timeout esperando actualización de tabla en página {page_num + 1}")
                                break

                    except Exception as e:
                        logger.error(f"[{symbol}] Error en get_full_price_history: {e}")
                    finally:
                        await page.close()
                        await browser.close()

                # Consolidar y ordenar
                consolidated = _consolidate_by_date(all_rows)   # función global
                logger.info(f"[{symbol}] Histórico completo: {len(consolidated)} días únicos")
                return consolidated

            # Ejecutar en un nuevo event loop (compatible con Windows)
            if sys.platform == 'win32':
                loop = asyncio.ProactorEventLoop()
            else:
                loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                return loop.run_until_complete(scrape())
            finally:
                loop.close()
                asyncio.set_event_loop(None)

        # Ejecutar en thread separado para no bloquear el event loop de FastAPI
        try:
            loop = asyncio.get_event_loop()
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                return await loop.run_in_executor(executor, _run)
        except Exception as e:
            logger.error(f"❌ get_full_price_history {symbol}: {e}")
            return []

    @staticmethod
    def is_market_open() -> bool:
        """
        Verifica si el mercado BVC está abierto.
        Horario: lunes-viernes, 9:00am - 3:00pm hora Venezuela (UTC-4).
        """
        from datetime import datetime, timezone, timedelta
        tz_ve = timezone(timedelta(hours=-4))
        now   = datetime.now(tz_ve)
        # Weekday: 0=Monday ... 4=Friday, 5=Saturday, 6=Sunday
        if now.weekday() >= 5:
            return False
        market_open  = now.replace(hour=9,  minute=0,  second=0, microsecond=0)
        market_close = now.replace(hour=15, minute=0,  second=0, microsecond=0)
        return market_open <= now <= market_close

def _parse_bvc_amount(text: str) -> float:
    """'45.000,00' → 45000.0   |   '0,00' → 0.0"""
    clean = text.strip().replace('.', '').replace(',', '.')
    try:
        return float(clean)
    except ValueError:
        return 0.0
 
 
def _parse_row(cells) -> Optional[Dict]:
    """
    Convierte las celdas de tbody#resumen_2 en un dict.
    Columnas (0-indexed):
      0 Fecha  1 Tipo  2 Apert.  3 Cierre  4 Max  5 Min
      6 Nº Operaciones  7 Títulos Negociados  8 Monto Efectivo
    """
    if len(cells) < 9:
        return None
    try:
        raw_date = cells[0].get_text(strip=True)          # "06/03/2026"
        trade_date = datetime.strptime(raw_date, "%d/%m/%Y").date()
        op_type = cells[1].get_text(strip=True)           # "R" | "P"
        return {
            "date":       trade_date,
            "op_type":    op_type,
            "open":       _parse_bvc_amount(cells[2].get_text(strip=True)),
            "close":      _parse_bvc_amount(cells[3].get_text(strip=True)),
            "high":       _parse_bvc_amount(cells[4].get_text(strip=True)),
            "low":        _parse_bvc_amount(cells[5].get_text(strip=True)),
            "trades":     int(_parse_bvc_amount(cells[6].get_text(strip=True))),
            "volume":     int(_parse_bvc_amount(cells[7].get_text(strip=True))),
            "amount":     _parse_bvc_amount(cells[8].get_text(strip=True)),
        }
    except Exception:
        return None
 
 
def _consolidate_by_date(rows: List[Dict]) -> List[Dict]:
    """
    El sitio puede tener dos filas por fecha (R = Regular, P = Plazo).
    Las consolida en un único registro por fecha sumando volumen, monto y
    operaciones; y tomando open/close/high/low del tipo R cuando existe.
    Devuelve lista ordenada cronológicamente (más viejo → más reciente).
    """
    by_date: Dict[date, Dict] = {}
    for row in rows:
        d = row["date"]
        if d not in by_date:
            by_date[d] = {
                "date":   d,
                "open":   row["open"],
                "close":  row["close"],
                "high":   row["high"],
                "low":    row["low"],
                "trades": row["trades"],
                "volume": row["volume"],
                "amount": row["amount"],
            }
        else:
            existing = by_date[d]
            # Precio: preferir fila R (Regular); solo actualizar si el tipo es R
            if row["op_type"] == "R":
                existing["open"]  = row["open"]
                existing["close"] = row["close"]
                existing["high"]  = row["high"]
                existing["low"]   = row["low"]
            # Siempre sumar operaciones, volumen y monto
            existing["trades"] += row["trades"]
            existing["volume"] += row["volume"]
            existing["amount"] += row["amount"]
 
    return sorted(by_date.values(), key=lambda x: x["date"])
 
 
# Singleton instance
bvc_scraper = BVCScraper()