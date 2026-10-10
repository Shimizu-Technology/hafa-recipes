"""One conservative empirical percentile definition for complete/partial runs."""

import math


def nearest_rank(values, fraction):
    """Return sorted rank ceil(N*q), using one-based ranks; empty input is unknown.

    For five observations p95 and p99 both select the maximum. No interpolation
    or lower-rank flooring may hide the slowest observation in a small category.
    This definition is used for both sides of future baseline comparisons.
    """
    if (
        isinstance(fraction, bool)
        or not isinstance(fraction, (int, float))
        or not math.isfinite(fraction)
        or not 0 < fraction <= 1
    ):
        raise ValueError("Percentile fraction must be in (0, 1]")
    ordered = sorted(values)
    if any(
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value < 0
        for value in ordered
    ):
        raise ValueError("Only finite nonnegative latency observations are allowed")
    return ordered[math.ceil(len(ordered) * fraction) - 1] if ordered else None
