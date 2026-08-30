# Recipe-image classification runbook

This gate prevents food photos and unreadable uploads from being treated as
recipe documents. It is additive to the existing single- and multi-image OCR
routes and is disabled by default.

## Behavior

When `IMAGE_INPUT_CLASSIFICATION_ENABLED=true`, the API classifies the complete
ordered image set before recipe extraction:

- `recipe_document`: readable ingredients or instructions are present;
- `multi_page_recipe`: ordered pages or sides from one readable recipe;
- `dish_photo`: food or ingredients without usable recipe text;
- `unreadable`: a likely recipe document whose cooking text cannot be read;
- `unsupported`: unrelated, mixed, conflicting, or otherwise unsupported input.

Only the two document classifications continue to OCR. Classification failure
is fail-closed: the API does not ask the recipe model to improvise. The mobile
app explains the problem and offers manual entry or image review. This slice
does not add an inspired-recipe generator; such a feature must remain a
separate, explicitly generated workflow if it is built later.

## Privacy and compatibility

Classification uses the same transient images, size limits, authenticated
routes, AI capability gate, and provider as OCR. It does not add image storage.
Responses add optional `error_code` and `input_classification` fields, so older
mobile clients retain their existing generic failure behavior.

Manual recovery uses the first selected image as the recipe photo. For a
multi-image failure, every selection remains on the Import screen so the user
can return to review or retry the full source set; the app does not claim that
the extra pages were attached to the manual recipe.

## Deployment gate

Before enabling production traffic:

1. Verify one synthetic or permissioned fixture for every classification.
2. Verify a clear single recipe card and a two-page recipe continue to OCR.
3. Verify a dish-only photo never invokes recipe OCR.
4. Verify blurry, cropped, mixed-recipe, provider-error, and timeout cases fail
   closed with usable manual-entry and retry paths.
5. Measure classification latency, model cost, document false-reject rate, and
   dish-photo false-accept rate.
6. Start with internal traffic and inspect outcomes before wider rollout.

## Rollback

Set `IMAGE_INPUT_CLASSIFICATION_ENABLED=false` and redeploy. No schema rollback
or data rewrite is required. The existing OCR routes and response shape remain
compatible.
