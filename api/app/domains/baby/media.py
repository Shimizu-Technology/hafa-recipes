"""Local uploaded-media tools with no network protocols and bounded children."""

import asyncio
import json
import math
import os

from app.services.video import _terminate_process

EXTENSIONS = {
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
}


def matches_container(data, mime):
    if mime in {"video/mp4", "video/quicktime", "audio/mp4"}:
        return len(data) >= 12 and data[4:8] == b"ftyp"
    if mime in {"video/webm", "audio/webm"}:
        return data.startswith(b"\x1aE\xdf\xa3")
    if mime in {"audio/wav", "audio/x-wav"}:
        return data.startswith(b"RIFF") and data[8:12] == b"WAVE"
    if mime == "audio/ogg":
        return data.startswith(b"OggS")
    if mime == "audio/mpeg":
        return data.startswith(b"ID3") or (
            len(data) > 2 and data[0] == 255 and data[1] & 224 == 224
        )
    return False


async def command(program, args, *, timeout=20):
    process = None
    try:
        process = await asyncio.create_subprocess_exec(
            program,
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            start_new_session=os.name == "posix",
        )
        output, _ = await asyncio.wait_for(process.communicate(), timeout)
        if process.returncode or len(output) > 65536:
            raise ValueError("Media tool failed")
        return output
    finally:
        await _terminate_process(process)


async def probe(path, *, mime=None):
    result = json.loads(
        await command(
            "ffprobe",
            [
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-show_entries",
                "format=duration:stream=codec_type",
                "-of",
                "json",
                str(path),
            ],
            timeout=10,
        )
    )
    duration = float(result["format"]["duration"])
    if not math.isfinite(duration) or not 0 < duration <= 1800:
        raise ValueError("Unsupported media duration")
    streams = {stream.get("codec_type") for stream in result.get("streams", [])}
    if mime and (
        (mime.startswith("video/") and "video" not in streams)
        or (mime.startswith("audio/") and "audio" not in streams)
    ):
        raise ValueError("Media content does not match its type")
    return duration


async def audio_track(path, output):
    await command(
        "ffmpeg",
        [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-threads",
            "1",
            "-i",
            str(path),
            "-vn",
            "-t",
            "1800",
            "-ac",
            "1",
            "-ar",
            "22050",
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "64k",
            "-threads",
            "1",
            "-y",
            str(output),
        ],
        timeout=60,
    )


async def frame(path, output, timestamp):
    await command(
        "ffmpeg",
        [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-threads",
            "1",
            "-ss",
            str(timestamp),
            "-i",
            str(path),
            "-frames:v",
            "1",
            "-vf",
            "scale='min(960,iw)':-2",
            "-threads:v",
            "1",
            "-q:v",
            "3",
            "-y",
            str(output),
        ],
    )
