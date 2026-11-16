import { describe, expect, it } from "vitest";
import type { BabyRecord } from "./models";
import { shareCategories } from "./share-categories";

const row = (id: string, kind: string, updated_at: string, space_id?: string) =>
  ({ id, kind, title: `T ${id}`, updated_at, space_id }) as unknown as BabyRecord;

describe("shareCategories", () => {
  it("offers only the session space's categories, most recently changed first, and a handful at most", () => {
    const rows = [row("a", "collection", "2026-11-01T00:00:00Z", "family"), row("b", "collection", "2026-11-03T00:00:00Z", "family"),
      row("c", "collection", "2026-11-04T00:00:00Z", "personal"), row("d", "source", "2026-11-05T00:00:00Z", "family")];
    expect(shareCategories(rows, "family")).toEqual([{ id: "b", title: "T b" }, { id: "a", title: "T a" }]);
    expect(shareCategories(rows).map((item) => item.id)).toEqual(["c", "b", "a"]);
    const many = Array.from({ length: 12 }, (_, index) => row(`x${index}`, "collection", `2026-11-${String(index + 1).padStart(2, "0")}T00:00:00Z`));
    expect(shareCategories(many)).toHaveLength(8);
    expect(shareCategories(many)[0].id).toBe("x11");
  });
});
