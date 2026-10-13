"""Small application-level request and concurrency budgets for paid AI work."""

import asyncio
import math
import time
from collections import defaultdict, deque
from collections.abc import AsyncIterator, Callable, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass


class RateLimitExceeded(Exception):
    def __init__(self, retry_after: int, reason: str):
        self.retry_after = max(1, retry_after)
        self.reason = reason
        super().__init__(reason)


@dataclass(frozen=True)
class QuotaWindow:
    """Allow at most ``limit`` admissions in any rolling ``seconds`` window."""

    seconds: int
    limit: int


class UserRateLimiter:
    """Enforce per-process per-user windows and in-flight limits.

    The current Render service runs a single API process, so this provides an
    immediate hard budget. The durable usage ledger will become the shared
    source of truth when worker concurrency is introduced.
    """

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self._clock = clock
        self._lock = asyncio.Lock()
        self._requests: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._active: dict[tuple[str, str], int] = defaultdict(int)
        self._last_prune = 0.0
        self._quota_events: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._quota_horizons: dict[tuple[str, str], int] = {}

    def reset(self) -> None:
        """Forget all windows and admissions (tests and controlled restarts)."""
        self._requests.clear()
        self._active.clear()
        self._quota_events.clear()
        self._quota_horizons.clear()
        self._last_prune = 0.0

    def _prune_inactive_keys(self, now: float) -> None:
        """Discard expired idle users so one-off traffic cannot grow memory forever."""
        if now - self._last_prune < 60:
            return

        for key, window in list(self._requests.items()):
            while window and now - window[0] >= 60:
                window.popleft()
            if not window and not self._active.get(key, 0):
                self._requests.pop(key, None)
                self._active.pop(key, None)
        for key, events in list(self._quota_events.items()):
            horizon = self._quota_horizons.get(key, 0)
            while events and now - events[0] >= horizon:
                events.popleft()
            if not events:
                self._quota_events.pop(key, None)
                self._quota_horizons.pop(key, None)
        self._last_prune = now

    async def consume_quota(
        self,
        *,
        user_id: str,
        capability: str,
        windows: Sequence[QuotaWindow],
    ) -> float:
        """Admit one unit of work against every rolling window or raise.

        Unlike ``limit`` this records an admission without holding a slot, so it
        fits work that continues in a background job after the request returns.
        Returns a token that ``refund_quota`` accepts when the admitted work
        turned out to be a replay that never reached a paid provider.
        """
        if not windows:
            raise ValueError("At least one quota window is required")
        key = (user_id, capability)
        horizon = max(window.seconds for window in windows)

        async with self._lock:
            now = self._clock()
            self._prune_inactive_keys(now)
            events = self._quota_events[key]
            while events and now - events[0] >= horizon:
                events.popleft()

            retry_after = 0
            for window in windows:
                in_window = sum(1 for event in events if now - event < window.seconds)
                if in_window >= window.limit:
                    oldest_in_window = events[len(events) - in_window]
                    retry_after = max(
                        retry_after,
                        math.ceil(window.seconds - (now - oldest_in_window)),
                    )
            if retry_after:
                if not events:
                    self._quota_events.pop(key, None)
                raise RateLimitExceeded(retry_after, "quota_exceeded")

            events.append(now)
            self._quota_horizons[key] = max(self._quota_horizons.get(key, 0), horizon)
            return now

    async def refund_quota(self, *, user_id: str, capability: str, token: float) -> None:
        """Return one admission recorded by ``consume_quota``."""
        key = (user_id, capability)
        async with self._lock:
            events = self._quota_events.get(key)
            if not events:
                return
            try:
                events.remove(token)
            except ValueError:
                return
            if not events:
                self._quota_events.pop(key, None)
                self._quota_horizons.pop(key, None)

    @asynccontextmanager
    async def limit(
        self,
        *,
        user_id: str,
        capability: str,
        requests_per_minute: int,
        max_concurrency: int,
    ) -> AsyncIterator[None]:
        key = (user_id, capability)
        now = self._clock()

        async with self._lock:
            self._prune_inactive_keys(now)
            window = self._requests[key]
            while window and now - window[0] >= 60:
                window.popleft()

            if self._active[key] >= max_concurrency:
                raise RateLimitExceeded(2, "concurrency_limit")
            if len(window) >= requests_per_minute:
                retry_after = math.ceil(60 - (now - window[0]))
                raise RateLimitExceeded(retry_after, "rate_limit")

            window.append(now)
            self._active[key] += 1

        try:
            yield
        finally:
            async with self._lock:
                self._active[key] = max(0, self._active[key] - 1)
                if not self._requests[key] and not self._active[key]:
                    self._requests.pop(key, None)
                    self._active.pop(key, None)


ai_rate_limiter = UserRateLimiter()
