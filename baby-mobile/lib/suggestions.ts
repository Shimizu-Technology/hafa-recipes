import type { BabyApi } from "./api";
import { changeCategory } from "./categories";
import type { BabyRecord, DeviceState, SuggestedCategory } from "./models";
import { replaceRecord } from "./outbox";

type Account = {
  api: Pick<BabyApi, "decideSuggestions" | "record" | "save" | "remove">;
  commit: (change: (s: DeviceState) => DeviceState) => Promise<void>;
  state: Pick<DeviceState, "bootstrap">;
};

export function pendingSuggestion(record: Pick<BabyRecord, "kind" | "data">) {
  const suggestion = record.data.suggested_category;
  return record.kind === "source" && suggestion?.status === "pending" && suggestion.name ? suggestion : null;
}

/** What one accept call changed, kept so Undo can put it back exactly. */
export interface AcceptOutcome {
  accepted: { record_id: string; collection_id: string; name: string; before: SuggestedCategory }[];
  /** Categories that did not exist before this accept; Undo removes them if they end up empty. */
  created: string[];
  conflicts: number;
  full: string[];
  skipped: number;
}

/** File sources into their suggested categories. Partial success is normal: each item reports its own result. */
export async function acceptSuggestions(account: Account, sources: readonly BabyRecord[], knownCategories: ReadonlySet<string>) {
  const chosen = sources.filter((row) => pendingSuggestion(row)).slice(0, 100);
  const outcome: AcceptOutcome = { accepted: [], created: [], conflicts: 0, full: [], skipped: 0 };
  if (!chosen.length) return outcome;
  const generation = account.state.bootstrap!.generation;
  const response = await account.api.decideSuggestions(chosen.map((row) => ({ record_id: row.id, revision: row.revision })), generation);
  const stale: string[] = [];
  for (const result of response.results) {
    const source = chosen.find((row) => row.id === result.record_id);
    if (result.status === "accepted" && result.collection_id && source) {
      const category = response.collections.find((row) => row.id === result.collection_id);
      outcome.accepted.push({ record_id: source.id, collection_id: result.collection_id,
        name: category?.title || pendingSuggestion(source)!.name, before: pendingSuggestion(source)! });
      if (!knownCategories.has(result.collection_id) && !outcome.created.includes(result.collection_id))
        outcome.created.push(result.collection_id);
    } else if (result.status === "conflict") {
      outcome.conflicts++;
      stale.push(result.record_id);
    } else if (result.status === "category_full" && source) outcome.full.push(pendingSuggestion(source)!.name);
    else outcome.skipped++;
  }
  // A stale revision means the post changed on another device; load it so the next tap uses it.
  const fresh = (await Promise.all(stale.map((id) => account.api.record(id).catch(() => null)))).filter((row): row is BabyRecord => !!row);
  await account.commit((s) => ({ ...s, records: [...response.records, ...response.collections, ...fresh].reduce(replaceRecord, s.records) }));
  return outcome;
}

/** "Added to Labor prep." / "Filed 5 posts into 3 categories. 1 changed elsewhere, so try it again." */
export function acceptMessage(outcome: AcceptOutcome) {
  const names = [...new Set(outcome.accepted.map((item) => item.name))], count = outcome.accepted.length;
  const parts = [
    count === 1 ? `Added to ${names[0]}.` : count ? `Filed ${count} posts into ${names.length} ${names.length === 1 ? "category" : "categories"}.` : "",
    outcome.conflicts ? `${outcome.conflicts} changed elsewhere, so try ${outcome.conflicts === 1 ? "it" : "them"} again.` : "",
    outcome.full.length ? `${[...new Set(outcome.full)].join(", ")} is full. Choose another category.` : "",
    !count && !outcome.conflicts && !outcome.full.length ? "These suggestions were already handled." : "",
  ];
  return parts.filter(Boolean).join(" ");
}

/** Take the posts back out, restore the pending suggestions, and drop categories this accept created if they are now empty. */
export async function undoAccepted(account: Account, outcome: AcceptOutcome) {
  const generation = account.state.bootstrap!.generation, changed: BabyRecord[] = [];
  for (const collectionId of new Set(outcome.accepted.map((item) => item.collection_id))) {
    const ids = outcome.accepted.filter((item) => item.collection_id === collectionId).map((item) => item.record_id);
    const { record } = await changeCategory(account.api, collectionId, ids, generation, "remove");
    if (outcome.created.includes(collectionId) && !(record.data.record_ids ?? []).length) {
      await account.api.remove(record, generation);
      await account.commit((s) => ({ ...s, records: s.records.filter((row) => row.id !== collectionId) }));
    } else changed.push(record);
  }
  await account.commit((s) => ({ ...s, records: changed.reduce(replaceRecord, s.records) }));
  for (const item of outcome.accepted) await restoreSuggestion(account, item.record_id, item.before);
}

/** Put a decided suggestion back to pending on the newest copy of the post. */
export async function restoreSuggestion(account: Account, id: string, before: SuggestedCategory) {
  const source = await account.api.record(id),
    saved = await account.api.save({ ...source, data: { ...source.data, suggested_category: { ...before, status: "pending" } } },
      account.state.bootstrap!.generation);
  await account.commit((s) => ({ ...s, records: replaceRecord(s.records, saved) }));
}

/** "Not this": the post stays in Uncategorized and is not suggested there again. Returns the suggestion for Undo. */
export async function dismissSuggestion(account: Account, source: BabyRecord) {
  const before = pendingSuggestion(source);
  if (!before) return null;
  const response = await account.api.decideSuggestions([{ record_id: source.id, revision: source.revision }], account.state.bootstrap!.generation, "dismiss");
  const status = response.results[0]?.status,
    fresh = status === "conflict" ? await account.api.record(source.id).catch(() => null) : null;
  await account.commit((s) => ({ ...s, records: [...response.records, ...(fresh ? [fresh] : [])].reduce(replaceRecord, s.records) }));
  if (status === "conflict") throw Error("This post changed on another device. Check it and try again.");
  return status === "dismissed" ? before : null;
}
