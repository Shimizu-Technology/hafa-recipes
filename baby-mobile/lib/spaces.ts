import type { Fence } from "./api";
import type { Bootstrap, BabySpace, DeviceState, EditorDraft, Kind, RecordWrite } from "./models";
import { trackerFor } from "./trackers";

/** The API listed this account's spaces, which it only does with the family stack on. */
export const spacesLive = (bootstrap?: Pick<Bootstrap, "spaces"> | null) => !!bootstrap?.spaces?.length;
export const familySpaces = (bootstrap?: Pick<Bootstrap, "spaces"> | null): BabySpace[] => (bootstrap?.spaces ?? []).filter((space) => space.kind === "family");
/** Whether to offer Family at all. Someone already in one keeps it, whatever the rehearsal's list says. */
export const familyOpen = (bootstrap?: Pick<Bootstrap, "spaces" | "family_available"> | null) =>
  spacesLive(bootstrap) && (bootstrap?.family_available !== false || !!familySpaces(bootstrap).length);
/**
 * What a screen's data depends on: which families, and in what role. The personal space is left out, so the flag turning
 * on doesn't remount an open editor, and so is the access version, which also moves when a file is taken off a record.
 */
export const accessKey = (bootstrap?: Pick<Bootstrap, "spaces"> | null) =>
  familySpaces(bootstrap).map((space) => `${space.id}:${space.role}`).sort().join("|");

/** Only ever true with the API's push flag on. Everything to do with reminders hangs off this. */
export const remindersOn = (bootstrap?: Pick<Bootstrap, "reminders"> | null) => !!bootstrap?.reminders?.push;

/** What the API answers for something this phone can't see, and how an older build wrote that down. */
export const unavailableMessage = "This item is no longer available. Keep your local copy or discard this change.";
export const goneBabyMessage = "This baby’s profile was removed.";
export const stuckTapMessage = "This tap couldn’t be added to the feed. It’s safe on this phone.";
/** The space a row lives in. An older build saved no space, and everything was personal then. */
export const spaceOf = (row: { space_id?: string }, personal?: string) => row.space_id ?? personal;
/** A space's own generation. No space, or the API not listing any, means the personal one. A space this account isn't in has none. */
export function generationOf(bootstrap: Pick<Bootstrap, "generation" | "spaces" | "personal_space_id"> | undefined, space?: string | null) {
  if (!bootstrap) return undefined;
  if (!space || !bootstrap.spaces?.length || space === bootstrap.personal_space_id) return bootstrap.generation;
  return bootstrap.spaces?.find((known) => known.id === space)?.generation;
}
/** What a queued change is fenced by. A bare number names no space, which is all the API takes with its flag off. */
export const fenceOf = (m: { generation: number; space_id?: string }): Fence => (m.space_id ? { generation: m.generation, space_id: m.space_id } : m.generation);
/** The same for a row the API sent, which says where it lives. */
export const rowFence = (row: { generation?: number; space_id?: string }, generation: number): Fence =>
  row.space_id && row.generation !== undefined ? { generation: row.generation, space_id: row.space_id } : generation;
/** Mirrors the API's list: what a caregiver may read and write in a family. */
const caregiverKinds = new Set<Kind>(["feeding", "sleep", "diaper", "routine", "event", "contraction", "kick_session", "pumping", "medicine", "temperature", "growth", "milestone", "custom"]);
/** A log about her, not the baby. It goes with her, not with the family. */
export const herLog = (record: Pick<RecordWrite, "kind" | "data" | "child_id">) => !record.child_id && trackerFor(record)?.about === "her";
/**
 * Where a new entry goes (section 4.4). Care follows its baby. A journal entry, a log about her, and anything chosen as
 * Just me stay personal. Everything else shared goes to the family when there is one. Nothing with the flag off.
 */
export function spaceForNew(state: Pick<DeviceState, "bootstrap">, record: Pick<RecordWrite, "kind" | "child_id" | "data">) {
  const { bootstrap } = state;
  if (!spacesLive(bootstrap)) return undefined;
  const personal = bootstrap!.personal_space_id!, family = familySpaces(bootstrap)[0];
  if (record.kind === "journal" || record.data.just_me || herLog(record)) return personal;
  if (family?.role === "caregiver" && !caregiverKinds.has(record.kind)) return personal;
  const child = record.child_id ? bootstrap!.children.find((known) => known.id === record.child_id) : undefined;
  return child?.space_id ?? family?.id ?? personal;
}
/** Where a new baby goes: a family's parents add them to the family, and otherwise they're this account's own. */
export function spaceForChild({ bootstrap }: Pick<DeviceState, "bootstrap">) {
  if (!spacesLive(bootstrap)) return undefined;
  const family = familySpaces(bootstrap)[0];
  return family?.role === "parent" ? family.id : bootstrap!.personal_space_id;
}
/** The fence for writing to a space this phone chose. */
export const spaceFence = (bootstrap: Bootstrap, space?: string): Fence =>
  fenceOf({ generation: generationOf(bootstrap, space) ?? bootstrap.generation, space_id: space });
/**
 * Family work on this phone, which an older build mustn't read: it would discard a queued family tap and offer no way
 * back. It refuses a vault of the next version outright, and overwrites nothing.
 */
export function holdsFamilyWork(state: Pick<DeviceState, "bootstrap" | "records" | "outbox">) {
  const personal = state.bootstrap?.personal_space_id, elsewhere = (space?: string) => !!space && space !== personal;
  return familySpaces(state.bootstrap).length > 0 || state.records.some((row) => elsewhere(row.space_id)) || state.outbox.some((m) => elsewhere(m.space_id));
}
/** What can be saved to a family if she says so. Care goes with its baby. */
const choosable = new Set<Kind>(["source", "journal", "question", "routine", "event", "collection"]);
/**
 * Shared with family, or Just me, as a new entry is written. A new post or event starts shared and a new journal entry
 * private. An event goes with a baby who's only hers, since the API keeps it in its baby's space. A draft from before
 * the family starts private, whatever its kind, since pending work is never published on its own, and she can still
 * choose Shared. Only a parent in a family has anything to choose.
 */
export function choiceFor(bootstrap: Bootstrap | undefined, draft: Pick<EditorDraft, "kind" | "existing" | "shared" | "space_id"> & { child_id?: string | null }) {
  const family = familySpaces(bootstrap)[0];
  if (draft.existing || family?.role !== "parent") return null;
  const held = !!draft.space_id, personalBaby = draft.kind === "event" && bootstrap!.children.some((child) => child.id === draft.child_id && child.space_id === bootstrap!.personal_space_id);
  if (held ? !choosable.has(draft.kind) : draft.kind !== "source" && draft.kind !== "journal" && draft.kind !== "event") return null;
  const shared = draft.shared ?? (!held && (draft.kind === "source" || (draft.kind === "event" && !personalBaby)));
  return { shared, space_id: shared ? family.id : bootstrap!.personal_space_id!, just_me: !shared && draft.kind === "source" };
}
/**
 * Where a new draft is going, written down each time it's saved, so erasure and removal can tell whose it is. Its choice
 * moves it, and so does changing to a baby in another space. A late write from an editor opened before a family arrived
 * doesn't know where joining put its draft, so the destination already held wins.
 */
export function stampedDraft(state: Pick<DeviceState, "bootstrap">, held: EditorDraft | undefined, draft: EditorDraft): EditorDraft {
  const { bootstrap } = state;
  if (draft.existing || !spacesLive(bootstrap)) return draft;
  // What it was saved with stands until she says otherwise: the form on screen may not have heard it.
  const placed = held?.space_id ? { ...draft, space_id: held.space_id, generation: held.generation, shared: draft.shared ?? held.shared } : draft,
    choice = choiceFor(bootstrap, placed),
    space = choice?.space_id ?? (placed.space_id && (!held || placed.child_id === held.child_id) ? placed.space_id : spaceForNew(state, placed)!);
  return { ...placed, ...(choice ? { shared: choice.shared } : {}), space_id: space, generation: bootstrap!.spaces!.find((one) => one.id === space)?.generation ?? bootstrap!.generation };
}
type ChoosingBaby = Pick<Bootstrap, "children" | "spaces" | "personal_space_id"> & Partial<Bootstrap>;
type ChoosingDraft = Pick<EditorDraft, "kind" | "existing" | "space_id" | "shared" | "child_id">;
type SavedRow = { space_id?: string; child_id?: string | null };
/**
 * The babies an entry can be for, since the API refuses a baby from another space. A saved entry stays where it is, and
 * the row knows that better than a draft held from before a move. A new one goes where its choice says, and otherwise
 * follows its baby. A personal journal entry is the one thing that can name a baby in any space.
 */
export function babiesFor(bootstrap: ChoosingBaby, draft: ChoosingDraft, saved?: SavedRow) {
  const { children, personal_space_id: personal } = bootstrap;
  if (!spacesLive(bootstrap)) return children;
  if (draft.existing) {
    const space = saved?.space_id ?? draft.space_id ?? personal;
    return draft.kind === "journal" && space === personal ? children : children.filter((child) => child.space_id === space);
  }
  const choice = choiceFor(bootstrap as Bootstrap, draft);
  if (!choice || draft.kind === "event" || (draft.kind === "journal" && !choice.shared)) return children;
  return children.filter((child) => child.space_id === choice.space_id);
}
/**
 * The baby a draft really goes with. One it can't take isn't shown as chosen, so it isn't sent: a saved entry keeps the
 * baby it has, and a new one has none. A baby this phone hasn't heard of is left for the API to answer.
 */
export function fittingChild(bootstrap: ChoosingBaby, draft: ChoosingDraft, saved?: SavedRow) {
  const { child_id: child } = draft;
  if (!child || !bootstrap.children.some((known) => known.id === child) || babiesFor(bootstrap, draft, saved).some((fits) => fits.id === child)) return child;
  return draft.existing ? saved?.child_id ?? null : null;
}
/** A caregiver can still keep a post or their own log, but it isn't shared, and nothing else on the way there would say so. */
export const caregiverKeeps = (state: Pick<DeviceState, "bootstrap">, draft: Pick<EditorDraft, "kind" | "existing" | "child_id" | "data">) =>
  isCaregiver(state.bootstrap) && !draft.existing && spaceForNew(state, draft) === state.bootstrap!.personal_space_id;
/** A baby's name, and whose it is when this account has both kinds, so two called the same can be told apart. */
export function babyLabel(child: { name: string; space_id?: string }, bootstrap?: Pick<Bootstrap, "children" | "personal_space_id"> | null) {
  const personal = bootstrap?.personal_space_id, spaces = (bootstrap?.children ?? []).map((one) => one.space_id);
  if (!personal || !spaces.includes(personal) || !spaces.some((space) => space && space !== personal)) return child.name;
  return `${child.name} · ${child.space_id === personal ? "Personal" : "Family"}`;
}
/** Helping in a family, not running it. The API refuses them the rest: this is so she's never offered what it'd refuse. */
export const isCaregiver = (bootstrap?: Pick<Bootstrap, "spaces"> | null) => familySpaces(bootstrap)[0]?.role === "caregiver";
export const canAddBaby = (bootstrap?: Pick<Bootstrap, "spaces"> | null) => !isCaregiver(bootstrap);
/** Changing a profile takes a parent of the space that baby lives in. */
export const canChangeBaby = (bootstrap: Pick<Bootstrap, "spaces"> | null | undefined, child: { space_id?: string }) =>
  !child.space_id || bootstrap?.spaces?.find((space) => space.id === child.space_id)?.role !== "caregiver";
