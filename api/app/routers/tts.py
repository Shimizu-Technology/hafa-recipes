"""Text-to-Speech router using OpenAI TTS API."""

from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.ai_governance import PROMPT_VERSIONS, AIInvocationTracker, ai_request_context
from app.auth import ClerkUser, get_current_user
from app.config import get_settings
from app.rate_limit import RateLimitExceeded, ai_rate_limiter

router = APIRouter(prefix="/api/tts", tags=["TTS"])
settings = get_settings()

# Available OpenAI TTS voices
TTS_VOICES = Literal["alloy", "echo", "fable", "onyx", "nova", "shimmer"]


class TTSRequest(BaseModel):
    """Request body for TTS generation."""
    text: str
    voice: TTS_VOICES = "nova"  # Default to nova (warm, natural)


@router.post("")
async def generate_tts(
    request: TTSRequest,
    user: ClerkUser = Depends(get_current_user),
):
    """
    Generate speech from text using OpenAI TTS API.
    
    Returns an audio stream (MP3 format).
    
    Voices:
    - alloy: Neutral, balanced
    - echo: Soft, gentle
    - fable: Expressive, storytelling
    - onyx: Deep, authoritative
    - nova: Warm, natural (default)
    - shimmer: Clear, bright
    """
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Text is required")
    
    # Limit text length to prevent abuse (approx 4096 chars = ~1 min audio)
    if len(request.text) > 4096:
        raise HTTPException(
            status_code=400, 
            detail="Text too long. Maximum 4096 characters."
        )
    
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=500,
            detail="OpenAI API key not configured"
        )

    if not settings.is_ai_capability_enabled("tts"):
        raise HTTPException(status_code=503, detail="Text-to-speech is temporarily unavailable")
    
    try:
        with ai_request_context(user_id=user.id, route="tts"):
            async with ai_rate_limiter.limit(
                user_id=user.id,
                capability="tts",
                requests_per_minute=20,
                max_concurrency=2,
            ):
                async with AIInvocationTracker(
                    capability="tts",
                    primary_model=settings.tts_model,
                    prompt_version=PROMPT_VERSIONS["tts"],
                ) as invocation:
                    async with httpx.AsyncClient(timeout=60.0) as client:
                        response = await client.post(
                            "https://api.openai.com/v1/audio/speech",
                            headers={
                                "Authorization": f"Bearer {settings.openai_api_key}",
                                "Content-Type": "application/json",
                            },
                            json={
                                "model": invocation.model,
                                "input": request.text,
                                "voice": request.voice,
                                "response_format": "mp3",
                            },
                        )

                    if response.status_code != 200:
                        invocation.fail(f"provider_http_{response.status_code}")
                        raise HTTPException(
                            status_code=502,
                            detail="Speech generation is temporarily unavailable.",
                        )
                    invocation.succeed()
                    return StreamingResponse(
                        iter([response.content]),
                        media_type="audio/mpeg",
                        headers={
                            "Content-Disposition": "inline; filename=speech.mp3",
                            "Cache-Control": "no-cache",
                        },
                    )
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many speech requests. Please wait and try again.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="TTS generation timed out. Try shorter text."
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Speech generation failed. Please try again."
        )


@router.get("/voices")
async def list_voices():
    """List available TTS voices with descriptions."""
    return {
        "voices": [
            {"id": "alloy", "name": "Alloy", "description": "Neutral, balanced"},
            {"id": "echo", "name": "Echo", "description": "Soft, gentle"},
            {"id": "fable", "name": "Fable", "description": "Expressive, storytelling"},
            {"id": "onyx", "name": "Onyx", "description": "Deep, authoritative"},
            {"id": "nova", "name": "Nova", "description": "Warm, natural"},
            {"id": "shimmer", "name": "Shimmer", "description": "Clear, bright"},
        ],
        "default": "nova"
    }
