"""Strict test-only export probe. Never imported by production or capacity.app."""

import os

from capacity.safety import OWNERS, ensure

ensure()
if any(
    os.environ.get(k) != v
    for k, v in {
        "CAPACITY_EXPORT_DIAGNOSTIC": "true",
        "JOB_WORKER_ENABLED": "false",
        "DELETION_CLEANUP_WORKER_ENABLED": "false",
        "WORKOUTS_IMPORTS_ENABLED": "false",
        "CAPACITY_COVER_SCENARIOS": "false",
        "CAPACITY_PHASE": "diagnostic",
        "WORKOUTS_API_ENABLED": "true",
    }.items()
):
    raise RuntimeError("Strict isolated diagnostic configuration required")

from fastapi import Depends, HTTPException

from capacity.app import app, identity
from capacity.export_diagnostic_instrument import install, snapshot

install()


@app.get("/capacity/export-diagnostic")
async def measurements(user=Depends(identity)):  # noqa: B008
    if user.id != OWNERS[22]:
        raise HTTPException(403, "Diagnostic fixture identity required")
    return snapshot()
