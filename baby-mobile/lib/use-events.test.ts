import { expect, it, vi } from "vitest";
import { optimisticRecord, type BabyRecord, type RecordPage } from "./models";

vi.mock("expo-router", () => ({ useFocusEffect: () => undefined }));
vi.mock("./context", () => ({ useBaby: () => null }));
vi.mock("./use-care-summary", () => ({ useDeleted: () => new Set() }));
import { allPages } from "./use-events";

const row = (n: number): BabyRecord => ({ ...optimisticRecord({ id: `e${n}`, kind: "event", title: "E", body: "", child_id: null, occurred_at: "2026-01-01T00:00:00Z", data: {} }), revision: 1 });

it("reads every page, however many there are, so an old repeat isn't missed", async () => {
  const all = Array.from({ length: 730 }, (_, n) => row(n)),
    read = vi.fn(async ({ limit, offset = 0 }: { limit: number; offset?: number }): Promise<RecordPage> => ({ items: all.slice(offset, offset + limit), total: all.length, has_more: offset + limit < all.length }));
  const found = await allPages(read);
  expect(found).toHaveLength(730);
  expect(found.at(-1)!.id).toBe("e729");
  expect(read).toHaveBeenCalledTimes(8);
});
it("counts a row once when a new one shifts the next page", async () => {
  const read = vi.fn<(page: { limit: number; offset?: number }) => Promise<RecordPage>>()
    .mockResolvedValueOnce({ items: [row(1), row(2)], total: 3, has_more: true })
    .mockResolvedValueOnce({ items: [row(2), row(3)], total: 3, has_more: false });
  expect((await allPages(read)).map((item) => item.id)).toEqual(["e1", "e2", "e3"]);
});
