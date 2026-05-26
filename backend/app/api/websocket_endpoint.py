from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from app.websocket.manager import manager
from app.websocket.bvc_proxy import bvc_cache
from app.utils.security import decode_token
from uuid import UUID
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(None)
):
    """WebSocket endpoint para conexiones en tiempo real"""
    user_id = None
    
    try:
        # ✅ Validar token correctamente
        if token:
            payload = decode_token(token)
            logger.info(f"🔍 WebSocket payload: {payload}")
            
            if payload and payload.get("sub"):
                user_id = UUID(payload.get("sub"))
                logger.info(f"✅ WebSocket auth successful for user {user_id}")
            else:
                logger.warning(f"⚠️ WebSocket invalid payload: {payload}")
        else:
            logger.warning("⚠️ WebSocket no token provided")
    except Exception as e:
        logger.error(f"❌ WebSocket auth failed: {e}")
    
    # Si no hay user_id válido, rechazar conexión
    if not user_id:
        logger.warning("⚠️ WebSocket connection rejected - invalid user_id")
        await websocket.close(code=4001, reason="Unauthorized - Invalid or missing token")
        return
    
    # Aceptar conexión
    await manager.connect(websocket, user_id)
    
    # Push el último estado del mercado (Cache)
    for event_name, event_data in bvc_cache.items():
        try:
            await websocket.send_json({
                "type": "bvc_event",
                "eventName": event_name,
                "data": event_data
            })
        except Exception:
            pass
            
    try:
        while True:
            # Esperar mensajes del cliente
            data = await websocket.receive_text()
            logger.info(f"📨 Received from {user_id}: {data}")
            
            # Echo back confirmation
            await websocket.send_json({
                "type": "ack",
                "data": {"received": data, "timestamp": str(__import__('datetime').datetime.utcnow())}
            })
    except WebSocketDisconnect:
        logger.info(f"🔌 WebSocket disconnected for user {user_id}")
        manager.disconnect(websocket, user_id)
    except Exception as e:
        logger.error(f"❌ WebSocket error for {user_id}: {e}")
        manager.disconnect(websocket, user_id)