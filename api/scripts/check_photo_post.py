"""Run from api: python scripts/check_photo_post.py. No AI, DB access or writes."""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai_governance import ai_request_context  # noqa: E402
from app.services.photo_posts import diagnose_photo_post  # noqa: E402
from app.services.video import public_video_service  # noqa: E402


async def main():
    with ai_request_context(route="/internal/import-health"):
        result = await diagnose_photo_post(
            public_video_service,
            "https://www.tiktok.com/@maileelton/photo/7697377006715030814",
        )
        print(json.dumps(result))
        return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
