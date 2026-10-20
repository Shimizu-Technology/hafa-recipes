import type { DeviceState, FeedTimer, RecordData } from "./models";

export type FeedSide = "left" | "right";
const minute = 60_000;

function time(iso: string | undefined) {
  const value = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(value) ? value : NaN;
}

/** Never end a segment before it began, even if the device clock moved backwards. */
function endAt(startedAt: string, now: Date) {
  return new Date(Math.max(time(startedAt), now.getTime())).toISOString();
}

function open(timer: FeedTimer) {
  const last = timer.segments[timer.segments.length - 1];
  return last && !last.ended_at ? last : undefined;
}

function close(timer: FeedTimer, now: Date): FeedTimer["segments"] {
  return timer.segments.map((segment) =>
    segment.ended_at ? segment : { ...segment, ended_at: endAt(segment.started_at, now) }
  );
}

export function startTimer(childId: string, generation: number, side: FeedSide, now = new Date()): FeedTimer {
  const started_at = now.toISOString();
  return { child_id: childId, generation, started_at, segments: [{ side, started_at }] };
}

export function currentSide(timer: FeedTimer): FeedSide {
  return timer.segments[timer.segments.length - 1]?.side ?? "left";
}

export function isPaused(timer: FeedTimer) {
  return !!timer.paused_at || !open(timer);
}

export function pauseTimer(timer: FeedTimer, now = new Date()): FeedTimer {
  if (isPaused(timer)) return timer;
  return { ...timer, segments: close(timer, now), paused_at: now.toISOString() };
}

export function resumeTimer(timer: FeedTimer, now = new Date()): FeedTimer {
  if (!isPaused(timer)) return timer;
  const { paused_at: _, ...rest } = timer;
  return { ...rest, segments: [...close(timer, now), { side: currentSide(timer), started_at: now.toISOString() }] };
}

/** Switching means feeding on the other side now, so it also resumes a paused timer. */
export function switchSide(timer: FeedTimer, now = new Date()): FeedTimer {
  const { paused_at: _, ...rest } = timer;
  const side: FeedSide = currentSide(timer) === "left" ? "right" : "left";
  return { ...rest, segments: [...close(timer, now), { side, started_at: now.toISOString() }] };
}

/** Milliseconds actually spent feeding: paused gaps and backwards clock jumps count as zero. */
export function activeMs(timer: FeedTimer, now = new Date()) {
  return timer.segments.reduce((total, segment) => {
    const start = time(segment.started_at),
      end = segment.ended_at ? time(segment.ended_at) : now.getTime(),
      spent = end - start;
    return Number.isFinite(spent) && spent > 0 ? total + spent : total;
  }, 0);
}

/** The ordinary feeding entry a finished timer becomes. */
export function feedRecordData(timer: FeedTimer, now = new Date()): RecordData {
  const used = new Set(timer.segments.map((segment) => segment.side));
  return {
    method: "breast",
    side: used.size > 1 ? "both" : currentSide(timer),
    duration_minutes: Math.max(1, Math.round(activeMs(timer, now) / minute)),
  };
}

/** "04:07" under an hour, then "1:04:07". */
export function clockText(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000)),
    h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = seconds % 60,
    pad = (value: number) => String(value).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** What VoiceOver reads: changes once a minute at most, e.g. "Left side, 12 minutes". */
export function spokenTimer(timer: FeedTimer, now = new Date()) {
  const minutes = Math.floor(activeMs(timer, now) / minute),
    side = currentSide(timer) === "left" ? "Left side" : "Right side",
    spent = minutes < 1 ? "less than a minute" : `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${isPaused(timer) ? "Paused, " : ""}${side}, ${spent}`;
}

/** The persisted timer when it still belongs to this Baby space and an existing baby. */
export function activeTimer(state: Pick<DeviceState, "feedTimer" | "bootstrap">): FeedTimer | undefined {
  const timer = state.feedTimer,
    bootstrap = state.bootstrap;
  if (!timer || !bootstrap || bootstrap.active === false || timer.generation !== bootstrap.generation) return;
  if (!Array.isArray(timer.segments) || !timer.segments.length || !Number.isFinite(time(timer.started_at))) return;
  return bootstrap.children.some((child) => child.id === timer.child_id) ? timer : undefined;
}

/** Change the running timer only if it is still the one the parent was looking at. */
export function changeTimer(state: DeviceState, startedAt: string, change: (timer: FeedTimer) => FeedTimer | undefined): DeviceState {
  const timer = activeTimer(state);
  if (!timer || timer.started_at !== startedAt) throw Error("This feeding timer already ended.");
  const next = change(timer);
  if (next) return { ...state, feedTimer: next };
  const { feedTimer: _, ...rest } = state;
  return rest;
}

/** The side offered first: the suggested next side after a breastfeed, otherwise left. */
export function sideChoices(next: RecordData["side"]): { side: FeedSide; suggested: boolean }[] {
  const first: FeedSide = next === "right" ? "right" : "left";
  return [
    { side: first, suggested: next === first },
    { side: first === "left" ? "right" : "left", suggested: false },
  ];
}
