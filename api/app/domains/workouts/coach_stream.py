"""Bounded Responses SSE decoding; text callbacks are provisional, never receipts."""

import json
import re
from contextlib import aclosing

MAX_FRAME_BYTES = 260_000
MAX_WIRE_BYTES = 1_024_000
MAX_RESPONSE_BYTES = 256_000
MAX_TEXT_CHARACTERS = 12_000
MAX_TEXT_BYTES = 48_000


class CoachStreamFailure(Exception):
    """Fixed safe codes only, without provider text or error details."""


def _invalid_constant(_value):
    raise CoachStreamFailure("stream_malformed_event")


async def _lines(response):
    pending, total = b"", 0
    # Preserve transport delivery: a fixed chunk_size would buffer short replies
    # until EOF instead of delivering their first real delta promptly.
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        if total > MAX_WIRE_BYTES:
            raise CoachStreamFailure("stream_size_limit")
        pending += chunk
        while match := re.search(rb"\r\n|\r|\n", pending):
            if match.group() == b"\r" and match.end() == len(pending):
                break  # The LF may be in the next transport chunk.
            line, pending = pending[:match.start()], pending[match.end():]
            if len(line) > MAX_FRAME_BYTES:
                raise CoachStreamFailure("stream_frame_limit")
            yield line, len(match.group())
        if len(pending) > MAX_FRAME_BYTES:
            raise CoachStreamFailure("stream_frame_limit")
    if pending.endswith(b"\r"):
        yield pending[:-1], 1
    elif pending:
        raise CoachStreamFailure("stream_unterminated_line")


async def _events(response):
    data, event, size, first = [], None, 0, True
    async with aclosing(_lines(response)) as lines:
        async for raw, separator_bytes in lines:
            size += len(raw) + separator_bytes
            if size > MAX_FRAME_BYTES:
                raise CoachStreamFailure("stream_frame_limit")
            line = raw.decode("utf-8", errors="strict")
            if first:
                line, first = line.removeprefix("\ufeff"), False
            if not line:
                if data:
                    value = json.loads("\n".join(data), parse_constant=_invalid_constant)
                    if (not isinstance(value, dict) or not isinstance(value.get("type"), str) or not value["type"]
                            or (event is not None and event != value["type"])):
                        raise CoachStreamFailure("stream_malformed_event")
                    yield value
                data, event, size = [], None, 0
                continue
            if line.startswith(":"):
                continue
            field, separator, value = line.partition(":")
            if separator and value.startswith(" "):
                value = value[1:]
            if field == "data":
                data.append(value)
            elif field == "event":
                event = value
    if data:
        raise CoachStreamFailure("stream_unterminated_event")


async def completed_response(response, on_text_delta):
    """Return the authoritative completed response, forwarding only text deltas.

    Await the callback for backpressure. Consumers must discard provisional text
    on failure and reset it between tool turns; this adapter does not orchestrate
    or persist messages, proposals, cancellation receipts or final delivery.
    The caller owns the HTTP stream context and its whole-turn timeout.
    """
    if response.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "text/event-stream":
        raise CoachStreamFailure("stream_content_type")
    characters = text_bytes = 0
    async with aclosing(_events(response)) as events:
        async for event in events:
            kind = event["type"]
            if kind == "response.output_text.delta":
                delta = event.get("delta")
                if not isinstance(delta, str):
                    raise CoachStreamFailure("stream_malformed_delta")
                characters += len(delta)
                text_bytes += len(delta.encode("utf-8", errors="strict"))
                if characters > MAX_TEXT_CHARACTERS or text_bytes > MAX_TEXT_BYTES:
                    raise CoachStreamFailure("stream_text_limit")
                if delta:
                    await on_text_delta(delta)
            elif kind == "response.completed":
                result = event.get("response")
                if not isinstance(result, dict) or result.get("status") != "completed":
                    raise CoachStreamFailure("stream_incomplete")
                usage = result.get("usage")
                if not isinstance(usage, dict) or any(
                    type(usage.get(key)) is not int or usage[key] < 0
                    for key in ("input_tokens", "output_tokens")
                ):
                    raise CoachStreamFailure("stream_usage_missing")
                if len(json.dumps(result, ensure_ascii=False).encode()) > MAX_RESPONSE_BYTES:
                    raise CoachStreamFailure("stream_response_limit")
                return result
            elif kind in {"error", "response.failed", "response.incomplete"}:
                raise CoachStreamFailure("stream_incomplete")
            # Reasoning, function arguments, output_text.done and other events
            # never become visible text. Normal response_parts validates final.
    raise CoachStreamFailure("stream_missing_completion")
