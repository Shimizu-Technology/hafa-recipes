"""Real extraction/schema/grounding on synthetic sources, without DB or servers."""

import argparse
import asyncio
import base64
import json
from pathlib import Path

import httpx

from capacity.safety import ensure
from capacity.source_facts import IMAGE_FACTS, PDF_FACTS, TEXT_FACTS
from capacity.transport import ProviderTransport


async def check_sources(folder):
    from app.domains.workouts.extraction import (
        ExtractionRequest,
        WorkoutExtractor,
        provider_messages,
    )

    transport = ProviderTransport(delay=0)

    class SyntheticProvider:
        enabled = True

        async def extract(self, source):
            async with httpx.AsyncClient(transport=transport) as client:
                response = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    json={"messages": provider_messages(source)},
                )
            return json.loads(response.json()["choices"][0]["message"]["content"])

    directory = Path(folder)
    requests = {
        "text": ExtractionRequest(
            kind="text", text=TEXT_FACTS["text"], ai_consent=True
        ),
        "image": ExtractionRequest(
            kind="images",
            images=[
                {
                    "base64_data": base64.b64encode(
                        (directory / "workout-image.jpg").read_bytes()
                    ).decode(),
                    "mime_type": "image/jpeg",
                }
            ],
            ai_consent=True,
        ),
        "pdf": ExtractionRequest(
            kind="document",
            document_base64=base64.b64encode(
                (directory / "source-30.pdf").read_bytes()
            ).decode(),
            document_mime="application/pdf",
            ai_consent=True,
        ),
    }
    facts = {"text": TEXT_FACTS, "image": IMAGE_FACTS, "pdf": PDF_FACTS}
    summary = {
        "synthetic": True,
        "provider_quality": False,
        "sources": {},
        "passed": True,
    }
    extractor = WorkoutExtractor(provider=SyntheticProvider())
    for kind, request in requests.items():
        result = await extractor.extract(request)
        exercise = (
            result.workout.blocks[0].exercises[0]
            if result.workout and result.workout.blocks
            else None
        )
        facts_pass = bool(exercise) and all(
            getattr(exercise, field) == facts[kind][field]
            for field in (
                "name",
                "sets",
                "reps_min",
                "reps_max",
                "rest_seconds",
                "per_side",
            )
        )
        visual_warning = "Visual extraction is model-observed evidence; review the source image/frame before accepting its prescription."
        expected = result.status == ("incomplete" if kind == "image" else "ready")
        warnings_pass = result.warnings == ([visual_warning] if kind == "image" else [])
        row = {
            "status": result.status,
            "facts_pass": facts_pass,
            "warnings_pass": warnings_pass,
            "error_code": result.error_code,
            "passed": facts_pass and expected and warnings_pass,
        }
        summary["sources"][kind] = row
        summary["passed"] = summary["passed"] and row["passed"]
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("folder")
    args = parser.parse_args()
    ensure()
    report = asyncio.run(check_sources(args.folder))
    print(json.dumps(report))
    raise SystemExit(0 if report["passed"] else 2)
