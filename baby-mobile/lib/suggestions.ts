import { ApiError, type BabyApi } from "./api";
import { changeCategory } from "./categories";
import type { BabyRecord, DeviceState, SuggestedCategory } from "./models";
import { replaceRecord } from "./outbox";

type Account = {
  api: Pick<BabyApi, "decideSuggestions" | "record" | "save" | "remove">;
  commit: (change: (s: DeviceState) => DeviceState) => Promise<void>;
  state: Pick<DeviceState, "bootstrap" | "outbox">;
};

export const offlineDecision = "You’re offline. Try again when you’re connected.";

export function pendingSuggestion(record: Pick<BabyRecord, "kind" | "data">) {
  const suggestion = record.data.suggested_category;
  return record.kind === "source" && suggestion?.status === "pending" && suggestion.name ? suggestion : null;
}

/** A post with an unsynced save can't be decided yet: its revision isn't on the server. */
export function decidable(state: Pick<DeviceState, "outbox">, record: Pick<BabyRecord, "id" | "kind" | "data">) {
  return !!pendingSuggestion(record) && !state.outbox.some((m) => m.type === "save" && m.record.id === record.id);
}

/** The API's name key: letters and numbers in any script, case- and width-folded; emoji-only names keep their emoji. */
export function comparableName(text: string) {
  const folded = text.normalize("NFKC").toLowerCase().replace(/[︀-️‍]/g, "");
  return folded.replace(/[^\p{L}\p{M}\p{N}]/gu, " ").split(/\s+/).filter(Boolean).join(" ")
    || folded.split(/\s+/).filter(Boolean).join(" ");
}

/** True when accepting will create a category: no id, and no loaded category the server would reuse by name. */
export function createsCategory(suggestion: SuggestedCategory, categories: readonly Pick<BabyRecord, "kind" | "title">[]) {
  if (suggestion.collection_id) return false;
  const name = comparableName(suggestion.name);
  return !categories.some((row) => row.kind === "collection" && !!name && comparableName(row.title) === name);
}

/** What one accept call changed, kept so Undo can put it back exactly. */
export interface AcceptOutcome {
  /** `unfiled` marks an item already taken back out of its category by an earlier, partial Undo. */
  accepted: { record_id: string; collection_id: string; name: string; before: SuggestedCategory; unfiled?: boolean }[];
  /** Categories this request created (returned at revision 1). Undo removes them only if they end up empty. */
  created: string[];
  conflicts: number;
  /** Full categories, with the posts that couldn't go in, so the parent can choose another. */
  full: { name: string; record_id: string }[];
  skipped: number;
}

/** File sources into their suggested categories. Partial success is normal: each item reports its own result. */
export async function acceptSuggestions(account: Account, sources: readonly BabyRecord[]) {
  const chosen = sources.filter((row) => decidable(account.state, row)).slice(0, 100);
  const outcome: AcceptOutcome = { accepted: [], created: [], conflicts: 0, full: [], skipped: 0 };
  if (!chosen.length) return outcome;
  const generation = account.state.bootstrap!.generation;
  const response = await account.api.decideSuggestions(chosen.map((row) => ({ record_id: row.id, revision: row.revision })), generation);
  const refetch = new Set<string>();
  for (const result of response.results) {
    const source = chosen.find((row) => row.id === result.record_id);
    if (!source) continue;
    const before = pendingSuggestion(source)!;
    if (result.status === "accepted" && result.collection_id) {
      const category = response.collections.find((row) => row.id === result.collection_id);
      outcome.accepted.push({ record_id: source.id, collection_id: result.collection_id, name: category?.title || before.name, before });
      // The server creates a category at revision 1 and bumps any existing one; a replay returns no row at all.
      if (category?.revision === 1 && !outcome.created.includes(category.id)) outcome.created.push(category.id);
      // A replay after a lost response isn't repeated in the envelope: load the post and its category.
      if (!response.records.some((row) => row.id === source.id)) refetch.add(source.id);
      if (!category) refetch.add(result.collection_id);
    } else if (result.status === "conflict" || result.status === "no_suggestion") {
      if (result.status === "conflict") outcome.conflicts++;
      else outcome.skipped++;
      refetch.add(source.id);
    } else if (result.status === "category_full") outcome.full.push({ name: before.name, record_id: source.id });
    else outcome.skipped++;
  }
  const fresh = (await Promise.all([...refetch].map((id) => account.api.record(id).catch(() => null)))).filter((row): row is BabyRecord => !!row);
  // Name a replayed item after the category it is actually in.
  for (const item of outcome.accepted) {
    const category = fresh.find((row) => row.kind === "collection" && row.id === item.collection_id);
    if (category?.title) item.name = category.title;
  }
  await account.commit((s) => ({ ...s, records: [...response.records, ...response.collections, ...fresh].reduce(replaceRecord, s.records) }));
  return outcome;
}

/** "Added to Labor prep." / "Filed 5 posts into 3 categories. 1 changed elsewhere, so try it again." */
export function acceptMessage(outcome: AcceptOutcome) {
  const names = [...new Set(outcome.accepted.map((item) => item.name))], count = outcome.accepted.length,
    full = [...new Set(outcome.full.map((item) => item.name))];
  const parts = [
    count === 1 ? `Added to ${names[0]}.` : count ? `Filed ${count} posts into ${names.length} ${names.length === 1 ? "category" : "categories"}.` : "",
    outcome.conflicts ? `${outcome.conflicts} changed elsewhere, so try ${outcome.conflicts === 1 ? "it" : "them"} again.` : "",
    full.length ? `${full.join(", ")} ${full.length === 1 ? "is" : "are"} full (500 posts). Choose another category.` : "",
    !count && !outcome.conflicts && !full.length ? "These suggestions were already handled." : "",
  ];
  return parts.filter(Boolean).join(" ");
}

/** The whole accept failed because a stored category can't be updated: offer the category picker instead. */
export const needsAnotherCategory = (failure: unknown) => failure instanceof ApiError && failure.status === 422;

/** Plain copy for a failed accept, dismiss or Undo. Nothing is queued, so offline says so. */
export function decisionError(failure: unknown) {
  if (failure instanceof ApiError && failure.status === 0) return offlineDecision;
  if (failure instanceof ApiError && failure.status === 422) return "This category can’t be updated. Choose another category.";
  return failure instanceof Error ? failure.message : "Something interrupted this step. Try again.";
}

export interface UndoResult {
  restored: number;
  /** What still needs undoing, ready to pass back to `undoAccepted`; null when everything was put back. */
  remaining: AcceptOutcome | null;
  offline: boolean;
}

/** Take the posts back out and restore the pending suggestions, one category at a time, so one failure
 * doesn't stop the rest. A category is deleted only if this accept created it and it is now empty. */
export async function undoAccepted(account: Account, outcome: AcceptOutcome): Promise<UndoResult> {
  const generation = account.state.bootstrap!.generation, left: AcceptOutcome["accepted"] = [];
  let offline = false;
  const failed = (failure: unknown) => { offline ||= failure instanceof ApiError && failure.status === 0; };
  const unfiled = outcome.accepted.filter((item) => item.unfiled);
  for (const collectionId of new Set(outcome.accepted.filter((item) => !item.unfiled).map((item) => item.collection_id))) {
    const items = outcome.accepted.filter((item) => !item.unfiled && item.collection_id === collectionId);
    let record: BabyRecord;
    try {
      ({ record } = await changeCategory(account.api, collectionId, items.map((item) => item.record_id), generation, "remove"));
    } catch (failure) {
      failed(failure);
      left.push(...items);
      continue;
    }
    unfiled.push(...items.map((item) => ({ ...item, unfiled: true })));
    let removed = false;
    if (outcome.created.includes(collectionId) && !(record.data.record_ids ?? []).length) {
      // A 409 here means something new was filed meanwhile; the category stays.
      removed = await account.api.remove(record, generation).then(() => true, (failure) => (failed(failure), false));
    }
    await account.commit((s) => ({ ...s, records: removed ? s.records.filter((row) => row.id !== collectionId) : replaceRecord(s.records, record) }));
  }
  for (const item of unfiled) {
    try { await restoreSuggestion(account, item.record_id, item.before); }
    catch (failure) { failed(failure); left.push(item); }
  }
  return { restored: outcome.accepted.length - left.length, remaining: left.length ? { ...outcome, accepted: left } : null, offline };
}

/** "Moved back to Uncategorized." or exactly what is left, so the parent can try again. */
export function undoMessage(result: UndoResult) {
  const left = result.remaining?.accepted.length ?? 0;
  if (!left) return "Moved back to Uncategorized.";
  const done = result.restored ? `Moved ${result.restored} back. ` : "";
  const rest = left === 1 ? "1 post" : `${left} posts`;
  return result.offline ? `${done}You’re offline. Try ${result.restored ? `the other ${rest}` : "again"} when you’re connected.`
    : `${done}${rest} couldn’t be moved back yet.`;
}

/** Put a decided suggestion back to pending on the newest copy of the post. */
export async function restoreSuggestion(account: Account, id: string, before: SuggestedCategory) {
  const source = await account.api.record(id),
    saved = await account.api.save({ ...source, data: { ...source.data, suggested_category: { ...before, status: "pending" } } },
      account.state.bootstrap!.generation);
  await account.commit((s) => ({ ...s, records: replaceRecord(s.records, saved) }));
}

/** "Not this": the post stays in Uncategorized and is not suggested there again.
 * Returns the suggestion for Undo only when this tap (or its replay) dismissed it. */
export async function dismissSuggestion(account: Account, source: BabyRecord) {
  const before = pendingSuggestion(source);
  if (!before || !decidable(account.state, source)) return { status: "no_suggestion" as const, before: null };
  const response = await account.api.decideSuggestions([{ record_id: source.id, revision: source.revision }], account.state.bootstrap!.generation, "dismiss");
  const status = response.results[0]?.status ?? "unavailable",
    // A conflict, an already-decided post or a replay without a row: load the post as it is now.
    fresh = status !== "unavailable" && !response.records.some((row) => row.id === source.id)
      ? await account.api.record(source.id).catch(() => null) : null;
  await account.commit((s) => ({ ...s, records: [...response.records, ...(fresh ? [fresh] : [])].reduce(replaceRecord, s.records) }));
  if (status === "conflict") throw Error("This post changed on another device. Check it and try again.");
  return { status, before: status === "dismissed" ? before : null };
}

/** What to say after "Not this", or nothing worth an Undo. */
export function dismissMessage(status: string) {
  return status === "dismissed" ? "Suggestion removed." : status === "unavailable" ? "This post is no longer available."
    : "This suggestion was already handled.";
}
