import asyncio
import os
import sys
import httpx
from datetime import datetime, timedelta

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

SYMBOLS = [
    "ABC.A", "ABC.B", "ALZ.B", "ARC.A", "ARC.B", "BNC", "BNC.O", "BPV", "BVC.D", "BVCC", "BVL", 
    "CCP.B", "CCR", "CCR.O", "CGQ", "CGQ.O", "CIE", "CIE.O", "CRM.A", "DOM", "EFE", "ENV", 
    "FFV.A", "FFV.B", "FNC", "FNV", "FVI.A", "FVI.B", "GMC.B", "GZL", "GZL.A", "GZL.B", "GZL.P", 
    "IBV", "ICP.B", "IMP.A", "IMP.B", "INV", "IVC", "IVC.A", "IVC.B", "MPA", "MTC.B", "MVZ.A", 
    "MVZ.B", "OCE", "PCP.B", "PER", "PGR", "PGR.O", "PIV.A", "PIV.B", "PTN", "PTN.O", "RFM", 
    "RSB.O", "RST", "RST.B", "RST.O", "SV.A", "SV.B", "SVS", "TDV.D", "TDV.P", "TPG", "TPG.O", "VNA.B"
]

def parse_ve_number(val):
    if not val: return 0.0
    val = str(val).strip()
    if not val: return 0.0
    val_clean = val.replace('.', '').replace(',', '.')
    try:
        return float(val_clean)
    except Exception:
        return 0.0

async def fetch_api2_historico(client, symbol, semaphore):
    """
    Descarga el histórico adicional desde la segunda API getOperacionesHistorico.
    Maneja la paginación internamente.
    """
    merged_data = {}
    pages = 1
    page = 0
    # Usamos un max_retries por si falla la red
    while page < pages:
        async with semaphore:
            try:
                resp = await client.post(
                    "https://www.bolsadecaracas.com/wp-admin/admin-ajax.php?action=getOperacionesHistorico",
                    data={
                        "simbolo": symbol, 
                        "min": "2010-01-01", 
                        "max": "2030-01-01", 
                        "page": page
                    }
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if page == 0:
                        pages = data.get("pagination", {}).get("pages", 1)
                        if pages == 0: pages = 1
                    
                    for mov in data.get("historico", []):
                        fec_str = mov.get("FEC") # Formato esperado: DD/MM/YYYY
                        try:
                            parts = fec_str.split('/')
                            # Cuidar formato: YYYY-MM-DD
                            p_date = f"{parts[2]}-{parts[1].zfill(2)}-{parts[0].zfill(2)}"
                            merged_data[p_date] = mov
                        except:
                            pass
                
                page += 1
            except Exception as e:
                print(f"    [WARN] Error API2 pag {page} para {symbol}: {e}")
                page += 1 # Continuar a la siguiente incluso si falla
    return merged_data

async def main():
    print("Iniciando generación de script SQL para la BVC...")
    print("Se consolidarán datos de 2 APIs distintas de la BVC para garantizar máxima cobertura de fechas.")
    
    cutoff_date = datetime.now() - timedelta(days=120)
    sql_file = "bvc_sync_data.sql"
    
    # Semáforo para no saturar a la BVC con concurrencias altas
    semaphore = asyncio.Semaphore(8)
    
    with open(sql_file, "w", encoding="utf-8") as f:
        date_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_name = f"price_history_backup_{date_str}"
        
        f.write("-- 1. CREANDO BACKUP PRIMERO\n")
        f.write(f"CREATE TABLE IF NOT EXISTS {backup_name} AS SELECT * FROM price_history;\n\n")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            headers = {
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Origin": "https://www.bolsadecaracas.com",
                "Referer": "https://www.bolsadecaracas.com/historicos/",
                "X-Requested-With": "XMLHttpRequest",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
            client.headers.update(headers)
            
            for symbol in SYMBOLS:
                try:
                    # 1. Llamar a la primera API (Resume)
                    resp = await client.post(
                        "https://www.bolsadecaracas.com/wp-admin/admin-ajax.php?action=getHistoricoSimbolo",
                        data={"simbolo": symbol}
                    )
                    
                    if resp.status_code != 200:
                        print(f"[ERROR] HTTP {resp.status_code} para {symbol}")
                        continue
                        
                    data = resp.json()
                    encab = data.get("cur_hist_encab", [])
                    fechas = data.get("fechas", {})
                    mov_api1 = data.get("cur_hist_mov_emisora", [])
                    
                    if not encab:
                        continue
                    
                    info = encab[0]
                    estatus = info.get("ESTATUS", "")
                    
                    max_date_str = fechas.get("MAX_DATE")
                    max_date = datetime.strptime(max_date_str, "%Y-%m-%d") if max_date_str else None
                    
                    is_inactive = False
                    if estatus == "INTERRUMPIDO":
                        is_inactive = True
                    elif max_date and max_date < cutoff_date:
                        is_inactive = True
                        
                    if is_inactive:
                        print(f"  [ELIMINANDO] {symbol} detectada inactiva.")
                        f.write(f"-- ESTADO INACTIVO/INTERRUMPIDO: {symbol}\n")
                        f.write(f"DELETE FROM price_history WHERE stock_id = (SELECT id FROM stocks WHERE symbol = '{symbol}');\n\n")
                        continue
                        
                    print(f"  [ACTIVA] {symbol}... Consolidando días...")
                    
                    all_days = {}
                    
                    # Cargar los datos de la API 1
                    for mov in mov_api1:
                        fec_str = mov.get("FEC") # DD-MMM-YY
                        meses_map = {"ENE": 1, "FEB": 2, "MAR": 3, "ABR": 4, "APR": 4, "MAY": 5, "JUN": 6, "JUL": 7, "AGO": 8, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DIC": 12, "DEC": 12}
                        try:
                            parts = fec_str.split('-')
                            day = int(parts[0])
                            month = meses_map.get(parts[1].upper(), 1)
                            year = int(parts[2])
                            if year < 100: year += 2000
                            p_date = f"{year}-{month:02d}-{day:02d}"
                            
                            all_days[p_date] = {
                                "OP": parse_ve_number(mov.get("PRECIO_APERT")),
                                "CP": parse_ve_number(mov.get("PRECIO_CIE")),
                                "CA": parse_ve_number(mov.get("VAR_ABS")),
                                "CPCT": parse_ve_number(mov.get("VAR_REL")),
                                "HP": parse_ve_number(mov.get("PRECIO_MAX")),
                                "LP": parse_ve_number(mov.get("PRECIO_MIN")),
                                "TR": int(parse_ve_number(mov.get("TOT_OP_NEGOC"))),
                                "VO": int(parse_ve_number(mov.get("TOT_ACC_NEGOC"))),
                                "AM": parse_ve_number(mov.get("TOT_MONTO_NEGOC"))
                            }
                        except Exception:
                            continue
                            
                    # Cargar y mezclar los datos de la API 2 (que tiene más fechas ocasionalmente)
                    mov_api2 = await fetch_api2_historico(client, symbol, semaphore)
                    added_from_api2 = 0
                    
                    for p_date, mov in mov_api2.items():
                        # Solo metemos las nuevas fechas que la API 1 ignoró
                        if p_date not in all_days:
                            added_from_api2 += 1
                            all_days[p_date] = {
                                "OP": parse_ve_number(mov.get("PRECIO_APERT")),
                                "CP": parse_ve_number(mov.get("PRECIO_CIE")),
                                "CA": 0.0,   # API 2 no provee variación, asumimos 0.0
                                "CPCT": 0.0,
                                "HP": parse_ve_number(mov.get("PRECIO_MAX")),
                                "LP": parse_ve_number(mov.get("PRECIO_MIN")),
                                "TR": int(parse_ve_number(mov.get("TOT_OP_NEGOC"))),
                                "VO": int(parse_ve_number(mov.get("TOT_ACC_NEGOC"))),
                                "AM": parse_ve_number(mov.get("TOT_MONTO_NEGOC"))
                            }
                    
                    if added_from_api2 > 0:
                        print(f"    (+{added_from_api2} días incorporados exclusivamente desde getOperacionesHistorico)")
                        
                    total_days = len(all_days)
                    if total_days > 0:
                        # Ordenamos el histórico temporalmente por fecha descendente
                        sorted_dates = sorted(all_days.keys(), reverse=True)
                        
                        f.write(f"-- Sincronizando historial {symbol} ({total_days} días)\n")
                        f.write("INSERT INTO price_history (stock_id, price_date, open_price, close_price, change_amount, change_pct, high_price, low_price, trades, volume, amount)\n")
                        f.write("SELECT s.id, d.price_date, d.open_price, d.close_price, d.change_amount, d.change_pct, d.high_price, d.low_price, d.trades, d.volume, d.amount\n")
                        f.write("FROM stocks s \nCROSS JOIN (\n")
                        f.write("  VALUES \n")
                        
                        values_blocks = []
                        for dt in sorted_dates:
                            v = all_days[dt]
                            values_blocks.append(f"    ('{dt}'::date, {v['OP']}, {v['CP']}, {v['CA']}, {v['CPCT']}, {v['HP']}, {v['LP']}, {v['TR']}, {v['VO']}, {v['AM']})")
                            
                        f.write(",\n".join(values_blocks))
                        
                        f.write("\n) AS d(price_date, open_price, close_price, change_amount, change_pct, high_price, low_price, trades, volume, amount)\n")
                        f.write(f"WHERE s.symbol = '{symbol}'\n")
                        f.write("ON CONFLICT (stock_id, price_date) DO UPDATE SET\n")
                        f.write("  open_price = EXCLUDED.open_price,\n")
                        f.write("  close_price = EXCLUDED.close_price,\n")
                        f.write("  change_amount = EXCLUDED.change_amount,\n")
                        f.write("  change_pct = EXCLUDED.change_pct,\n")
                        f.write("  high_price = EXCLUDED.high_price,\n")
                        f.write("  low_price = EXCLUDED.low_price,\n")
                        f.write("  trades = EXCLUDED.trades,\n")
                        f.write("  volume = EXCLUDED.volume,\n")
                        f.write("  amount = EXCLUDED.amount;\n\n")

                except Exception as e:
                    print(f"  [ERROR] Procesamiento de {symbol} falló: {e}")

    print(f"\n¡Completado! Se generó el archivo '{sql_file}'.")
    print("Abre tu consola SQL de Supabase, sube o pega el contenido directo del archivo generado para ejecutar la integración final.")

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
