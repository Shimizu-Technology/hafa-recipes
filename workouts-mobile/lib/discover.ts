/**
 * Workouts Discover: wire types, query keys, filters and the publishing rules
 * the screens share. Contract: docs/hafa-workouts/DISCOVER.md.
 */
import type { AuthoredWorkout, ExercisePrescription, Workout } from "./models";

export interface Publication {
  is_public: boolean;
  moderation_status: "active" | "hidden";
  published_at: string | null;
  discover_visible: boolean;
}
export interface DiscoverContributor {
  contributor_id: string | null;
  display_name: string;
}
export interface DiscoverCard {
  id: string;
  title: string;
  kind: Workout["kind"];
  estimated_minutes: number | null;
  equipment_required: string[];
  equipment_optional: string[];
  block_count: number;
  exercise_count: number;
  source_url: string | null;
  source_platform: string | null;
  source_creator: string | null;
  /** Always null for now; Workouts doesn't store media yet. */
  thumbnail_url: string | null;
  published_at: string | null;
  contributor: DiscoverContributor;
  is_owner: boolean;
  saved_workout_id: string | null;
}
export interface DiscoverDetail extends DiscoverCard {
  workout: AuthoredWorkout & { source_creator?: string | null; source_title?: string | null };
}
export interface DiscoverPage {
  items: DiscoverCard[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}
export type ReportCategory = "spam" | "unsafe" | "inappropriate" | "copyright" | "impersonation" | "other";
export interface PublishingDisclosureStatus {
  current_version: number;
  accepted_version: number;
  requires_acceptance: boolean;
}

export type DurationRange = "short" | "medium" | "long";
export interface DiscoverFilters {
  q?: string;
  /** Free equipment name, or "none" for no required equipment. */
  equipment?: string;
  platform?: string;
  duration?: DurationRange;
}

export const DISCOVER_PAGE_SIZE = 20;
/** Feed changes slowly and reads are viewer-specific; a minute avoids refetch churn on tab switches. */
export const DISCOVER_STALE_MS = 60_000;
export const SEARCH_DEBOUNCE_MS = 300;

export const durationRanges: Record<DurationRange, { label: string; min?: number; max?: number }> = {
  short: { label: "Under 15 min", max: 15 },
  medium: { label: "15–30 min", min: 15, max: 30 },
  long: { label: "30+ min", min: 30 },
};
export const equipmentFilters = [
  { value: "none", label: "No equipment", icon: "body-outline" },
  { value: "dumbbell", label: "Dumbbell", icon: "barbell-outline" },
  { value: "kettlebell", label: "Kettlebell", icon: "barbell-outline" },
  { value: "resistance band", label: "Band", icon: "barbell-outline" },
] as const;
export const platformFilters = ["youtube", "tiktok", "instagram", "web"] as const;

const platforms: Record<string, { label: string; icon: "logo-youtube" | "logo-tiktok" | "logo-instagram" | "logo-facebook" | "globe-outline" }> = {
  youtube: { label: "YouTube", icon: "logo-youtube" },
  tiktok: { label: "TikTok", icon: "logo-tiktok" },
  instagram: { label: "Instagram", icon: "logo-instagram" },
  facebook: { label: "Facebook", icon: "logo-facebook" },
  web: { label: "Web", icon: "globe-outline" },
};
export function platformInfo(platform: string | null | undefined) {
  if (!platform) return { label: "Håfa member", icon: "person-circle-outline" as const };
  return platforms[platform] ?? { label: platform.charAt(0).toUpperCase() + platform.slice(1), icon: "globe-outline" as const };
}

/** Query string for GET /discover. Empty filters are omitted; search is trimmed and capped at the API's 100 chars. */
export function discoverQuery(filters: DiscoverFilters, offset = 0, limit = DISCOVER_PAGE_SIZE) {
  const params = new URLSearchParams();
  const q = filters.q?.trim().slice(0, 100);
  if (q) params.set("q", q);
  const equipment = filters.equipment?.trim();
  if (equipment) params.set("equipment", equipment);
  if (filters.platform) params.set("platform", filters.platform);
  const range = filters.duration ? durationRanges[filters.duration] : undefined;
  if (range?.min != null) params.set("min_minutes", String(range.min));
  if (range?.max != null) params.set("max_minutes", String(range.max));
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return params.toString();
}

/** Normalised filters so equivalent searches share one cache entry. */
export function normalizeFilters(filters: DiscoverFilters): DiscoverFilters {
  const out: DiscoverFilters = {};
  const q = filters.q?.trim().slice(0, 100);
  if (q) out.q = q;
  if (filters.equipment?.trim()) out.equipment = filters.equipment.trim().toLowerCase();
  if (filters.platform) out.platform = filters.platform;
  if (filters.duration) out.duration = filters.duration;
  return out;
}

/**
 * Query keys. Everything is owner-scoped (the root layout drops a previous
 * owner's queries on account change) and generation-scoped, because
 * `saved_workout_id` points at a copy in the current Workouts generation.
 */
export const discoverKeys = {
  all: (owner: string) => [owner, "discover"] as const,
  feed: (owner: string, generation: number | null | undefined, filters: DiscoverFilters) =>
    [owner, "discover", "feed", generation ?? null, normalizeFilters(filters)] as const,
  detail: (owner: string, generation: number | null | undefined, id: string) =>
    [owner, "discover", "detail", generation ?? null, id] as const,
};

/** Next offset for useInfiniteQuery, or undefined at the end. */
export function nextDiscoverOffset(page: DiscoverPage) {
  // Advance by the requested page size: the server can drop unreadable rows from
  // a page, so items.length may be short (or zero) while has_more stays true.
  return page.has_more ? page.offset + Math.max(page.limit, 1) : undefined;
}

/** Feed pages can shift while scrolling (new publications); never render the same card twice. */
export function uniqueCards(pages: DiscoverPage[] | undefined) {
  return [...new Map((pages ?? []).flatMap((page) => page.items).map((item) => [item.id, item])).values()];
}

/** Discover is unavailable when the server says so, or every Discover route answers 503 (migration 045 pending). */
export function discoverUnavailable(capabilities: { discover?: boolean } | undefined, error?: unknown) {
  if (capabilities && capabilities.discover !== true) return true;
  return (error as { status?: number } | null | undefined)?.status === 503;
}

/** Recipes' rule: link imports default to public, photo/text/document/manual imports to private. */
export function defaultShareToDiscover(captureKind: string | null | undefined) {
  return captureKind === "url";
}

/** Server rule: every block has exercises and every exercise has reps, time or distance. */
export function publishable(workout: Pick<AuthoredWorkout, "blocks">) {
  return (
    workout.blocks.length > 0 &&
    workout.blocks.every(
      (block) =>
        block.exercises.length > 0 &&
        block.exercises.every((e) => e.reps_min != null || e.reps_max != null || e.duration_seconds != null || e.distance_meters != null)
    )
  );
}

export const INCOMPLETE_MESSAGE = "Add the missing details before sharing. Every exercise needs reps, time or distance.";
export const UNAVAILABLE_MESSAGE = "Discover is getting ready. Your library isn’t affected.";

export function isDisclosureRequired(error: unknown) {
  const e = error as { status?: number; detail?: string } | null | undefined;
  return e?.status === 409 && /publishing disclosure/i.test(e.detail ?? "");
}
export function isIncomplete(error: unknown) {
  return (error as { status?: number } | null | undefined)?.status === 422;
}

export const DECLINED = Symbol("declined");
/**
 * Runs a publishing write. If the server asks for the shared publishing
 * disclosure (409), checks the current version, asks the person, records their
 * acceptance and retries once. Returns DECLINED when they keep it private.
 */
export async function withPublishingDisclosure<T>(
  attempt: () => Promise<T>,
  deps: {
    status(): Promise<PublishingDisclosureStatus>;
    accept(version: number): Promise<PublishingDisclosureStatus>;
    ask(): Promise<boolean>;
  }
): Promise<T | typeof DECLINED> {
  try {
    return await attempt();
  } catch (error) {
    if (!isDisclosureRequired(error)) throw error;
  }
  const status = await deps.status();
  if (status.requires_acceptance) {
    if (!(await deps.ask())) return DECLINED;
    await deps.accept(status.current_version);
  }
  return attempt();
}

export const PUBLISHING_DISCLOSURE_TITLE = "Before you share to Discover";
export const PUBLISHING_DISCLOSURE_POINTS = [
  "People using Håfa Workouts can find, open and save this workout.",
  "They see the title, blocks and exercises with sets, reps, time and rest, the equipment, the source link and creator credit, and your contributor name.",
  "Workout instructions are included. Private notes, effort, training history, profile and health data stay private.",
  "You can remove it from Discover at any time. Copies people already saved stay in their libraries.",
  "This is the same sharing agreement as Håfa Recipes, so it also covers recipes you choose to make public.",
];

/** "3 × 10–12 reps · 45s rest" style summary for one exercise. */
export function prescriptionLine(e: ExercisePrescription) {
  const parts: string[] = [];
  const reps =
    e.reps_min != null
      ? e.reps_max != null && e.reps_max !== e.reps_min
        ? `${e.reps_min}–${e.reps_max} reps`
        : `${e.reps_min} reps`
      : e.reps_max != null
        ? `up to ${e.reps_max} reps`
        : null;
  const targets = [
    reps,
    e.duration_seconds != null ? formatSeconds(e.duration_seconds) : null,
    e.distance_meters != null ? `${e.distance_meters} m` : null,
  ].filter((target): target is string => target != null);
  if (e.sets != null && targets.length) parts.push(`${e.sets} × ${targets[0]}`);
  else if (e.sets != null) parts.push(`${e.sets} sets`);
  else if (targets.length) parts.push(targets[0]);
  parts.push(...targets.slice(1));
  if (e.per_side) parts.push("each side");
  if (e.rest_seconds != null) parts.push(`${formatSeconds(e.rest_seconds)} rest`);
  if (e.load != null) {
    const convention = { total: "total", per_hand: "per hand", added: "added", assistance: "assistance" };
    parts.push(`${e.provenance === "source" ? "Source load" : "Load"}: ${e.load} ${e.load_unit ?? "unit unspecified"}${e.load_convention ? ` ${convention[e.load_convention]}` : " · convention unspecified"}`);
  }
  if (e.tempo) parts.push(`Tempo ${e.tempo}`);
  if (e.effort) parts.push(e.effort);
  return parts.join(" · ") || "Details not specified";
}
export function formatSeconds(seconds: number) {
  if (seconds < 60 || seconds % 60) return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  return `${seconds / 60} min`;
}

/** Card meta line: minutes · exercises · contributor. */
export function cardMeta(card: Pick<DiscoverCard, "estimated_minutes" | "exercise_count" | "contributor" | "is_owner">) {
  return [
    card.estimated_minutes ? `${card.estimated_minutes} min` : null,
    `${card.exercise_count} ${card.exercise_count === 1 ? "exercise" : "exercises"}`,
    card.is_owner ? "Shared by you" : `Shared by ${card.contributor.display_name}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
export function creatorCredit(card: Pick<DiscoverCard, "source_creator" | "source_platform">) {
  const platform = card.source_platform ? platformInfo(card.source_platform).label : null;
  if (card.source_creator && platform) return `${card.source_creator} on ${platform}`;
  return card.source_creator ?? (platform ? `From ${platform}` : null);
}
export function equipmentChips(card: Pick<DiscoverCard, "equipment_required">) {
  return card.equipment_required.length ? card.equipment_required : ["No equipment"];
}

/** One short byline for a grid card: the original creator when known, else who shared it. */
export function gridByline(card: Pick<DiscoverCard, "source_creator" | "contributor" | "is_owner">) {
  if (card.is_owner) return "Shared by you";
  return card.source_creator?.trim() || `by ${card.contributor.display_name}`;
}

export type DiscoverFilterKey = "duration" | "equipment" | "platform";
/** Active sheet filters (search excluded) as removable labels, in sheet order. */
export function activeFilters(filters: DiscoverFilters): { key: DiscoverFilterKey; label: string }[] {
  const active: { key: DiscoverFilterKey; label: string }[] = [];
  if (filters.duration) active.push({ key: "duration", label: durationRanges[filters.duration].label });
  const equipment = equipmentFilters.find((item) => item.value === filters.equipment);
  if (filters.equipment) active.push({ key: "equipment", label: equipment?.label ?? filters.equipment });
  if (filters.platform) active.push({ key: "platform", label: platformInfo(filters.platform).label });
  return active;
}

export type DiscoverView = "grid" | "list";
/** Device-only, per-account layout preference. */
export function discoverViewKey(owner: string) {
  return `hafa-workouts:v1:${encodeURIComponent(owner)}:discover-view`;
}
export function parseDiscoverView(value: string | null | undefined): DiscoverView {
  return value === "list" ? "list" : "grid";
}
