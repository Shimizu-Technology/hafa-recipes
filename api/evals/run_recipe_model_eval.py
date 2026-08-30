"""Run the redacted Håfa recipe extraction benchmark without storing outputs."""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import os
import re
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import dotenv_values
from openai import AsyncOpenAI
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
DEFAULT_DATASET = ROOT / "golden" / "recipe_extraction_v1.json"
REPORTS = ROOT / "reports"
SYSTEM_PROMPT = (
    "You are a culinary extraction engine. Extract recipe information and return valid JSON only."
)


class ModelRefusal(Exception):
    """Indicate that a provider refused instead of returning a recipe."""


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def render_page(text: str) -> str:
    """Render a synthetic recipe page into a deterministic PNG data URL."""

    image = Image.new("RGB", (1200, 1600), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=30)
    y = 80
    for source_line in text.splitlines():
        words = source_line.split()
        lines: list[str] = []
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if len(candidate) > 64:
                lines.append(current)
                current = word
            else:
                current = candidate
        lines.append(current)
        for line in lines:
            draw.text((80, y), line, fill="black", font=font)
            y += 34
        y += 14
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def build_messages(case: dict[str, Any]) -> list[dict[str, Any]]:
    from app.services.prompts import get_ocr_extraction_prompt, get_recipe_extraction_prompt

    if case["modality"] == "text":
        prompt = get_recipe_extraction_prompt(
            "https://example.invalid/redacted-source",
            case["source_text"],
            "Guam",
        )
        content: Any = prompt
    else:
        content = []
        pages = case["pages"]
        for index, page in enumerate(pages, start=1):
            content.append({"type": "text", "text": f"[PAGE {index} OF {len(pages)}]"})
            content.append(
                {"type": "image_url", "image_url": {"url": render_page(page)}}
            )
        content.append({"type": "text", "text": get_ocr_extraction_prompt("Guam")})
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": content},
    ]


def extract_fields(recipe: dict[str, Any]) -> tuple[list[str], list[str]]:
    ingredients: list[str] = []
    steps: list[str] = []
    for component in recipe.get("components") or []:
        if not isinstance(component, dict):
            continue
        for ingredient in component.get("ingredients") or []:
            if isinstance(ingredient, dict):
                ingredients.append(normalize(str(ingredient.get("name") or "")))
            elif isinstance(ingredient, str):
                ingredients.append(normalize(ingredient))
        steps.extend(
            normalize(step)
            for step in component.get("steps") or []
            if isinstance(step, str)
        )
    return ingredients, steps


def contains_term(values: list[str], term: str) -> bool:
    normalized = normalize(term)
    return any(normalized in value or value in normalized for value in values if value)


def score_recipe(case: dict[str, Any], recipe: object) -> dict[str, Any]:
    if not isinstance(recipe, dict):
        return {
            "schema_valid": False,
            "completeness": 0.0,
            "corrections": 1,
            "hallucinations": 0,
            "task_success": False,
        }
    title = normalize(str(recipe.get("title") or ""))
    ingredients, steps = extract_fields(recipe)
    schema_valid = bool(title and ingredients and steps)
    expected = case["expected"]
    checks = [term in title for term in map(normalize, expected["title_terms"])]
    checks.extend(contains_term(ingredients, term) for term in expected["ingredients"])
    checks.extend(contains_term(steps, term) for term in expected["step_terms"])
    completeness = sum(checks) / len(checks)

    expected_ingredients = [normalize(item) for item in expected["ingredients"]]
    hallucinations = sum(
        1
        for ingredient in ingredients
        if ingredient and not contains_term(expected_ingredients, ingredient)
    )
    invented_quantities = 0
    if case.get("must_not_invent_quantities"):
        serialized = normalize(json.dumps(recipe, sort_keys=True))
        invented_quantities = sum(
            1 for term in case["must_not_invent_quantities"] if normalize(term) in serialized
        )
    corrections = (len(checks) - sum(checks)) + hallucinations + invented_quantities
    return {
        "schema_valid": schema_valid,
        "completeness": round(completeness, 4),
        "corrections": corrections,
        "hallucinations": hallucinations + invented_quantities,
        "task_success": schema_valid and completeness >= 0.8 and corrections == 0,
    }


async def evaluate_case(
    client: AsyncOpenAI,
    model: str,
    case: dict[str, Any],
    reasoning_effort: str,
) -> dict[str, Any]:
    from app.ai_governance import estimate_cost_microusd, extract_token_usage
    from app.services.prompts import RECIPE_RESPONSE_FORMAT

    started = time.perf_counter()
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=build_messages(case),
            reasoning_effort=reasoning_effort,
            response_format=RECIPE_RESPONSE_FORMAT,
            max_completion_tokens=5000,
        )
        latency_ms = round((time.perf_counter() - started) * 1000)
        message = response.choices[0].message
        raw = message.content or ""
        if getattr(message, "refusal", None):
            raise ModelRefusal("model_refusal")
        try:
            recipe: object = json.loads(raw)
        except json.JSONDecodeError:
            recipe = None
        scores = score_recipe(case, recipe)
        usage = extract_token_usage(response)
        cost = estimate_cost_microusd(model, **{
            "input_tokens": usage["input_tokens"],
            "cached_input_tokens": usage["cached_input_tokens"],
            "output_tokens": usage["output_tokens"],
        })
        return {
            "case_id": case["id"],
            "category": case["category"],
            "latency_ms": latency_ms,
            **usage,
            "estimated_cost_microusd": cost,
            "error_code": None,
            **scores,
        }
    except Exception as exc:
        return {
            "case_id": case["id"],
            "category": case["category"],
            "latency_ms": round((time.perf_counter() - started) * 1000),
            "input_tokens": None,
            "cached_input_tokens": None,
            "output_tokens": None,
            "reasoning_tokens": None,
            "estimated_cost_microusd": None,
            "error_code": (
                "model_refusal" if isinstance(exc, ModelRefusal) else type(exc).__name__
            ),
            "schema_valid": False,
            "completeness": 0.0,
            "corrections": 1,
            "hallucinations": 0,
            "task_success": False,
        }


def summarize(model: str, results: list[dict[str, Any]]) -> dict[str, Any]:
    successes = [result for result in results if result["task_success"]]
    costs = [
        result["estimated_cost_microusd"]
        for result in results
        if result["estimated_cost_microusd"] is not None
    ]
    return {
        "model": model,
        "cases": len(results),
        "task_success_rate": round(len(successes) / len(results), 4),
        "schema_valid_rate": round(
            sum(result["schema_valid"] for result in results) / len(results), 4
        ),
        "mean_completeness": round(
            statistics.mean(result["completeness"] for result in results), 4
        ),
        "total_corrections": sum(result["corrections"] for result in results),
        "total_hallucinations": sum(result["hallucinations"] for result in results),
        "median_latency_ms": round(statistics.median(result["latency_ms"] for result in results)),
        "total_input_tokens": sum(result["input_tokens"] or 0 for result in results),
        "total_output_tokens": sum(result["output_tokens"] or 0 for result in results),
        "total_reasoning_tokens": sum(result["reasoning_tokens"] or 0 for result in results),
        "estimated_total_cost_microusd": sum(costs) if len(costs) == len(results) else None,
        "estimated_cost_per_success_microusd": (
            round(sum(costs) / len(successes))
            if successes and len(costs) == len(results)
            else None
        ),
        "results": results,
    }


async def run(args: argparse.Namespace) -> Path | None:
    dataset = json.loads(args.dataset.read_text())
    categories = {case["category"] for case in dataset["cases"]}
    required = {
        "video_transcript",
        "website_text",
        "single_ocr",
        "multi_page_ocr",
        "low_quality",
    }
    if categories != required:
        raise ValueError(f"Dataset categories must exactly match {sorted(required)}")
    if args.dry_run:
        print(f"Validated {len(dataset['cases'])} redacted cases across {len(categories)} categories")
        return None

    if args.env_file:
        values = dotenv_values(args.env_file)
        api_key = values.get("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("The evaluation env file does not contain OPENAI_API_KEY")
        os.environ["OPENAI_API_KEY"] = api_key
        os.environ.setdefault(
            "DATABASE_URL",
            "postgresql://evaluation:evaluation@localhost/hafa_evaluation",
        )
        os.environ.setdefault("DATABASE_USE_SSL", "false")

    from app.ai_governance import PROMPT_VERSIONS, RECIPE_SCHEMA_VERSION
    from app.config import get_settings

    settings = get_settings()
    client = AsyncOpenAI(api_key=settings.openai_api_key)
    reports = []
    for model in args.models:
        results = []
        for case in dataset["cases"]:
            results.append(
                await evaluate_case(client, model, case, args.reasoning_effort)
            )
        reports.append(summarize(model, results))

    generated_at = datetime.now(timezone.utc).isoformat()
    report = {
        "report_version": "hafa-model-comparison-v1",
        "generated_at": generated_at,
        "dataset_version": dataset["dataset_version"],
        "privacy": dataset["privacy"],
        "prompt_version": PROMPT_VERSIONS["recipe_extraction"],
        "schema_version": RECIPE_SCHEMA_VERSION,
        "reasoning_effort": args.reasoning_effort,
        "models": reports,
        "contains_provider_outputs": False,
    }
    REPORTS.mkdir(parents=True, exist_ok=True)
    output = args.output or REPORTS / f"recipe-model-comparison-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.json"
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(f"Wrote privacy-bounded comparison report: {output}")
    for model_report in reports:
        print(
            f"{model_report['model']}: success={model_report['task_success_rate']:.0%} "
            f"schema={model_report['schema_valid_rate']:.0%} "
            f"corrections={model_report['total_corrections']} "
            f"cost_microusd={model_report['estimated_total_cost_microusd']}"
        )
    return output


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument(
        "--models",
        nargs="+",
        default=["gpt-5.6-luna", "gpt-5.6-terra"],
    )
    parser.add_argument("--reasoning-effort", default="none")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    asyncio.run(run(parse_args()))
