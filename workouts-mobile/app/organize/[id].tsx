import { useEffect, useState } from "react";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Choice, Copy, Field, Notice, Screen } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import { tagsFromText, organizationErrors, type Organization } from "@/lib/organization";
interface Draft {
  generation: number;
  organization: Organization;
  tags_text: string;
  duplicate?: { request_id: string; expected_revision: number; title: string; copied_id?: string };
}
export default function Organize() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { localDrafts, api, owner, enrollment } = useTraining();
  const cache = useQueryClient();
  const generation = enrollment?.generation ?? 0;
  const key = `organization:${id}:${generation}`;
  const workout = useQuery({
    queryKey: [owner, "workout", id, generation],
    queryFn: () => api.workout(id),
    enabled: !!enrollment?.enrolled,
  });
  const q = useQuery({
    queryKey: [owner, "organization", id, generation],
    queryFn: () => api.organization(id, generation),
    enabled: !!enrollment?.enrolled,
  });
  const collections = useQuery({
    queryKey: [owner, "collections", generation],
    queryFn: () => api.collections(generation),
    enabled: !!enrollment?.enrolled,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    setDraft(null);
    setLoaded(false);
    void localDrafts
      .load<Draft>(owner, key)
      .then((value) => {
        if (active) {
          if (value?.generation === generation) setDraft(value);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setError("Could not restore organization choices. Your saved workout is safe.");
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [owner, key, generation]);
  useEffect(() => {
    if (loaded && !draft && q.data) setDraft({ generation, organization: q.data, tags_text: q.data.tags.join(", ") });
  }, [loaded, q.data, draft, generation]);
  useEffect(() => {
    if (loaded && draft)
      void localDrafts
        .save(owner, key, draft)
        .catch(() => setError("Could not save these choices on this device. Keep this screen open and retry."));
  }, [owner, key, loaded, draft]);
  function change(patch: Partial<Organization>) {
    if (!busy && draft) setDraft({ ...draft, organization: { ...draft.organization, ...patch } });
  }
  async function invalidate() {
    await cache.invalidateQueries({ queryKey: [owner, "library"] });
    await cache.invalidateQueries({ queryKey: [owner, "workout", id] });
    await cache.invalidateQueries({ queryKey: [owner, "collections"] });
    await q.refetch();
  }
  async function save() {
    if (!draft) return;
    const problems = organizationErrors(tagsFromText(draft.tags_text), draft.organization.collection_ids);
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const organization = await api.saveOrganization(
        id,
        {
          expected_revision: draft.organization.revision,
          favorite: draft.organization.favorite,
          archived: draft.organization.archived,
          tags: tagsFromText(draft.tags_text),
          collection_ids: draft.organization.collection_ids,
        },
        draft.generation
      );
      const next = { ...draft, organization, tags_text: organization.tags.join(", ") };
      await localDrafts.save(owner, key, next);
      setDraft(next);
      setMessage(
        organization.archived
          ? "Archived. You can restore it here or find it with the archive filter."
          : "Organization saved. Your workout prescription and historical sessions are unchanged."
      );
      await invalidate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function duplicate() {
    if (!draft || !workout.data) return;
    if (draft.duplicate?.copied_id) {
      router.push({ pathname: "/workout/[id]", params: { id: draft.duplicate.copied_id } });
      return;
    }
    setBusy(true);
    setError("");
    try {
      const operation = draft.duplicate ?? {
        request_id: Crypto.randomUUID(),
        expected_revision: workout.data.revision,
        title: `${workout.data.title.slice(0, 193)} (copy)`,
      };
      const pending = { ...draft, duplicate: operation };
      await localDrafts.save(owner, key, pending);
      setDraft(pending);
      const copy = await api.duplicateWorkout(
        id,
        operation.request_id,
        operation.expected_revision,
        operation.title,
        draft.generation
      );
      const next = { ...pending, duplicate: { ...operation, copied_id: copy.id } };
      await localDrafts.save(owner, key, next);
      setDraft(next);
      await invalidate();
      router.push({ pathname: "/workout/[id]", params: { id: copy.id } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen back title="A place for this workout." subtitle={workout.data?.title ?? "Private library organization"}>
      <QueryState
        loading={!loaded || q.isPending}
        error={q.error}
        retry={() => {
          void q.refetch();
        }}
      >
        {draft && (
          <>
            <Card>
              <Choice
                label="Favorite"
                detail="Find it quickly with the Favorites filter."
                selected={draft.organization.favorite}
                onPress={() => change({ favorite: !draft.organization.favorite })}
              />
              <Choice
                label="Archive"
                detail="Keep it saved while hiding it from your default library."
                selected={draft.organization.archived}
                onPress={() => change({ archived: !draft.organization.archived })}
              />
              <Field
                label="Tags"
                value={draft.tags_text}
                onChange={(value) => {
                  if (!busy) setDraft({ ...draft, tags_text: value });
                }}
                placeholder="Strength, quick sessions, basketball"
                optional
              />
              <Copy kind="label">Collections</Copy>
              {!collections.data?.length && <Copy>Create a collection to group your workouts.</Copy>}
              {collections.data?.map((item) => (
                <Choice
                  key={item.id}
                  label={item.title}
                  selected={draft.organization.collection_ids.includes(item.id)}
                  onPress={() =>
                    change({
                      collection_ids: draft.organization.collection_ids.includes(item.id)
                        ? draft.organization.collection_ids.filter((value) => value !== item.id)
                        : [...draft.organization.collection_ids, item.id],
                    })
                  }
                />
              ))}
              {collections.error && <Notice error>{collections.error.message}</Notice>}
              <Button
                title="Manage collections"
                secondary
                disabled={busy}
                onPress={() => router.push("/collections")}
              />
              <Button
                title="Save organization"
                busy={busy}
                onPress={() => {
                  void save();
                }}
              />
            </Card>
            {!!message && <Notice>{message}</Notice>}
            {!!error && (
              <>
                <Notice error>{error}</Notice>
                <Button
                  title="Reload saved choices and discard these edits"
                  secondary
                  disabled={busy}
                  onPress={() => {
                    void q.refetch().then((result) => {
                      if (result.data) {
                        setDraft({ ...draft, organization: result.data, tags_text: result.data.tags.join(", ") });
                        setError("");
                      }
                    });
                  }}
                />
              </>
            )}
            <Card>
              <Copy kind="heading">Make your own variation</Copy>
              <Copy>
                Duplicate the workout, then edit the private copy. Source prescriptions and past sessions keep their
                original versions.
              </Copy>
              <Button
                title={
                  draft.duplicate?.copied_id
                    ? "Open your saved copy"
                    : draft.duplicate
                      ? "Retry creating this copy"
                      : "Duplicate workout"
                }
                secondary
                busy={busy}
                disabled={!workout.data}
                onPress={() => {
                  void duplicate();
                }}
              />
              {!!draft.organization.duplicate_of_workout_id && (
                <Notice>This workout began as a private duplicate of another saved version.</Notice>
              )}
            </Card>
          </>
        )}
      </QueryState>
    </Screen>
  );
}
