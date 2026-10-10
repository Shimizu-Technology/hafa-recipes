# Private export size admission: bounded PostgreSQL rendering

The private snapshot builder admits each page before asyncpg decodes its JSON.
It measures only approved projected fields, reserves half the 8 MiB page bound
for data and the remainder for wrappers/quoting, and retains the final encoded
8 MiB page / 64 MiB snapshot bounds. This change leaves the legacy export route,
projection, page schema, complete version history and privacy checks unchanged.

## Measured bottleneck and minimal fix

The parent isolated native-x86 diagnostic on the unchanged export implementation
measured an 8.026-second service build: 19 size-guard calls/259 queries occupied
5.935 seconds, projection 1.248 seconds, page writers 0.574 seconds, JSON encoding
0.091 seconds and encryption 0.028 seconds. This identifies a guard bottleneck;
it does not establish the cause of every mixed Recipes latency regression.

The old query rendered `octet_length(content::text)` below PostgreSQL's sort and
limit. Actual PostgreSQL 16.15 EXPLAIN ANALYZE/VERBOSE showed rendering on a scan
of all 190 matching records, even when the page selected ten records. Thus early,
middle and late offsets had similar costs. The fix selects only the required
field references into a bounded MATERIALIZED page, then measures them outside:

```sql
WITH selected AS MATERIALIZED (
  SELECT content FROM workouts_library
  WHERE app_user_id=:owner AND generation=:generation
  ORDER BY created_at DESC,id DESC LIMIT :limit OFFSET :offset
)
SELECT COALESCE(SUM(COALESCE(octet_length(content::text),0)),0)
FROM selected;
```

Only existing server-owned table/field/order constants enter this SQL. The
result remains one numeric scalar; no private JSON is returned to the driver.
The guard still sums every selected table's bytes, rejects excessive cumulative
size immediately, checks the profile reserve and uses the same 413 error.

A separate synthetic comparison used 190 records with forty deterministic random
4,000-character notes each and a normal owner/generation index. Eight alternating
old/new samples per offset produced identical byte totals:

| Offset | Old median ms | Bounded median ms |
| --- | ---: | ---: |
| 0 | 75.25 | 4.92 |
| 90 | 72.09 | 4.81 |
| 180 | 73.30 | 4.70 |

The old plan rendered 190 rows; the bounded plan rendered ten. Merely combining
the old queries into a UNION reduced this comparison's total by roughly 5%,
retaining the expensive rendering. No UNION or larger inventory refactor is
included here.

These timings use local Docker PostgreSQL 16.15 and Python 3.12.8 on macOS ARM,
with all 81 exact Render requirements and six separate test tools installed.
They are not the hosted Linux x86/0.5 CPU/512 MiB capacity measurement. Numeric
plans, timing receipts and the standalone comparison are retained privately at
`/tmp/hafa-export-sizeguard-proof`. The hosted one-second write and relative
Recipes latency gates remain failed until a reviewed final candidate is retested.
The unchanged diagnostic's non-guard remainder alone was about 2.09 seconds.

## Separate correctness repair: select the actual projected page

Health observations, published shares and copy receipts export in ascending
`created_at,id` order. The old guard used descending order for these tables,
which could admit a small recent row before decoding an oversized older row.
Their guard order now matches their existing exporter. Other guarded tables keep
descending order. The exported order itself is unchanged.

## Verification

`tests/test_workouts_export_sizeguard.py` uses the real migrations and PostgreSQL:

- Numeric EXPLAIN row bounds at offsets 0/90/180 and equal legacy byte totals.
- Oversized selected/skipped records, later-page rejection, owner/generation
  filtering, empty pages and absent profiles.
- Cumulative and profile reserves, nullable import results, combined coach TEXT
  and JSON fields, and a real JSONB decoder trap proving scalar-only admission.
- Asymmetric large-old/small-new fixtures checked against the actual health and
  connection exporters for all three ascending datasets.

Existing snapshot consistency, deletion/revocation/expiry, writer locks, response
lifetime guards and legacy contracts remain required checks. This slice does not
change those mechanisms, enable Workouts/AI, waive a capacity gate or establish
native/product/provider acceptance.
