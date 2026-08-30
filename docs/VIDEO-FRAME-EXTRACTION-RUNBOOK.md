# Normal-video frame extraction runbook

This path recovers recipe details that exist on screen but not in a caption or
spoken audio. It is an additive recovery path, not the default extractor.

## Behavior

Frame analysis runs only when all of these conditions are true:

- `VIDEO_FRAME_EXTRACTION_ENABLED=true`;
- the source is a supported YouTube, TikTok, or Instagram video;
- the request is not a fast re-extraction;
- text extraction was unavailable, failed, or produced an uncertain recipe.

The service downloads a video no larger than `VIDEO_FRAME_MAX_BYTES` and no
longer than `VIDEO_FRAME_MAX_DURATION_SECONDS`. It samples six opening,
closing, and periodic frames plus up to two distinct scene-change frames. The
hard cap is `VIDEO_FRAME_MAX_COUNT`.

The visual model receives each frame with its timestamp, available caption and
audio text, and the tentative text draft. Its prompt forbids guessing hidden
ingredients, package sizes, quantities, and bridge steps. A visual result can
replace a text draft only when it preserves ingredient and instruction coverage
and measurably reduces uncertainty or adds supported content.

## Privacy and retention

The downloaded video and extracted JPEGs live in one uniquely named temporary
directory. The directory is removed after success, provider failure, timeout,
or cancellation. The application does not upload or persist those files.

Private owner evidence may retain only:

- modality names;
- sampled frame timestamps;
- `sourceArtifactsRetained: false`.

The allowlist drops recipe text, image data, URLs, and arbitrary keys. Public
recipe responses continue to omit extraction evidence.

## Deployment gate

The flag defaults to false. Before enabling production traffic:

1. Confirm `yt-dlp`, `ffmpeg`, and `ffprobe` exist in the deployed runtime.
2. Run one permissioned public canary for each supported platform.
3. Verify an on-screen-only fixture recovers a useful private draft.
4. Verify a text-complete fixture does not invoke frame analysis.
5. Verify private, deleted, over-size, over-duration, timeout, and provider
   failure cases retain their existing safe outcome.
6. Inspect temporary storage after every terminal path.
7. Record acquisition success, added latency, model cost, missing-field recall,
   unsupported-fact count, and false-ready rate.

Start with internal traffic. Do not expand if unsupported cooking-critical facts
increase, cleanup fails, or latency and cost exceed the agreed guardrails.

## Rollback

Set `VIDEO_FRAME_EXTRACTION_ENABLED=false` and redeploy. Text, audio, slideshow,
website, photo, manual, source-draft, review-state, and publishing behavior are
unchanged. No schema rollback or data rewrite is required. Existing timestamp
evidence remains valid and harmless.
