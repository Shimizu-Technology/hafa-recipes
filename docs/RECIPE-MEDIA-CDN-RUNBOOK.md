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

- The S3 bucket policy grants CloudFront `s3:GetObject` only for
  `thumbnails/*`.
- The WAF allows only viewer paths beginning with `/thumbnails/` and blocks all
  other paths before they reach S3.
- The distribution uses an Origin Access Control that signs every S3 request.
- A per-IP rate rule blocks more than 10,000 thumbnail requests in five minutes.
- The Free plan uses AWS-managed cache and response-header policies. It does not
  depend on query strings, cookies, or viewer identity.
- CloudFront standard access logs are intentionally disabled because the
  current operational value does not justify retaining request-level data.
  The Free plan includes standard-log ingestion into CloudWatch Logs, but log
  storage and queries can incur separate costs. WAF metrics and sampled
  requests remain enabled.

Never change the bucket resource in the policy from
`arn:aws:s3:::recipe-extractor-thumbnails/thumbnails/*` to a bucket-wide ARN.
Do not use the S3 website endpoint; OAC requires the regular S3 bucket origin.

## Deploy the infrastructure

The template must be deployed in `us-east-1`. CloudFront is global, and its WAF
web ACL can only be created from that Region.

Validate and create a reviewable change set from the repository root:

```bash
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
    KeepLegacyPublicRead=true \
  --no-execute-changeset
```

Inspect the generated change set in CloudFormation. It must create one WAF web
ACL, one OAC, one distribution, one Free pricing-plan subscription, and update
the existing thumbnail-only bucket policy. It must not create or replace the S3
bucket. Execute the exact reviewed change set, then wait for the stack and the
distribution to finish deploying.

Record these stack outputs in the deployment log:

```bash
aws cloudformation describe-stacks \
  --region us-east-1 \
  --stack-name hafa-recipes-media-cdn-production \
  --query 'Stacks[0].Outputs' \
  --output table
```

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
`RECIPE_MEDIA_BASE_URL` in Render and redeploy. While
`KeepLegacyPublicRead=true`, the API will return the original S3 delivery URL.

## Add the custom hostname

The initial cutover may safely use the generated CloudFront hostname. For
`media.hafa-recipes.com`, request an ACM public certificate in `us-east-1`, add
its DNS validation CNAME in the authoritative DNS provider, and wait until the
certificate status is `ISSUED`. Do not expose validation credentials or move
the domain's nameservers.

Create another CloudFormation change set with both parameters:

```text
MediaDomainName=media.hafa-recipes.com
AcmCertificateArn=arn:aws:acm:us-east-1:ACCOUNT:certificate/CERTIFICATE_ID
```

After the distribution is deployed, add the DNS CNAME
`media.hafa-recipes.com` to the distribution hostname. Verify TLS and CDN cache
behavior through the custom hostname, then change Render's
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
current TestFlight build are verified. Then create and execute a CloudFormation
change set with `KeepLegacyPublicRead=false`. After it deploys, enable all four
S3 Block Public Access settings:

```bash
aws s3api put-public-access-block \
  --bucket recipe-extractor-thumbnails \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

Re-run the CDN thumbnail and chat-image tests. A direct unauthenticated S3
thumbnail request must now return `403`, while the same key through CloudFront
must remain available.

To roll back after closing the compatibility window, first restore the prior
public-access-block configuration, then deploy the stack with
`KeepLegacyPublicRead=true`, and only then unset `RECIPE_MEDIA_BASE_URL`.
Reversing the order creates broken images.

## Destructive cleanup

Do not delete the stack during an incident. First switch Render back to direct
S3 delivery and verify images. Deleting an active pricing-plan subscription
schedules cancellation for the end of the current billing period; keep its
associated resources intact until cancellation completes. CloudFront
distributions must also be disabled before they can be deleted. The bucket
policy has a `Retain` deletion policy so stack deletion cannot silently remove
the bucket's access policy; reconcile it manually after every destructive stack
operation.
