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
  opens: "panel" | "quick-log" | "/kicks" | "/contractions";
}

const born: readonly Stage[] = ["born"], expecting: readonly Stage[] = ["expecting"], none: readonly Stage[] = [];

/** Every tracker in the app, the one list that Add and "what shows" read. Its words are labels, with no reading of anything logged. */
export const trackers: readonly Tracker[] = [
  { id: "breast", label: "Breastfeed", icon: "care:mother-nurse", kind: "feeding", defaultOn: born, offeredIn: born, about: "baby", opens: "quick-log" },
  { id: "bottle", label: "Bottle", icon: "care:baby-bottle-outline", kind: "feeding", defaultOn: born, offeredIn: born, about: "baby", opens: "quick-log" },
  { id: "diaper", label: "Diaper", icon: "care:human-baby-changing-table", kind: "diaper", defaultOn: born, offeredIn: born, about: "baby", opens: "quick-log" },
  { id: "sleep", label: "Sleep", icon: "moon-outline", kind: "sleep", defaultOn: born, offeredIn: born, about: "baby", opens: "quick-log" },
  { id: "kicks", label: "Kick counter", icon: "footsteps-outline", kind: "kick_session", defaultOn: expecting, offeredIn: expecting, about: "baby", opens: "/kicks" },
  { id: "contractions", label: "Contraction timer", icon: "pulse-outline", kind: "contraction", defaultOn: expecting, offeredIn: expecting, about: "baby", opens: "/contractions" },
  { id: "feeling", label: "How I’m feeling", icon: "happy-outline", kind: "custom", dataLabel: "How I'm feeling", defaultOn: expecting, offeredIn: expecting, about: "her", opens: "panel" },
  { id: "my_weight", label: "My weight", icon: "scale-outline", kind: "custom", dataLabel: "My weight", defaultOn: expecting, offeredIn: expecting, about: "her", opens: "panel" },
  { id: "blood_pressure", label: "Blood pressure", icon: "heart-outline", kind: "custom", dataLabel: "Blood pressure", defaultOn: expecting, offeredIn: expecting, about: "her", opens: "panel" },
  { id: "vitamins", label: "Vitamins & medicine", icon: "nutrition-outline", kind: "custom", dataLabel: "Vitamins and medicine", defaultOn: expecting, offeredIn: expecting, about: "her", opens: "panel" },
  { id: "pumping", label: "Pumping", icon: "water-outline", kind: "pumping", defaultOn: none, offeredIn: born, about: "baby", opens: "panel" },
  { id: "medicine", label: "Medicine", icon: "bandage-outline", kind: "medicine", defaultOn: none, offeredIn: born, about: "baby", opens: "panel" },
  { id: "temperature", label: "Temperature", icon: "thermometer-outline", kind: "temperature", defaultOn: none, offeredIn: born, about: "baby", opens: "panel" },
  { id: "growth", label: "Growth", icon: "trending-up-outline", kind: "growth", defaultOn: none, offeredIn: born, about: "baby", opens: "panel" },
  { id: "note", label: "Note", icon: "create-outline", kind: "custom", dataLabel: "Note", defaultOn: none, offeredIn: born, about: "baby", opens: "panel" },
  { id: "custom", label: "Custom", icon: "star-outline", kind: "custom", defaultOn: none, offeredIn: born, about: "baby", opens: "panel" },
];

export const trackerById = (id: string) => trackers.find((tracker) => tracker.id === id);
export const trackersFor = (stage: Stage) => trackers.filter((tracker) => tracker.offeredIn.includes(stage));
/** The ones with a `TrackerPanel` of their own, for a stage. */
export const panelTrackers = (stage: Stage) => trackersFor(stage).filter((tracker) => tracker.opens === "panel");
export const shotLabel = "Shot";

/** Which tracker a saved entry came from. A shot has its own place in Well visits, and a label nobody listed is one she made up. */
export function trackerFor({ kind, data }: Pick<BabyRecord, "kind" | "data">) {
  if (kind === "feeding") return trackerById(data.method === "bottle" ? "bottle" : "breast");
  if (kind !== "custom") return trackers.find((tracker) => tracker.kind === kind);
  if (data.label === shotLabel) return undefined;
  return trackers.find((tracker) => tracker.kind === "custom" && tracker.dataLabel === data.label) ?? trackerById("custom");
}
