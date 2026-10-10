"""Deterministic source generation, run outside the API memory cgroup."""

import argparse
import base64
import hashlib
import json
import random
import string
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from capacity.source_facts import IMAGE_FACTS, PDF_FACTS, TEXT_FACTS
from capacity.transport import TEXT


def padding(size, seed):
    rng = random.Random(seed)
    return "".join(rng.choices(string.ascii_letters + string.digits + " ", k=size))


def generate(folder, *, media=True):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for name, dimensions in [
        ("normal.jpg", (1000, 1000)),
        ("image-limit.jpg", (2000, 2000)),
        ("cover.jpg", (4000, 4000)),
    ]:
        image = Image.new("RGB", dimensions, "#efe9de")
        draw = ImageDraw.Draw(image)
        draw.ellipse(
            (
                dimensions[0] // 5,
                dimensions[1] // 5,
                dimensions[0] * 4 // 5,
                dimensions[1] * 4 // 5,
            ),
            fill="#385748",
        )
        draw.text((30, 30), TEXT, fill="black")
        image.save(folder / name, format="JPEG", quality=85)
    # Distinct, annotated source: a Recipe cover never stands in for a workout.
    with Image.new("RGB", (2000, 2000), "white") as image:
        draw = ImageDraw.Draw(image)
        font = ImageFont.load_default(size=70)
        draw.multiline_text(
            (90, 120),
            "SYNTHETIC TEST WORKOUT\n\nPush-up\n4 sets of 6-10 reps\nRest 75 seconds\nNo equipment required",
            fill="black",
            font=font,
            spacing=35,
        )
        image.save(folder / "workout-image.jpg", format="JPEG", quality=85)
    (folder / "source-facts.json").write_text(
        json.dumps(
            {
                "synthetic": True,
                "text": TEXT_FACTS,
                "image": IMAGE_FACTS,
                "pdf": PDF_FACTS,
            },
            indent=2,
        )
    )
    for count in [1, 30, 31]:
        writer = PdfWriter()
        font = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            }
        )
        reference = writer._add_object(font)
        for _ in range(count):
            page = writer.add_blank_page(width=600, height=800)
            page[NameObject("/Resources")] = DictionaryObject(
                {NameObject("/Font"): DictionaryObject({NameObject("/F1"): reference})}
            )
            stream = DecodedStreamObject()
            stream.set_data(
                f"BT /F1 10 Tf 30 750 Td ({PDF_FACTS['text']}) Tj ET".encode()
            )
            page[NameObject("/Contents")] = writer._add_object(stream)
        with (folder / f"source-{count}.pdf").open("wb") as out:
            writer.write(out)
    (folder / "malformed.pdf").write_bytes(b"%PDF-1.7\nnot a valid PDF")
    image_request = {
        "source": {
            "kind": "images",
            "images": [
                {
                    "base64_data": base64.b64encode(
                        (folder / "workout-image.jpg").read_bytes()
                    ).decode(),
                    "mime_type": "image/jpeg",
                }
            ],
            "ai_consent": True,
        }
    }
    # JSON whitespace is valid and exercises nearly the entire transport cap.
    encoded = json.dumps(image_request).encode()
    (folder / "near-body.json").write_bytes(
        encoded + b" " * (3 * 1024 * 1024 - 512 - len(encoded))
    )
    if media:
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=1280x720:rate=24",
                "-t",
                "12",
                "-c:v",
                "mpeg4",
                "-q:v",
                "4",
                "-y",
                str(folder / "source.mp4"),
            ],
            check=True,
            timeout=60,
        )
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=16000",
                "-t",
                "12",
                "-y",
                str(folder / "source.wav"),
            ],
            check=True,
            timeout=30,
        )
    manifest = {
        path.name: {
            "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
        for path in sorted(folder.iterdir())
        if path.is_file() and path.name != "manifest.json"
    }
    (folder / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("folder")
    parser.add_argument("--no-media", action="store_true")
    args = parser.parse_args()
    generate(args.folder, media=not args.no_media)
