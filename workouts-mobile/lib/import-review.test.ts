import { describe, expect, it } from "vitest";
import { importReviewClass, importReviewClassNoRotationClue, importReviewWarnings } from "./fixtures/import-review-class";
import { workoutErrors, workoutProblems } from "./library";
import { inferRotation, intervalWord, partName, problemSummary, retryHelp, reviewNotices, reviewProblems, setPartRotation, setPartRounds, withReviewDefaults, wantsRotation, wantsRounds } from "./import-review";
import type { AuthoredWorkout } from "./models";

const workout = importReviewClass as unknown as AuthoredWorkout;
const noClue = importReviewClassNoRotationClue as unknown as AuthoredWorkout;
const block = (w: AuthoredWorkout, id: string) => w.blocks.find(b => b.id === id)!;
const rotation = (w: AuthoredWorkout) => (block(w, "b").execution as { rotation: string | null }).rotation;

describe("rotation default", () => {
  it("chooses Alternate when the part lists Minute 1 to N with one move per minute", () => {
    expect(inferRotation(block(workout, "b"))).toBe("alternating");
    expect(rotation(withReviewDefaults(workout))).toBe("alternating");
  });
  it("reads minute rows named on the moves themselves", () => {
    const rows = { ...workout, blocks: workout.blocks.map(b => b.id !== "b" ? b : { ...b, instructions: [],
      exercises: b.exercises.map((e, i) => ({ ...e, name: `Minute ${i + 1}: ${e.name}` })) }) } as AuthoredWorkout;
    expect(rotation(withReviewDefaults(rows))).toBe("alternating");
  });
  it("leaves it for the person when nothing in the part says so", () => {
    expect(inferRotation(block(noClue, "b"))).toBeNull();
    expect(withReviewDefaults(noClue)).toBe(noClue);
  });
  it("does not guess from an interval length, from too few minutes, or from fewer minutes than moves", () => {
    const only = (instructions: string[]) => ({ ...workout, blocks: workout.blocks.map(b => b.id === "b" ? { ...b, instructions } : b) }) as AuthoredWorkout;
    expect(inferRotation(block(only(["Every 3 minutes for 9 minutes"]), "b"))).toBeNull();
    expect(inferRotation(block(only(["Minute 1"]), "b"))).toBeNull();
    expect(inferRotation(block(only(["Minute 1–3"]), "b"))).toBeNull(); // five moves, three minutes
  });
  it("does not guess when a minute holds several moves or every move runs each minute", () => {
    const pair = (instructions: string[]) => ({ ...workout, blocks: workout.blocks.map(b => b.id !== "b" ? b : { ...b, instructions,
      exercises: [{ name: "Dumbbell Snatch", reps_min: 10, reps_max: 10 }, { name: "Sit-up", reps_min: 15, reps_max: 15 }] }) }) as AuthoredWorkout;
    expect(inferRotation(block(pair(["Minutes 1–8: do both moves each minute."]), "b"))).toBeNull();
    expect(inferRotation(block(pair(["Minute 1: Snatches + Sit-Ups", "Minute 2: Rest"]), "b"))).toBeNull();
    expect(inferRotation(block(pair(["Minute 1: Snatches", "Minute 2: Sit-Ups"]), "b"))).toBe("alternating");
  });
  it("counts a rest minute the import left out", () => {
    const rest = { ...workout, blocks: workout.blocks.map(b => b.id !== "b" ? b : { ...b, exercises: b.exercises.slice(0, 2),
      instructions: ["Minute 1 Row", "Minute 2 Echo Bike", "Minute 3 Rest for 1 minute"] }) } as AuthoredWorkout;
    expect(inferRotation(block(rest, "b"))).toBe("alternating");
  });
  it("never overrides a choice that was made", () => {
    const chosen = setPartRotation(workout, "b", "together");
    expect(withReviewDefaults(chosen)).toBe(chosen);
    expect(rotation(chosen)).toBe("together");
  });
  it("leaves nothing for Save to block on once the default applies", () => {
    expect(reviewProblems(workout)).toEqual([]);
    expect(reviewProblems(withReviewDefaults(workout))).toEqual([]);
  });
});

describe("problems stay with their part", () => {
  const problems = reviewProblems(noClue);
  it("names the part and offers the one-tap fix for an unset rotation", () => {
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ blockId: "b", part: "Part B", scope: "part", fix: "rotation" });
    expect(problemSummary(problems)).toBe("One thing to fix before saving. Part B: Choose whether to alternate the moves or do every move each interval.");
  });
  it("resolves when a choice is made", () => {
    expect(reviewProblems(setPartRotation(noClue, "b", "alternating"))).toEqual([]);
  });
  it("lists the first problem first, in the order the parts appear", () => {
    const broken = { ...noClue, blocks: noClue.blocks.map(b => b.id === "c" ? { ...b, rounds: 500 } : b) } as AuthoredWorkout;
    const found = reviewProblems(broken);
    expect(found.map(p => p.part)).toEqual(["Part B", "Part C"]);
    expect(problemSummary(found)).toMatch(/^2 things to fix before saving\. Part B:/);
  });
  it("puts a bad class date first, and an empty workout at the workout level", () => {
    const badDate = { ...noClue, programming: { ...noClue.programming!, date: "2026-02-30" } } as AuthoredWorkout;
    expect(reviewProblems(badDate, { isClass: true })[0]).toMatchObject({ scope: "date" });
    const empty = { ...workout, blocks: [] } as AuthoredWorkout;
    expect(reviewProblems(empty, { allowIncomplete: true })[0]).toMatchObject({ scope: "workout", message: "Add at least one exercise before saving this workout." });
  });
  it("keeps the same messages the flat validator reports", () => {
    const broken = { ...noClue, blocks: noClue.blocks.map(b => b.id === "c" ? { ...b, rounds: 500 } : b) } as AuthoredWorkout;
    expect(workoutProblems(broken).map(p => p.message)).toEqual(workoutErrors(broken));
  });
  it("names a part by its letter, else by its label", () => {
    expect(partName({ label: "C. Accessories" }, 2)).toBe("Part C");
    expect(partName({ label: "Finisher" }, 3)).toBe("Finisher");
  });
});

describe("notices", () => {
  const notices = reviewNotices([...importReviewWarnings, importReviewWarnings[0], "  "], workout);
  it("links each warning to its part and drops repeats", () => {
    expect(notices).toHaveLength(3);
    expect(notices[0]).toMatchObject({ blockId: "c", part: "Part C", kind: "check" });
    expect(notices[1]).toMatchObject({ blockId: "b", part: "Part B", kind: "check" });
  });
  it("marks a warning that already names its part, so the list does not say it twice", () => {
    expect(notices[0].named).toBe(true);
    expect(notices[1].named).toBe(true);
    expect(reviewNotices(["Per-side details for Side Plank are unspecified; review the source."], workout)[0].named).toBeUndefined();
  });
  it("keeps a purely informational warning quiet and unlinked", () => {
    expect(notices[2]).toMatchObject({ blockId: null, part: null, kind: "info" });
  });
  it("links a warning that names one move only", () => {
    expect(reviewNotices(["Per-side details for Side Plank are unspecified; review the source."], workout)[0]).toMatchObject({ blockId: "c", kind: "check" });
    expect(reviewNotices(["Per-side details for Burpee are unspecified; review the source."], workout)[0].blockId).toBe("b");
  });
  it("tells two parts with the same label apart by the move, and leaves a missing part unlinked", () => {
    const circuits = { ...workout, blocks: [
      { ...block(workout, "a"), id: "x", label: "Circuit", exercises: [{ name: "Back Squat", sets: 3 }] },
      { ...block(workout, "c"), id: "y", label: "Circuit" }] } as AuthoredWorkout;
    expect(reviewNotices(["Circuit: Side Plank needs source review."], circuits)[0].blockId).toBe("y");
    expect(reviewNotices(["Circuit needs source review."], circuits)[0].blockId).toBeNull();
    expect(reviewNotices(["Part D was read from the page layout; review it. Side Plank too."], workout)[0].blockId).toBeNull();
  });
});

describe("part controls", () => {
  it("offers rounds on counted parts and the rotation choice on an EMOM with several moves", () => {
    expect(wantsRounds(block(workout, "c"))).toBe(true);
    expect(wantsRounds(block(workout, "a"))).toBe(false); // straight sets
    expect(wantsRounds(block(workout, "b"))).toBe(false); // the timer counts intervals
    expect(wantsRotation(block(workout, "b"))).toBe(true);
    expect(wantsRotation(block(workout, "c"))).toBe(false);
  });
  it("sets and clears rounds on one part only", () => {
    const three = setPartRounds(workout, "c", 3);
    expect(block(three, "c").rounds).toBe(3);
    expect(block(three, "a").rounds).toBeUndefined();
    expect(block(setPartRounds(three, "c", null), "c").rounds).toBeNull();
  });
  it("calls an interval a minute only when it is one", () => {
    expect(intervalWord(block(workout, "b"))).toBe("minute");
    const three = { ...block(workout, "b"), execution: { mode: "emom" as const, interval_seconds: 180, intervals: 3, rotation: null } };
    expect(intervalWord(three)).toBe("interval");
  });
});

describe("re-read copy follows the source", () => {
  it.each([
    ["images", true, "screenshots could not be read"], ["images", false, "images could not be read"], ["document", true, "PDF could not be read"],
    ["text", true, "again if something was missed"], ["url", false, "video or page could not be read"],
  ] as const)("%s (class %s)", (kind, isClass, phrase) => {
    const copy = retryHelp(kind, isClass);
    expect(copy).toContain(phrase);
    expect(copy).toContain("separate private import");
    if (kind !== "url") expect(copy).not.toMatch(/video/i);
  });
  it("asks for the class instructions for a class and the caption otherwise", () => {
    expect(retryHelp("images", true)).toContain("class instructions");
    expect(retryHelp("images", false)).toContain("caption");
  });
});
