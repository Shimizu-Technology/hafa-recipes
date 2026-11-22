"""Deterministic, fixture-preserving file-level LPT partitioning for CI."""
import json
import math
from collections import Counter
from pathlib import Path

import pytest


def partition(files, timings, count):
    """Assign each file once; ties and unseen files never depend on node IDs."""
    if count < 1:
        raise ValueError("shard count must be positive")
    if any(not math.isfinite(t) or t < 0 for t in timings.values()):
        raise ValueError("timings must be finite and nonnegative")
    files = set(files)
    fallback = sum(timings.values()) / max(len(timings), 1) or 1.0
    weights = {f: timings.get(f, fallback) for f in files}
    groups, loads = [set() for _ in range(count)], [0.0] * count
    for file in sorted(files, key=lambda f: (-weights[f], f)):
        index = min(range(count), key=lambda i: (loads[i], i))
        groups[index].add(file)
        loads[index] += weights[file]
    assert Counter(f for group in groups for f in group) == Counter(files)
    return groups, loads


def pytest_addoption(parser):
    parser.addoption("--ci-manifest")
    parser.addoption("--ci-shard", type=int)
    parser.addoption("--ci-shards", type=int, default=6)
    parser.addoption("--ci-selection", choices=("api", "baby"), default="api")


@pytest.hookimpl(trylast=True)
def pytest_collection_modifyitems(config, items):
    shard = config.getoption("ci_shard")
    if shard is None:
        return
    count = config.getoption("ci_shards")
    if not 1 <= shard <= count:
        raise pytest.UsageError("--ci-shard must be between 1 and --ci-shards")
    data = json.loads(Path(__file__).with_name("file-durations.json").read_text())
    timings = data[config.getoption("ci_selection")]
    files = [item.nodeid.split("::", 1)[0] for item in items]
    groups, loads = partition(files, timings, count)
    # Prove every collected item has exactly one owner, including random IDs.
    owners = {f: i for i, group in enumerate(groups) for f in group}
    assert len(owners) == len(set(files))
    selected, deselected = [], []
    for item, file in zip(items, files):
        (selected if owners[file] == shard - 1 else deselected).append(item)
    assert len(selected) + len(deselected) == len(items)
    config.hook.pytest_deselected(items=deselected)
    items[:] = selected
    reporter = config.pluginmanager.get_plugin("terminalreporter")
    if reporter:
        reporter.write_line(f"CI file shard {shard}/{count}: {len(selected)} tests, "
                            f"predicted {loads[shard - 1]:.1f}s")


def pytest_collection_finish(session):
    manifest = session.config.getoption("ci_manifest")
    if manifest:
        counts = Counter(item.nodeid.split("::", 1)[0] for item in session.items)
        Path(manifest).write_text(json.dumps(dict(counts), sort_keys=True))
