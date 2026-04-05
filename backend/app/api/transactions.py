from fastapi import APIRouter, Depends, HTTPException, status, Header, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.models.transaction import Transaction, TransactionSlippage   
from app.models.stock import Stock
from app.utils.security import decode_token
from uuid import UUID
from typing import List, Optional
from datetime import date, datetime
from pydantic import BaseModel, Field
from decimal import Decimal
import logging
from fastapi.responses import StreamingResponse
from app.services.excel_service import excel_service

logger = logging.getLogger(__name__)
router = APIRouter()

from app.schemas.transaction import TransactionCreate, TransactionResponse, TransactionUpdate, SlippageEntry, TransactionWithSlippage
from app.services.encryption_service import encryption_service

# ==================== DEPENDENCIES ====================

async def get_current_user_id(authorization: str = Header(...)) -> UUID:
    """Obtener ID del usuario desde el token JWT"""
    try:
        token = authorization.replace("Bearer ", "")
        payload = decode_token(token)
        if not payload or not payload.get("sub"):
            raise HTTPException(status_code=401, detail="Token inválido")
        return UUID(payload.get("sub"))
    except Exception as e:
        logger.error(f"Error decoding token: {e}")
        raise HTTPException(status_code=401, detail="Token inválido o expirado")

# ==================== ENDPOINTS ====================

@router.post("/", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    transaction_data: TransactionCreate,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    try:
        # Buscar o crear la acción
        stock_symbol = transaction_data.stock_symbol.upper().strip()
        result = await db.execute(select(Stock).where(Stock.symbol == stock_symbol))
        stock = result.scalar_one_or_none()
        if not stock:
            stock = Stock(symbol=stock_symbol, name=stock_symbol, currency="Bs", is_active=True)
            db.add(stock)
            await db.flush()

        # Calcular avg_price y gross_amount según slippage
        if transaction_data.slippage_entries and len(transaction_data.slippage_entries) > 0:
            # Verificar que la suma de cantidades coincida con la cantidad total
            total_qty = sum(entry.quantity for entry in transaction_data.slippage_entries)
            if total_qty != transaction_data.quantity:
                raise HTTPException(status_code=400, detail="Suma de cantidades de slippage no coincide con cantidad total")
            total_value = sum(entry.quantity * entry.price for entry in transaction_data.slippage_entries)
            avg_price = total_value / total_qty
            gross_amount = total_value
        else:
            if transaction_data.avg_price is None:
                raise HTTPException(status_code=400, detail="avg_price es requerido si no hay slippage")
            avg_price = transaction_data.avg_price
            gross_amount = transaction_data.quantity * avg_price

        # Calcular otros montos si no se proporcionan
        commission = transaction_data.commission or (gross_amount * 0.04)
        iva = transaction_data.iva or (commission * 0.16)
        registry_fee = transaction_data.registry_fee or (gross_amount * 0.001)
        net_amount = transaction_data.net_amount or (gross_amount + commission + iva + registry_fee)

        # Tasa BCV
        bcv_rate = transaction_data.bcv_rate
        if not bcv_rate:
            from app.models.stock import BcvRate
            bcv_result = await db.execute(select(BcvRate).order_by(BcvRate.rate_date.desc()).limit(1))
            bcv = bcv_result.scalar_one_or_none()
            bcv_rate = float(bcv.rate) if bcv else 370.0

        amount_usd = transaction_data.amount_usd or (net_amount / bcv_rate if bcv_rate > 0 else 0)

        # Crear transacción
        transaction = Transaction(
            user_id=user_id,
            stock_id=stock.id,
            order_number=transaction_data.order_number,
            order_type=transaction_data.order_type,
            request_type=transaction_data.request_type,
            quantity=transaction_data.quantity,
            avg_price=Decimal(str(avg_price)),
            gross_amount=Decimal(str(gross_amount)),
            commission=Decimal(str(commission)),
            iva=Decimal(str(iva)),
            registry_fee=Decimal(str(registry_fee)),
            net_amount=Decimal(str(net_amount)),
            bcv_rate=Decimal(str(bcv_rate)),
            amount_usd=Decimal(str(amount_usd)),
            transaction_date=transaction_data.transaction_date,
            brokerage=transaction_data.brokerage,
            notes=encryption_service.encrypt(transaction_data.notes or "")
        )
        db.add(transaction)
        await db.flush()  # para obtener transaction.id

        # Insertar slippage entries si existen
        if transaction_data.slippage_entries:
            for i, entry in enumerate(transaction_data.slippage_entries, start=1):
                slip = TransactionSlippage(
                    user_id=user_id,
                    transaction_id=transaction.id,
                    tramo_num=i,
                    cantidad=entry.quantity,
                    precio=Decimal(str(entry.price)),
                    monto_tramo=Decimal(str(entry.quantity * entry.price))
                )
                db.add(slip)

        await db.commit()
        await db.refresh(transaction)

        logger.info(f"✅ Transacción creada: {transaction.id} - {stock_symbol} - {transaction_data.order_type}")
        return {
            "message": "Transacción creada exitosamente",
            "transaction_id": transaction.id,
            "stock_symbol": stock.symbol,
            "stock_name": stock.name,
            "amount_usd": float(amount_usd),
            "order_type": transaction_data.order_type
        }

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"❌ Error creando transacción: {e}")
        raise HTTPException(status_code=500, detail=f"Error al crear transacción: {str(e)}")


@router.get("/", response_model=List[TransactionResponse])
async def get_transactions(
    user_id: UUID = Depends(get_current_user_id),
    stock_symbol: Optional[str] = None,
    order_type: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Obtener todas las transacciones del usuario con filtros opcionales
    """
    try:
        # Construir query base
        query = select(Transaction).where(Transaction.user_id == user_id)
        
        # Unir con Stock para obtener símbolo
        query = query.join(Stock, Transaction.stock_id == Stock.id)
        
        # Aplicar filtros
        if stock_symbol:
            query = query.where(Stock.symbol == stock_symbol.upper().strip())
        if order_type:
            query = query.where(Transaction.order_type == order_type)
        if start_date:
            query = query.where(Transaction.transaction_date >= start_date)
        if end_date:
            query = query.where(Transaction.transaction_date <= end_date)
        
        # Ordenar por fecha descendente
        query = query.order_by(Transaction.transaction_date.desc())
        query = query.offset(offset).limit(limit)
        
        # Ejecutar query
        result = await db.execute(query)
        transactions = result.scalars().all()
        
        # Obtener información de las acciones
        stock_ids = [t.stock_id for t in transactions if t.stock_id]
        stocks = {}
        if stock_ids:
            stocks_result = await db.execute(select(Stock).where(Stock.id.in_(stock_ids)))
            stocks = {s.id: s for s in stocks_result.scalars().all()}
        
        # Construir respuesta
        response = []
        for t in transactions:
            stock = stocks.get(t.stock_id)
            

            response.append(TransactionResponse(
                id=t.id,
                order_number=t.order_number,
                order_type=t.order_type,
                request_type=t.request_type,
                quantity=t.quantity,
                avg_price=float(t.avg_price) if t.avg_price else 0,
                gross_amount=float(t.gross_amount) if t.gross_amount else None,
                commission=float(t.commission) if t.commission else None,
                iva=float(t.iva) if t.iva else None,
                registry_fee=float(t.registry_fee) if t.registry_fee else None,
                net_amount=float(t.net_amount) if t.net_amount else None,
                bcv_rate=float(t.bcv_rate) if t.bcv_rate else None,
                amount_usd=float(t.amount_usd) if t.amount_usd else None,
                transaction_date=t.transaction_date,
                notes=encryption_service.decrypt(t.notes) if t.notes else "",
                stock_symbol=stock.symbol if stock else "N/A",
                stock_name=stock.name if stock else "N/A",
                created_at=str(t.created_at) if t.created_at else "",
            ))
        
        logger.info(f"📊 Transacciones obtenidas: {len(response)} para usuario {user_id}")
        
        return response
        
    except Exception as e:
        logger.error(f"❌ Error obteniendo transacciones: {e}")
        raise HTTPException(status_code=500, detail=f"Error al obtener transacciones: {str(e)}")
    
@router.get("/template")
async def download_transaction_template(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Descargar plantilla Excel para cargar transacciones
    """
    try:
        from app.services.excel_service import excel_service
        from fastapi.responses import StreamingResponse
        import io
        
        # Obtener acciones activas
        result = await db.execute(
            select(Stock).where(Stock.is_active == True)
        )
        stocks = result.scalars().all()
        
        stocks_data = [
            {'symbol': s.symbol, 'name': s.name, 'is_active': s.is_active}
            for s in stocks
        ]
        
        # Si no hay acciones en DB, usar el fallback completo del scraper
        if not stocks_data:
            from app.services.bvc_scraper import bvc_scraper
            stocks_data = bvc_scraper._get_fallback_stocks()
            logger.info(f"📋 Usando fallback scraper: {len(stocks_data)} acciones para plantilla")
        
        # Generar plantilla
        excel_content = excel_service.create_template(stocks_data)
        
        return StreamingResponse(
            io.BytesIO(excel_content),
            media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            headers={
                'Content-Disposition': 'attachment; filename="plantilla_transacciones.xlsx"'
            }
        )
        
    except Exception as e:
        logger.error(f"❌ Error generating template: {e}")
        raise HTTPException(status_code=500, detail=f"Error generando plantilla: {str(e)}")

@router.get("/export")
async def export_transactions(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Exportar todas las transacciones del usuario a Excel
    """
    try:
        import io
        from app.models.transaction import Transaction
        from app.models.stock import Stock
        
        # Obtener todas las transacciones con información de acción
        query = select(Transaction).where(Transaction.user_id == user_id).join(Stock, Transaction.stock_id == Stock.id).order_by(Transaction.transaction_date.desc())
        result = await db.execute(query)
        transactions = result.scalars().all()
        
        # Obtener stock symbols
        stock_ids = [t.stock_id for t in transactions]
        stocks_result = await db.execute(select(Stock).where(Stock.id.in_(stock_ids)))
        stocks_map = {s.id: s.symbol for s in stocks_result.scalars().all()}
        
        # Formatear datos para el servicio de Excel
        data_to_export = []
        for t in transactions:
            data_to_export.append({
                'order_number': t.order_number,
                'order_type': t.order_type,
                'stock_symbol': stocks_map.get(t.stock_id, "N/A"),
                'request_type': t.request_type,
                'quantity': t.quantity,
                'avg_price': float(t.avg_price),
                'gross_amount': float(t.gross_amount),
                'commission': float(t.commission),
                'iva': float(t.iva),
                'registry_fee': float(t.registry_fee),
                'net_amount': float(t.net_amount),
                'bcv_rate': float(t.bcv_rate) if t.bcv_rate else None,
                'amount_usd': float(t.amount_usd) if t.amount_usd else None,
                'transaction_date': t.transaction_date.strftime("%Y-%m-%d") if t.transaction_date else "",
                'brokerage': t.notes.split(" | ")[0] if t.notes else ""
            })
            
        excel_content = excel_service.create_export(data_to_export)
        
        return StreamingResponse(
            io.BytesIO(excel_content),
            media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            headers={
                'Content-Disposition': 'attachment; filename="mis_transacciones.xlsx"'
            }
        )
    except Exception as e:
        logger.error(f"❌ Error exporting transactions: {e}")
        raise HTTPException(status_code=500, detail=f"Error exportando transacciones: {str(e)}")
    
@router.post("/import")
async def import_transactions_from_excel(
    file: UploadFile = File(...),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Importar transacciones desde archivo Excel
    """
    try:
        # Validar tipo de archivo
        if not file.filename.endswith('.xlsx'):
            raise HTTPException(
                status_code=400,
                detail='Archivo inválido. Solo se aceptan archivos .xlsx'
            )
        
        # Leer contenido
        content = await file.read()
        
        # Parsear Excel
        transactions, errors = excel_service.parse_excel(content)
        
        if not transactions and errors:
            return {
                'success': False,
                'message': 'No se pudieron importar transacciones',
                'errors': errors,
                'imported_count': 0
            }
        
        # Importar transacciones válidas
        imported_count = 0
        import_details = []
        
        for tx_data in transactions:
            try:
                # Buscar o crear acción
                stock_symbol = tx_data['stock_symbol'].upper()
                result = await db.execute(
                    select(Stock).where(Stock.symbol == stock_symbol)
                )
                stock = result.scalar_one_or_none()
                
                if not stock:
                    stock = Stock(
                        symbol=stock_symbol,
                        name=stock_symbol,
                        currency='Bs',
                        is_active=True
                    )
                    db.add(stock)
                    await db.flush()
                
                # ── Resolver Tasa BCV por fecha si es necesario ──────────
                bcv_rate = tx_data.get('bcv_rate')
                amount_usd = tx_data.get('amount_usd')
                net_amount = tx_data.get('net_amount', 0)
                transaction_date_str = tx_data.get('transaction_date')

                if tx_data.get('bcv_rate_needed') and transaction_date_str:
                    try:
                        from app.models.stock import BcvRate
                        from datetime import date as _date
                        tx_date = datetime.strptime(transaction_date_str, '%Y-%m-%d').date()
                        # Buscar tasa exacta o la más reciente anterior a esa fecha
                        rate_result = await db.execute(
                            select(BcvRate)
                            .where(BcvRate.rate_date <= tx_date)
                            .order_by(BcvRate.rate_date.desc())
                            .limit(1)
                        )
                        bcv_record = rate_result.scalar_one_or_none()
                        if bcv_record:
                            bcv_rate = float(bcv_record.rate)
                            if net_amount and bcv_rate > 0:
                                amount_usd = round(float(net_amount) / bcv_rate, 6)
                            logger.info(f"✅ Tasa BCV para {transaction_date_str}: {bcv_rate}")
                        else:
                            logger.warning(f"⚠️ No hay tasa BCV en BD para {transaction_date_str}")
                    except Exception as e_rate:
                        logger.warning(f"⚠️ No se pudo obtener tasa BCV: {e_rate}")

                # Preparar fecha (puede ser None si no se proporcionó)
                if transaction_date_str:
                    tx_date_obj = datetime.strptime(transaction_date_str, '%Y-%m-%d').date()
                else:
                    from datetime import date as _date2
                    tx_date_obj = _date2.today()
                    logger.warning(f"⚠️ Sin fecha en fila — usando fecha de hoy")

                # Notas con info de slippage
                notes = tx_data.get('notes', '')
                slippage_tramos = tx_data.get('slippage_tramos', [])
                if slippage_tramos:
                    slip_detail = " | ".join(
                        [f"T{i+1}: {t['cantidad']}@{t['precio']}"
                         for i, t in enumerate(slippage_tramos)]
                    )
                    notes = f"{notes} | Slippage: {slip_detail}"

                # Crear transacción
                transaction = Transaction(
                    user_id=user_id,
                    stock_id=stock.id,
                    order_number=tx_data.get('order_number'),
                    order_type=tx_data['order_type'],
                    request_type=tx_data['request_type'],
                    quantity=tx_data['quantity'],
                    avg_price=Decimal(str(tx_data['avg_price'])),
                    gross_amount=Decimal(str(tx_data.get('gross_amount', 0))),
                    commission=Decimal(str(tx_data.get('commission', 0))),
                    iva=Decimal(str(tx_data.get('iva', 0))),
                    registry_fee=Decimal(str(tx_data.get('registry_fee', 0))),
                    net_amount=Decimal(str(net_amount)),
                    bcv_rate=Decimal(str(bcv_rate)) if bcv_rate else None,
                    amount_usd=Decimal(str(amount_usd)) if amount_usd else None,
                    brokerage=tx_data.get('brokerage'),
                    transaction_date=tx_date_obj,
                    notes=encryption_service.encrypt(notes or "")
                )
                
                db.add(transaction)
                await db.flush()  # get transaction.id before slippage insert

                # ── Guardar tramos de slippage ────────────────────────────
                slippage_tramos = tx_data.get('slippage_tramos', [])
                if slippage_tramos:
                    for i, tramo in enumerate(slippage_tramos, start=1):
                        monto = round(tramo['cantidad'] * tramo['precio'], 2)
                        slip = TransactionSlippage(
                            user_id=user_id,
                            transaction_id=transaction.id,
                            tramo_num=i,
                            cantidad=tramo['cantidad'],
                            precio=Decimal(str(tramo['precio'])),
                            monto_tramo=Decimal(str(monto))
                        )
                        db.add(slip)
                    logger.info(f"✅ {len(slippage_tramos)} tramos slippage guardados "
                                f"para tx {transaction.id}")

                imported_count += 1
                import_details.append({
                    'stock': stock_symbol,
                    'type': tx_data['order_type'],
                    'quantity': tx_data['quantity'],
                    'slippage_tramos': len(slippage_tramos),
                    'status': 'imported'
                })
                
            except Exception as e:
                errors.append({
                    'row': imported_count + 1,
                    'error': f'Error guardando transacción: {str(e)}',
                    'data': tx_data
                })
        
        await db.commit()
        
        return {
            'success': True,
            'message': f'{imported_count} transacciones importadas exitosamente',
            'imported_count': imported_count,
            'errors': errors if errors else None,
            'details': import_details
        }
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"❌ Error importing transactions: {e}")
        raise HTTPException(status_code=500, detail=f"Error importando transacciones: {str(e)}")
    
@router.get("/summary/stats")
async def get_transaction_stats(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Obtener estadísticas de transacciones del usuario
    """
    try:
        # Total de transacciones
        total_query = select(func.count(Transaction.id)).where(Transaction.user_id == user_id)
        total_result = await db.execute(total_query)
        total_transactions = total_result.scalar() or 0
        
        # Total comprado
        buy_query = select(func.sum(Transaction.net_amount)).where(
            Transaction.user_id == user_id,
            Transaction.order_type == "Compra"
        )
        buy_result = await db.execute(buy_query)
        total_bought = float(buy_result.scalar() or 0)
        
        # Total vendido
        sell_query = select(func.sum(Transaction.net_amount)).where(
            Transaction.user_id == user_id,
            Transaction.order_type == "Venta"
        )
        sell_result = await db.execute(sell_query)
        total_sold = float(sell_result.scalar() or 0)
        
        # Total en USD
        usd_query = select(func.sum(Transaction.amount_usd)).where(
            Transaction.user_id == user_id,
            Transaction.order_type == "Compra"
        )
        usd_result = await db.execute(usd_query)
        total_usd = float(usd_result.scalar() or 0)
        
        return {
            "total_transactions": total_transactions,
            "total_compras": total_transactions // 2,
            "total_ventas": total_transactions // 2,
            "total_invertido_bs": total_bought,
            "total_vendido_bs": total_sold,
            "total_invertido_usd": total_usd
        }
        
    except Exception as e:
        logger.error(f"❌ Error obteniendo estadísticas: {e}")
        raise HTTPException(status_code=500, detail=f"Error al obtener estadísticas: {str(e)}")


@router.get("/{transaction_id}", response_model=TransactionResponse)
async def get_transaction(
    transaction_id: int,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Obtener una transacción específica por ID
    """
    try:
        result = await db.execute(
            select(Transaction)
            .join(Stock, Transaction.stock_id == Stock.id)
            .where(
                Transaction.id == transaction_id,
                Transaction.user_id == user_id
            )
        )
        transaction = result.scalar_one_or_none()
        
        if not transaction:
            raise HTTPException(status_code=404, detail="Transacción no encontrada")
        
        # Obtener información de la acción
        stock_result = await db.execute(select(Stock).where(Stock.id == transaction.stock_id))
        stock = stock_result.scalar_one_or_none()
        
        return TransactionResponse(
            id=transaction.id,
            order_number=transaction.order_number,
            order_type=transaction.order_type,
            request_type=transaction.request_type,
            quantity=transaction.quantity,
            avg_price=float(transaction.avg_price) if transaction.avg_price else 0,
            gross_amount=float(transaction.gross_amount) if transaction.gross_amount else None,
            commission=float(transaction.commission) if transaction.commission else None,
            iva=float(transaction.iva) if transaction.iva else None,
            registry_fee=float(transaction.registry_fee) if transaction.registry_fee else None,
            net_amount=float(transaction.net_amount) if transaction.net_amount else None,
            bcv_rate=float(transaction.bcv_rate) if transaction.bcv_rate else None,
            amount_usd=float(transaction.amount_usd) if transaction.amount_usd else None,
            transaction_date=transaction.transaction_date,
            notes=transaction.notes,
            stock_symbol=stock.symbol if stock else "N/A",
            stock_name=stock.name if stock else "N/A",
            created_at=str(transaction.created_at) if transaction.created_at else ""
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error obteniendo transacción {transaction_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error al obtener transacción: {str(e)}")


@router.put("/{transaction_id}", response_model=TransactionResponse)
async def update_transaction(
    transaction_id: int,
    transaction_data: TransactionUpdate,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Actualizar una transacción existente
    """
    try:
        result = await db.execute(
            select(Transaction).where(
                Transaction.id == transaction_id,
                Transaction.user_id == user_id
            )
        )
        transaction = result.scalar_one_or_none()
        
        if not transaction:
            raise HTTPException(status_code=404, detail="Transacción no encontrada")
        
        # Actualizar campos permitidos
        update_data = transaction_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            if value is not None:
                setattr(transaction, field, value)
        
        await db.commit()
        await db.refresh(transaction)
        
        # Obtener información de la acción
        stock_result = await db.execute(select(Stock).where(Stock.id == transaction.stock_id))
        stock = stock_result.scalar_one_or_none()
        
        logger.info(f"✏️ Transacción actualizada: {transaction_id}")
        
        return TransactionResponse(
            id=transaction.id,
            order_number=transaction.order_number,
            order_type=transaction.order_type,
            request_type=transaction.request_type,
            quantity=transaction.quantity,
            avg_price=float(transaction.avg_price) if transaction.avg_price else 0,
            gross_amount=float(transaction.gross_amount) if transaction.gross_amount else None,
            commission=float(transaction.commission) if transaction.commission else None,
            iva=float(transaction.iva) if transaction.iva else None,
            registry_fee=float(transaction.registry_fee) if transaction.registry_fee else None,
            net_amount=float(transaction.net_amount) if transaction.net_amount else None,
            bcv_rate=float(transaction.bcv_rate) if transaction.bcv_rate else None,
            amount_usd=float(transaction.amount_usd) if transaction.amount_usd else None,
            transaction_date=transaction.transaction_date,
            notes=transaction.notes,
            stock_symbol=stock.symbol if stock else "N/A",
            stock_name=stock.name if stock else "N/A",
            created_at=str(transaction.created_at) if transaction.created_at else ""
        )
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"❌ Error actualizando transacción {transaction_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error al actualizar transacción: {str(e)}")


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    transaction_id: int,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Eliminar una transacción
    """
    try:
        result = await db.execute(
            select(Transaction).where(
                Transaction.id == transaction_id,
                Transaction.user_id == user_id
            )
        )
        transaction = result.scalar_one_or_none()
        
        if not transaction:
            raise HTTPException(status_code=404, detail="Transacción no encontrada")
        
        await db.delete(transaction)
        await db.commit()
        
        logger.info(f"🗑️ Transacción eliminada: {transaction_id}")
        
        return {"message": "Transacción eliminada exitosamente"}
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"❌ Error eliminando transacción {transaction_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error al eliminar transacción: {str(e)}")


# ==================== ESTADÍSTICAS ====================