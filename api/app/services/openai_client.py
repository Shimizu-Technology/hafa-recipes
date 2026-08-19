"""OpenAI audio transcription service."""

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from openai import AsyncOpenAI

from app.ai_governance import PROMPT_VERSIONS, AIInvocationTracker
from app.config import get_settings

settings = get_settings()


@dataclass
class TranscriptionResult:
    """Result of an audio transcription attempt."""

    success: bool
    text: str = ""
    error: Optional[str] = None


class OpenAIService:
    """Service for provider-backed audio transcription."""

    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def transcribe_audio(self, audio_file_path: str) -> TranscriptionResult:
        if not settings.is_ai_capability_enabled("transcription"):
            return TranscriptionResult(
                success=False,
                error="Transcription is temporarily unavailable",
            )

        audio_path = Path(audio_file_path)
        if not audio_path.exists():
            return TranscriptionResult(success=False, error="Audio file was not found")

        try:
            async with AIInvocationTracker(
                capability="transcription",
                primary_model=settings.transcription_model,
                prompt_version=PROMPT_VERSIONS["transcription"],
            ) as invocation:
                with audio_path.open("rb") as audio_file:
                    transcription = await self.client.audio.transcriptions.create(
                        file=audio_file,
                        model=invocation.model,
                        language="en",
                        response_format="text",
                        temperature=0.0,
                    )
                if not transcription:
                    invocation.fail("empty_response")
                    return TranscriptionResult(
                        success=False,
                        error="Transcription returned no text",
                    )
                invocation.succeed()
                return TranscriptionResult(success=True, text=transcription)
        except Exception as exc:
            return TranscriptionResult(
                success=False,
                error=f"Transcription failed ({type(exc).__name__})",
            )


openai_service = OpenAIService()
