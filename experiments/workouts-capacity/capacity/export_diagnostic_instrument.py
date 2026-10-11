"""Wrappers await unchanged production methods; no replacement connection/codec."""

import functools

from capacity.export_diagnostic_metrics import Metrics, active, stack

latest = None


def async_stage(stage, original):
    @functools.wraps(original)
    async def call(*args, **kwargs):
        state = active.get()
        if state is None:
            return await original(*args, **kwargs)
        with state.measure(stage):
            return await original(*args, **kwargs)

    return call


def sync_stage(stage, original, output_bytes=False):
    @functools.wraps(original)
    def call(*args, **kwargs):
        state = active.get()
        if state is None:
            return original(*args, **kwargs)
        with state.measure(stage, sync=True) as frame:
            result = original(*args, **kwargs)
            if output_bytes:
                frame["bytes"] = len(
                    result.encode() if isinstance(result, str) else result
                )
            return result

    return call


def source_call(original):
    @functools.wraps(original)
    async def call(session, *args, **kwargs):
        state = active.get()
        if (
            state is None
            or session is not state.source
            or any(f["stage"] == "source_fetch_decode" for f in stack.get())
        ):
            return await original(session, *args, **kwargs)
        with state.measure("source_fetch_decode"):
            return await original(session, *args, **kwargs)

    return call


def install(patch=setattr, *, wrap_singleton=True, max_builds=1):
    if type(max_builds) is not int or max_builds not in (1, 5):
        raise ValueError("Only fixed one/five build scenarios are permitted")
    build_count = 0

    from app.db.database import engine
    from app.domains.workouts import export_service as service
    from app.domains.workouts.export_context import SnapshotSourceContext
    from app.domains.workouts.export_router import private_exports
    from app.domains.workouts.router import ExportResponse
    from sqlalchemy import event
    from sqlalchemy.ext.asyncio import AsyncSession

    event.listen(engine.sync_engine, "before_cursor_execute", query_event)
    patch(
        service,
        "guard_projection_memory",
        async_stage("size_guard", service.guard_projection_memory),
    )
    patch(
        service,
        "build_export_page",
        async_stage("projection", service.build_export_page),
    )
    original_prepare = SnapshotSourceContext.prepare.__func__

    @functools.wraps(original_prepare)
    async def prepare(cls, db, *args, **kwargs):
        state = active.get()
        if state is None:
            return await original_prepare(cls, db, *args, **kwargs)
        # Identify the real source before its scalar inventory queries. The
        # original constructor verifies its live readonly RR transaction.
        state.source = db
        with state.measure("source_inventory"):
            return await original_prepare(cls, db, *args, **kwargs)

    patch(SnapshotSourceContext, "prepare", classmethod(prepare))
    patch(service, "seal", sync_stage("aes_encrypt", service.seal, output_bytes=True))
    patch(
        ExportResponse,
        "model_dump_json",
        sync_stage("json_encode", ExportResponse.model_dump_json, False),
    )
    original_page = service.approved_export_page

    async def page(db, *args, **kwargs):
        active.get().source = db
        return await original_page(db, *args, **kwargs)

    # The existing singleton's default callback was captured at construction.
    # Replace only that callback with an await-preserving wrapper around it.
    if wrap_singleton:
        patch(private_exports, "page_source", page)
    for method in ("execute", "scalar", "get"):
        patch(AsyncSession, method, source_call(getattr(AsyncSession, method)))
    patch(AsyncSession, "rollback", rollback_call(AsyncSession.rollback))
    writer = service.PrivateExportService._write_page

    async def write(*args, **kwargs):
        result = await async_stage("page_writer_commit", writer)(*args, **kwargs)
        if active.get():
            active.get().pages += 1
        return result

    patch(service.PrivateExportService, "_write_page", write)
    create = service.PrivateExportService.create

    async def build(*args, **kwargs):
        global latest
        nonlocal build_count
        if max_builds == 1:
            if latest is not None:
                raise RuntimeError("Only one diagnostic export is permitted")
        elif build_count >= max_builds or (latest is not None and not latest.complete):
            raise RuntimeError("Diagnostic build inventory exhausted or unsettled")
        build_count += 1
        state = latest = Metrics()
        token = active.set(state)
        failed = True
        try:
            with state.measure("build_total"):
                result = await create(*args, **kwargs)
                state.complete = True
                failed = False
                return result
        finally:
            if state.finalization is not None:
                state.end(state.finalization, failed)
                state.finalization = None
            state.source = None
            active.reset(token)

    patch(service.PrivateExportService, "create", build)
    return lambda: event.remove(
        engine.sync_engine, "before_cursor_execute", query_event
    )


def query_event(*_):
    state = active.get()
    if state is not None:
        state.query()


def snapshot():
    return latest.snapshot() if latest else None


def rollback_call(original):
    async def call(session, *args, **kwargs):
        state = active.get()
        if state and session is state.source and state.finalization is None:
            state.finalization = state.begin("finalization")
        return await original(session, *args, **kwargs)

    return call
