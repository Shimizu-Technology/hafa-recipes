import json
import tempfile
import unittest
from pathlib import Path

from ci_shards import partition
from refresh_timings import refresh


class PartitionTests(unittest.TestCase):
    def test_lpt_balances_and_covers_files_once(self):
        timings = {str(i): t for i, t in enumerate([9, 8, 7, 6, 5, 4])}
        groups, loads = partition(timings, timings, 3)
        self.assertEqual(loads, [13, 13, 13])
        self.assertEqual(set.union(*groups), set(timings))
        self.assertEqual(sum(map(len, groups)), len(timings))

    def test_collection_order_duplicates_and_random_parameters_do_not_matter(self):
        files = ["a.py", "b.py", "a.py", "new.py"]
        self.assertEqual(partition(files, {"a.py": 10}, 6),
                         partition(reversed(files), {"a.py": 10}, 6))
        groups, _ = partition(files, {"a.py": 10}, 6)
        self.assertEqual(sum("a.py" in group for group in groups), 1)

    def test_empty_and_invalid_inputs(self):
        self.assertEqual(partition([], {}, 6), ([set() for _ in range(6)], [0.] * 6))
        for timing in [-1, float("nan"), float("inf")]:
            with self.assertRaises(ValueError):
                partition(["a"], {"a": timing}, 6)
        with self.assertRaises(ValueError):
            partition([], {}, 0)

    def test_refresh_sums_split_files_before_median_and_keeps_configs_separate(self):
        with tempfile.TemporaryDirectory() as directory:
            runs = [Path(directory) / str(i) for i in range(3)]
            for i, run in enumerate(runs):
                for prefix in ("api-shards", "baby-family-shards"):
                    for shard in range(1, 7):
                        file = run / f"{prefix}-{shard}" / ".github/pytest-durations.json"
                        file.parent.mkdir(parents=True)
                        value = (i + 1) * (10 if prefix == "api-shards" else 1)
                        file.write_text(json.dumps({f"tests/a.py::test_{shard}": value}))
            result = refresh(runs)
            self.assertEqual(result["api"]["tests/a.py"], 120)
            self.assertEqual(result["baby"]["tests/a.py"], 12)
            (runs[0] / "api-shards-6/.github/pytest-durations.json").unlink()
            with self.assertRaises(FileNotFoundError):
                refresh(runs)


if __name__ == "__main__":
    unittest.main()
