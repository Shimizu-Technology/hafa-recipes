import type { BabyRecord, Bootstrap, Child, DeviceState, EditorDraft } from "./models";
import { canBeJustMe } from "./family";
import { choiceFor, familySpaces, spaceForNew } from "./spaces";

/** Plain words for where each kind of writing goes, so she knows where to look for it later. None of it is about health. */
type State = Pick<DeviceState, "bootstrap">;
const inFamily = (bootstrap: Bootstrap | undefined, space?: string | null) => familySpaces(bootstrap).some((known) => known.id === space);

/** A baby's Note is on that baby's day, with their care, which the whole family can read. */
export function noteWhere(child: Pick<Child, "name" | "space_id">, bootstrap?: Bootstrap) {
  const name = child.name.trim();
  return `Goes in Tracker, on ${name ? `${name}’s` : "this baby’s"} day.${inFamily(bootstrap, child.space_id) ? " Your family can see it." : ""}`;
}
/** Hers, with no baby on it, and it stays out of any family. */
export const feelingWhere = "Just for you. Goes in Tracker.";
/** The one note on the contraction timer. It starts private, and if she's shared it from Journal, it says so. */
export const doctorNoteWhere = (bootstrap: Bootstrap | undefined, note?: Pick<BabyRecord, "space_id">) =>
  inFamily(bootstrap, note?.space_id) ? "Shared with your family. It’s in your Journal too." : "Just for you. It’s in your Journal too.";

/** One line above a new entry or question. A caregiver's own line already says who can see it, and so does a choice on the form. */
export function writingWhere(state: State, draft: Pick<EditorDraft, "kind" | "existing" | "child_id" | "data" | "space_id" | "shared">) {
  const bootstrap = state.bootstrap;
  if (draft.existing || (draft.kind !== "journal" && draft.kind !== "question")) return "";
  const place = draft.kind === "journal" ? "Goes in your Journal." : "Goes in your Journal, under Doctor questions.";
  if (familySpaces(bootstrap)[0]?.role === "caregiver" || choiceFor(bootstrap, draft)) return place;
  return `${place} ${inFamily(bootstrap, spaceForNew(state, draft)) ? "Parents in your family can see it." : "Only you can see it."}`;
}

/** An event's own Note stays on the event, and whoever sees that reads it. A saved one is where it is, and a new one goes where its form says. */
export function eventNoteWhere(state: State, draft: Pick<EditorDraft, "kind" | "existing" | "child_id" | "data" | "space_id" | "shared">, saved?: Pick<BabyRecord, "space_id">) {
  const space = draft.existing ? saved?.space_id : choiceFor(state.bootstrap, draft)?.space_id ?? spaceForNew(state, draft);
  return `Stays with this event, not in your Journal.${inFamily(state.bootstrap, space) ? " Anyone who can see the event can read it." : ""}`;
}

/** What "Shared with family" means for what only parents read: a caregiver's list leaves these out. */
export const sharedDetail = (kind: BabyRecord["kind"]) => (canBeJustMe(kind) || kind === "question" ? "The parents in your family can read it." : undefined);

/**
 * Whether she can move this between Shared and Just me, as the API has it. A journal entry is only ever its writer's to move,
 * and a shared post its maker's, unless they've left. Still queued (no author yet) means hers.
 */
export function canMoveEntry(record: Pick<BabyRecord, "kind" | "created_by">, owner: string) {
  if (record.created_by === undefined || record.created_by === owner) return true;
  return record.kind !== "journal" && record.created_by === null;
}
