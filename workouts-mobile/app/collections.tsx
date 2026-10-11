import { useEffect, useState } from "react";
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
}: {
  item: Collection;
  save(title: string, revision: number): Promise<boolean>;
  remove(revision: number): Promise<boolean>;
  busy: boolean;
}) {
  const [title, setTitle] = useState(item.title);
  const [base, setBase] = useState({ title: item.title, revision: item.revision });
  const [confirmRevision, setConfirmRevision] = useState<number | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (title === base.title) {
      setTitle(item.title);
      setBase({ title: item.title, revision: item.revision });
    }
  }, [item.title, item.revision]);
  async function rename() {
    const problem = collectionTitleError(title);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    if (await save(title.trim(), base.revision)) setBase({ title: title.trim(), revision: base.revision + 1 });
  }
  return (
    <Card>
      <Copy kind="small">{item.workout_count} saved workouts</Copy>
      <Field
        label={`Collection name: ${base.title}`}
        value={title}
        onChange={(value) => {
          if (!busy) setTitle(value);
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
              void remove(confirmRevision);
            }}
          />
          <Button title="Keep collection" secondary disabled={busy} onPress={() => setConfirmRevision(null)} />
        </>
      ) : (
        <Button title="Remove collection" secondary disabled={busy} onPress={() => setConfirmRevision(item.revision)} />
      )}
    </Card>
  );
}
export default function Collections() {
  const { api, owner, enrollment } = useTraining();
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
  async function run(work: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      await work();
      await cache.invalidateQueries({ queryKey: [owner, "collections"] });
      await cache.invalidateQueries({ queryKey: [owner, "library"] });
      await cache.invalidateQueries({ queryKey: [owner, "organization"] });
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    const problem = collectionTitleError(title);
    if (problem) {
      setError(problem);
      return;
    }
    if (await run(() => api.createCollection(title.trim(), generation))) setTitle("");
  }
  return (
    <Screen back title="Collections that make sense." subtitle="Group saved workouts for your own routines.">
      <Card>
        <Field
          label="New collection name"
          value={title}
          onChange={(value) => {
            if (!busy) setTitle(value);
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
              void q.refetch();
            }}
          />
        </>
      )}
      <QueryState
        loading={q.isPending && !!enrollment?.enrolled}
        error={q.error}
        retry={() => {
          void q.refetch();
        }}
      >
        {!q.data?.length && <Copy>No collections yet. Create one above, then organize a workout into it.</Copy>}
        {q.data?.map((item) => (
          <CollectionEditor
            key={item.id}
            item={item}
            busy={busy}
            save={(title, revision) => run(() => api.renameCollection(item.id, title, revision, generation))}
            remove={(revision) => run(() => api.removeCollection(item.id, revision, generation))}
          />
        ))}
      </QueryState>
    </Screen>
  );
}
