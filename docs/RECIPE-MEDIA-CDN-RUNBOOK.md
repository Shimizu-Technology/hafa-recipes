# Recipe media CDN runbook

Håfa Recipes serves public recipe thumbnails through a dedicated CloudFront
distribution. The API still owns transformation and upload: it creates bounded,
content-addressed `list.webp` and `hero.webp` variants. CloudFront only caches
and delivers those immutable objects closer to users.

The distribution is covered by AWS's Free CloudFront flat-rate plan. The plan
includes 1 million requests, 100 GB of delivery, and 5 GB of S3 Standard storage
credits each month. It has no overage charges, although AWS can reduce delivery
performance after sustained usage above the allowance. Reassess the plan when
the account reaches its 50%, 80%, or 100% notifications.

## Security boundary

The existing `recipe-extractor-thumbnails` bucket also contains private chat
uploads. The CDN must never be granted access to the whole bucket.

- During an exclusive policy-writer window, the policy tool adds one
  distribution-scoped CloudFront `s3:GetObject` grant for `thumbnails/*` and
  preserves every unrelated bucket-policy statement.
- The WAF allows only viewer paths beginning with `/thumbnails/` and blocks all
  other paths before they reach S3.
- The distribution uses an Origin Access Control that signs every S3 request.
- A per-IP rate rule blocks more than 10,000 thumbnail requests in five minutes.
- The Free plan uses AWS-managed cache and response-header policies. It does not
  depend on query strings, cookies, or viewer identity.
- Privacy-minimized standard access logs go to CloudWatch Logs for 14 days.
  They retain delivery status, latency, TLS, object path, and edge-location
  evidence while excluding viewer IPs, forwarded IPs, user agents, referrers,
  query strings, and cookies. The Free plan includes standard-log ingestion;
  CloudWatch Logs storage and queries can still incur separate charges.

Never change the bucket resource in the policy from
`arn:aws:s3:::recipe-extractor-thumbnails/thumbnails/*` to a bucket-wide ARN.
Do not use the S3 website endpoint; OAC requires the regular S3 bucket origin.

## Deploy the infrastructure

The template must be deployed in `us-east-1`. CloudFront is global, and its WAF
web ACL can only be created from that Region.

Validate and create a reviewable change set from the repository root:

```bash
(
set -euo pipefail
cd api
uv run python -m app.recipe_media_pricing_preflight
cd ..

aws cloudformation validate-template \
  --region us-east-1 \
  --template-body file://infra/cloudformation/recipe-media-cdn.yaml

aws cloudformation deploy \
  --region us-east-1 \
  --stack-name hafa-recipes-media-cdn-production \
  --template-file infra/cloudformation/recipe-media-cdn.yaml \
  --parameter-overrides \
    ThumbnailBucketName=recipe-extractor-thumbnails \
    ThumbnailBucketRegion=ap-southeast-2 \
    MediaDomainName=media.hafa-recipes.com \
    AcmCertificateArn=arn:aws:acm:us-east-1:ACCOUNT:certificate/CERTIFICATE_ID \
  --no-execute-changeset
)
```

Inspect the generated change set in CloudFormation. It must create one WAF web
ACL, one OAC, one distribution, one Free pricing-plan subscription, and the
four CloudWatch Logs delivery resources. It must not create or modify an S3
bucket or bucket policy. Execute the exact reviewed change set, then wait for
the stack and the distribution to finish deploying.
The pricing preflight must report `eligible: true`; it rejects new AWS Free Tier
accounts and accounts already at the three-CloudFront-Free-plan limit before
CloudFormation attempts to create the subscription.

Record these stack outputs in the deployment log:

```bash
aws cloudformation describe-stacks \
  --region us-east-1 \
  --stack-name hafa-recipes-media-cdn-production \
  --query 'Stacks[0].Outputs' \
  --output table
```

## Attach CloudFront without replacing the bucket policy

CloudFormation intentionally does not own the existing bucket policy. An
`AWS::S3::BucketPolicy` resource represents the complete policy document and
could remove unrelated statements that are added outside this stack. The
policy tool reads the live policy, preserves every unrelated statement, and
adds only the exact `AllowCloudFrontReadRecipeThumbnails` statement.

S3 does not offer compare-and-swap for `PutBucketPolicy`. A final pre-write read
cannot prevent another writer from changing the policy in the interval before
the tool writes. Every mutation therefore requires an exclusive bucket-policy
writer window. Before opening the window:

- inventory IAM, CloudFormation, deployment workflows, and human operators that
  can call `s3:PutBucketPolicy` or `s3:DeleteBucketPolicy` for this bucket;
- pause or coordinate every such automation and operator so this tool is the
  only writer;
- create a non-secret change-record ID for the window; and
- keep the window active from before the tool's plan through its final read-back
  verification.

Do not treat the CLI token as an AWS lock. It is fail-closed evidence that the
external writer coordination has been completed. If another writer cannot be
paused or coordinated, do not mutate the policy.

The tool's unit tests prove merge preservation, thumbnail and distribution
scope, non-overwriting backups, concurrent-change detection, exact write
verification, and fail-closed handling of conflicting managed statements. The
CloudFormation template test cannot prove the state of an external live bucket
policy; the runtime plan and apply checks provide that proof.

Run a read-only plan, then apply it with a new absolute backup path in approved
deployment storage. The backup is created with mode `0600`; the command refuses
to overwrite an existing file. Keep it with the deployment record.

```bash
DISTRIBUTION_ID="$(aws cloudformation describe-stacks \
  --region us-east-1 \
  --stack-name hafa-recipes-media-cdn-production \
  --query 'Stacks[0].Outputs[?OutputKey==`DistributionId`].OutputValue | [0]' \
  --output text)"

cd api
uv run python -m app.recipe_media_bucket_policy plan \
  --bucket recipe-extractor-thumbnails \
  --region ap-southeast-2 \
  --distribution-id "$DISTRIBUTION_ID"
uv run python -m app.recipe_media_bucket_policy apply \
  --bucket recipe-extractor-thumbnails \
  --region ap-southeast-2 \
  --distribution-id "$DISTRIBUTION_ID" \
  --exclusive-writer-token CHG-YYYYMMDD-RECIPE-CDN \
  --backup-path /ABSOLUTE/APPROVED/BACKUP-DIRECTORY/policy-before-cdn.json
cd ..
```

The apply step writes only when the policy observed immediately before the
write still matches the planned policy. It then reads the policy back and
requires an exact match. If either check fails, stop and reconcile the live
policy; do not retry by deleting or replacing unrelated statements. Release the
exclusive writer window only after the read-back verification succeeds.

## Verify before changing production traffic

Choose an existing public thumbnail key and one known private chat-image key.
Download the public object from both S3 and CloudFront, then verify that their
hashes match. Make the CDN request twice and require the second response to
contain `X-Cache: Hit from cloudfront` and a positive `Age` header. Download the
private object only through authenticated S3 access, require CloudFront to
return `403`, and prove the response body is not the private object.

```bash
(
set -euo pipefail
VERIFY_DIR="$(mktemp -d)"
trap 'rm -rf "$VERIFY_DIR"' EXIT

aws s3api get-object \
  --no-sign-request \
  --bucket recipe-extractor-thumbnails \
  --key "thumbnails/EXISTING_KEY" \
  "$VERIFY_DIR/s3-thumbnail" >/dev/null
curl --fail --silent --show-error \
  --dump-header "$VERIFY_DIR/cdn-first.headers" \
  --output "$VERIFY_DIR/cdn-first" \
  "https://DISTRIBUTION_DOMAIN/thumbnails/EXISTING_KEY"
curl --fail --silent --show-error \
  --dump-header "$VERIFY_DIR/cdn-second.headers" \
  --output "$VERIFY_DIR/cdn-second" \
  "https://DISTRIBUTION_DOMAIN/thumbnails/EXISTING_KEY"

S3_HASH="$(shasum -a 256 "$VERIFY_DIR/s3-thumbnail" | awk '{print $1}')"
CDN_FIRST_HASH="$(shasum -a 256 "$VERIFY_DIR/cdn-first" | awk '{print $1}')"
CDN_SECOND_HASH="$(shasum -a 256 "$VERIFY_DIR/cdn-second" | awk '{print $1}')"
test "$S3_HASH" = "$CDN_FIRST_HASH"
test "$S3_HASH" = "$CDN_SECOND_HASH"
grep -i '^x-cache: Hit from cloudfront' "$VERIFY_DIR/cdn-second.headers"
grep -Ei '^age: [1-9][0-9]*' "$VERIFY_DIR/cdn-second.headers"

aws s3api get-object \
  --bucket recipe-extractor-thumbnails \
  --key "chat-images/KNOWN_EXISTING_KEY" \
  "$VERIFY_DIR/private-object" >/dev/null
test "$(curl --silent --show-error \
  --output "$VERIFY_DIR/blocked-response" \
  --write-out '%{http_code}' \
  "https://DISTRIBUTION_DOMAIN/chat-images/KNOWN_EXISTING_KEY")" = '403'
test "$(shasum -a 256 "$VERIFY_DIR/private-object" | awk '{print $1}')" != \
  "$(shasum -a 256 "$VERIFY_DIR/blocked-response" | awk '{print $1}')"
)
```

Also require:

- HTTP redirects to HTTPS;
- HTTP/2 or HTTP/3 is negotiated when supported;
- list and hero WebP objects retain
  `Cache-Control: public, max-age=31536000, immutable`;
- unknown thumbnail keys return an error rather than unrelated bucket data; and
- WAF sampled requests contain no private chat-image response data.

## Route API thumbnail URLs through the CDN

Set the Render service's `RECIPE_MEDIA_BASE_URL` to the exact `MediaBaseUrl`
stack output. Keep the existing AWS bucket and Region variables unchanged.
Deploy the current `main` commit and verify `/up` before exercising public and
authenticated recipe endpoints.

The API rewrites only URLs whose host exactly matches the configured owned S3
bucket. External recipe images remain on their original host. Confirm API list,
search, collection, saved, and detail responses use the CDN base URL for owned
thumbnails and do not rewrite external images.

Rollback is immediate and does not require a database change: unset
`RECIPE_MEDIA_BASE_URL` in Render and redeploy. While the legacy public-read
statement remains in the bucket policy, the API will return the original S3
delivery URL.

## Custom hostname prerequisite

Production deployment requires `media.hafa-recipes.com` and an ACM public
certificate in `us-east-1`; the template deliberately has no default-certificate
fallback because CloudFront's generated-hostname certificate cannot enforce the
configured TLS 1.2 minimum. Before creating the stack, add ACM's DNS validation
CNAME in the authoritative DNS provider and wait for the certificate to become
`ISSUED`. Do not expose validation credentials or move the domain's nameservers.

After the distribution is deployed, add the DNS CNAME
`media.hafa-recipes.com` to the distribution hostname. Verify TLS and CDN cache
behavior through the custom hostname before changing Render's
`RECIPE_MEDIA_BASE_URL` to `https://media.hafa-recipes.com`.

## Repair legacy thumbnails

Follow [THUMBNAIL-BACKFILL-RUNBOOK.md](./THUMBNAIL-BACKFILL-RUNBOOK.md). Create
and verify a Neon restore point, run the production dry-run twice, require
identical plan values, and apply the immutable plan in small batches. The
backfill never deletes source objects and only processes public recipes.

Do not run the backfill in Render pre-deploy. Reconcile each append-only batch
before advancing, then run a final inventory from the beginning and require
zero eligible public thumbnails or explicitly reconcile every exception.

## End the compatibility window

Keep direct public S3 thumbnail reads until the API cutover, CDN monitoring, and
current TestFlight build are verified. Then remove only the exact legacy
`PublicReadForThumbnails` statement, preserving the CloudFront and every
unrelated statement. Use a new backup path and keep it with the deployment
record.

```bash
cd api
uv run python -m app.recipe_media_bucket_policy close-compatibility \
  --bucket recipe-extractor-thumbnails \
  --region ap-southeast-2 \
  --distribution-id "$DISTRIBUTION_ID" \
  --exclusive-writer-token CHG-YYYYMMDD-RECIPE-CDN-CLOSE \
  --backup-path /ABSOLUTE/APPROVED/BACKUP-DIRECTORY/policy-before-public-close.json
cd ..
```

After the verified policy change, record the current S3 Block Public Access
configuration in a new private deployment backup, then enable all four settings:

```bash
(
set -euo pipefail
umask 077
PAB_BACKUP_PATH=/ABSOLUTE/APPROVED/BACKUP-DIRECTORY/public-access-block-before-close.json
set -o noclobber
aws s3api get-public-access-block \
  --bucket recipe-extractor-thumbnails \
  --output json \
  | jq --arg bucket recipe-extractor-thumbnails \
      '{Bucket: $bucket, PublicAccessBlockConfiguration: .PublicAccessBlockConfiguration}' \
      > "$PAB_BACKUP_PATH"
test -s "$PAB_BACKUP_PATH"
)

aws s3api put-public-access-block \
  --bucket recipe-extractor-thumbnails \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

Re-run the CDN thumbnail and chat-image tests. A direct unauthenticated S3
thumbnail request must now return `403`, while the same key through CloudFront
must remain available.

Verify those two outcomes independently so the expected S3 denial cannot stop
the CloudFront check:

```bash
(
set -euo pipefail
VERIFY_DIR="$(mktemp -d)"
trap 'rm -rf "$VERIFY_DIR"' EXIT

S3_STATUS="$(curl --silent --show-error \
  --output "$VERIFY_DIR/direct-s3-response" \
  --write-out '%{http_code}' \
  "https://recipe-extractor-thumbnails.s3.ap-southeast-2.amazonaws.com/thumbnails/EXISTING_KEY")"
test "$S3_STATUS" = '403'

curl --fail --silent --show-error \
  --output "$VERIFY_DIR/cdn-thumbnail" \
  "https://media.hafa-recipes.com/thumbnails/EXISTING_KEY"
test -s "$VERIFY_DIR/cdn-thumbnail"
)
```

To roll back after closing the compatibility window, first restore the captured
public-access-block configuration. Then restore the exact pre-close policy,
while creating a separate backup of the current policy:

```bash
aws s3api put-public-access-block \
  --cli-input-json file:///ABSOLUTE/APPROVED/BACKUP-DIRECTORY/public-access-block-before-close.json

cd api
uv run python -m app.recipe_media_bucket_policy restore \
  --bucket recipe-extractor-thumbnails \
  --region ap-southeast-2 \
  --distribution-id "$DISTRIBUTION_ID" \
  --backup-path /ABSOLUTE/APPROVED/BACKUP-DIRECTORY/policy-before-public-close.json \
  --exclusive-writer-token CHG-YYYYMMDD-RECIPE-CDN-ROLLBACK \
  --pre-restore-backup-path /ABSOLUTE/APPROVED/BACKUP-DIRECTORY/policy-before-rollback.json
cd ..
```

Verify direct S3 access before unsetting `RECIPE_MEDIA_BASE_URL`. Reversing the
order creates broken images.

## Destructive cleanup

Do not delete the stack during an incident. First switch Render back to direct
S3 delivery and verify images. Before planned teardown, use the policy tool's
`detach-cloudfront` action with a new backup path; it removes only the exact
distribution-scoped statement and preserves everything else. This action also
requires an exclusive-writer token and window. Deleting an active pricing-plan
subscription schedules cancellation for the end of the current billing period,
so keep its associated resources intact until cancellation completes.
CloudFront distributions must also be disabled before they can be deleted.
Because the stack never owns the bucket or its policy, stack deletion cannot
remove either one.
