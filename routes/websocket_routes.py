import json
import logging
import asyncio
from typing import Dict, Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, BackgroundTasks
from starlette.websockets import WebSocketState

from models import TextQuestion
from routes.chat_routes import chat

logger = logging.getLogger(__name__)

router = APIRouter()

# WebSocket connection manager with rate limiting
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.message_counts: Dict[str, int] = {}
        self.rate_limit = 20  # Max messages per minute
        self.rate_window = 60  # Window in seconds
        
    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket
        self.message_counts[client_id] = 0
        logger.info(f"Client {client_id} connected. Total connections: {len(self.active_connections)}")
        
        # Schedule rate limit reset
        asyncio.create_task(self._reset_rate_limit(client_id))

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
            
        if client_id in self.message_counts:
            del self.message_counts[client_id]
            
        logger.info(f"Client {client_id} disconnected. Total connections: {len(self.active_connections)}")

    async def send_personal_message(self, message: Dict[str, Any], client_id: str):
        if client_id in self.active_connections:
            websocket = self.active_connections[client_id]
            if websocket.client_state == WebSocketState.CONNECTED:
                try:
                    await websocket.send_json(message)
                except Exception as e:
                    logger.error(f"Error sending message to client {client_id}: {e}")
                    self.disconnect(client_id)
            else:
                self.disconnect(client_id)

    async def broadcast(self, message: Dict[str, Any]):
        disconnected_clients = []
        for client_id, websocket in self.active_connections.items():
            if websocket.client_state == WebSocketState.CONNECTED:
                try:
                    await websocket.send_json(message)
                except Exception as e:
                    logger.error(f"Error broadcasting to client {client_id}: {e}")
                    disconnected_clients.append(client_id)
            else:
                disconnected_clients.append(client_id)

        # Remove disconnected clients
        for client_id in disconnected_clients:
            self.disconnect(client_id)
    
    def check_rate_limit(self, client_id: str) -> bool:
        """Check if client has exceeded rate limit"""
        if client_id not in self.message_counts:
            return True
            
        if self.message_counts[client_id] >= self.rate_limit:
            return False
            
        self.message_counts[client_id] += 1
        return True
    
    async def _reset_rate_limit(self, client_id: str):
        """Reset rate limit after window expires"""
        await asyncio.sleep(self.rate_window)
        if client_id in self.message_counts:
            self.message_counts[client_id] = 0

# Create a manager instance
manager = ConnectionManager()

@router.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    """WebSocket endpoint for real-time chat with language support"""
    await manager.connect(websocket, client_id)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            message_type = message.get("type")
            message_data = message.get("data", {})

            if message_type == "ping":
                # Simple ping-pong for connection keep-alive
                await manager.send_personal_message({"type": "pong"}, client_id)

            elif message_type == "chat_message":
                # Check rate limit
                if not manager.check_rate_limit(client_id):
                    # Get user's language preference
                    language = message_data.get("language", "en")
                    
                    # Localized rate limit message
                    if language == "uz":
                        error_msg = "Tezlik chegarasi oshib ketdi. Iltimos, sekinlashing."
                    else:
                        error_msg = "Rate limit exceeded. Please slow down."
                        
                    await manager.send_personal_message(
                        {"type": "error", "data": {"message": error_msg}},
                        client_id
                    )
                    continue

                # Process chat message
                conversation_id = message_data.get("conversation_id")
                user_message = message_data.get("message")
                language = message_data.get("language", "en")  # Get language preference

                if not user_message:
                    # Localized error message
                    if language == "uz":
                        error_msg = "Xabar mazmuni talab qilinadi"
                    else:
                        error_msg = "Message content is required"
                        
                    await manager.send_personal_message(
                        {"type": "error", "data": {"message": error_msg}},
                        client_id
                    )
                    continue

                # Notify client that message is being processed
                # Localized processing message
                if language == "uz":
                    processing_msg = "Xabaringiz qayta ishlanmoqda..."
                else:
                    processing_msg = "Processing your message..."
                    
                await manager.send_personal_message(
                    {"type": "processing", "data": {"message": processing_msg}},
                    client_id
                )

                try:
                    # Create background tasks
                    background_tasks = BackgroundTasks()
                    
                    # Process the message with language support
                    question = TextQuestion(
                        message=user_message, 
                        conversation_id=conversation_id,
                        language=language
                    )
                    response = await chat(question, background_tasks)

                    # Send response back to client
                    await manager.send_personal_message(
                        {
                            "type": "chat_response",
                            "data": {
                                "answer": response.answer,
                                "conversation_id": response.conversation_id
                            }
                        },
                        client_id
                    )
                except Exception as e:
                    logger.error(f"Error processing WebSocket message: {e}")
                    
                    # Localized error message
                    if language == "uz":
                        error_msg = "Xabaringizni qayta ishlashda xatolik yuz berdi. Iltimos, qayta urinib ko'ring."
                    else:
                        error_msg = "An error occurred while processing your message. Please try again."
                        
                    await manager.send_personal_message(
                        {"type": "error", "data": {"message": error_msg}},
                        client_id
                    )

            else:
                # Unknown message type - language depends on what was sent in the message
                language = message_data.get("language", "en") if isinstance(message_data, dict) else "en"
                
                # Localized error message
                if language == "uz":
                    error_msg = f"Noma'lum xabar turi: {message_type}"
                else:
                    error_msg = f"Unknown message type: {message_type}"
                    
                await manager.send_personal_message(
                    {"type": "error", "data": {"message": error_msg}},
                    client_id
                )

    except WebSocketDisconnect:
        manager.disconnect(client_id)
    except json.JSONDecodeError:
        logger.error(f"Invalid JSON received from client {client_id}")
        manager.disconnect(client_id)
    except Exception as e:
        logger.error(f"WebSocket error for client {client_id}: {e}")
        manager.disconnect(client_id)
        
