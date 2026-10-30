import { expect, it } from "vitest";
import { optimisticRecord } from "./models";
import { sharedSourceTitle, shortSourceTitle, sourceTitle } from "./source-title";
const text = "Pack the diaper bag before leaving home. Restock after each outing so tomorrow is easier.";
const row = optimisticRecord({ id: "source", kind: "source", title: "Saved source", body: "", child_id: null,
  occurred_at: "2026-10-30T00:00:00Z", data: { source_text: text } });
it("uses the first complete sentence and truncates long sentences at a word boundary", () => {
  expect(shortSourceTitle(text)).toBe("Pack the diaper bag before leaving home.");
  const title = shortSourceTitle("Pack clean diapers and a spare outfit in the diaper bag before leaving the house tomorrow morning");
  expect(Array.from(title).length).toBeLessThanOrEqual(60);
  expect(title).toBe("Pack clean diapers and a spare outfit in the diaper bag…");
  expect(shortSourceTitle("x".repeat(100))).toBe("Saved source");
  expect(shortSourceTitle("")).toBe("Saved source");
});
it("counts emoji as characters without splitting a surrogate pair", () => {
  expect(shortSourceTitle("🌅 A sunset together. A longer second sentence.")).toBe("🌅 A sunset together.");
});
it("prefers processed and user-edited titles, with no mutation of saved data", () => {
  expect(sourceTitle(row)).toBe("Pack the diaper bag before leaving home.");
  expect(row.title).toBe("Saved source");
  expect(sourceTitle({ ...row, title: "Packing our bag", revision: 2 })).toBe("Packing our bag");
  expect(sourceTitle({ ...row, title: "My title with exactly the words I chose", revision: 3 })).toBe("My title with exactly the words I chose");
});
it("shortens an untouched native capture only for display and preserves its idempotent wire title", () => {
  const legacy = sharedSourceTitle(text);
  const capture = { ...row, title: legacy, revision: 1 };
  expect(sourceTitle(capture)).toBe("Pack the diaper bag before leaving home.");
  expect(capture.title).toBe(legacy);
  // The same bytes after an explicit edit belong to the user, even when long.
  expect(sourceTitle({ ...capture, revision: 2 })).toBe(legacy);
  expect(sharedSourceTitle("😀".repeat(110))).toHaveLength(200);
});
