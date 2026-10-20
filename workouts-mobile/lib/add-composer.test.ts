import { describe, expect, it } from "vitest";
import { importSettingsSummary, linkLooksComplete, recentImports } from "./add-composer";
import type { ImportJob } from "./capture";
import type { Workout } from "./models";

const workout = (id: string, extra: Partial<Workout> = {}): Workout => ({
  id, revision: 1, generation: 1, title: `Workout ${id}`, kind: "session", provenance: "source", blocks: [], ...extra,
});
const job = (id: string, accepted: string | null, extra: Partial<ImportJob> = {}) => ({
  id, generation: 1, status: "ready", attempt_count: 1, expires_at: "", accepted_workout_id: accepted,
  result: { status: "ready", workout: null, evidence: [], warnings: [], source: { platform: "web", channels: [], coverage_notes: [], title: "Server title", url: "https://www.tiktok.com/@coach/video/1" } },
  ...extra,
}) as ImportJob;

describe("linkLooksComplete", () => {
  it.each(["", "youtube", "https://", "https://youtube", "ftp://example.com/x", "https://user:pw@example.com/x"])("rejects %j", value => {
    expect(linkLooksComplete(value)).toBe(false);
  });
  it.each(["https://youtu.be/abc", " https://www.instagram.com/reel/x/ ", "http://example.test/workout"])("accepts %j", value => {
    expect(linkLooksComplete(value)).toBe(true);
  });
});

describe("importSettingsSummary", () => {
  it("summarises visibility only when Discover is available and notes only when they apply", () => {
    expect(importSettingsSummary({ discover: true, isPublic: true, notes: "", notesApply: true })).toBe("Public · No extra notes");
    expect(importSettingsSummary({ discover: true, isPublic: false, notes: "caption", notesApply: true })).toBe("Private · Extra notes added");
    expect(importSettingsSummary({ discover: false, isPublic: true, notes: " ", notesApply: true })).toBe("No extra notes");
    expect(importSettingsSummary({ discover: true, isPublic: false, notes: "", notesApply: false })).toBe("Private");
  });
});

describe("recentImports", () => {
  it("lists saved server imports first, then imported library workouts, without duplicates or manual workouts", () => {
    const library = [
      workout("w1", { capture_kind: "url", source_url: "https://www.youtube.com/watch?v=1" }),
      workout("manual", { provenance: "user" }),
      workout("from-friend", { capture_kind: "shared" }),
      workout("w2", { capture_kind: "images" }),
      workout("w3", { capture_kind: "url", source_creator: "Coach Ana" }),
    ];
    const jobs = [job("j-pending", null), job("j-new", "w-new"), job("j-1", "w1"), job("j-other-gen", "w9", { generation: 2 })];
    expect(recentImports(jobs, library, 1)).toEqual([
      { id: "w-new", title: "Server title", detail: "tiktok.com" },
      { id: "w1", title: "Workout w1", detail: "youtube.com", thumbnail: undefined },
      { id: "w2", title: "Workout w2", detail: "Photos", thumbnail: undefined },
      { id: "w3", title: "Workout w3", detail: "Coach Ana", thumbnail: undefined },
    ]);
  });
  it("still fills the section from the library after server imports are purged", () => {
    const library = Array.from({ length: 8 }, (_, i) => workout(`w${i}`, { capture_kind: "url" }));
    expect(recentImports(undefined, library, 1).map(item => item.id)).toEqual(["w0", "w1", "w2", "w3", "w4"]);
    expect(recentImports([], [], 1)).toEqual([]);
  });
});
