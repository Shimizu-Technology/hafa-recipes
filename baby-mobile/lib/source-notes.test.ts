import { describe, expect, it } from "vitest";
import { sourceEvidenceItems, sourceEvidenceLocation, sourceProcessingNotes } from "./models";

describe("source processing context", () => {
  const sampledNote = (index: number, timestamp: string) =>
    `image:${index} sampled at ${timestamp}s; samples do not cover every frame.`;
  it("compacts eight actual frame warnings while preserving every timestamp", () => {
    const timestamps = ["0", "3.82", "7.64", "11.46", "15.28", "19.1", "22.92", "26.74"];
    expect(sourceProcessingNotes(timestamps.map((time, index) => sampledNote(index, time)))).toEqual([
      "8 video frames were sampled at 0, 3.82, 7.64, 11.46, 15.28, 19.1, 22.92, 26.74 seconds. Details between frames may be missing.",
    ]);
  });
  it("keeps failure and budget notes in order around the first sampled warning", () => {
    const before = "Captions were unavailable.",
      failure = "Frame processing reached the import time limit; available captions remain usable.",
      budget = "You’ve reached today’s AI processing limit. Your original is saved.";
    expect(sourceProcessingNotes([before, sampledNote(0, "0"), failure, sampledNote(1, "3.820"), budget])).toEqual([
      before,
      "2 video frames were sampled at 0, 3.820 seconds. Details between frames may be missing.",
      failure,
      budget,
    ]);
  });
  it("leaves unrecognized and malformed sampling claims unchanged", () => {
    const unknown = [
      "image:0 sampled at 0s; all frames were reviewed.",
      "image:0 sampled at -1s; samples do not cover every frame.",
      sampledNote(8, "4"),
      sampledNote(0, "NaN"),
      sampledNote(1, "1e999"),
      "Uploaded video has incomplete visual coverage.",
    ];
    expect(sourceProcessingNotes(unknown)).toEqual(unknown);
    expect(sourceProcessingNotes([sampledNote(0, "0")])).toEqual([sampledNote(0, "0")]);
  });
  it("retains deduplication and bounds without truncating grouped timestamps", () => {
    expect(sourceProcessingNotes([sampledNote(0, "0"), sampledNote(0, "0"), sampledNote(1, "1e-05")])).toEqual([
      "2 video frames were sampled at 0, 1e-05 seconds. Details between frames may be missing.",
    ]);
    const longNotes = Array.from({ length: 8 }, (_, index) => sampledNote(index, "1." + String(index).repeat(45)));
    expect(sourceProcessingNotes(longNotes)).toEqual(longNotes);
    const capped = Array.from({ length: 30 }, (_, index) => `Unchanged warning ${index}`);
    expect(sourceProcessingNotes([...capped, sampledNote(0, "0"), sampledNote(1, "1")])).toEqual(capped);
  });
  it("retains actual coverage limits and daily-budget explanations as plain text", () => {
    const notes = [
      "Video frames are samples; details between samples may be missing.",
      "You’ve reached today’s AI processing limit. Your original is saved.",
    ];
    expect(sourceProcessingNotes(notes)).toEqual(notes);
    expect(sourceProcessingNotes(undefined)).toEqual([]);
    expect(sourceProcessingNotes([])).toEqual([]);
  });
  it("bounds notes and ignores malformed objects without stringifying private fields", () => {
    expect(
      sourceProcessingNotes([null, { secret: "NOT A NOTE" }, 12, "  ", " readable\u0000 note ", "readable note"])
    ).toEqual(["readable note"]);
    expect(sourceProcessingNotes({ error: "NOT A NOTE" })).toEqual([]);
    expect(sourceProcessingNotes(Array.from({ length: 40 }, (_, i) => `${i}:` + "x".repeat(400)))).toHaveLength(30);
    expect(sourceProcessingNotes(["x".repeat(400)])[0]).toHaveLength(300);
  });
  it.each([
    ["caption", "Source caption"],
    ["transcript", "Audio transcript"],
    ["pasted_text", "Text you added"],
    ["image:0", "Source image 1"],
    ["attachment:0", "Attachment 1"],
    ["attachment:1:uploaded_transcript", "Attachment 2 · Audio transcript"],
    ["attachment:0:uploaded_frame:12.5s", "Attachment 1 · Sampled video frame at 12.5 seconds"],
    ["attachment:0:document_page:3", "Attachment 1 · Document page 3"],
  ])("translates the actual acquisition location %s", (location, label) => {
    expect(sourceEvidenceLocation(location)).toBe(label);
  });
  it("does not expose unknown locations or turn ambiguous source images into verified video frames", () => {
    for (const value of [
      null,
      {},
      "https://example.test/private",
      "attachment:0:internal:error",
      "__proto__",
      "attachment:100:uploaded_frame:2s",
      "uploaded_frame:9999s",
      "x".repeat(200),
    ])
      expect(sourceEvidenceLocation(value)).toBeUndefined();
    expect(sourceEvidenceLocation("image:0")).not.toContain("frame");
  });
  it("preserves readable evidence and legacy fields without a raw JSON fallback", () => {
    expect(
      sourceEvidenceItems([
        null,
        { unknown_private_field: "NEVER DISPLAY" },
        { text: { private: "NEVER DISPLAY" } },
        { text: "Visible hospital checklist", location: "attachment:0" },
        { excerpt: "Older evidence", timestamp: "00:12", source: "Caption" },
      ])
    ).toEqual([
      { text: "Visible hospital checklist", location: "Attachment 1", timestamp: "", source: "" },
      { text: "Older evidence", location: undefined, timestamp: "00:12", source: "Caption" },
    ]);
    expect(sourceEvidenceItems([{ text: "x".repeat(13000) }])[0].text).toHaveLength(12000);
  });
});
