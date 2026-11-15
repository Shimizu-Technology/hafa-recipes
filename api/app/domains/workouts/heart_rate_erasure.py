"""Narrow database exception for removing HR without rewriting recorded actuals."""

import re

from sqlalchemy import text

STRIP_BODY = """
SELECT CASE WHEN value ? 'segments' THEN jsonb_set(value - 'heart_rate', '{segments}',
    COALESCE((SELECT jsonb_agg(segment - 'avg_hr' - 'max_hr' ORDER BY position)
    FROM jsonb_array_elements(value->'segments') WITH ORDINALITY AS parts(segment, position)), '[]'::jsonb))
    ELSE value - 'heart_rate' END
"""
GUARD_BODY = """
BEGIN
    IF TG_TABLE_NAME = 'workouts_sessions'
       AND to_jsonb(NEW) - 'content' = to_jsonb(OLD) - 'content'
       AND NEW.content = public.workouts_without_heart_rate(OLD.content) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Workouts prescription versions and actual snapshots are immutable';
END
"""


async def install_heart_rate_erasure(db):
    await db.execute(text(f"CREATE OR REPLACE FUNCTION public.workouts_without_heart_rate(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $body${STRIP_BODY}$body$"))
    await db.execute(text(f"CREATE OR REPLACE FUNCTION public.prevent_workouts_snapshot_update() RETURNS trigger LANGUAGE plpgsql AS $body${GUARD_BODY}$body$"))


def normalized_body(body):
    # Ignore formatting outside quoted SQL literals, preserving their meaning.
    return re.sub(r"'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|\s+",
                  lambda match: "" if match[0].isspace() else match[0], body)


async def heart_rate_erasure_ready(db):
    bodies = dict((await db.execute(text("""SELECT proname,prosrc FROM pg_proc
        WHERE oid IN (to_regprocedure('public.workouts_without_heart_rate(jsonb)'),
                      to_regprocedure('public.prevent_workouts_snapshot_update()'))"""))).all())
    return all(normalized_body(bodies.get(name, "")) == normalized_body(body) for name, body in (
        ("workouts_without_heart_rate", STRIP_BODY), ("prevent_workouts_snapshot_update", GUARD_BODY)))
