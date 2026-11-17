import type { Child, Relevance, RecordData } from "./models";
import { babyAgeWeeks, pregnancyProgress, todayStage } from "./timing";

/** A key point's words, with its "(slide 4)" moved to a quiet second line. */
export function pointParts(point: string) {
  const refs: string[] = [];
  const text = point.replace(/\s*\((slides?\s+\d[\d\s,–-]*(?:and\s+\d+)?)\)/gi, (_, ref: string) => {
    refs.push(ref.trim().replace(/^s/, "S"));
    return "";
  }).trim();
  return { text: text || point, ref: refs.join(" · ") };
}

const lostNotes = ["An attachment could not be read.", "Image attachment:", "The linked source could not be read."];
const read = (data: Pick<RecordData, "evidence">) => (data.evidence ?? [])
  .filter((entry) => entry && typeof entry === "object" && String(entry.text ?? "").trim() && entry.location !== "user_note")
  .map((entry) => String(entry.location ?? ""));

/**
 * What's missing from a saved post, in plain words, or null when nothing is. Mirrors the API's missing_reason: only a
 * post that isn't ready gets one, and queued or processing posts are still being read.
 */
export function missingProblem(data: Pick<RecordData, "status" | "evidence" | "coverage_notes" | "summary" | "url" | "source_text">) {
  switch (data.status) {
    case "saved": return { title: "Not read yet", body: "Your original is saved. Read it to get a summary and key points, or add screenshots of the post." };
    case "cancelled": return { title: "Reading stopped", body: "Your original is saved. Try again, or add screenshots of the post." };
    case "failed": return { title: "This post couldn’t be read", body: "Your link and anything you added are saved. Try again, or add screenshots of the post." };
    case "incomplete": break;
    default: return null;
  }
  const places = read(data), notes = (data.coverage_notes ?? []).filter((note): note is string => typeof note === "string");
  // An older post kept its text without evidence; that text was still read from it.
  if (!places.length && !data.source_text?.trim()) return { title: "Nothing could be read from this post", body: "The link is saved, but its words and pictures couldn’t be read. Try again, or add screenshots." };
  if (notes.some((note) => lostNotes.some((lost) => note.startsWith(lost)) || note.startsWith("Daily AI limit reached")))
    return { title: "Part of this post couldn’t be read", body: "Something you added couldn’t be read, or reading stopped partway. Try again, or add screenshots." };
  if (!data.summary) return { title: "No summary yet", body: "The post was read, but a summary wasn’t made. Try again." };
  if (data.url && places.length && places.every((place) => place === "caption"))
    return { title: "Only the caption was read", body: "The video’s speech and pictures couldn’t be read. Try again, or add a screenshot of the slides." };
  return { title: "Part of this post couldn’t be read", body: "Try again, or add screenshots of what’s missing." };
}

const counted = (count: number, one: string, many = one + "s") => `${count} ${count === 1 ? one : many}`;
/** "Caption and 8 slides": what the reading came from, for the closed "What was read" row. */
export function readSummary(data: Pick<RecordData, "evidence" | "source_text">) {
  const places = read(data), has = (test: (place: string) => boolean) => places.filter(test).length;
  const images = has((place) => /^image:\d+$/.test(place)), frames = has((place) => place.startsWith("uploaded_frame:")),
    attachments = new Set(places.filter((place) => place.startsWith("attachment:")).map((place) => place.split(":")[1])).size;
  const parts = [
    places.includes("caption") && "Caption",
    (places.includes("transcript") || places.includes("uploaded_transcript")) && "speech",
    images && counted(images, "slide"),
    frames && counted(frames, "video frame"),
    places.includes("page_text") && "the web page",
    attachments && counted(attachments, "screenshot"),
    (places.includes("pasted_text") || places.includes("provided_text")) && "your text",
  ].filter((part): part is string => !!part);
  if (!parts.length) return data.source_text ? "The post’s text" : "";
  const line = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return line[0].toUpperCase() + line.slice(1);
}

/** "saved yesterday", "saved Nov 6". */
export function savedWhen(iso: string, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime(),
    days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days === 0) return "saved today";
  if (days === 1) return "saved yesterday";
  return "saved " + date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}

/**
 * How far off a tip's start is for this child: "useful now", "about 3 weeks from now", or "" when it's past or
 * can't be said. A pregnancy counts on through the due date into baby age.
 */
export function timingDistance(relevance: Relevance | null | undefined, child: Pick<Child, "birth_date" | "due_date"> | null | undefined, now = new Date()) {
  if (!relevance || !child) return "";
  const stage = todayStage(child, now), num = (value?: number | null): value is number => typeof value === "number";
  const pregnancyLow = relevance.pregnancy_week_min, pregnancyHigh = relevance.pregnancy_week_max,
    babyLow = relevance.baby_age_min_weeks, babyHigh = relevance.baby_age_max_weeks;
  let weeks: number | null = null;
  if (stage === "pregnancy") {
    const progress = pregnancyProgress(child.due_date!, now);
    if (!progress) return "";
    if (num(pregnancyLow) || num(pregnancyHigh)) {
      if (num(pregnancyHigh) && pregnancyHigh < progress.week) return "";
      weeks = num(pregnancyLow) ? pregnancyLow - progress.week : 0;
    } else if (num(babyLow) || relevance.stage === "postpartum" || relevance.stage === "baby")
      weeks = Math.max(1, Math.round(progress.daysLeft / 7)) + (num(babyLow) ? babyLow : 0);
  } else if (stage === "baby" && !num(pregnancyLow) && !num(pregnancyHigh) && relevance.stage !== "pregnancy") {
    const age = babyAgeWeeks(child.birth_date!, now);
    if (num(babyHigh) && babyHigh < age) return "";
    weeks = num(babyLow) ? babyLow - age : 0;
  }
  if (weeks === null) return "";
  if (weeks <= 0) return "useful now";
  if (weeks === 1) return "next week";
  return weeks < 9 ? `about ${weeks} weeks from now` : `about ${Math.round((weeks * 12) / 52)} months from now`;
}
