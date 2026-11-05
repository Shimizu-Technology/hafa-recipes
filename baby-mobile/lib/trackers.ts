import type { IconName } from "../components/ui";
import type { BabyRecord, Kind } from "./models";

export type Stage = "expecting" | "born";
export interface Tracker {
  id: string;
  label: string;
  icon: IconName;
  /** How it's saved: its kind, and for a `custom` entry the label that tells it apart, as a shot's does. */
  kind: Kind;
  dataLabel?: string;
  /** Where it starts switched on, per EXACT_PLAN section 16. Someone can always override that. */
  defaultOn: readonly Stage[];
  /** Where it's offered at all, on or off. */
  offeredIn: readonly Stage[];
  /** A log about her isn't about the baby, so it has no `child_id`. */
  about: "baby" | "her";
  /** What tapping it reaches: its `TrackerPanel`, a panel inside `QuickLog`, or its own screen. */
  opens: "panel" | "quick-log" | "/kicks" | "/contractions" | "/well-visits" | "/milestones";
  /** A line for where it's listed with room to say what it does. */
  detail?: string;
}

const born: readonly Stage[] = ["born"], expecting: readonly Stage[] = ["expecting"], both: readonly Stage[] = ["expecting", "born"], none: readonly Stage[] = [];

/** Every tracker in the app, the one list that Add and "what shows" read. Its words are labels, with no reading of anything logged. */
export const trackers: readonly Tracker[] = [
  { id: "breast", label: "Breastfeed", icon: "care:mother-nurse", kind: "feeding", defaultOn: born, offeredIn: both, about: "baby", opens: "quick-log", detail: "Choose left, right or both. A tap saves it." },
  { id: "bottle", label: "Bottle", icon: "care:baby-bottle-outline", kind: "feeding", defaultOn: born, offeredIn: both, about: "baby", opens: "quick-log", detail: "Choose an amount and breast milk or formula. A tap saves it." },
  { id: "diaper", label: "Diaper", icon: "care:human-baby-changing-table", kind: "diaper", defaultOn: born, offeredIn: both, about: "baby", opens: "quick-log", detail: "Choose pee, poo, both or dry. A tap saves it." },
  { id: "sleep", label: "Sleep", icon: "moon-outline", kind: "sleep", defaultOn: born, offeredIn: both, about: "baby", opens: "quick-log", detail: "Starts a sleep" },
  { id: "kicks", label: "Kick counter", icon: "footsteps-outline", kind: "kick_session", defaultOn: expecting, offeredIn: both, about: "baby", opens: "/kicks", detail: "A tap for each movement, and your history" },
  { id: "contractions", label: "Contraction timer", icon: "pulse-outline", kind: "contraction", defaultOn: expecting, offeredIn: both, about: "baby", opens: "/contractions", detail: "Start, stop, and the last hour" },
  { id: "pumping", label: "Pumping", icon: "water-outline", kind: "pumping", defaultOn: none, offeredIn: born, about: "baby", opens: "panel" },
  { id: "medicine", label: "Medicine", icon: "bandage-outline", kind: "medicine", defaultOn: none, offeredIn: born, about: "baby", opens: "panel" },
  { id: "temperature", label: "Temperature", icon: "thermometer-outline", kind: "temperature", defaultOn: none, offeredIn: born, about: "baby", opens: "panel" },
  { id: "growth", label: "Growth", icon: "trending-up-outline", kind: "growth", defaultOn: none, offeredIn: born, about: "baby", opens: "panel" },
  { id: "note", label: "Note", icon: "create-outline", kind: "custom", dataLabel: "Note", defaultOn: none, offeredIn: born, about: "baby", opens: "panel" },
  { id: "custom", label: "Custom", icon: "star-outline", kind: "custom", defaultOn: none, offeredIn: born, about: "baby", opens: "panel" },
  // Hers, on by default until the birth and in Add after it. Blood pressure still matters then.
  { id: "feeling", label: "How I’m feeling", icon: "happy-outline", kind: "custom", dataLabel: "How I'm feeling", defaultOn: expecting, offeredIn: both, about: "her", opens: "panel" },
  { id: "my_weight", label: "My weight", icon: "scale-outline", kind: "custom", dataLabel: "My weight", defaultOn: expecting, offeredIn: both, about: "her", opens: "panel" },
  { id: "blood_pressure", label: "Blood pressure", icon: "heart-outline", kind: "custom", dataLabel: "Blood pressure", defaultOn: expecting, offeredIn: both, about: "her", opens: "panel" },
  { id: "vitamins", label: "Vitamins & medicine", icon: "nutrition-outline", kind: "custom", dataLabel: "Vitamins and medicine", defaultOn: expecting, offeredIn: both, about: "her", opens: "panel" },
  { id: "shot", label: "Shots", icon: "medkit-outline", kind: "custom", dataLabel: "Shot", defaultOn: none, offeredIn: born, about: "baby", opens: "/well-visits", detail: "Suggested visits, and the shots you record" },
  { id: "milestone", label: "Milestones", icon: "ribbon-outline", kind: "milestone", defaultOn: none, offeredIn: born, about: "baby", opens: "/milestones", detail: "CDC’s list, and your keepsakes" },
];

/** Things to keep rather than track, for Add. */
export const keepItems: readonly { kind: Kind; title: string; detail: string }[] = [
  { kind: "source", title: "Save a video or link", detail: "Video, link, screenshot, or document" },
  { kind: "journal", title: "Write in your journal", detail: "A thought, a memory, or a photo" },
  { kind: "event", title: "Add to the calendar", detail: "An appointment, baptism or family visit" },
  { kind: "question", title: "Keep a doctor question", detail: "Bring your questions to the next visit" },
  { kind: "routine", title: "Make a list", detail: "A checklist or a routine you review first" },
];

const unique = (kinds: Kind[]) => [...new Set(kinds)];
/** Every kind a tracker saves. */
export const trackedKinds: readonly Kind[] = unique(trackers.map((tracker) => tracker.kind));
/** The kinds with a `TrackerPanel`, for reading what's been logged. */
export const moreKinds: readonly Kind[] = unique(trackers.filter((tracker) => tracker.opens === "panel").map((tracker) => tracker.kind));

export const trackerById = (id: string) => trackers.find((tracker) => tracker.id === id);
export const trackersFor = (stage: Stage) => trackers.filter((tracker) => tracker.offeredIn.includes(stage));
/** The ones with a `TrackerPanel` of their own, for a stage. */
export const panelTrackers = (stage: Stage) => trackersFor(stage).filter((tracker) => tracker.opens === "panel");
export const shotLabel = "Shot";
/** Whether a tracker is on: its stage's default. */
export const trackerOn = (tracker: Tracker, stage: Stage) => tracker.defaultOn.includes(stage);

/** Which tracker a saved entry came from. A label nobody listed is one she made up. */
export function trackerFor({ kind, data }: Pick<BabyRecord, "kind" | "data">) {
  if (kind === "feeding") return trackerById(data.method === "bottle" ? "bottle" : "breast");
  if (kind !== "custom") return trackers.find((tracker) => tracker.kind === kind);
  return trackers.find((tracker) => tracker.kind === "custom" && tracker.dataLabel === data.label) ?? trackerById("custom");
}

/**
 * Whose a row is, when that isn't the baby on screen. A log about her has no baby. Nor does one whose baby was removed,
 * since removing a profile keeps its logs: older general feeds, sleep and diapers were never on a baby, so they say nothing.
 */
export function whoseLog(record: Pick<BabyRecord, "kind" | "data" | "child_id">) {
  const tracker = trackerFor(record);
  if (!tracker || record.child_id) return "";
  return tracker.about === "her" ? "For you" : tracker.opens === "quick-log" ? "" : "From a removed profile";
}
