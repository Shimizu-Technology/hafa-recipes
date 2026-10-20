import { describe, expect, it } from "vitest";
import {
  activeMs,
  activeTimer,
  changeTimer,
  clockText,
  currentSide,
  feedRecordData,
  isPaused,
  pauseTimer,
  resumeTimer,
  sideChoices,
  spokenTimer,
  startTimer,
  switchSide,
} from "./feed-timer";
import { fencedState } from "./outbox";
import { emptyState, type DeviceState } from "./models";

const at = (minutes: number, seconds = 0) => new Date(Date.UTC(2026, 9, 20, 3, minutes, seconds));
const space = (generation = 2, children = ["baby"]): DeviceState => ({
  ...emptyState(),
  bootstrap: {
    generation,
    active: true,
    ai_available: false,
    children: children.map((id) => ({ id, name: id, revision: 1 })),
    profile: { display_name: "Kami", timezone: "Pacific/Guam", ai_consent: false },
  },
});

describe("elapsed time", () => {
  it("counts a running side up to now", () => {
    const timer = startTimer("baby", 2, "left", at(0));
    expect(activeMs(timer, at(12, 30))).toBe(12.5 * 60_000);
    expect(isPaused(timer)).toBe(false);
    expect(currentSide(timer)).toBe("left");
  });

  it("excludes paused time and resumes on the same side", () => {
    let timer = startTimer("baby", 2, "right", at(0));
    timer = pauseTimer(timer, at(5));
    expect(isPaused(timer)).toBe(true);
    expect(timer.paused_at).toBe(at(5).toISOString());
    expect(activeMs(timer, at(30))).toBe(5 * 60_000);
    timer = resumeTimer(timer, at(30));
    expect(timer.paused_at).toBeUndefined();
    expect(currentSide(timer)).toBe("right");
    expect(activeMs(timer, at(34))).toBe(9 * 60_000);
  });

  it("ignores repeated pause or resume taps", () => {
    const timer = startTimer("baby", 2, "left", at(0)),
      paused = pauseTimer(timer, at(4));
    expect(pauseTimer(paused, at(9))).toBe(paused);
    expect(resumeTimer(timer, at(9))).toBe(timer);
  });

  it("switches sides into one continuous total, resuming a paused timer", () => {
    let timer = startTimer("baby", 2, "left", at(0));
    timer = switchSide(timer, at(8));
    expect(currentSide(timer)).toBe("right");
    expect(activeMs(timer, at(15))).toBe(15 * 60_000);
    timer = pauseTimer(timer, at(15));
    timer = switchSide(timer, at(20));
    expect(isPaused(timer)).toBe(false);
    expect(currentSide(timer)).toBe("left");
    expect(activeMs(timer, at(21))).toBe(16 * 60_000);
  });

  it("never counts backwards when the device clock moves back", () => {
    let timer = startTimer("baby", 2, "left", at(10));
    expect(activeMs(timer, at(5))).toBe(0);
    timer = pauseTimer(timer, at(5));
    expect(timer.segments[0].ended_at).toBe(at(10).toISOString());
    timer = switchSide(timer, at(20));
    expect(activeMs(timer, at(19))).toBe(0);
    expect(activeMs(timer, at(22))).toBe(2 * 60_000);
  });

  it("is pure over persisted state, so a restarted app resumes the same count", () => {
    const timer = switchSide(startTimer("baby", 2, "left", at(0)), at(6)),
      restored = JSON.parse(JSON.stringify(timer));
    expect(activeMs(restored, at(10))).toBe(activeMs(timer, at(10)));
    expect(activeMs(restored, at(10))).toBe(10 * 60_000);
  });
});

describe("saved feed", () => {
  it("records one side, rounded active minutes, and at least a minute", () => {
    const timer = startTimer("baby", 2, "left", at(0));
    expect(feedRecordData(timer, at(12, 29))).toEqual({ method: "breast", side: "left", duration_minutes: 12 });
    expect(feedRecordData(timer, at(12, 30)).duration_minutes).toBe(13);
    expect(feedRecordData(timer, at(0, 10)).duration_minutes).toBe(1);
    expect(feedRecordData(timer, at(0)).duration_minutes).toBe(1);
  });

  it("records both sides after a switch and leaves out paused minutes", () => {
    let timer = startTimer("baby", 2, "left", at(0));
    timer = switchSide(timer, at(7));
    timer = pauseTimer(timer, at(10));
    expect(feedRecordData(timer, at(40))).toEqual({ method: "breast", side: "both", duration_minutes: 10 });
  });
});

describe("display", () => {
  it("formats minutes and hours", () => {
    expect(clockText(0)).toBe("00:00");
    expect(clockText(-5000)).toBe("00:00");
    expect(clockText(65_900)).toBe("01:05");
    expect(clockText((3600 + 4 * 60 + 7) * 1000)).toBe("1:04:07");
  });

  it("speaks whole minutes rather than every second", () => {
    const timer = startTimer("baby", 2, "left", at(0));
    expect(spokenTimer(timer, at(0, 40))).toBe("Left side, less than a minute");
    expect(spokenTimer(timer, at(1, 59))).toBe("Left side, 1 minute");
    expect(spokenTimer(pauseTimer(timer, at(12, 3)), at(20))).toBe("Paused, Left side, 12 minutes");
  });

  it("offers the suggested next side first", () => {
    expect(sideChoices("right")).toEqual([
      { side: "right", suggested: true },
      { side: "left", suggested: false },
    ]);
    expect(sideChoices("left")[0]).toEqual({ side: "left", suggested: true });
    expect(sideChoices("both")).toEqual([
      { side: "left", suggested: false },
      { side: "right", suggested: false },
    ]);
    expect(sideChoices(undefined)[0].suggested).toBe(false);
  });
});

describe("ownership", () => {
  it("only shows a timer for this space generation and an existing baby", () => {
    const timer = startTimer("baby", 2, "left", at(0));
    expect(activeTimer({ ...space(), feedTimer: timer })).toBe(timer);
    expect(activeTimer({ ...space(3), feedTimer: timer })).toBeUndefined();
    expect(activeTimer({ ...space(2, ["other"]), feedTimer: timer })).toBeUndefined();
    expect(activeTimer({ ...space(), bootstrap: { ...space().bootstrap!, active: false }, feedTimer: timer })).toBeUndefined();
    expect(activeTimer({ ...space(), feedTimer: { ...timer, segments: [] } })).toBeUndefined();
    expect(activeTimer(space())).toBeUndefined();
  });

  it("clears the timer when the Baby space is fenced", () => {
    const state = { ...space(2), feedTimer: startTimer("baby", 2, "left", at(0)) };
    expect(fencedState(state, 2).feedTimer).toBeDefined();
    const fenced = fencedState(state, 3);
    expect(fenced.feedTimer).toBeUndefined();
    expect("feedTimer" in fenced).toBe(false);
  });

  it("changes or removes only the timer the parent was looking at", () => {
    const timer = startTimer("baby", 2, "left", at(0)),
      state = { ...space(), feedTimer: timer };
    expect(changeTimer(state, timer.started_at, (t) => pauseTimer(t, at(3))).feedTimer?.paused_at).toBe(at(3).toISOString());
    const cleared = changeTimer(state, timer.started_at, () => undefined);
    // Removed rather than set to undefined, so the vault drops the section.
    expect("feedTimer" in cleared).toBe(false);
    expect(() => changeTimer(state, at(1).toISOString(), () => undefined)).toThrow("already ended");
    expect(() => changeTimer(space(), timer.started_at, () => undefined)).toThrow("already ended");
  });
});
