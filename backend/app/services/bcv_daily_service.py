"""
BCV Daily Rate Service
Scrapes the current USD/Bs rate from bcv.org.ve and saves it to the DB.
Called by APScheduler Mon–Fri at midnight (Caracas time) from main.py.
"""

import logging
import re
import warnings
from datetime import date

import requests
from bs4 import BeautifulSoup
from requests.packages.urllib3.exceptions import InsecureRequestWarning  # type: ignore
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal as async_session_maker

logger = logging.getLogger(__name__)

warnings.simplefilter("ignore", InsecureRequestWarning)
requests.packages.urllib3.disable_warnings(InsecureRequestWarning)

BCV_HOME = "https://www.bcv.org.ve/"

_SESSION = requests.Session()
_SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-VE,es;q=0.9",
})


def _scrape_bcv_home() -> dict | None:
    """
    Returns {'date': 'YYYY-MM-DD', 'rate': float} or None.
    Looks for:
      <div id="dolar">...<strong>474,05980000</strong>...</div>
      <span class="date-display-single" content="2026-04-06T00:00:00-04:00">
    """
    try:
        resp = _SESSION.get(BCV_HOME, timeout=30, verify=False)
        resp.raise_for_status()
    except Exception as exc:
        logger.error(f"BCV daily: connection error — {exc}")
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    dolar_div = soup.find("div", id="dolar")
    if not dolar_div:
        logger.error("BCV daily: div#dolar not found in page")
        return None

    strong = dolar_div.find("strong")
    if not strong:
        logger.error("BCV daily: <strong> not found inside div#dolar")
        return None

    try:
        rate = float(strong.get_text(strip=True).replace(",", ".").replace(" ", ""))
    except ValueError as exc:
        logger.error(f"BCV daily: cannot parse rate '{strong.get_text()}' — {exc}")
        return None

    # Date: prefer content attr of .date-display-single
    date_span = soup.find("span", class_="date-display-single")
    if date_span:
        content = date_span.get("content", "")  # "2026-04-06T00:00:00-04:00"
        iso_date = content[:10] if content else date.today().isoformat()
    else:
        iso_date = date.today().isoformat()

    return {"date": iso_date, "rate": round(rate, 8)}


async def save_bcv_rate_to_db(iso_date: str, rate: float) -> bool:
    """Insert into bcv_rates — skip if date already exists."""
    try:
        async with async_session_maker() as session:  # type: AsyncSession
            result = await session.execute(
                text(
                    """
                    INSERT INTO bcv_rates (rate_date, rate)
                    VALUES (:d, :r)
                    ON CONFLICT (rate_date) DO NOTHING
                    """
                ),
                {"d": iso_date, "r": rate},
            )
            await session.commit()
            inserted = result.rowcount > 0
            if inserted:
                logger.info(f"✅ BCV rate saved: {iso_date} → {rate:,.6f} Bs/$")
            else:
                logger.info(f"ℹ️  BCV rate already exists for {iso_date} — skipped")
            return inserted
    except Exception as exc:
        logger.error(f"❌ BCV daily DB error: {exc}")
        return False


async def fetch_and_save_today_rate() -> None:
    """Full job: scrape + persist. Called by APScheduler."""
    logger.info("⏰ BCV daily rate job started")
    result = _scrape_bcv_home()
    if not result:
        logger.warning("BCV daily job: no data obtained — skipping save")
        return
    logger.info(f"📊 BCV scraped: {result['date']} = {result['rate']:,.6f} Bs/$")
    await save_bcv_rate_to_db(result["date"], result["rate"])
