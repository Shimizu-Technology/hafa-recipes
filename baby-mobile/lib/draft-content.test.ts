import { expect, it } from "vitest";
import { keepDraft } from "./draft-content";
import type { EditorDraft } from "./models";
const empty: EditorDraft = { id: "draft", kind: "source", title: "", body: "", child_id: null,
  occurred_at: "2026-10-21T00:00:00Z", data: { topics: [], status: "saved" }, files: [] };
it("does not turn an untouched or cleared composer into a task", () => {
  expect(keepDraft(empty)).toBe(false);
  expect(keepDraft({ ...empty, body: " \n " }, true)).toBe(false);
  expect(keepDraft({ ...empty, kind: "feeding", data: { method: "breast", side: "both" } })).toBe(false);
});
it("keeps actual content, files and deliberately changed care entries", () => {
  expect(keepDraft({ ...empty, data: { url: "https://example.test/post" } })).toBe(true);
  expect(keepDraft({ ...empty, kind: "journal", body: "One thing from today" })).toBe(true);
  expect(keepDraft({ ...empty, kind: "collection", data: { record_ids: ["old-source"] } })).toBe(true);
  expect(keepDraft({ ...empty, kind: "sleep" }, true)).toBe(true);
});
