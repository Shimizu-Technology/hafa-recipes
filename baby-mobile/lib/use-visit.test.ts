import { expect, it, vi } from "vitest";
import { optimisticRecord, type BabyRecord } from "./models";

vi.mock("expo-router", () => ({ useFocusEffect: () => undefined }));
vi.mock("./context", () => ({ useBaby: () => null }));
vi.mock("./use-care-summary", () => ({ useDeleted: () => new Set() }));
import { visitReads } from "./use-visit";

const row = (n: number, data: BabyRecord["data"], kind: BabyRecord["kind"] = "question"): BabyRecord => ({ ...optimisticRecord({ id: `r${n}`, kind, title: "R", body: "", child_id: null, occurred_at: "2020-01-01T00:00:00Z", data }), revision: 1 });

it("asks for one visit's records by its id, and never lists private journal entries to find them", async () => {
  const pages: Record<string, unknown>[] = [],
    read = vi.fn(async (filters: Record<string, unknown>) => { pages.push(filters); return { items: [], total: 0, has_more: false }; });
  for (const { filters } of visitReads("visit", true)) await read({ ...filters });
  expect(pages).toEqual([{ kinds: ["question", "journal"], event_id: "visit" }, { kind: "question" }]);
  expect(visitReads("visit", false).map((item) => item.filters)).toEqual([{ kinds: ["question"], event_id: "visit" }]);
  expect(pages.some((filters) => filters.kind === "journal" && !filters.event_id)).toBe(false);
});
it("reaches records older than any fixed number of pages", async () => {
  const all = Array.from({ length: 640 }, (_, n) => row(n, { event_id: "visit" })),
    read = vi.fn(async ({ limit, offset = 0 }: { limit: number; offset?: number }) => ({ items: all.slice(offset, offset + limit), total: all.length, has_more: offset + limit < all.length })),
    { allPages } = await import("./use-events");
  expect(await allPages(read)).toHaveLength(640);
});
it("tells what each read is the whole of", () => {
  const [linked, questions] = visitReads("visit", true);
  expect(linked.belongs(row(1, { event_id: "visit" }, "journal"))).toBe(true);
  expect(linked.belongs(row(2, {}, "journal"))).toBe(false);
  expect(linked.belongs(row(3, { event_id: "visit" }, "event"))).toBe(false);
  expect(questions.belongs(row(4, {}))).toBe(true);
  expect(questions.belongs(row(5, {}, "journal"))).toBe(false);
});
