# Recipe thumbnail and cover memory

This fix starts from verified main `823986f48e4eb5de3075969a742f834036b5d473`.
Recipes retains its existing image validation and delivery contracts: 40 MP,
12,000 px per dimension, the configured byte and MIME limits, first-frame thumbnail
handling, metadata-free WebP, list 640 px/200 KiB and hero 1280 px/500 KiB bounds. Original
OCR/extraction bytes remain the source of truth. Cover candidates retain their
original encoded bytes and identities; preparation still supplies the existing
hero and square JPEG crops to the existing judging protocol.

## Change

The previous path loaded the full raster, copied it through EXIF transpose, and
converted another full raster before resizing. The new helper computes the
display dimensions from the original aspect and orientation, asks JPEG's decoder
for a draft at that size, and resizes before in-place EXIF handling. Odd JPEG draft
dimensions use the decoder's original-extent box. Palette, monochrome and other
color modes expand before filtering when needed to preserve color/alpha semantics;
cover RGB conversion retains its existing treatment of alpha. Pixel buffers,
filter/crop intermediates and encoder buffers close explicitly on success, early
rejection and errors.

JPEG reduced IDCT can change encoded output. The transformation fingerprint is
now `webp-v2-draft-list640-200k-hero1280-500k-q82`, so a backfill run approved for
the prior transform cannot silently resume under the new contract. Storage already
hashes the actual encoded variant set. Changed bytes receive a new immutable key;
the key layout and existing `thumbnails/<recipe_id>/<hash>/{list,hero}.webp` classification
remain intact. Existing stored URLs continue selecting their sibling variants.

## Isolated measurement

The preserved synthetic capacity fixture is a 4000×4000 RGB JPEG with 288,911 bytes.
Each measurement starts a fresh Python process with Pillow 12.3.0 and synthetic
configuration, then performs eight sequential calls through the actual storage
normalization path or production-style `asyncio.to_thread` cover preparation.
The baseline is resident memory after imports/input loading. Peak is process
`getrusage` high-water memory; retained values are OS resident memory sampled
after each call, without a manual garbage collection or allocator trim.

| Pipeline | Prior peak increment | Fixed peak increment | Prior retained increment after 8 calls | Fixed retained increment after 8 calls |
|---|---:|---:|---:|---:|
| List/hero preparation | 211.95 MiB | 51.38 MiB | 210.69 MiB | 51.37 MiB |
| Cover preparation on its worker thread | 195.30 MiB | 40.58 MiB | 195.26 MiB | 40.55 MiB |

The fixed paths retain the same output dimensions and one usable cover candidate.
These are macOS process increments, not a shared Render/container acceptance
result. The earlier 512 MiB Recipes-only experiment stopped at 470 MiB; its 26 MiB
Python sampler remains included in that envelope. This comparison neither
subtracts that sampler nor changes the threshold. Root must repeat the corrected
complete workload and external monitoring before merging/deploying this fix or
enabling Workouts.

Other codecs still need a full source raster, and palette/color expansion can
require additional buffers. Existing input caps remain supported; this patch
does not prove every legal non-JPEG image combined with simultaneous media jobs
fits 512 MiB. Decode size, concurrency and the real process/container envelope need
separate capacity evidence. No live grading/model-quality conclusion follows
from the synthetic provider tests.

## Verification

Regressions execute actual normalization/cover code in fresh processes and bound
16 MP JPEG peak/repeated retained growth. Functional checks cover asymmetric
EXIF 6/8 corners and dimensions, all allowed formats, RGBA/LA and palette GIF
transparency, monochrome filtering, animation's first frame, preserved 40 MP
validation, corrupt JPEG entropy, metadata stripping, repeated byte-budget
resizing, original cover candidate identity/crop protocol, and old variant URLs.
The complete `./scripts/check.sh` gate passed: 1,209 API tests, 34 skips and 16
existing warnings; 790 mobile tests, types, Doctor 21/21 and zero unexpected
runtime advisories; both website builds/types/lint/audits and 13 admin tests.
The dedicated `hafa_recipes_thumbnail_memory_test` database was removed after
the gate. Root owns independent review, the final 512 MiB mixed-workload retest
and the release decision; this slice remains a draft until those gates pass.
