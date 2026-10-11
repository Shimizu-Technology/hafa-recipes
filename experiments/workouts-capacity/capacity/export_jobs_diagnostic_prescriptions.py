"""Independent deterministic seed-content proof. Digests never leave private RAM."""

import hashlib
import json

from capacity.fixtures import padding
from capacity.transport import workout


def content_digest(value):
    if not isinstance(value, dict):
        raise TypeError("Invalid synthetic prescription")
    canonical = {key: item for key, item in value.items() if key != "id"}
    return hashlib.sha256(
        json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()
    ).digest()


def expected_content(index):
    content = workout()
    content.update(
        version=1,
        provenance="user",
        notes=[padding(4000, index * 60 + note) for note in range(40)],
    )
    return content


def expected_prescriptions():
    """Run before trace origin/timed traffic; retain190 small independent hashes."""
    expected = {}
    for index in range(190):
        content = expected_content(index)
        digest = content_digest(content)
        if digest in expected:
            raise ValueError("Synthetic fixture indices must remain distinct")
        expected[digest] = index
    return expected


class PrescriptionProof:
    def __init__(self, expected):
        self.expected = expected
        self.seen = {"workouts": set(), "workout_versions": set()}
        self.links = {"workouts": {}, "workout_versions": {}}

    def page(self, datasets):
        """Offload one bounded page; no response-derived expected content."""
        for name in self.seen:
            for row in datasets.get(name, []):
                content = row.get("content")
                relationship = (
                    row.get("id") if name == "workouts" else row.get("workout_id")
                )
                if (
                    not isinstance(relationship, str)
                    or not relationship
                    or not isinstance(content, dict)
                    or content.get("id") != relationship
                    or row.get("revision") != 1
                ):
                    raise ValueError("Synthetic prescription relationship changed")
                digest = content_digest(content)
                index = self.expected.get(digest)
                if (
                    index is None
                    or index in self.seen[name]
                    or relationship in self.links[name]
                ):
                    raise ValueError(
                        "Synthetic prescription or immutable history changed"
                    )
                self.seen[name].add(index)
                self.links[name][relationship] = digest

    def complete(self):
        return (
            all(indices == set(range(190)) for indices in self.seen.values())
            and self.links["workouts"] == self.links["workout_versions"]
            and len(self.links["workouts"]) == 190
        )
