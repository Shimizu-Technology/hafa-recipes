"""Synthetic legal-size PNGs. Run only in the separate fixture cgroup."""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

SPECS = {
    "rgba40": (8000, 5000, "RGBA"),
    "palette40": (8000, 5000, "P"),
    "wide40": (12000, 3333, "RGBA"),
    "alpha16": (4000, 4000, "RGBA"),
}
MAX_BYTES = 10 * 1024 * 1024


def generate(folder, specs=SPECS):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for name, (width, height, mode) in specs.items():
        with Image.new(
            mode, (width, height), 0 if mode == "P" else (22, 71, 39, 0)
        ) as image:
            if mode == "P":
                image.putpalette([22, 71, 39, 240, 180, 50, 150, 30, 90] + [0] * 759)
                image.info["transparency"] = bytes([0, 128, 255] + [255] * 253)
            draw = ImageDraw.Draw(image)
            # Low entropy but nonblank, with edges/alpha at multiple scales.
            for index, x in enumerate(range(0, width, max(16, width // 64))):
                draw.rectangle(
                    (x, 0, x + width // 128, height - 1),
                    fill=(index % 2) + 1
                    if mode == "P"
                    else (240, 180, 50, 128 if index % 2 else 255),
                )
            draw.ellipse(
                (width // 4, height // 4, width * 3 // 4, height * 3 // 4),
                fill=2 if mode == "P" else (150, 30, 90, 255),
            )
            exif = Image.Exif()
            exif[274] = 6
            path = folder / f"{name}.png"
            image.save(path, format="PNG", exif=exif, compress_level=9)
        data = path.read_bytes()
        if len(data) > MAX_BYTES:
            raise ValueError("Fixture exceeds unchanged legal byte cap")
        with Image.open(path) as opened:
            if (
                opened.size != (width, height)
                or opened.mode != mode
                or opened.getexif().get(274) != 6
            ):
                raise ValueError("Fixture metadata changed")
            if mode == "P" and not isinstance(opened.info.get("transparency"), bytes):
                raise ValueError("Palette alpha missing")
        manifest[name] = {
            "width": width,
            "height": height,
            "pixels": width * height,
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "mime": "image/png",
            "mode": mode,
            "exif_orientation": 6,
            "alpha": True,
        }
    (folder / "legal-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("folder")
    generate(parser.parse_args().folder)
