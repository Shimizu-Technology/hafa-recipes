"""Synthetic provider HTTP only; real request construction remains in application code."""

import asyncio
import json
import re
from uuid import uuid4

import httpx

TEXT = "Squat: 3 sets of 8-12 reps. Rest 90 seconds."
SCORES = ("same_dish", "finished_dish", "clarity", "crop", "unobstructed", "lighting")


def recipe():
    return {
        "title": "Capacity rice",
        "servings": 2,
        "prepTime": "5 minutes",
        "cookTime": "10 minutes",
        "ingredients": [
            {"name": "rice", "quantity": "1", "unit": "cup"},
            {"name": "water", "quantity": "2", "unit": "cups"},
        ],
        "steps": ["Combine rice and water.", "Cook until tender."],
        "notes": "",
        "tags": ["capacity"],
    }


def workout(location="provided_text"):
    evidence = [
        {"field": field, "wording": quote, "location": location}
        for field, quote in [
            ("name", "Squat"),
            ("sets", "3 sets"),
            ("reps_min", "8-12 reps"),
            ("reps_max", "8-12 reps"),
            ("rest_seconds", "90 seconds"),
        ]
    ]
    return {
        "title": "Capacity squat",
        "kind": "session",
        "estimated_minutes": 20,
        "equipment_required": [],
        "blocks": [
            {
                "id": "main",
                "label": "Strength",
                "grouping": "sequential",
                "exercises": [
                    {
                        "name": "Squat",
                        "sets": 3,
                        "reps_min": 8,
                        "reps_max": 12,
                        "rest_seconds": 90,
                        "evidence": evidence,
                    }
                ],
            }
        ],
    }


class FixtureBudget:
    """Bulk throughput mode only: no financial reservation/quality claim."""

    def attempt(self, **_):
        from app.domains.workouts.budget import BudgetAttempt

        return BudgetAttempt(self, _["capability"], _["model"], _["envelope"])

    async def reserve(self, *_):
        return uuid4(), 1

    async def finish(self, *_):
        return None


class ProviderTransport(httpx.AsyncBaseTransport):
    def __init__(self, delay=0.25):
        self.delay = delay
        self.calls = {"extraction": 0, "cover": 0, "chat": 0}

    async def handle_async_request(self, request):
        if request.url.host != "api.openai.com":
            raise RuntimeError("Unexpected external transport blocked")
        await asyncio.sleep(self.delay)
        if request.url.path == "/v1/audio/transcriptions":
            self.calls["extraction"] += 1
            return httpx.Response(200, json={"text": TEXT * 20})
        data = json.loads(request.content)
        if request.url.path == "/v1/responses":
            self.calls["chat"] += 1
            return httpx.Response(
                200,
                json={
                    "id": "capacity-response",
                    "status": "completed",
                    "output": [
                        {
                            "type": "message",
                            "role": "assistant",
                            "content": [
                                {
                                    "type": "output_text",
                                    "text": "Synthetic capacity reply; no training quality claim.",
                                }
                            ],
                        }
                    ],
                    "usage": {"input_tokens": 1, "output_tokens": 1},
                },
            )
        if request.url.path != "/v1/chat/completions":
            raise RuntimeError("Unexpected provider endpoint blocked")
        messages = data.get("messages", [])
        prompt = messages[0].get("content", "") if messages else ""
        if "Compare source photographs" in prompt:
            self.calls["cover"] += 1
            content = messages[1].get("content", [])
            ids = [
                match.group(1)
                for part in content
                if part.get("type") == "text"
                if (
                    match := re.match(
                        r"Candidate ([A-Za-z0-9_-]+);", part.get("text", "")
                    )
                )
            ]
            result = {
                "selected_id": None,
                "confidence": "high",
                "grades": [
                    {"candidate_id": identifier, **dict.fromkeys(SCORES, 4)}
                    for identifier in ids
                ],
            }
        elif "You extract workout prescriptions" in prompt:
            self.calls["extraction"] += 1
            text = " ".join(
                part.get("text", "")
                for part in messages[1].get("content", [])
                if part.get("type") == "text"
            )
            location = (
                "document_page:1"
                if "document_page:" in text
                else "image:1"
                if any(
                    part.get("type") == "image_url"
                    for part in messages[1].get("content", [])
                )
                else "provided_text"
            )
            result = workout(location)
        elif "Classify image evidence" in prompt:
            result = {
                "classification": "recipe",
                "confidence": "high",
                "reason": "Synthetic fixture",
            }
        elif (
            "recipe" in prompt.lower()
            and ("assistant" in prompt.lower() or "cooking" in prompt.lower())
            and "extraction engine" not in prompt.lower()
        ):
            self.calls["chat"] += 1
            result = "Synthetic recipe reply; no provider quality claim."
        else:
            self.calls["extraction"] += 1
            result = recipe()
        return httpx.Response(
            200,
            json={
                "id": "capacity-completion",
                "object": "chat.completion",
                "created": 0,
                "model": data.get("model"),
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": result
                            if isinstance(result, str)
                            else json.dumps(result),
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 1,
                    "completion_tokens": 1,
                    "total_tokens": 2,
                },
            },
        )


def install_provider_transport(delay=0.25):
    transport = ProviderTransport(delay)
    original = httpx.AsyncClient.__init__

    def init(client, *args, **kwargs):
        kwargs["transport"] = transport
        kwargs["trust_env"] = False
        original(client, *args, **kwargs)

    httpx.AsyncClient.__init__ = init
    return transport
