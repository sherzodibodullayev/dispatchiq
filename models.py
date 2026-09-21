from datetime import datetime
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str
    content: str
    timestamp: Optional[str] = Field(default_factory=lambda: datetime.now().isoformat())


class TextQuestion(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    language: Optional[str] = "en"  # Default to English


class ChatResponse(BaseModel):
    answer: str
    conversation_id: str
    transcribed_text: Optional[str] = None


class WSMessage(BaseModel):
    type: str
    data: Dict[str, Any]