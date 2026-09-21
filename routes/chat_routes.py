import os
import uuid
import logging
from datetime import datetime
from typing import Optional

import openai
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks, Depends
from fastapi.responses import JSONResponse

from models import ChatResponse, TextQuestion
from config import AUDIO_DIR, CHAT_MODEL, HAS_OPENAI_KEY
from utils.audio_utils import (
    cleanup_audio_file, 
    is_ffmpeg_available, 
    convert_audio_to_mp3, 
    convert_audio_format_basic
)
from utils.conversation_utils import get_or_create_conversation
from utils.rate_limiting import rate_limit_dependency
from utils.redis_utils import (
    get_conversation_from_redis, 
    save_conversation_to_redis,
    delete_conversation_from_redis
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

@router.post("/chat", response_model=ChatResponse, dependencies=[Depends(rate_limit_dependency)])
async def chat(question: TextQuestion, background_tasks: BackgroundTasks):
    """Handle text chat messages with language support"""
    if not HAS_OPENAI_KEY:
        logger.error("OPENAI_API_KEY is not set; the assistant cannot answer.")
        raise HTTPException(
            status_code=503,
            detail="The assistant isn't configured yet. Please try again later.",
        )

    try:
        # Get or create conversation history with language support
        conversation_id, conversation = get_or_create_conversation(
            question.conversation_id, 
            question.language
        )

        # Add user message to history
        user_message = {"role": "user", "content": question.message, "timestamp": datetime.now().isoformat()}
        conversation.append({"role": "user", "content": question.message})

        # Get response from OpenAI
        response = openai.chat.completions.create(
            model=CHAT_MODEL,
            messages=conversation,
            max_tokens=1000,
            temperature=0.7
        )

        # Extract and save assistant response
        assistant_message = response.choices[0].message.content
        conversation.append(
            {"role": "assistant", "content": assistant_message, "timestamp": datetime.now().isoformat()})

        # Save updated conversation to Redis using background task
        background_tasks.add_task(save_conversation_to_redis, conversation_id, conversation)

        # Return response
        return ChatResponse(answer=assistant_message, conversation_id=conversation_id)

    except openai.APIError as e:
        logger.error(f"OpenAI API error: {e}")
        # Localized error message
        if question.language == "uz":
            error_msg = "Xizmat vaqtincha mavjud emas. Iltimos, keyinroq qayta urinib ko'ring."
        else:
            error_msg = "Service temporarily unavailable. Please try again later."
        raise HTTPException(status_code=503, detail=error_msg)
    except Exception as e:
        logger.error(f"Error processing chat request: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/audio-question", response_model=ChatResponse, dependencies=[Depends(rate_limit_dependency)])
async def process_audio_question(
        background_tasks: BackgroundTasks,
        audio_file: UploadFile = File(...),
        conversation_id: Optional[str] = Form(None),
        language: Optional[str] = Form("en")  # Default to English
):
    """Handle audio questions with transcription and language support"""
    temp_files = []  # Track files to clean up
    
    try:
        # Check if file is empty
        file_content = await audio_file.read()
        if len(file_content) == 0:
            raise HTTPException(
                status_code=400, 
                detail="Empty audio file received"
            )
        
        # Create a unique filename, preserving the original extension
        original_filename = audio_file.filename or "recording.webm"
        original_extension = os.path.splitext(original_filename)[1]
        if not original_extension:
            original_extension = ".webm"  # Default if no extension
            
        filename = f"{uuid.uuid4()}{original_extension}"
        file_location = f"{AUDIO_DIR}/{filename}"
        
        # Log incoming audio details
        logger.info(f"Received audio with filename: {original_filename}, "
                   f"content_type: {audio_file.content_type}, "
                   f"size: {len(file_content)} bytes, "
                   f"saving as: {filename}")
        
        # Save audio file
        with open(file_location, "wb") as file_object:
            file_object.write(file_content)
        
        # Schedule cleanup for original file
        background_tasks.add_task(cleanup_audio_file, file_location)
        temp_files.append(file_location)
        
        # Try to detect iOS recording
        is_ios_recording = False
        if "/iPhone" in str(audio_file.content_type) or "iOS" in str(audio_file.content_type) or "/iPad" in str(audio_file.content_type):
            is_ios_recording = True
        
        # Set default transcribe path to original file
        transcribe_file_path = file_location
        
        # Step 1: Try to convert using FFmpeg if available
        ffmpeg_available = is_ffmpeg_available()
        if ffmpeg_available:
            logger.info("FFmpeg is available, attempting conversion")
            converted_file = convert_audio_to_mp3(file_location)
            if converted_file:
                logger.info(f"FFmpeg conversion successful: {converted_file}")
                transcribe_file_path = converted_file
                background_tasks.add_task(cleanup_audio_file, converted_file)
                temp_files.append(converted_file)
        else:
            logger.warning("FFmpeg not available, trying alternative conversion")
            
            # Step 2: Try simple extension change if it's iOS
            if is_ios_recording or ".webm" in original_filename.lower():
                # Try the basic conversion (just changes extension)
                converted_file = convert_audio_format_basic(file_location, "mp3")
                if converted_file:
                    logger.info(f"Basic conversion completed: {converted_file}")
                    transcribe_file_path = converted_file
                    background_tasks.add_task(cleanup_audio_file, converted_file)
                    temp_files.append(converted_file)
                
                # For iOS specifically, also create WAV version as another fallback
                wav_file = convert_audio_format_basic(file_location, "wav")
                if wav_file:
                    logger.info(f"Created WAV version as fallback: {wav_file}")
                    # Only use this if MP3 conversion fails
                    temp_files.append(wav_file)
        
        # Now try transcription with the potentially converted file
        try:
            with open(transcribe_file_path, "rb") as audio_file:
                transcript = openai.audio.transcriptions.create(
                    file=audio_file,
                    model="whisper-1"
                )
                
            # Get text from transcript
            question_text = transcript.text
            logger.info(f"Successfully transcribed audio: {question_text[:50]}...")
            
        except openai.APIError as e:
            logger.error(f"OpenAI Whisper API error with first attempt: {e}")
            
            # If transcription failed and we have a WAV fallback, try that
            wav_fallback = [f for f in temp_files if f.endswith('.wav')]
            if wav_fallback and os.path.exists(wav_fallback[0]):
                logger.info(f"Trying WAV fallback file: {wav_fallback[0]}")
                try:
                    with open(wav_fallback[0], "rb") as audio_file:
                        transcript = openai.audio.transcriptions.create(
                            file=audio_file,
                            model="whisper-1"
                        )
                    question_text = transcript.text
                    logger.info(f"Successfully transcribed with WAV fallback: {question_text[:50]}...")
                except Exception as e2:
                    logger.error(f"WAV fallback also failed: {e2}")
                    # If all attempts fail, return a helpful error
                    error_msg = (
                        "We couldn't process your audio recording. "
                        "Please try using a different format or use text input instead."
                    )
                    
                    if language == "uz":
                        error_msg = (
                            "Audio yozuvingizni qayta ishlashda muammo yuzaga keldi. "
                            "Iltimos, boshqa formatdan foydalaning yoki matn kiritishdan foydalaning."
                        )
                        
                    raise HTTPException(status_code=400, detail=error_msg)
            else:
                # No fallback available
                error_msg = (
                    "We couldn't process your audio recording. "
                    "Please try using a different format or use text input instead."
                )
                
                if language == "uz":
                    error_msg = (
                        "Audio yozuvingizni qayta ishlashda muammo yuzaga keldi. "
                        "Iltimos, boshqa formatdan foydalaning yoki matn kiritishdan foydalaning."
                    )
                    
                raise HTTPException(status_code=400, detail=error_msg)

        # Process the text question with language support
        text_question = TextQuestion(
            message=question_text, 
            conversation_id=conversation_id,
            language=language
        )
        
        response = await chat(text_question, background_tasks)

        # Include the transcribed text in the response
        response.transcribed_text = question_text

        return response

    except openai.APIError as e:
        logger.error(f"OpenAI API error in audio processing: {e}")
        # Localized error message
        if language == "uz":
            error_msg = "Xizmat vaqtincha mavjud emas. Iltimos, keyinroq qayta urinib ko'ring."
        else:
            error_msg = "Service temporarily unavailable. Please try again later."
        raise HTTPException(status_code=503, detail=error_msg)
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
        
    except Exception as e:
        logger.error(f"Error processing audio question: {e}")
        
        # Provide helpful error message based on language
        if language == "uz":
            error_msg = "Audio xabaringizni qayta ishlashda xatolik yuz berdi. Iltimos, matn kiritishni sinab ko'ring."
        else:
            error_msg = "Error processing your audio message. Please try using text input instead."
            
        raise HTTPException(status_code=500, detail=error_msg)
    
    finally:
        # Ensure all temp files are cleaned up in case of exceptions
        for file_path in temp_files:
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
                    logger.info(f"Cleaned up temp file: {file_path}")
            except Exception as e:
                logger.error(f"Error cleaning up temp file {file_path}: {e}")


@router.get("/conversations/{conversation_id}", dependencies=[Depends(rate_limit_dependency)])
async def get_conversation(conversation_id: str, language: Optional[str] = "en"):
    """Get conversation history by ID with language support"""
    conversation = get_conversation_from_redis(conversation_id)
    if not conversation:
        # Localized error message
        if language == "uz":
            error_msg = "Suhbat topilmadi"
        else:
            error_msg = "Conversation not found"
        raise HTTPException(status_code=404, detail=error_msg)

    # Filter out system messages for client display
    chat_history = [msg for msg in conversation if msg["role"] != "system"]
    
    # Add language information for frontend to know which language this conversation is in
    language_info = "en"  # Default
    
    # Extract language from system message if available
    if conversation and conversation[0]["role"] == "system":
        system_content = conversation[0]["content"]
        if "[LANGUAGE: uz]" in system_content:
            language_info = "uz"
    
    return {
        "conversation": chat_history,
        "language": language_info
    }


@router.delete("/conversations/{conversation_id}", dependencies=[Depends(rate_limit_dependency)])
async def delete_conversation(conversation_id: str, language: Optional[str] = "en"):
    """Delete a conversation by ID with localized response"""
    result = delete_conversation_from_redis(conversation_id)
    if not result:
        # Localized error message
        if language == "uz":
            error_msg = "Suhbat topilmadi yoki o'chirilmadi"
        else:
            error_msg = "Conversation not found or could not be deleted"
        raise HTTPException(status_code=404, detail=error_msg)
    
    # Localized success message
    if language == "uz":
        success_msg = "Suhbat muvaffaqiyatli o'chirildi"
    else:
        success_msg = "Conversation deleted successfully"
        
    return {"success": True, "message": success_msg}