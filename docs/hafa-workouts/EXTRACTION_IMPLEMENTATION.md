# Workout extraction implementation and integration handoff

This is a bounded extraction-service slice. It does not deliver native capture,
durable import ownership, queued processing, private storage, cancellation APIs,
sharing or comprehensive acceptance. Those belong to the integration owner.

## Contract

```python
from app.domains.workouts.extraction import (
    ExtractionRequest, WorkoutExtractor, ProductionExtractionProvider,
)

extractor = WorkoutExtractor()  # Dormant unless production settings permit it.
result = await extractor.extract(ExtractionRequest(
    kind="text",
    text="Squat: 3 sets of 8–12 reps. Rest 90 seconds.",
    ai_consent=True,
))
```

`ExtractionRequest` is Pydantic 2 with extra fields forbidden:

- `kind`: `text`, `url`, `images`, `document`.
- Optional `text` (maximum 30,000 characters), `source_url` (maximum 2,000).
- `images`: up to eight `{base64_data, mime_type, location?}` objects. Actual bytes
  are verified. Caller location text is not trusted; the service assigns image:N.
- `document_base64`, `document_mime`: only UTF-8 text/plain and text/markdown in
  this slice. PDF/DOCX remain unsupported with an explicit draft result.
- `ai_consent`: defaults false. This is the caller's authorized consent snapshot,
  not a replacement for looking up current grants or handling revocation races.

`WorkoutExtractionResult` returns:

- `status`: ready, incomplete or failed. Ready means the schema and this engine's
  source checks pass; it does not prove actual model quality or fitness suitability.
- Optional `workout: WorkoutContent`, always source provenance.
- `evidence`, `warnings`, bounded `error_code`.
- `source`: canonical URL/key, platform, title/creator/duration where obtained,
  acquired channels and coverage notes.

Provider/source failure generally yields an incomplete private-source draft with
no invented blocks, so the caller can retain the bookmark and offer manual entry.
A forbidden source URL yields failed with no usable source URL. Cancellation is
propagated for the job owner to record, never converted to completed success.

The engine accepts injected `provider` and `acquirer` objects. A provider exposes
`enabled` and async `extract(SourceBundle) -> dict`. Media providers can also
expose async `transcribe(path) -> str`. An acquirer exposes async
`acquire(url, provider) -> SourceBundle`. SourceBundle comprises SourceMetadata,
text parts with named locations, validated data-URL images, and coverage warnings.
Injected test providers verify contracts without a real model request.

## Paid provider controls and accounting

The default ProductionExtractionProvider is enabled only with:

1. Workouts master API, import and AI switches enabled.
2. The workload capability permitted by the existing AI emergency controls.
3. A provider credential and production environment, or explicitly enabled paid
   development with an explicitly injected development_api_key.

The test environment never enables the default real adapter. Merely supplying a
production credential to development settings does not enable paid calls. A
budget-limited development credential must be supplied deliberately:

```python
provider = ProductionExtractionProvider(development_api_key=verified_dev_key)
extractor = WorkoutExtractor(provider=provider)
```

The integration owner verifies the credential scope and authorized budget before
that operation. No real provider calls were made to develop/test this slice.

Text uses configured primary/fallback extraction models; images use configured
OCR models. There are at most two structured-provider attempts, with 60-second
HTTP timeouts and a 130-second outer generation timeout. Workouts has its own
system prompt, strict schema, prompt/schema versions and capabilities:
`workout_extraction`, `workout_transcription`. No recipe ingredient schema or
culinary prompt is used. The caller still needs product-specific budget limits;
configured model reuse does not itself enforce those budgets.

AIInvocationTracker provides routing and content-free usage/accounting. Root must
add capability canary registry support before configuring Workouts canaries.
Important current constraint: AIInvocation.job_id still references the Recipes
extraction_jobs table. Use a stable workout-import identifier as request_id, the
verified app owner as user_id, an appropriate workout route, and job_id=None until
the tracking schema supports Workouts jobs. Otherwise the usage insert can fail.
Never inherit a Recipes job context into a Workouts import.

The adapter uses Chat Completions JSON Schema with required fields, no extra
properties, refusal/finish checks, Pydantic validation and source grounding.
Requests set store=false. Shape guarantees are separate from semantic accuracy.
Official reference inspected:
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
No account/model availability was validated by a paid call.

## Implemented support matrix

| Input | Implemented acquisition | Current limits and acceptance evidence |
| --- | --- | --- |
| Pasted text | Named text evidence; own workout prompt/schema | Annotated fake-provider grounding tests; actual language/model evaluation pending. |
| Public workout web page | PublicHTTPTransport pins public IPs, bounded streamed HTML, validated redirects, workout-neutral main/article text | Script/nav removal and byte/redirect/blocked-target tests; live sites pending. No recipe JSON-LD parser. |
| YouTube/TikTok/Instagram video | Shared URL normalization, canonical platform IDs, metadata, bounded audio/video/frame services; own transcription and workout extraction | Captions/transcripts preserved independently, sampled frame timestamps recorded. Real platform access/rights/reliability and ffmpeg recovery remain integration checks. |
| TikTok photo post | Shared image URL discovery; new streamed image reader using the shared SSRF transport and validators | Capped bytes/count/pixels, normalized images. Live slideshow access pending. |
| Screenshot/photo | Strict base64, real MIME/dimensions, metadata-stripped normalized vision input | Visual observations stay incomplete until reviewed. No physique-based prescription. |
| UTF-8 TXT/Markdown document | Strict base64 decoding, MIME allowlist, bounded text evidence | Annotated document tests; no executable or HTML rendering. |
| PDF/DOCX | Explicit unsupported draft | Parser/rendering not implemented; do not advertise support. |
| Private/deleted/inaccessible source | Retained bookmark/manual draft where the URL is valid | Failure contract tested; no promise to bypass access controls. |
| Music-only/title-only source | Title metadata not prescription evidence; no instructions means manual draft | Fake metadata case tested. Actual transcription hallucinations require annotated audio evaluation. |

Platform capability does not establish acquisition rights or permission to rehost.
Use permitted access and attribution; do not advertise every platform URL as
reliably supported from these tests. Do not store/rehost creator videos by default.

Bounds: 30,000 combined source characters; caption allocation up to 12,000 and
transcript up to 18,000; eight images, 4 MiB per original image, 12 MiB aggregate;
16 million image pixels; normalized stills at at most 1600 pixels per dimension;
HTML 2 MiB; text documents 128 KiB and 30,000 decoded characters. Shared video
settings retain their duration, media byte/process concurrency and subprocess
cleanup limits. Image decoding/media bursts still require mixed-workload tests
before declaring the existing Render instance safe for both products.

PublicHTTPTransport is used for website/image redirects and IP pinning. Social
downloaders only receive validated, canonical supported-platform IDs; arbitrary
website URLs are never handed to yt-dlp. Shared audio cleanup is invoked in
finally even if transcription is cancelled. Shared frame acquisition owns its
temporary download directory and process cleanup. Tests here assert the former
contract; shared service/restart tests are still required after integration.

## Grounding and review behavior

Source, personal adaptation and actual session results remain distinct. The engine
forces source provenance, removes generated IDs/version links and estimates,
and defers catalog matching to a separate review step. A model's self-declared
confidence does not count as evidence.

Text evidence must quote an actual acquired part at its assigned location. Numeric
values need field-specific supporting notation: rounds stay rounds, multiplication
set counts are distinct from rep counts, timing requires time units, distance
requires metres/kilometres and loads require weight units. Load units/conventions,
per-side meaning and original cues must also be supported. Required versus
optional equipment needs direct labeled evidence on a block. Unsupported values
are cleared and flagged; originals/evidence remain available for manual review.

Image evidence must reference an acquired image location, but that is not
independent proof of what its pixels contain. Therefore every visual import is
explicitly an incomplete reviewable draft even when its model shape looks complete.
Frame sampling can miss instructions and that coverage limitation is retained.
Missing sets/rest remain missing, and no complete session is invented from a
demonstration. A creator's supported load is retained only as source prescription;
adaptation rules never adopt it automatically as the user's personal load.

These checks reduce obvious hallucinations; they do not solve every attribution,
exercise association, conflicting instruction or on-screen transcription error.
Annotated actual model/media evaluations and correction usability remain required.

## Persistence/job integration gates

- Persist the authorized import before acquisition; use durable claim/retry and
  cancellation semantics outside this module. Use the returned structured record
  as a new source version with stable owner/revision controls.
- Check current consent, account/product deletion epochs and import cancellation
  before provider transmission and after every await before persisting results.
  Revocation/deletion must cancel in-flight work and block late recreation. An
  ai_consent field captured when the job was queued is insufficient.
- Keep uploads/source assets private with bounded temporary lifetimes. Never put
  health/source images into the public recipe bucket. Clear transient encoded
  request bytes after terminal processing under the storage retention policy.
- Route errors/warnings into bounded UI states and preserve manual operation.
  Retry must not duplicate source versions or consume unlimited provider budget.
- Add provider circuit breakers, per-user/product limits, redacted logs and exact
  trace context; the extractor does not implement those authorization wrappers.
- Review/approve movement matching, numeric programming and adaptations separately.
  Extraction completion never closes D03 or authorizes medical programming.

For PDF, the inspected current release is
[pypdf 6.20.0](https://pypi.org/project/pypdf/6.20.0/) (2026-10-09, BSD-3-Clause,
Python >=3.9). A separate dependency/parser slice can pin it, enforce encrypted,
page/content-stream/time limits and support text PDFs; scanned pages need bounded
render/OCR support too. No dependency was added here, and PDF acceptance is open.

No servers, browser tabs, simulators, containers or real provider calls were
started. The isolated clean branch/worktree are preserved for root integration.
