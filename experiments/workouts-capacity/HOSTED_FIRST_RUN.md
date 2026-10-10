# First hosted native x86 run

Source: `7c1fdc37c6fcb2b6c3cd4719c0269cafef0c3adf`, diagnostic draft PR #140,
workflow attempt 1. Both isolated jobs failed during baseline startup. No baseline,
mixed or legal matrix result passed. Zero observation samples means memory and
latency were not measured; the receipt's zero peak is not zero memory use.

Both jobs built and verified native x86 artifacts before attempting startup:

| Provenance | Core | Legal |
| --- | --- | --- |
| Image SHA256 | `460e51b9545c0a1f64273d7882af5bd8ad30b991208b11d54262ce80fe8daf49` | `abb04ea4b8690549d3bd5c6e03f296c27c806c9209d4bf61123e15ed9c529b15` |
| Architecture | x86_64 | x86_64 |
| Python | 3.12.15 | 3.12.15 |
| FFmpeg | 5.1.9-0+deb12u1 | 5.1.9-0+deb12u1 |
| Pinned distributions verified | 81 | 81 |
| Observation samples / protected requests | 0 / 0 | 0 / 0 |
| Real provider calls | 0 | 0 |
| Exact owned cleanup | Confirmed | Confirmed |

Requirements SHA remains
`9002549c41b56eb84eda74b5e53875daf8899759ec183b532649a973343b5996`.
The verified production graph includes FastAPI 0.122.0, Starlette 0.50.0,
OpenAI 2.8.1, Pydantic 2.12.5, Pillow 12.3.0, pypdf 6.20.0 and cryptography 46.0.3.
The coordinator steps exited with code 2, while both always-clean and tiny receipt uploads
succeeded. These are setup failures, not workload, memory or parser acceptance.

The harness compared the public liveness response with diagnostic status
“healthy.” The actual mounted `/up` handler returns `HealthResponse()` with
`{"status":"ok"}`; “healthy” belongs to the separate admin dependency diagnostic.
The incorrect probe exhausted its startup deadline even when public liveness
was correct. A harness-only fix accepts the exact public shape and tests the
actual mounted handler, while refusing diagnostic/degraded/wrong-shape results.

The original coordinator suppressed error detail, so action logs contained only
exit code 2. Future receipts add fixed whitelisted failure code/phase enums; they never
copy raw exception text, provider data, URLs or resource identifiers. The first
failed receipts remain unchanged in retained local evidence. No automatic rerun
or relaxed pin is allowed. Root must inspect the new exact source and setup before
another finite hosted attempt. Production source, schema, provider configuration,
input caps and all memory/latency thresholds remain unchanged. R04 is open.

The harness-only startup/diagnostic repair passed 109 finite source tests in
16.26 seconds, including an in-process request to the real mounted liveness
handler. Lint and diff checks passed; no production API file changed. The fix is
local until exact-pin review and a separately authorized hosted attempt.
