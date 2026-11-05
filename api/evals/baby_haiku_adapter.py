"""Haiku for Ask's evaluation only. Production has no Anthropic path or consent to use one.

Speaks the Responses shape the loop already uses, so Haiku runs the same prompt and tools.
Needs the SDK just for this run: `uv run --with anthropic python -m evals.run_chat_model_eval ...`.
"""

from __future__ import annotations

import json
from typing import Any

JSON_ONLY = " Reply with only the JSON object, nothing before or after it."
# The dynamic-filtering search variant isn't listed for this model, so it uses the basic one.
SEARCH_TOOL = "web_search_20250305"
PAUSED_TURNS = 2


def tool_for(tool: dict[str, Any]) -> dict[str, Any]:
    if tool["type"] == "web_search":
        allowed = tool.get("filters", {}).get("allowed_domains")
        return {
            "type": SEARCH_TOOL, "name": "web_search", "max_uses": 2,
            **({"allowed_domains": allowed} if allowed else {}),
        }
    return {
        "name": tool["name"], "description": tool["description"],
        "input_schema": tool["parameters"], "strict": bool(tool.get("strict")),
    }


def messages_for(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Replay what Claude produced unchanged; every tool result for a turn goes in one user message."""
    messages: list[dict[str, Any]] = []
    for item in items:
        kind = item.get("type")
        if kind == "anthropic_content":
            messages.append({"role": "assistant", "content": item["content"]})
        elif kind == "function_call_output":
            result = {"type": "tool_result", "tool_use_id": item["call_id"], "content": item["output"]}
            if messages and messages[-1]["role"] == "user" and isinstance(messages[-1]["content"], list):
                messages[-1]["content"].append(result)
            else:
                messages.append({"role": "user", "content": [result]})
        elif kind != "function_call":
            messages.append({"role": item["role"], "content": item["content"]})
    return messages


def request_for(model: str, body: dict[str, Any]) -> dict[str, Any]:
    effort = body.get("reasoning", {}).get("effort")
    system = body["instructions"] + (JSON_ONLY if body.get("text") else "")
    request: dict[str, Any] = {
        "model": model, "max_tokens": body["max_output_tokens"], "system": system,
        # A search's input is just her question.
        "messages": [{"role": "user", "content": body["input"]}] if isinstance(body["input"], str) else messages_for(body["input"]),
    }
    # This model has no "none" effort; low is the nearest setting.
    request["output_config"] = {"effort": effort if effort and effort != "none" else "low"}
    if body.get("tools"):
        request["tools"] = [tool_for(tool) for tool in body["tools"]]
        if body.get("tool_choice") == "none":
            request["tool_choice"] = {"type": "none"}
    return request


def response_from(message: dict[str, Any]) -> dict[str, Any]:
    """The reply in Responses' shape, keeping the original blocks so they can be sent back."""
    stop = message.get("stop_reason")
    usage = message.get("usage") or {}
    cached = usage.get("cache_read_input_tokens") or 0
    written = usage.get("cache_creation_input_tokens") or 0
    output: list[dict[str, Any]] = []
    text, annotations = "", []
    calls = []
    for block in message.get("content", []):
        if block.get("type") == "text":
            for citation in block.get("citations") or []:
                if citation.get("url"):
                    annotations.append({"type": "url_citation", "url": citation["url"], "title": citation.get("title")})
            text += block.get("text", "")
        elif block.get("type") == "tool_use":
            calls.append({"type": "function_call", "call_id": block["id"], "name": block["name"], "arguments": json.dumps(block.get("input") or {})})
    output.extend({"type": "web_search_call"} for block in message.get("content", []) if block.get("type") == "server_tool_use")
    if calls:
        output.append({"type": "anthropic_content", "content": message["content"]})
        output.extend(calls)
    else:
        output.append({"type": "message", "content": [{"type": "output_text", "text": text, "annotations": annotations}]})
    return {
        "id": message.get("id"),
        "status": "completed" if stop in {"end_turn", "tool_use", "stop_sequence"} else "incomplete",
        "output": output,
        "usage": {
            "input_tokens": (usage.get("input_tokens") or 0) + cached + written,
            "output_tokens": usage.get("output_tokens") or 0,
            "input_tokens_details": {"cached_tokens": cached},
            "output_tokens_details": {"reasoning_tokens": 0},
        },
    }


class HaikuProvider:
    """No retries, so a failure is visible in the evaluation rather than paid for twice."""

    def __init__(self, api_key: str, client: Any = None):
        self.responses: list[tuple[str, dict[str, Any]]] = []
        if client is None:
            import anthropic

            client = anthropic.AsyncAnthropic(api_key=api_key, max_retries=0)
        self.client = client

    async def responses_call(self, *, capability, model, prompt_version, body, searches=0):
        request = request_for(model, body)
        message = (await self.client.messages.create(**request)).model_dump()
        # A paused server tool turn continues by sending its content back, within what was reserved.
        for _ in range(PAUSED_TURNS):
            if message.get("stop_reason") != "pause_turn":
                break
            request["messages"] = [*request["messages"], {"role": "assistant", "content": message["content"]}]
            message = (await self.client.messages.create(**request)).model_dump()
        data = response_from(message)
        if data["status"] != "completed":
            raise ValueError("Incomplete response")
        self.responses.append((model, data))
        return data
