import { describe, it, expect, vi } from "vitest";
import { createWorkoutsApi, authoredWorkout } from "./api";
import {
  libraryQuery,
  addWorkoutsToCollection,
  type OrganizationWrite,
  tagsFromText,
  emptyOrganization,
  organizationErrors,
  collectionTitleError,
  workoutDeletionBlock,
} from "./organization";
import type { Workout } from "./models";
import type { TrainingState } from "./training";
describe("private library organization", () => {
  it("protects active and unsynced direct sessions without blocking independent plan snapshots", () => {
    const state: TrainingState = { version: 1, generation: 1, active: null, history: [] };
    expect(workoutDeletionBlock("owned", state, false)).toContain("loading");
    expect(workoutDeletionBlock("owned", state, true)).toBeNull();
    const history = { request: { workout_id: "owned" }, state: "queued" } as TrainingState["history"][number];
    state.history.push(history);
    expect(workoutDeletionBlock("owned", state, true)).toContain("pending results");
    history.state = "blocked";
    expect(workoutDeletionBlock("owned", state, true)).toContain("pending results");
    history.state = "synced";
    expect(workoutDeletionBlock("owned", state, true)).toBeNull();
    state.active = { source: { workout_id: "owned", workout_revision: 1 } } as TrainingState["active"];
    expect(workoutDeletionBlock("owned", state, true)).toContain("active session");
    state.active = { source: { program_id: "plan", program_revision: 1, program_session_id: "day" } } as TrainingState["active"];
    expect(workoutDeletionBlock("owned", state, true)).toBeNull();
  });
  it("deletes with the captured owner and generation", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const api = createWorkoutsApi("https://example.test", async () => "token", transport, { owner: "stable", binding: "a", currentBinding: () => "a" });
    await api.deleteWorkout("owned", 2);
    expect(transport.mock.calls[0][0]).toContain("/library/owned");
    expect(transport.mock.calls[0][1]).toMatchObject({ method: "DELETE", headers: { "X-Workouts-Generation": "2", "X-Hafa-Account-ID": "stable" } });
  });
  it("encodes repeated tag filters and cursor without leaking private values into paths", () => {
    const query = new URLSearchParams(
      libraryQuery({ q: "Running & strength", tags: ["Gym days", "Basketball"], archived_only: true }, "saved cursor")
    );
    expect(query.get("q")).toBe("Running & strength");
    expect(query.getAll("tags")).toEqual(["Gym days", "Basketball"]);
    expect(query.get("cursor")).toBe("saved cursor");
    expect(query.get("archived_only")).toBe("true");
  });
  it("normalizes labels without changing case display and refuses unsupported bounds", () => {
    expect(tagsFromText(" Gym, gym, Basketball , ,basketball")).toEqual(["Gym", "Basketball"]);
    expect(organizationErrors(["x".repeat(41)], [])).toHaveLength(1);
    expect(collectionTitleError("  Gym  ")).toBeNull();
    expect(collectionTitleError("")).toBeTruthy();
    expect(() => libraryQuery({ q: "x".repeat(101) })).toThrow("100 characters");
  });
  it("keeps organization metadata out of authored prescription changes", () => {
    const workout = {
      id: "owned",
      revision: 1,
      generation: 2,
      title: "Workout",
      kind: "session",
      provenance: "user",
      blocks: [],
      organization: emptyOrganization(),
    } as Workout;
    expect(authoredWorkout(workout)).not.toHaveProperty("organization");
  });
  it("uses captured enrollment generation for organization reads and original independent revision for writes", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(emptyOrganization())))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...emptyOrganization(), revision: 2, favorite: true })));
    const api = createWorkoutsApi("https://example.test", async () => "token", transport, {
      owner: "stable",
      binding: "a",
      currentBinding: () => "a",
    });
    await api.organization("owned", 2);
    await api.saveOrganization("owned", { expected_revision: 1, favorite: true }, 2);
    expect(transport.mock.calls[0][1].headers["X-Workouts-Generation"]).toBe("2");
    expect(JSON.parse(transport.mock.calls[1][1].body)).toEqual({ expected_revision: 1, favorite: true });
    expect(transport.mock.calls[1][1].headers["X-Hafa-Account-ID"]).toBe("stable");
  });
  it("maps paginated record metadata while retaining prescription and organization revisions separately", async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "owned",
                generation: 2,
                revision: 4,
                content: { title: "Session", kind: "session", provenance: "user", blocks: [] },
                organization: { ...emptyOrganization(), revision: 7 },
              },
            ],
            total: 1,
            limit: 30,
            offset: 0,
            has_more: false,
            next_cursor: null,
          })
        )
      );
    const api = createWorkoutsApi("https://example.test", async () => "token", transport);
    const page = await api.searchLibrary({ favorite_only: true }, null, 2);
    expect(page.items[0].revision).toBe(4);
    expect(page.items[0].organization?.revision).toBe(7);
    expect(transport.mock.calls[0][0]).toContain("/library/search?limit=30&favorite_only=true");
  });
});

it("bulk collection adds merge current memberships and patch no other private choices", async () => {
  const original = { ...emptyOrganization(), revision: 7, favorite: true, archived: true, tags: ["Private"], collection_ids: ["existing"] };
  const api = { organization: vi.fn(async () => original), saveOrganization: vi.fn(async () => ({ ...original, revision: 8, collection_ids: ["existing", "new"] })) };
  expect(await addWorkoutsToCollection(["a", "a"], "new", 3, api, () => undefined)).toEqual({ added: ["a"], failed: [] });
  expect(api.organization).toHaveBeenCalledWith("a", 3);
  expect(api.saveOrganization).toHaveBeenCalledExactlyOnceWith("a", { expected_revision: 7, collection_ids: ["existing", "new"] }, 3);
  expect(original.collection_ids).toEqual(["existing"]);
});
it("bulk retry reconciles accepted-but-unacknowledged memberships and does not replay successful items", async () => {
  const rows = new Map(["a", "b"].map(id => [id, { ...emptyOrganization(), revision: 1 }]));
  const api = { organization: vi.fn(async (id: string) => rows.get(id)!), saveOrganization: vi.fn(async (id: string, body: OrganizationWrite) => {
    const saved = { ...rows.get(id)!, revision: 2, collection_ids: body.collection_ids ?? rows.get(id)!.collection_ids }; rows.set(id, saved);
    if (id === "b") throw Error("Acknowledgment lost"); return saved;
  }) };
  const first = await addWorkoutsToCollection(["a", "b"], "new", 1, api, () => undefined);
  expect(first.added).toEqual(["a"]); expect(first.failed).toEqual([{ id: "b", message: "Acknowledgment lost" }]);
  expect(await addWorkoutsToCollection(first.failed.map(item => item.id), "new", 1, api, () => undefined)).toEqual({ added: ["b"], failed: [] });
  expect(api.saveOrganization).toHaveBeenCalledTimes(2);
  expect(api.organization.mock.calls.map(([id]) => id)).toEqual(["a", "b", "b"]);
});
it("bulk additions stop before writing or advancing when their account generation retires", async () => {
  let current = true;
  const api = { organization: vi.fn(async () => { current = false; return emptyOrganization(); }), saveOrganization: vi.fn() };
  await expect(addWorkoutsToCollection(["a", "b"], "new", 2, api, () => { if (!current) throw Error("Retired generation"); })).rejects.toThrow("Retired generation");
  expect(api.organization).toHaveBeenCalledTimes(1); expect(api.saveOrganization).not.toHaveBeenCalled();
});
it("keeps a full collection membership failure retryable without dropping its existing collections", async () => {
  const api = { organization: vi.fn(async () => ({ ...emptyOrganization(), collection_ids: Array.from({ length: 20 }, (_, i) => String(i)) })), saveOrganization: vi.fn() };
  const result = await addWorkoutsToCollection(["a"], "new", 1, api, () => undefined);
  expect(result.failed[0].message).toContain("20 collections"); expect(api.saveOrganization).not.toHaveBeenCalled();
});
