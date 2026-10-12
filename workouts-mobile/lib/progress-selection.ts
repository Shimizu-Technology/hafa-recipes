import type { TrainingSession } from "./models";
import type { SavedLocalSession } from "./training";

export interface ProgressAncestry {
  records: TrainingSession[];
  complete: boolean;
}
export function missingProgressParents(local: readonly SavedLocalSession[], remote: readonly TrainingSession[], generation: number) {
  const ids = new Set([
    ...local.filter((x) => x.generation === generation).flatMap((x) => x.synced_id ? [x.synced_id] : []),
    ...remote.filter((x) => x.generation === generation).map((x) => x.id),
  ]);
  return [...new Set([
    ...local.filter((x) => x.generation === generation).map((x) => x.request.supersedes_session_id),
    ...remote.filter((x) => x.generation === generation).map((x) => x.content.supersedes_session_id),
  ].filter((id): id is string => !!id && !ids.has(id)))].sort();
}

/** /sessions returns latest leaves; fetch missing immutable links, not guessed date/title matches. */
export async function loadProgressAncestry(
  parents: readonly string[], load: (id: string) => Promise<TrainingSession>, generation: number, maxReads = 64,
  knownIds: readonly string[] = [],
  options: { signal?: AbortSignal; now?: () => number; maxCharacters?: number; timeoutMs?: number } = {}
): Promise<ProgressAncestry> {
  const pending = [...parents], seen = new Set<string>(knownIds), records: TrainingSession[] = [];
  const now = options.now ?? Date.now, started = now();
  let characters = 0;
  const stopped = () => options.signal?.aborted || now() - started >= (options.timeoutMs ?? 15000);
  while (pending.length) {
    if (stopped()) return { records, complete: false };
    const id = pending.shift()!;
    if (seen.has(id)) continue;
    if (records.length >= maxReads) return { records, complete: false };
    seen.add(id);
    try {
      const record = await load(id);
      if (stopped()) return { records, complete: false };
      if (record.id !== id || record.generation !== generation) return { records, complete: false };
      // UTF-8 is at most three bytes per UTF-16 code unit. This bounds retained
      // serialized payload size; it is not a guarantee about JavaScript heap size.
      characters += JSON.stringify(record).length;
      if (characters > (options.maxCharacters ?? 1000000)) return { records, complete: false };
      records.push(record);
      if (record.content.supersedes_session_id) pending.push(record.content.supersedes_session_id);
    } catch { return { records, complete: false }; }
  }
  return { records, complete: true };
}

/** Read-only view: immutable events stay in storage; blocked corrections stay visible for review. */
export function selectProgressSessions(
  local: readonly SavedLocalSession[], remote: readonly TrainingSession[], generation: number,
  ancestors: readonly TrainingSession[] = []
) {
  type Node = { key: string; local?: SavedLocalSession; remote?: TrainingSession; ancestor?: TrainingSession };
  const nodes = new Map<string, Node>();
  const client = (id: string) => `client:${id}`;
  const server = (id: string) => `server:${id}`;
  for (const item of ancestors.filter((x) => x.generation === generation))
    nodes.set(client(item.client_session_id), { key: client(item.client_session_id), ancestor: item });
  for (const item of remote.filter((x) => x.generation === generation)) {
    const key = client(item.client_session_id);
    nodes.set(key, { ...nodes.get(key), key, remote: item });
  }
  for (const item of local.filter((x) => x.generation === generation)) {
    const key = client(item.request.client_session_id);
    // History is newest first. A replayed client UUID is the same event, not another session.
    if (!nodes.get(key)?.local) nodes.set(key, { ...nodes.get(key), key, local: item });
  }
  const parent = new Map<string, string>();
  function root(key: string): string {
    if (!parent.has(key)) parent.set(key, key);
    let result = key;
    while (parent.get(result) !== result) result = parent.get(result)!;
    while (key !== result) { const next = parent.get(key)!; parent.set(key, result); key = next; }
    return result;
  }
  function join(a: string, b: string) { const x = root(a), y = root(b); if (x !== y) parent.set(x, y); }
  const content = (node: Node) => (node.remote ?? node.ancestor)?.content ?? node.local!.request;
  const accepted = (node: Node) => !!(node.remote || node.ancestor || node.local?.state === "synced");
  const applicable = (node: Node) => accepted(node) || node.local?.state === "queued";
  const aliases = (node: Node) => [node.remote?.id, node.ancestor?.id, node.local?.synced_id].filter((id): id is string => !!id);
  for (const node of nodes.values()) {
    root(node.key);
    for (const id of aliases(node)) join(node.key, server(id));
    const previous = content(node).supersedes_session_id;
    if (previous) join(node.key, server(previous));
  }
  const superseded = new Set<string>();
  for (const node of nodes.values()) {
    const previous = content(node).supersedes_session_id;
    if (previous && applicable(node)) superseded.add(server(previous));
  }
  const leaves = [...nodes.values()].filter((node) => !aliases(node).some((id) => superseded.has(server(id))));
  const families = new Map<string, Node[]>();
  for (const node of leaves) {
    const key = root(node.key);
    const family = families.get(key) ?? []; family.push(node); families.set(key, family);
  }
  // A competing accepted leaf wins; otherwise preview the newest device proposal.
  // A rejected correction never replaces an accepted record in the count.
  const chosen = new Set<string>();
  const conflictingQueued: string[] = [];
  const localOrder = new Map(local.map((item, index) => [client(item.request.client_session_id), index]));
  for (const family of families.values()) {
    const queued = family.filter((node) => node.local?.state === "queued" && !accepted(node))
      .sort((a, b) => localOrder.get(a.key)! - localOrder.get(b.key)!)[0];
    const saved = family.find(accepted);
    const standaloneBlocked = family.find((node) => node.local?.state === "blocked" && !content(node).supersedes_session_id);
    // Another accepted leaf is a competing correction, not this queue's ancestor.
    // The server requires correcting its latest revision; retain the stale queue for review.
    if (saved) for (const node of family)
      if (node.local?.state === "queued" && !accepted(node)) conflictingQueued.push(node.local.request.client_session_id);
    const effective = saved ?? queued ?? standaloneBlocked;
    if (effective) chosen.add(effective.key);
  }
  const leafKeys = new Set(leaves.map((node) => node.key));
  const visibleLocal = [...nodes.values()].filter((node) => node.local && (chosen.has(node.key) || node.local.state === "blocked"
    || (node.local.state === "queued" && leafKeys.has(node.key))))
    .sort((a, b) => localOrder.get(a.key)! - localOrder.get(b.key)!);
  const visibleRemote = [...nodes.values()].filter((node) => node.remote && chosen.has(node.key)
    && (!node.local || node.local.state === "blocked"));
  return {
    requiresAncestry: families.size > 1 || chosen.size < families.size,
    conflictingQueued,
    local: visibleLocal.map((node) => node.local!),
    remote: visibleRemote.map((node) => node.remote!),
    sessions: [...nodes.values()].filter((node) => chosen.has(node.key)).map((node) => ({
      started_at: content(node).started_at,
      recorded: content(node).actuals.some((actual) => actual.completed),
    })),
  };
}
