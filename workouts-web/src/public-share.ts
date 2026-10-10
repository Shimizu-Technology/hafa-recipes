import { developmentApiOrigin, productionApiOrigin } from "./api-origin";

declare const __WORKOUTS_DEV_LOOPBACK__: boolean;

export type PublicExercise = {
  name: string;
  provenance: string | null;
  sets: number | null;
  reps_min: number | null;
  reps_max: number | null;
  per_side: boolean | null;
  duration_seconds: number | null;
  distance_meters: number | null;
  rest_seconds: number | null;
  load: number | null;
  load_unit: "kg" | "lb" | null;
  load_convention: string | null;
  tempo: string | null;
  effort: string | null;
};
export type PublicBlock = {
  label: string;
  grouping: string;
  rounds: number | null;
  rest_between_rounds_seconds: number | null;
  exercises: PublicExercise[];
};
export type PublicWorkout = {
  title: string;
  kind: string;
  provenance: string;
  source_url: string | null;
  source_creator: string | null;
  source_title: string | null;
  equipment_required: string[];
  equipment_optional: string[];
  estimated_minutes: number | null;
  blocks: PublicBlock[];
};
export interface PublicProgram {
  title: string;
  notice: string;
  sessions: Array<{ sequence: number; day_offset: number; workout: PublicWorkout }>;
}
export interface PublicSnapshot {
  kind: "workout" | "program";
  content: PublicWorkout | PublicProgram;
  expires_at: string;
  review_required: boolean;
  attribution: { shared_by_display_name: string | null; source_revision: number; original_source_included: boolean };
}
export class ShareError extends Error {
  constructor(readonly code: "invalid" | "unavailable" | "network" | "configuration" | "too_large") {
    super(code);
  }
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ShareError("invalid");
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 200) => {
  if (typeof value !== "string" || value.length > max) throw new ShareError("invalid");
  return value;
};
const optionalText = (value: unknown, max = 200) => (value == null ? null : text(value, max));
const number = (value: unknown, max = 1_000_000) => {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) throw new ShareError("invalid");
  return value;
};
const list = (value: unknown, max: number): unknown[] => {
  if (!Array.isArray(value) || value.length > max) throw new ShareError("invalid");
  return value;
};
const strings = (value: unknown) => list(value ?? [], 100).map((item) => text(item, 200));
const bool = (value: unknown) => {
  if (typeof value !== "boolean") throw new ShareError("invalid");
  return value;
};
export function safeSourceURL(value: unknown) {
  if (value == null) return null;
  const source = text(value, 2000);
  try {
    const url = new URL(source);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname.includes(".") ||
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) ||
      url.hostname.endsWith(".local")
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
function workout(input: unknown): PublicWorkout {
  const w = object(input);
  const blocks = list(w.blocks, 100).map((item) => {
    const b = object(item);
    if (!["sequential", "circuit", "superset", "interval"].includes(String(b.grouping)))
      throw new ShareError("invalid");
    return {
      label: text(b.label ?? "", 200),
      grouping: String(b.grouping),
      rounds: number(b.rounds, 1000),
      rest_between_rounds_seconds: number(b.rest_between_rounds_seconds),
      exercises: list(b.exercises, 100).map((item) => {
        const e = object(item);
        if (e.load_unit != null && !["kg", "lb"].includes(String(e.load_unit))) throw new ShareError("invalid");
        return {
          name: text(e.name),
          provenance: optionalText(e.provenance, 20),
          sets: number(e.sets, 1000),
          reps_min: number(e.reps_min, 10000),
          reps_max: number(e.reps_max, 10000),
          per_side: e.per_side == null ? null : bool(e.per_side),
          duration_seconds: number(e.duration_seconds),
          distance_meters: number(e.distance_meters),
          rest_seconds: number(e.rest_seconds),
          load: number(e.load, 2000),
          load_unit: (e.load_unit as "kg" | "lb" | null) ?? null,
          load_convention: optionalText(e.load_convention, 40),
          tempo: optionalText(e.tempo, 100),
          effort: null,
        };
      }),
    };
  });
  return {
    title: text(w.title),
    kind: text(w.kind, 20),
    provenance: text(w.provenance, 20),
    source_url: safeSourceURL(w.source_url),
    source_creator: optionalText(w.source_creator),
    source_title: optionalText(w.source_title),
    equipment_required: strings(w.equipment_required),
    equipment_optional: strings(w.equipment_optional),
    estimated_minutes: number(w.estimated_minutes, 1440),
    blocks,
  };
}
export function parseSnapshot(value: unknown): PublicSnapshot {
  const s = object(value);
  if (!["workout", "program"].includes(String(s.kind))) throw new ShareError("invalid");
  const a = object(s.attribution);
  const kind = s.kind as "workout" | "program";
  let content: PublicWorkout | PublicProgram;
  if (kind === "workout") content = workout(s.content);
  else {
    const p = object(s.content);
    content = {
      title: text(p.title),
      notice: text(p.notice ?? "", 1000),
      sessions: list(p.sessions, 366).map((item) => {
        const row = object(item);
        const sequence = number(row.sequence, 366),
          offset = number(row.day_offset, 365);
        if (sequence == null || offset == null || !Number.isInteger(sequence) || !Number.isInteger(offset))
          throw new ShareError("invalid");
        return { sequence, day_offset: offset, workout: workout(row.workout) };
      }),
    };
  }
  const expires = text(s.expires_at, 60);
  if (!Number.isFinite(Date.parse(expires))) throw new ShareError("invalid");
  return {
    kind,
    content,
    expires_at: expires,
    review_required: bool(s.review_required),
    attribution: {
      shared_by_display_name: optionalText(a.shared_by_display_name, 100),
      source_revision: number(a.source_revision, 2_147_483_647) ?? 0,
      original_source_included: bool(a.original_source_included),
    },
  };
}
export function shareToken(path: string, hash: string, query: string) {
  if (path.length > 150 || hash.length > 100 || query || (path.startsWith("/shared/") && path !== "/shared/" && hash))
    return null;
  const raw =
    path === "/shared" || path === "/shared/" ? hash.slice(1) : path.startsWith("/shared/") ? path.slice(8) : "";
  return /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : null;
}
export function publicApiBase(raw: string) {
  try {
    if (import.meta.env.DEV && __WORKOUTS_DEV_LOOPBACK__) return developmentApiOrigin(raw);
    return productionApiOrigin(raw);
  } catch {
    throw new ShareError("configuration");
  }
}
export async function fetchSnapshot(base: string, token: string, signal: AbortSignal, transport: typeof fetch = fetch) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ShareError("invalid");
  try {
    const response = await transport(`${base}/api/v1/workouts/shared/${token}`, {
      signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new ShareError([404, 410].includes(response.status) ? "unavailable" : "network");
    if (!response.body || !response.headers.get("content-type")?.includes("application/json"))
      throw new ShareError("invalid");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let body = "",
      bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 2 * 1024 * 1024) throw new ShareError("too_large");
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } finally {
      await reader.cancel();
    }
    return parseSnapshot(JSON.parse(body));
  } catch (error) {
    if (error instanceof ShareError) throw error;
    throw new ShareError("network");
  }
}

export function repsLabel(min: number | null, max: number | null) {
  if (min == null && max == null) return "Not specified";
  if (min == null) return `Up to ${max}; minimum unspecified`;
  if (max == null) return `${min} minimum; maximum unspecified`;
  return min === max ? String(min) : `${min}–${max}`;
}
