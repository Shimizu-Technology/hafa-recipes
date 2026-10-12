# Bounded Workouts bulk ingress

The globally serialized Workouts worker does not bound concurrent request bodies.
Import ingress previously admitted a separate 3 MiB body per request before auth
and JSON parsing. This change admits one bulk import request per API process,
without waiting or buffering a second body. Busy requests receive 429
`workouts_import_busy`, `Retry-After: 2` and `Cache-Control: no-store` before body,
auth or database work. The disabled master still returns 404 before those steps,
even while the process permit is occupied.

The permit spans body receipt, handler execution and final ASGI response send.
Cancellation, disconnect, validation/handler failures and normal completion release
it. A 60-second total deadline prevents an unfinished client from holding the
permit indefinitely. A deadline before response start returns 408
`workouts_import_timeout` with the same retry/no-store headers. After response
start the incomplete response is aborted; no second status or JSON error is
appended. A client retry retains its original request UUID/body, because a lost
response can follow a successful durable admission.

This is process-local admission, matching the checked-in single-Uvicorn Render
command. Future worker/replica counts multiply simultaneous ingress permits and
must be included in capacity testing. It is not a distributed admission limit,
provider budget, authentication rule or worker lease. Existing body-size and
source-validation limits still apply. Recipes routes do not acquire this permit.

Acceptance covers unread busy/disabled bodies, actual parsing, final-send
backpressure, receive/send cancellation, disconnect, invalid/oversized bodies,
handled/unhandled errors, deadline recovery and an unrelated Recipes route.
`WORKOUTS_INGRESS_SOCKET_TEST=1` enables an additional finite loopback Uvicorn test
for Expect: 100-continue rejection and disconnect recovery. That socket scenario
is not_run until root authorizes runtime setup. No synthetic ASGI result proves
physical device, production network or full R04 capacity acceptance.
