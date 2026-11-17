import { describe, expect, it } from "vitest";
import { missingProblem, pointParts, readSummary, savedWhen, timingDistance } from "./source-reading";

describe("pointParts", () => {
  it("moves a slide reference to its own line", () => {
    expect(pointParts("Milk storage: fridge and freezer times (slide 4)")).toEqual({ text: "Milk storage: fridge and freezer times", ref: "Slide 4" });
    expect(pointParts("Wake windows grow by month (slides 2–3).")).toEqual({ text: "Wake windows grow by month.", ref: "Slides 2–3" });
    expect(pointParts("Plain point")).toEqual({ text: "Plain point", ref: "" });
    // Other brackets are part of the point.
    expect(pointParts("Swaddle (not too tight)")).toEqual({ text: "Swaddle (not too tight)", ref: "" });
  });
});

describe("missingProblem", () => {
  const caption = [{ location: "caption", text: "Questions to ask" }];
  it("names nothing for a ready post or one still being read", () => {
    expect(missingProblem({ status: "ready" })).toBeNull();
    expect(missingProblem({ status: "processing" })).toBeNull();
    expect(missingProblem({ status: "queued" })).toBeNull();
  });
  it("says plainly what's missing", () => {
    expect(missingProblem({ status: "incomplete", url: "https://tiktok.com/x", summary: "Questions", evidence: caption })?.title).toBe("Only the caption was read");
    expect(missingProblem({ status: "incomplete", evidence: [{ location: "user_note", text: "mine" }] })?.title).toBe("Nothing could be read from this post");
    expect(missingProblem({ status: "incomplete", evidence: caption })?.title).toBe("No summary yet");
    expect(missingProblem({ status: "incomplete", summary: "s", evidence: caption, coverage_notes: ["An attachment could not be read."] })?.title)
      .toBe("Part of this post couldn’t be read");
    expect(missingProblem({ status: "failed" })?.title).toBe("This post couldn’t be read");
    expect(missingProblem({ status: "saved" })?.title).toBe("Not read yet");
  });
});

it("summarizes what was read", () => {
  expect(readSummary({ evidence: [{ location: "caption", text: "a" }, ...Array.from({ length: 8 }, (_, i) => ({ location: `image:${i}`, text: "b" }))] }))
    .toBe("Caption and 8 slides");
  expect(readSummary({ evidence: [{ location: "transcript", text: "a" }, { location: "attachment:0:image:0", text: "b" }, { location: "attachment:1", text: "c" }] }))
    .toBe("Speech and 2 screenshots");
  expect(readSummary({ source_text: "old" })).toBe("The post’s text");
  expect(readSummary({})).toBe("");
});

it("says when it was saved", () => {
  const now = new Date(2026, 10, 17, 9);
  expect(savedWhen(new Date(2026, 10, 17, 1).toISOString(), now)).toBe("saved today");
  expect(savedWhen(new Date(2026, 10, 16, 22).toISOString(), now)).toBe("saved yesterday");
  expect(savedWhen(new Date(2026, 10, 6, 12).toISOString(), now)).toBe("saved Nov 6");
  expect(savedWhen(new Date(2025, 10, 6, 12).toISOString(), now)).toBe("saved Nov 6, 2025");
});

describe("timingDistance", () => {
  const now = new Date(2026, 10, 17);
  // Due Dec 8: 37 weeks today, 3 weeks to go.
  const expecting = { due_date: "2026-12-08", birth_date: null };
  it("counts weeks to a pregnancy tip, and on into baby age", () => {
    expect(timingDistance({ pregnancy_week_min: 36 }, expecting, now)).toBe("useful now");
    expect(timingDistance({ pregnancy_week_min: 39 }, expecting, now)).toBe("about 2 weeks from now");
    expect(timingDistance({ pregnancy_week_min: 38 }, expecting, now)).toBe("next week");
    expect(timingDistance({ stage: "baby", baby_age_min_weeks: 0 }, expecting, now)).toBe("about 3 weeks from now");
    expect(timingDistance({ stage: "baby", baby_age_min_weeks: 26 }, expecting, now)).toBe("about 7 months from now");
    expect(timingDistance({ pregnancy_week_max: 20 }, expecting, now)).toBe("");
  });
  it("counts weeks for a baby, and says nothing for pregnancy tips after birth", () => {
    const baby = { birth_date: "2026-10-20", due_date: null }; // 4 weeks old
    expect(timingDistance({ stage: "baby", baby_age_min_weeks: 6 }, baby, now)).toBe("about 2 weeks from now");
    expect(timingDistance({ stage: "baby", baby_age_min_weeks: 0, baby_age_max_weeks: 8 }, baby, now)).toBe("useful now");
    expect(timingDistance({ stage: "baby", baby_age_max_weeks: 2 }, baby, now)).toBe("");
    expect(timingDistance({ pregnancy_week_min: 30 }, baby, now)).toBe("");
    expect(timingDistance(null, baby, now)).toBe("");
  });
});
