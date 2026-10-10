import { it, expect } from "vitest";
import { captureErrors, boundedSource, importIsTerminal, type CaptureDraft } from "./capture";
import { filterLibrary, workoutErrors, editedContent } from "./library";
import { isISODate, publicShareReader } from "./sharing";
const draft: CaptureDraft = {
  request_id: "owned-request",
  generation: 3,
  kind: "url",
  source_url: "https://example.test/workout",
  text: "",
  files: [],
  created_at: "2026-10-10T00:00:00Z",
};
it("rejects credentialed/non-web sources and preserves optional captions", () => {
  expect(captureErrors(draft)).toEqual([]);
  expect(captureErrors({ ...draft, source_url: "https://private:secret@example.test/workout" })).toHaveLength(1);
  expect(captureErrors({ ...draft, source_url: "file:///private/workout" })).toHaveLength(1);
  expect(
    boundedSource({ kind: "url", source_url: draft.source_url, text: "Three rounds, each side", ai_consent: true }).text
  ).toBe("Three rounds, each side");
});
it("bounds image counts and source payload bytes without inventing missing prescriptions", () => {
  expect(captureErrors({ ...draft, kind: "images", files: [] })).toHaveLength(1);
  expect(captureErrors({ ...draft, kind: "text", text: "x".repeat(30001) })).toHaveLength(1);
  expect(() => boundedSource({ kind: "text", text: "x".repeat(4 * 1024 * 1024), ai_consent: true })).toThrow(
    "too large"
  );
  expect(importIsTerminal("incomplete")).toBe(true);
  expect(importIsTerminal("processing")).toBe(false);
});
it("treats user edits as authored versions and rejects reversed rep ranges", () => {
  const content = {
    title: "Dumbbell session",
    kind: "session" as const,
    provenance: "suggestion" as const,
    equipment_required: ["dumbbells"],
    blocks: [
      {
        id: "main",
        label: "Main",
        grouping: "sequential" as const,
        exercises: [{ name: "Row", provenance: "suggestion" as const, reps_min: 10, reps_max: 8 }],
      },
    ],
  };
  const edited = editedContent(content);
  expect(edited.provenance).toBe("user");
  expect(edited.blocks[0].exercises[0].provenance).toBe("user");
  expect(content.provenance).toBe("suggestion");
  expect(workoutErrors(edited)).toContain("Row: minimum reps cannot exceed maximum reps.");
  expect(
    filterLibrary([{ ...edited, id: "owned", revision: 1, generation: 3 }], "row", "dumbbells", "session")
  ).toHaveLength(1);
});
it("rejects rollover calendar dates for recipient program copies", () => {
  expect(isISODate("2026-02-31")).toBe(false);
  expect(isISODate("2026-10-10")).toBe(true);
});
it("loads only the explicit public sharing route without private authorization", async () => {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const read = publicShareReader("https://api.example.test", async (url, options) => {
    calls.push([String(url), options]);
    return new Response(JSON.stringify({ id: "public-snapshot" }));
  });
  await expect(read("invalid")).rejects.toThrow("invalid");
  expect(calls).toHaveLength(0);
  const token = "a".repeat(43);
  await read(token);
  expect(calls[0][0]).toBe(`https://api.example.test/api/v1/workouts/shared/${token}`);
  expect(calls[0][1]?.headers).toBeUndefined();
});
