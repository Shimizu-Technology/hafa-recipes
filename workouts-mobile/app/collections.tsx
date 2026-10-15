import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Copy, Field, Notice, Screen } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import { collectionTitleError, type Collection } from "@/lib/organization";
function CollectionEditor({
  item,
  save,
  remove,
  busy,
  scopeToken,
  isCurrent,
}: {
  item: Collection;
  save(title: string, revision: number): Promise<boolean>;
  remove(revision: number): Promise<boolean>;
  busy: boolean;
  scopeToken: object;
  isCurrent(): boolean;
}) {
  const [title, setTitle] = useState(item.title);
  const [base, setBase] = useState({ title: item.title, revision: item.revision });
  const [confirmRevision, setConfirmRevision] = useState<number | null>(null);
  const [error, setError] = useState("");
  const scope = useMemo(() => ({ lock: null as object | null }), [scopeToken, item.id]);
  const live = useRef<typeof scope | null>(null);
  useLayoutEffect(() => {
    live.current = scope; setTitle(item.title); setBase({ title: item.title, revision: item.revision });
    setConfirmRevision(null); setError("");
    return () => { if (live.current === scope) live.current = null; };
  }, [scope]);
  const current = () => live.current === scope && isCurrent();
  useEffect(() => {
    if (current() && title === base.title) {
      setTitle(item.title);
      setBase({ title: item.title, revision: item.revision });
    }
  }, [item.title, item.revision]);
  async function rename() {
    if (!current() || busy || scope.lock) return;
    const problem = collectionTitleError(title);
    if (problem) {
      setError(problem);
      return;
    }
    const token = {}; scope.lock = token;
    const submitted = { title: title.trim(), revision: base.revision };
    setError("");
    try {
      if (await save(submitted.title, submitted.revision) && current() && scope.lock === token)
        setBase({ title: submitted.title, revision: submitted.revision + 1 });
    } finally { if (scope.lock === token) scope.lock = null; }
  }
  return (
    <Card>
      <Copy kind="small">{item.workout_count} saved workouts</Copy>
      <Field
        label={`Collection name: ${base.title}`}
        value={title}
        onChange={(value) => {
          if (current() && !busy && !scope.lock) setTitle(value);
        }}
      />
      {!!error && <Notice error>{error}</Notice>}
      {base.revision !== item.revision && (
        <>
          <Notice>
            Another device changed this collection. Your unsaved name remains here; reload the current name before
            saving a replacement.
          </Notice>
          <Button
            title="Reload saved collection name"
            secondary
            disabled={busy}
            onPress={() => {
              if (!current() || busy || scope.lock) return;
              setTitle(item.title);
              setBase({ title: item.title, revision: item.revision });
            }}
          />
        </>
      )}
      <Button
        title="Save collection name"
        secondary
        busy={busy}
        disabled={!title.trim() || title === base.title}
        onPress={() => {
          void rename();
        }}
      />
      {confirmRevision != null ? (
        <>
          <Notice>Remove the collection? Its workouts remain saved. Their collection links will change.</Notice>
          <Button
            title="Remove this collection"
            secondary
            busy={busy}
            onPress={() => {
              if (current() && !busy && !scope.lock) void remove(confirmRevision);
            }}
          />
          <Button title="Keep collection" secondary disabled={busy} onPress={() => { if (current() && !busy && !scope.lock) setConfirmRevision(null); }} />
        </>
      ) : (
        <Button title="Remove collection" secondary disabled={busy} onPress={() => { if (current() && !busy && !scope.lock) setConfirmRevision(item.revision); }} />
      )}
    </Card>
  );
}
export default function Collections() {
  const { api, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: [owner, "collections", generation],
    queryFn: () => api.collections(generation),
    enabled: !!enrollment?.enrolled,
  });
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scope = useMemo(() => ({ lock: null as object | null }), [owner, generation, enrollment?.enrolled, storage]);
  const live = useRef<typeof scope | null>(null);
  useLayoutEffect(() => {
    live.current = scope; setTitle(""); setBusy(false); setError("");
    return () => { if (live.current === scope) live.current = null; };
  }, [scope]);
  const current = () => live.current === scope && !!enrollment?.enrolled && storage.isCurrent() && isCurrentAccount();
  async function run(work: () => Promise<unknown>): Promise<boolean> {
    if (!current() || scope.lock) return false;
    const token = {}; scope.lock = token; setBusy(true); setError("");
    try {
      await work();
      if (!current()) return false;
      await cache.invalidateQueries({ queryKey: [owner, "collections"] });
      if (!current()) return false;
      await cache.invalidateQueries({ queryKey: [owner, "library"] });
      if (!current()) return false;
      await cache.invalidateQueries({ queryKey: [owner, "organization"] });
      return current();
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "Could not update this collection.");
      return false;
    } finally {
      if (scope.lock === token) { scope.lock = null; if (current()) setBusy(false); }
    }
  }
  async function create() {
    if (!current() || scope.lock) return;
    const problem = collectionTitleError(title);
    if (problem) {
      setError(problem);
      return;
    }
    const submitted = title.trim();
    if (await run(() => api.createCollection(submitted, generation)) && current()) setTitle("");
  }
  return (
    <Screen back title="Collections that make sense." subtitle="Group saved workouts for your own routines.">
      <Card>
        <Field
          label="New collection name"
          value={title}
          onChange={(value) => {
            if (current() && !busy && !scope.lock) setTitle(value);
          }}
          placeholder="Gym days, Basketball prep…"
        />
        <Button
          title="Create collection"
          busy={busy}
          disabled={!title.trim() || !enrollment?.enrolled}
          onPress={() => {
            void create();
          }}
        />
      </Card>
      {!!error && (
        <>
          <Notice error>{error} Your unsaved names stay on screen.</Notice>
          <Button
            title="Refresh saved collections"
            secondary
            onPress={() => {
              if (current()) void q.refetch();
            }}
          />
        </>
      )}
      <QueryState
        loading={q.isPending && !!enrollment?.enrolled}
        error={q.error}
        retry={() => {
          if (current()) void q.refetch();
        }}
      >
        {!q.data?.length && <Copy>No collections yet. Create one above, then organize a workout into it.</Copy>}
        {q.data?.map((item) => (
          <CollectionEditor
            key={item.id}
            item={item}
            busy={busy}
            scopeToken={scope}
            isCurrent={current}
            save={(title, revision) => run(() => api.renameCollection(item.id, title, revision, generation))}
            remove={(revision) => run(() => api.removeCollection(item.id, revision, generation))}
          />
        ))}
      </QueryState>
    </Screen>
  );
}
