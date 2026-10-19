import { describe, expect, it } from "vitest";
import type { Workout } from "./models";
import {
  coachActionNoun,
  humanize,
  proposalStatusLabel,
  sessionStatusLabel,
  workoutKindLabel,
  workoutOrigin,
} from "./labels";

const base: Workout = { id: "w", generation: 1, revision: 1, title: "Legs", kind: "session", provenance: "user", blocks: [] };

describe("plain labels for stored codes", () => {
  it("names every workout kind without exposing the code", () => {
    expect(workoutKindLabel("session")).toBe("Workout");
    expect(workoutKindLabel("exercise")).toBe("Exercise");
    expect(workoutKindLabel("program")).toBe("Program");
    expect(workoutKindLabel("accessory")).toBe("Accessory");
    expect(workoutKindLabel("cool_down")).toBe("Cool down");
  });

  it("says where a workout came from", () => {
    expect(workoutOrigin(base)).toBe("Made by you");
    expect(workoutOrigin({ ...base, provenance: "suggestion" })).toBe("Suggested by Coach");
    expect(workoutOrigin({ ...base, provenance: "source", source_url: "https://www.tiktok.com/@coach/video/1" })).toBe("Saved from TikTok");
    expect(workoutOrigin({ ...base, source_url: "https://m.youtube.com/watch?v=1" })).toBe("Saved from YouTube");
    expect(workoutOrigin({ ...base, source_url: "https://youtu.be/1" })).toBe("Saved from YouTube");
    expect(workoutOrigin({ ...base, source_url: "https://instagram.com/reel/1" })).toBe("Saved from Instagram");
    expect(workoutOrigin({ ...base, source_url: "https://example.test/blog", capture_kind: "url" })).toBe("Saved from the web");
    expect(workoutOrigin({ ...base, capture_kind: "images" })).toBe("Saved from photos");
    expect(workoutOrigin({ ...base, source_creator: "Someone" })).toBe("Saved from a source");
    expect(workoutOrigin({ ...base, source_url: "not a url" })).toBe("Saved from a source");
    // Lookalike hosts are not treated as the real platform.
    expect(workoutOrigin({ ...base, source_url: "https://nottiktok.com/x" })).toBe("Saved from the web");
  });

  it("labels session status, coach actions and proposal status", () => {
    expect(sessionStatusLabel("completed")).toBe("Completed");
    expect(sessionStatusLabel("partial")).toBe("Partly done");
    expect(sessionStatusLabel("in_progress")).toBe("In progress");
    expect(coachActionNoun("program")).toBe("plan");
    expect(coachActionNoun("adaptation")).toBe("workout");
    expect(coachActionNoun("schedule")).toBe("schedule");
    expect(coachActionNoun("new_kind")).toBe("new kind");
    expect(proposalStatusLabel("ready")).toBe("Ready to review");
    expect(proposalStatusLabel("needs_information")).toBe("Needs more information");
    expect(proposalStatusLabel("something_else")).toBe("Something else");
    expect(humanize("")).toBe("");
  });
});
