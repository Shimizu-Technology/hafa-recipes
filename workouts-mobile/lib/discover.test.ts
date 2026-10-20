import { describe, expect, it, vi } from "vitest";
import { ApiError, authoredWorkout, createWorkoutsApi } from "./api";
import {
  DECLINED,
  activeFilters,
  cardMeta,
  contributorChip,
  creatorCredit,
  defaultShareToDiscover,
  discoverKeys,
  discoverFilterQuery,
  discoverQuery,
  discoverUnavailable,
  discoverViewKey,
  gridByline,
  isDisclosureRequired,
  parseDiscoverView,
  nextDiscoverOffset,
  prescriptionLine,
  publishable,
  uniqueCards,
  withPublishingDisclosure,
  type DiscoverCard,
  type DiscoverPage,
} from "./discover";
import type { Workout } from "./models";

const card: DiscoverCard = {
  id: "a", title: "Legs", kind: "session", estimated_minutes: 10, equipment_required: [], equipment_optional: [],
  block_count: 1, exercise_count: 1, source_url: null, source_platform: "tiktok", source_creator: "Coach Nani",
  thumbnail_url: null, published_at: null, contributor: { contributor_id: "c", display_name: "Leon" }, is_owner: false,
  saved_workout_id: null,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("discover query mapping", () => {
  it("maps filters to the API's parameters and omits empty ones", () => {
    expect(discoverQuery({})).toBe("limit=20&offset=0");
    expect(
      Object.fromEntries(new URLSearchParams(discoverQuery({ q: "  squat ", equipment: "none", platform: "youtube", duration: "medium" }, 40)))
    ).toEqual({ q: "squat", equipment: "none", platform: "youtube", min_minutes: "15", max_minutes: "30", limit: "20", offset: "40" });
    expect(new URLSearchParams(discoverQuery({ duration: "short" })).get("max_minutes")).toBe("15");
    expect(new URLSearchParams(discoverQuery({ duration: "short" })).has("min_minutes")).toBe(false);
    expect(new URLSearchParams(discoverQuery({ duration: "long" })).get("min_minutes")).toBe("30");
    expect(new URLSearchParams(discoverQuery({ q: "x".repeat(150) })).get("q")).toHaveLength(100);
  });
  it("gives equivalent searches one cache key, scoped to the owner", () => {
    expect(discoverKeys.feed("me", 1, { q: " legs ", equipment: "Dumbbell" })).toEqual(
      discoverKeys.feed("me", 1, { q: "legs", equipment: "dumbbell", platform: undefined })
    );
    expect(discoverKeys.feed("me", 1, {})).not.toEqual(discoverKeys.feed("you", 1, {}));
    // saved_workout_id belongs to a generation; a data reset must not reuse cached copies.
    expect(discoverKeys.feed("me", 1, {})).not.toEqual(discoverKeys.feed("me", 2, {}));
    expect(discoverKeys.detail("me", 1, "a")).not.toEqual(discoverKeys.detail("me", 2, "a"));
    expect(discoverKeys.feed("me", 1, {}).slice(0, 2)).toEqual(discoverKeys.all("me"));
    expect(discoverKeys.detail("me", 1, "a").slice(0, 2)).toEqual(discoverKeys.all("me"));
  });
  it("pages by offset and never shows a card twice", () => {
    const first: DiscoverPage = { items: [card, { ...card, id: "b" }], total: 3, limit: 2, offset: 0, has_more: true };
    const last: DiscoverPage = { items: [{ ...card, id: "b" }], total: 3, limit: 2, offset: 2, has_more: false };
    expect(nextDiscoverOffset(first)).toBe(2);
    expect(nextDiscoverOffset(last)).toBeUndefined();
    // The server can drop unreadable rows; the offset must still advance past them.
    expect(nextDiscoverOffset({ items: [], total: 60, limit: 20, offset: 20, has_more: true })).toBe(40);
    expect(uniqueCards([first, last]).map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("discover rules", () => {
  it("is unavailable when the capability is false or missing, or a route answers 503", () => {
    expect(discoverUnavailable({ discover: false })).toBe(true);
    expect(discoverUnavailable({})).toBe(true);
    expect(discoverUnavailable({ discover: true })).toBe(false);
    expect(discoverUnavailable({ discover: true }, new ApiError("x", 503))).toBe(true);
    expect(discoverUnavailable({ discover: true }, new ApiError("x", 500))).toBe(false);
    expect(discoverUnavailable(undefined)).toBe(false);
  });
  it("defaults link imports to public and everything else to private", () => {
    expect(defaultShareToDiscover("url")).toBe(true);
    for (const kind of ["images", "text", "document", "shared", undefined, null]) expect(defaultShareToDiscover(kind)).toBe(false);
  });
  it("matches the server's completeness rule", () => {
    const block = (exercises: Workout["blocks"][number]["exercises"]) => ({ id: "b", label: "B", grouping: "sequential" as const, exercises });
    expect(publishable({ blocks: [] })).toBe(false);
    expect(publishable({ blocks: [block([])] })).toBe(false);
    expect(publishable({ blocks: [block([{ name: "Squat", sets: 3 }])] })).toBe(false);
    expect(publishable({ blocks: [block([{ name: "Squat", reps_min: 5 }, { name: "Plank", duration_seconds: 30 }, { name: "Run", distance_meters: 400 }])] })).toBe(true);
  });
  it("only treats the publishing disclosure 409 as a disclosure request", () => {
    expect(isDisclosureRequired(new ApiError("x", 409, false, "Accept the current publishing disclosure before sharing recipes"))).toBe(true);
    expect(isDisclosureRequired(new ApiError("x", 409, false, "Import already accepted with different content"))).toBe(false);
    expect(isDisclosureRequired(new ApiError("x", 409))).toBe(false);
    expect(isDisclosureRequired(new ApiError("x", 422, false, "publishing disclosure"))).toBe(false);
  });
  it("formats prescriptions, credits and card meta", () => {
    expect(prescriptionLine({ name: "Squat", sets: 3, reps_min: 10, reps_max: 12, rest_seconds: 45 })).toBe("3 × 10–12 reps · 45s rest");
    expect(prescriptionLine({ name: "Plank", sets: 2, duration_seconds: 60, rest_seconds: 90 })).toBe("2 × 1 min · 1m 30s rest");
    expect(prescriptionLine({ name: "Lunge", reps_min: 8, per_side: true })).toBe("8 reps · each side");
    expect(prescriptionLine({ name: "Mystery" })).toBe("Details not specified");
    expect(prescriptionLine({ name: "Run", sets: 3, duration_seconds: 90, distance_meters: 400 })).toBe("3 × 1m 30s · 400 m");
    expect(prescriptionLine({ name: "Run", distance_meters: 1200 })).toBe("1200 m");
    expect(prescriptionLine({ name: "Squat", provenance: "source", reps_min: 5, load: 20, load_unit: "kg", load_convention: "per_hand", tempo: "3-1-1", effort: "Comfortable" })).toBe("5 reps · Source load: 20 kg per hand · Tempo 3-1-1 · Comfortable");
    expect(prescriptionLine({ name: "Unknown load", load: 10 })).toBe("Load: 10 unit unspecified · convention unspecified");
    expect(prescriptionLine({ name: "Distance", reps_max: 8, duration_seconds: 60, distance_meters: 100, rest_seconds: 0 })).toBe("up to 8 reps · 1 min · 100 m · 0s rest");
    expect(creatorCredit(card)).toBe("Coach Nani on TikTok");
    expect(creatorCredit({ source_creator: null, source_platform: "youtube" })).toBe("From YouTube");
    expect(creatorCredit({ source_creator: null, source_platform: null })).toBeNull();
    expect(cardMeta(card)).toBe("10 min · 1 exercise · Shared by Leon");
    expect(cardMeta({ ...card, is_owner: true, estimated_minutes: null, exercise_count: 4 })).toBe("4 exercises · Shared by you");
  });
});

describe("publishing disclosure retry", () => {
  const required = new ApiError("conflict", 409, false, "Accept the current publishing disclosure before sharing recipes");
  const pending = { current_version: 2, accepted_version: 1, requires_acceptance: true };
  it("asks, records the current version and retries once", async () => {
    const attempt = vi.fn().mockRejectedValueOnce(required).mockResolvedValueOnce("published");
    const accept = vi.fn().mockResolvedValue({ ...pending, accepted_version: 2, requires_acceptance: false });
    const ask = vi.fn().mockResolvedValue(true);
    await expect(withPublishingDisclosure(attempt, { status: async () => pending, accept, ask })).resolves.toBe("published");
    expect(ask).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith(2);
    expect(attempt).toHaveBeenCalledTimes(2);
  });
  it("returns DECLINED without recording or retrying when the person keeps it private", async () => {
    const attempt = vi.fn().mockRejectedValue(required);
    const accept = vi.fn();
    await expect(
      withPublishingDisclosure(attempt, { status: async () => pending, accept, ask: async () => false })
    ).resolves.toBe(DECLINED);
    expect(accept).not.toHaveBeenCalled();
    expect(attempt).toHaveBeenCalledTimes(1);
  });
  it("retries without asking when acceptance landed elsewhere meanwhile", async () => {
    const attempt = vi.fn().mockRejectedValueOnce(required).mockResolvedValueOnce("ok");
    const ask = vi.fn();
    await withPublishingDisclosure(attempt, {
      status: async () => ({ ...pending, requires_acceptance: false }),
      accept: vi.fn(),
      ask,
    });
    expect(ask).not.toHaveBeenCalled();
    expect(attempt).toHaveBeenCalledTimes(2);
  });
  it("rethrows other errors untouched and never loops", async () => {
    const incomplete = new ApiError("x", 422);
    const ask = vi.fn();
    await expect(withPublishingDisclosure(() => Promise.reject(incomplete), { status: vi.fn(), accept: vi.fn(), ask })).rejects.toBe(incomplete);
    expect(ask).not.toHaveBeenCalled();
    const attempt = vi.fn().mockRejectedValue(required);
    await expect(
      withPublishingDisclosure(attempt, { status: async () => pending, accept: vi.fn().mockResolvedValue(pending), ask: async () => true })
    ).rejects.toBe(required);
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});

describe("discover API client", () => {
  function client(respond: (url: string, init: RequestInit) => Response) {
    const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => respond(String(url), init ?? {}));
    return { transport, api: createWorkoutsApi("https://example.test", async () => "token", transport) };
  }
  it("reads the feed and detail with the caller's abort signal", async () => {
    const { api, transport } = client(() => json({ items: [card], total: 1, limit: 20, offset: 0, has_more: false }));
    const controller = new AbortController();
    const result = await api.discover({ equipment: "none" }, 20, controller.signal);
    expect(result.items[0].id).toBe("a");
    expect(transport.mock.calls[0][0]).toBe("https://example.test/api/v1/workouts/discover?equipment=none&limit=20&offset=20");
    expect((transport.mock.calls[0][1] as RequestInit).method).toBe("GET");
    await api.discoverWorkout("a b");
    expect(transport.mock.calls[1][0]).toBe("https://example.test/api/v1/workouts/discover/a%20b");
    // A cancelled query (e.g. a superseded search) aborts the request it started.
    controller.abort();
    await expect(api.discover({ q: "old" }, 0, controller.signal)).rejects.toBeInstanceOf(ApiError);
    expect((transport.mock.calls[2][1] as RequestInit).signal?.aborted).toBe(true);
  });
  it("saves, reports, blocks, publishes and unpublishes on the documented routes", async () => {
    const record = { id: "copy", generation: 3, revision: 1, content: { title: "Legs", kind: "session", provenance: "user", blocks: [] },
      created_at: "", updated_at: "", publication: null };
    const publication = { is_public: true, moderation_status: "active", published_at: "2026-10-13T00:00:00Z", discover_visible: true };
    const { api, transport } = client((url) =>
      url.endsWith("/save") ? json(record, 201) : url.includes("publish") ? json(publication) : json({ id: "r", contributor_id: "c", display_name: "Leon" }, 201)
    );
    const saved = await api.saveDiscovered("pub", 3);
    expect(saved).toMatchObject({ id: "copy", generation: 3, revision: 1, title: "Legs", publication: null });
    await api.reportDiscovered("pub", "spam", "  looks fake  ");
    await api.blockDiscoverContributor("pub");
    await expect(api.publishWorkout("w", 3)).resolves.toEqual(publication);
    await api.unpublishWorkout("w", 3);
    const calls = transport.mock.calls.map(([url, init]) => [String(url).replace("https://example.test/api/v1/workouts", ""), (init as RequestInit).method]);
    expect(calls).toEqual([
      ["/discover/pub/save", "POST"],
      ["/discover/pub/report", "POST"],
      ["/discover/pub/block", "POST"],
      ["/library/w/publish", "POST"],
      ["/library/w/unpublish", "POST"],
    ]);
    const headers = (i: number) => (transport.mock.calls[i][1] as { headers: Record<string, string> }).headers;
    expect(headers(0)["X-Workouts-Generation"]).toBe("3");
    expect(headers(3)["X-Workouts-Generation"]).toBe("3");
    expect(JSON.parse(String((transport.mock.calls[1][1] as RequestInit).body))).toEqual({ category: "spam", details: "looks fake" });
  });
  it("uses the shared account disclosure endpoint", async () => {
    const { api, transport } = client(() => json({ current_version: 1, accepted_version: 1, requires_acceptance: false }));
    await api.publishingDisclosure();
    await api.acceptPublishingDisclosure(1);
    expect(transport.mock.calls.map(([url]) => url)).toEqual([
      "https://example.test/api/users/me/publishing-disclosure",
      "https://example.test/api/users/me/publishing-disclosure",
    ]);
    expect(JSON.parse(String((transport.mock.calls[1][1] as RequestInit).body))).toEqual({ version: 1 });
  });
  it("sends is_public only when sharing an import", async () => {
    const record = { id: "w", generation: 1, revision: 1, content: { title: "Legs", kind: "session", provenance: "user", blocks: [] }, created_at: "", updated_at: "" };
    const { api, transport } = client(() => json(record));
    const workout = { title: "Legs", kind: "session" as const, provenance: "user" as const, blocks: [] };
    await api.acceptImport("job", workout, 1);
    await api.acceptImport("job", workout, 1, true);
    const body = (i: number) => JSON.parse(String((transport.mock.calls[i][1] as RequestInit).body));
    expect(body(0)).not.toHaveProperty("is_public");
    expect(body(1)).toMatchObject({ is_public: true, acknowledge_warnings: true });
  });
  it("keeps the server detail for classification but shows only the friendly message", async () => {
    const { api } = client(() => json({ detail: "Accept the current publishing disclosure before sharing recipes" }, 409));
    const error = (await api.publishWorkout("w", 1).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(isDisclosureRequired(error)).toBe(true);
    expect(error.message).not.toContain("disclosure");
    const plain = client(() => new Response("private diagnostic", { status: 409 }));
    const other = (await plain.api.publishWorkout("w", 1).catch((e: unknown) => e)) as ApiError;
    expect(other.detail).toBeUndefined();
  });
  it("maps owner publication state onto workouts and strips it from writes", async () => {
    const publication = { is_public: true, moderation_status: "active", published_at: null, discover_visible: true };
    const { api } = client(() => json({ id: "w", generation: 1, revision: 2, content: { title: "Legs", kind: "session", provenance: "user", blocks: [] }, created_at: "", updated_at: "", publication }));
    const workout = await api.workout("w");
    expect(workout.publication).toEqual(publication);
    expect(authoredWorkout(workout)).not.toHaveProperty("publication");
  });
});

describe("Discover browsing helpers", () => {
  const who = { source_creator: null, contributor: { contributor_id: "c1", display_name: "Leon" }, is_owner: false };
  it("bylines credit the original creator, then the person who shared it", () => {
    expect(gridByline({ ...who, source_creator: "Coach Nani" })).toBe("Coach Nani");
    expect(gridByline({ ...who, source_creator: "  " })).toBe("by Leon");
    expect(gridByline({ ...who, is_owner: true })).toBe("Shared by you");
  });
  it("lists active sheet filters in sheet order with readable labels", () => {
    expect(activeFilters({ q: "legs" })).toEqual([]);
    expect(activeFilters({ platform: "tiktok", equipment: "none", duration: "long" }).map((f) => f.label))
      .toEqual(["30+ min", "No equipment", "TikTok"]);
    expect(activeFilters({ equipment: "bench" })).toEqual([{ key: "equipment", label: "bench" }]);
  });
  it("defaults to the grid and keeps the layout key owner-scoped", () => {
    expect(parseDiscoverView(null)).toBe("grid");
    expect(parseDiscoverView("nonsense")).toBe("grid");
    expect(parseDiscoverView("list")).toBe("list");
    expect(discoverViewKey("user/1")).toBe("hafa-workouts:v1:user%2F1:discover-view");
  });
});

describe("Discover contributors and Surprise me", () => {
  it("passes one person's opaque id to the feed and the random pick", () => {
    expect(discoverQuery({ contributor: "chef_abc12345" }, 20)).toBe("contributor=chef_abc12345&limit=20&offset=20");
    expect(discoverFilterQuery({ q: " legs ", equipment: "none", contributor: "chef_abc12345", duration: "short" }))
      .toBe("q=legs&equipment=none&max_minutes=15&contributor=chef_abc12345");
    expect(discoverFilterQuery({})).toBe("");
  });
  it("labels people and the active person filter plainly", () => {
    expect(contributorChip({ contributor_id: "chef_a", display_name: "Leon", workout_count: 3, is_you: false })).toBe("Leon (3)");
    expect(contributorChip({ contributor_id: "chef_b", display_name: "Leon", workout_count: 1, is_you: true })).toBe("You (1)");
    expect(activeFilters({ contributor: "chef_a", duration: "long" }, "Leon").map((f) => f.label)).toEqual(["by Leon", "30+ min"]);
    expect(activeFilters({ contributor: "chef_a" })[0].label).toBe("by Håfa member");
  });
});
