# Android private export saving

Android uses one `ACTION_CREATE_DOCUMENT` request for a JSON file. It writes the
complete private cache source to that document and reports saved only after the
write, flush and close succeed. iOS continues to use its existing share sheet
and reports opened; the app cannot establish whether an external copy was saved.

The earlier Android share implementation returned an activity result without a
receiver-read acknowledgement, then deleted the file backing its content URI.
No actual device failure was observed. The new path removes that unsupported
file-lifetime boundary; it does not use a sharing fallback or deletion delay.

## Ownership and scope

Android's [create-file contract](https://developer.android.com/training/data-storage/shared/documents-files#create-file)
creates a new document and appends a number for a filename collision instead of
overwriting an existing file. Failure cleanup applies only to the successful
result of this module's own create request, with a document-provider content URI.
No arbitrary file, directory, existing-document selection, persistent permission,
or raw destination URI crosses the JavaScript interface.

After the picker returns, both callers check the original account, storage and
training generation, then read the existing snapshot manifest endpoint. The
server rechecks membership, expiry, privacy and readiness. JavaScript compares
the manifest before allowing native copying. A failed read prevents copying.

The background controller preserves its operation only for its own Android
picker's background transition. Losing screen focus, disposal or captured scope
still cancels it. Foreground polling remains bounded. While the module is alive,
the picker request stays reserved until its matching callback, including
cancellation; a late result cannot become the destination of a newer operation.
During destruction Expo removes the activity listener and module registry, so a
missing picker URI remains unknown. Known cleanup is queued before orderly
executor shutdown; running and queued work keeps its close ownership, and new
work is rejected.

Copying uses a 64KiB buffer and a 64MiB compact-source limit. Provider I/O can
block; cancellation is not proof that I/O ended. The copy owns both stream
closures, and failures cannot become saved results. A reliable descriptor is
checked for reported peer errors before and after its owning stream closes;
the first error is preserved even if closure clears or caches a status. These
checks detect available errors, not future remote persistence. Failed or cancelled
copies attempt to remove only their new destination. A failed deletion produces
an incomplete-file notice. Private source cleanup runs after the operation settles;
if source removal also fails, the safe primary save failure remains first and a
local cleanup warning is added. A successful Android write or iOS opened outcome
also remains truthful when only local cleanup fails. Server cancellation/removal
remains the caller's responsibility.

An interrupted save marker contains no URI or export payload. A cold restart
shows that a complete or incomplete file may remain in the chosen location and
never automatically opens another picker. Process death can prevent destination
rollback or leave a private cache source for owner-scoped device cleanup; no
successful cleanup is claimed without acknowledgement. Destination-write/close
success does not claim cloud synchronization or physical-storage durability.

## Acceptance still required

At source `7ab88f89707f9b588fb61679104a76defe5beb72`, the first focused gate passed
91 tests in five files, and a separate TypeScript typecheck passed with no
diagnostics. The full Workouts suite then passed 377 tests in 42 files, including
the real continuity bridge against integration API `8fe483f` and its verified
Render-pinned Python dependency environment. All commands used isolated Node
22.22.3 and their explicit time limits; no retry or dependency sync was needed.

Doctor passed 21/21 checks. The runtime audit found zero unexpected advisories
within the existing dated dependency exceptions. iOS/Android/web exports with
source maps and native bundle selection checks passed. The maps select the
Android document adapter and the existing iOS native sharing adapter separately.
These results cover JavaScript/types/bundles; they do not compile or accept the
new Android module. Fresh autolinking, native tests and an APK built from the final
source are still required. The previous development APK does not prove the new ABI.

The executed JavaScript regressions cover source cleanup after deferred copy/close,
cancelled selection, missing module, stale scope and privacy, modal-background
versus disposal, interrupted-save recovery and simultaneous destination/source
cleanup failures, preserving safe primary errors and truthful Android/iOS results.
Prepared native regressions cover exact bounded stream bytes, oversize/truncated
sources, open/write/flush/close/cancellation errors, errors consumed before close,
errors cached during close, orderly teardown with queued work, and an unknown
picker that cannot supply a future callback. An API36 instrumentation regression
uses real reliable socket descriptors and a fixed synthetic peer failure; it
opens no document/provider/UI. Native JVM and descriptor instrumentation tests
remain NOT_RUN, as do all actual Android destination/provider/UI scenarios.

Actual Android acceptance must verify a local selected destination's full bytes,
filename-collision behavior without changing the existing file, cancelled
picker, scope/privacy loss during the picker, provider failure and partial
cleanup, foreground recovery and cold interruption. The seven background-export
scenarios and required physical/provider dimensions remain separate unfinished
gates. No transmission, real AI, production change or store delivery is included.
