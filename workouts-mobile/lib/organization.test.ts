import { describe, it, expect, vi } from "vitest";
import { createWorkoutsApi, authoredWorkout } from "./api";
import {
  libraryQuery,
  tagsFromText,
  emptyOrganization,
  organizationErrors,
  collectionTitleError,
} from "./organization";
import type { Workout } from "./models";
describe("private library organization", () => {
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
