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
still cancels it. Foreground polling remains bounded. The picker request stays
reserved until its matching callback, including cancellation; a late result
cannot become the destination of a newer operation.

Copying uses a 64KiB buffer and a 64MiB compact-source limit. Provider I/O can
block; cancellation is not proof that I/O ended. The copy owns both stream
closures, and failures cannot become saved results. Failed or cancelled copies
attempt to remove only their new destination. A failed deletion produces an
incomplete-file notice, and the private cache source is removed in the adapter's
`finally` block. Server cancellation/removal remains the caller's responsibility.

An interrupted save marker contains no URI or export payload. A cold restart
shows that a complete or incomplete file may remain in the chosen location and
never automatically opens another picker. Process death can prevent destination
rollback or leave a private cache source for owner-scoped device cleanup; no
successful cleanup is claimed without acknowledgement. Destination-write/close
success does not claim cloud synchronization or physical-storage durability.

## Acceptance still required

Source and tests are prepared; no test/build/UI result is claimed by this note.
The new Android module requires fresh autolinking and an APK built from the final
source. The previous development APK does not prove the new ABI.

Focused automated gates cover source cleanup after deferred copy/close,
cancelled selection, missing module, stale scope and privacy, modal-background
versus disposal, interrupted-save recovery, exact bounded stream bytes,
oversize/truncated sources, and open/write/flush/close/cancellation errors.

Actual Android acceptance must verify a local selected destination's full bytes,
filename-collision behavior without changing the existing file, cancelled
picker, scope/privacy loss during the picker, provider failure and partial
cleanup, foreground recovery and cold interruption. The seven background-export
scenarios and required physical/provider dimensions remain separate unfinished
gates. No transmission, real AI, production change or store delivery is included.
