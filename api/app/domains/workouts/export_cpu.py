"""Pure page CPU work; callers retain existing export admission until settlement."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from functools import partial
from types import MappingProxyType
from uuid import UUID

# The existing cross-replica slots admit one builder and one reader. Do not
# submit before admission or use the shared executor/context-propagating to_thread.
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="workouts-export")


def freeze_payload(value):
    """Copy only private scalar data; no ORM objects or mutable aliases cross threads.

    This bounded page copy deliberately remains on the event loop. Serialization
    and cryptography move off-loop; this does not eliminate projection/copy cost.
    """
    if isinstance(value, dict):
        if any(type(key) is not str for key in value):
            raise TypeError("Invalid export payload")
        return MappingProxyType({key: freeze_payload(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(freeze_payload(item) for item in value)
    if isinstance(value, UUID):
        # asyncpg supplies an immutable UUID subclass in explicit SQL projections.
        # Canonicalize it rather than passing driver-specific objects to threads.
        return UUID(str(value))
    if value is None or type(value) in (str, int, float, bool, datetime, date, UUID):
        return value
    raise TypeError("Invalid export payload")


def thaw_payload(value):
    if isinstance(value, MappingProxyType):
        return {key: thaw_payload(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [thaw_payload(item) for item in value]
    return value


async def run_cpu(function, *args):
    """Never release caller locks/private inputs while a cancelled thread is live."""
    future = asyncio.get_running_loop().run_in_executor(_executor, partial(function, *args))
    try:
        return await asyncio.shield(future)
    except asyncio.CancelledError:
        while not future.done():
            try:
                await asyncio.shield(future)
            except asyncio.CancelledError:
                continue
            except Exception:
                break
        if future.done() and not future.cancelled():
            future.exception()  # Consume failure without replacing cancellation.
        raise
