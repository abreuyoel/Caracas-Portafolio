from fastapi import WebSocket
from typing import Dict, List
from uuid import UUID
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[UUID, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: UUID):
        """Aceptar y registrar conexión WebSocket"""
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        logger.info(f"✅ User {user_id} connected via WebSocket")
        logger.info(f"📊 Active connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket, user_id: UUID):
        """Cerrar y remover conexión WebSocket"""
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        logger.info(f"❌ User {user_id} disconnected from WebSocket")
        logger.info(f"📊 Active connections: {len(self.active_connections)}")

    async def send_personal_message(self, message: dict, user_id: UUID):
        """Enviar mensaje a un usuario específico"""
        if user_id in self.active_connections:
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Error sending message to {user_id}: {e}")

    async def broadcast(self, message: dict):
        """Enviar mensaje a todos los usuarios conectados"""
        for user_id, connections in self.active_connections.items():
            for connection in connections:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Error broadcasting to {user_id}: {e}")

    async def send_price_update(self, user_id: UUID, symbol: str, price: float, change_pct: float):
        """Enviar actualización de precio de acción"""
        message = {
            "type": "price_update",
            "data": {
                "symbol": symbol,
                "price": price,
                "change_pct": change_pct,
                "timestamp": datetime.utcnow().isoformat()
            }
        }
        await self.send_personal_message(message, user_id)

    async def send_alert(self, user_id: UUID, alert_type: str, message: str, stock_symbol: str = None):
        """Enviar alerta al usuario"""
        msg = {
            "type": "alert",
            "data": {
                "alert_type": alert_type,
                "message": message,
                "stock_symbol": stock_symbol,
                "timestamp": datetime.utcnow().isoformat()
            }
        }
        await self.send_personal_message(msg, user_id)

    async def send_portfolio_update(self, user_id: UUID, summary: dict):
        """Enviar actualización de portafolio"""
        message = {
            "type": "portfolio_update",
            "data": summary
        }
        await self.send_personal_message(message, user_id)

    def get_connection_count(self) -> int:
        """Obtener número total de conexiones activas"""
        return sum(len(connections) for connections in self.active_connections.values())


# Singleton instance
manager = ConnectionManager()