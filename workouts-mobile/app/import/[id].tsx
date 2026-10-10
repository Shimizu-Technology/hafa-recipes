import { workoutErrors } from "@/lib/library";
import { SourceImage } from "@/components/source-image";
import { useEffect, useState, useCallback, useMemo } from "react";
import { AppState, Image, Linking } from "react-native";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Choice, Copy, Empty, Notice, Screen } from "@/components/ui";
import { WorkoutEditor } from "@/components/workout-editor";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import { importIsTerminal, type CaptureDraft } from "@/lib/capture";
import { cleanupCaptureFiles } from "@/lib/capture-io";
import * as Crypto from "expo-crypto";
import { createPrivateDraftSlot, type PrivateDraftSnapshot } from "@/lib/private-form";
import type { AuthoredWorkout } from "@/lib/models";
export default function ImportReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { localDrafts, api, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const generation = enrollment?.generation;
  const slot = useMemo(
    () => createPrivateDraftSlot<CaptureDraft>(storage, owner, `capture:${generation}`, Crypto.randomUUID),
    [storage, owner, generation]
  );
  function current() {
    if (!storage.isCurrent() || !isCurrentAccount())
      throw Error("Your account changed. This source cleanup was stopped.");
  }
  const cache = useQueryClient();
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(AppState.currentState === "active");
  const [original, setOriginal] = useState<PrivateDraftSnapshot<CaptureDraft> | null>(null);
  const [edited, setEdited] = useState<AuthoredWorkout | null>(null);
  const [editing, setEditing] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useFocusEffect(
    useCallback(() => {
      setVisible(true);
      return () => setVisible(false);
    }, [])
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => sub.remove();
  }, []);
  const q = useQuery({
    queryKey: [owner, "import", id, generation],
    queryFn: () => api.importJob(id),
    enabled: !!enrollment?.enrolled,
    refetchInterval: (query) =>
      visible && active && query.state.data && !importIsTerminal(query.state.data.status) ? 2500 : false
  });
  useEffect(() => {
    let valid = true;
    void slot
      .load(current)
      .then((saved) => {
        if (valid && saved.value?.job_id === id) setOriginal(saved);
      })
      .catch(() => {
        if (valid) setError("Could not restore the original source for cleanup.");
      });
    void localDrafts.load<AuthoredWorkout>(owner, `import-edit:${generation}:${id}`).then((value) => {
      if (valid && value) setEdited(value);
    });
    return () => {
      valid = false;
    };
  }, [owner, id, generation, slot]);
  function update(value: AuthoredWorkout) {
    setEdited(value);
    setReviewed(false);
    void localDrafts
      .save(owner, `import-edit:${generation}:${id}`, value)
      .catch(() => setError("Could not keep your corrections on this device. Stay here until saved."));
  }
  async function retireOriginalSource() {
    if (!original?.value) return;
    const retained = [...(original.value.files ?? []), ...(original.value.cleanup_files ?? [])];
    let retirement: PrivateDraftSnapshot<CaptureDraft>;
    try {
      retirement = await slot.save(
        original.revision,
        {
          request_id: Crypto.randomUUID(),
          generation: original.value.generation,
          kind: "url",
          source_url: "",
          text: "",
          files: [],
          created_at: new Date().toISOString(),
          cleanup_files: retained
        },
        current
      );
    } catch (error) {
      // Another source owns this slot now; never clear or clean its assets.
      if ((error as { captureDraftConflict?: boolean }).captureDraftConflict) return;
      throw error;
    }
    setOriginal(retirement);
    // Keep exact old references durable until deletion succeeds. A newer source
    // can inherit them, so final removal is conditional on our retirement receipt.
    await cleanupCaptureFiles(retained, true);
    await slot.remove(retirement.revision, current);
  }
  async function accept() {
    if (!q.data?.result?.workout || !reviewed) return;
    const errors = workoutErrors(edited ?? q.data.result.workout);
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await api.acceptImport(id, edited ?? q.data.result.workout, q.data.generation);
      await cache.invalidateQueries({ queryKey: [owner, "library"] });
      cache.removeQueries({ queryKey: [owner, "import-source", id] });
      await localDrafts.remove(owner, `import-edit:${generation}:${id}`);
      const imports = (await localDrafts.load<Array<{ id: string }>>(owner, `imports:${generation}`)) ?? [];
      await localDrafts.save(
        owner,
        `imports:${generation}`,
        imports.filter((item) => item.id !== id)
      );
      await retireOriginalSource();
      router.replace({ pathname: "/workout/[id]", params: { id: saved.id } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!q.data) return;
    setBusy(true);
    try {
      await api.cancelImport(id, q.data.generation);
      await retireOriginalSource();
      cache.removeQueries({ queryKey: [owner, "import-source", id] });
      await q.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const source = useQuery({
    queryKey: [owner, "import-source", id, generation],
    queryFn: () => api.importSource(id),
    enabled: !!q.data && ["ready", "incomplete", "failed"].includes(q.data.status) && !q.data.accepted_workout_id,
    staleTime: 60000
  });
  const result = q.data?.result;
  const workout = edited ?? result?.workout;
  return (
    <Screen back title="Review the workout." subtitle="Keep source facts, missing details, and your corrections clear.">
      <Notice>
        Uploaded photos and documents are temporary: they are cleared after acceptance, cancellation or expiry. Your
        library keeps the prescription, evidence and source link where available. An incomplete private draft may stay
        incomplete.
      </Notice>
      <QueryState
        loading={q.isPending}
        error={q.error}
        retry={() => {
          void q.refetch();
        }}
      >
        {q.data && ["queued", "processing"].includes(q.data.status) && (
          <Card>
            <Copy kind="heading">{q.data.status === "queued" ? "Your source is saved" : "Reading the source"}</Copy>
            <Copy>You can leave this screen. The import continues in the background.</Copy>
            <Button title="Back to my library" secondary onPress={() => router.replace("/(tabs)/library")} />
          </Card>
        )}
        {!!q.data?.accepted_workout_id && (
          <Button
            title="Open saved workout"
            onPress={() => router.replace({ pathname: "/workout/[id]", params: { id: q.data!.accepted_workout_id! } })}
          />
        )}
        {q.data && ["failed", "expired", "cancelled"].includes(q.data.status) && (
          <Empty
            icon="document-text-outline"
            title={
              q.data.status === "expired"
                ? "This import expired"
                : q.data.status === "cancelled"
                  ? "Import cancelled"
                  : "Could not read this source"
            }
            description="You can paste clearer instructions, choose screenshots, or write the workout manually."
            action={<Button title="Write workout manually" secondary onPress={() => router.push("/add-workout")} />}
          />
        )}
        {result && (
          <>
            <Card>
              <Copy kind="heading">{result.source.title ?? "Original source"}</Copy>
              {!!result.source.creator && <Copy>By {result.source.creator}</Copy>}
              <Copy>
                {result.source.platform} · {result.source.channels.join(", ") || "No source channels available"}
              </Copy>
              {!!result.source.url && (
                <Button
                  title="Open source"
                  secondary
                  onPress={() => {
                    void Linking.openURL(result.source.url!).catch(() => setError("Could not open the source."));
                  }}
                />
              )}
              {original?.value?.kind === "text" && <Copy>{original.value!.text}</Copy>}
              {!source.data?.images?.length &&
                original?.value?.files
                  .filter((f) => f.mime_type.startsWith("image/"))
                  .map((file) => (
                    <SourceImage key={file.uri} uri={file.uri} label={`Original source image: ${file.name}`} />
                  ))}
              {source.data?.images?.map((image, index) => (
                <SourceImage
                  key={index}
                  uri={`data:${image.mime_type};base64,${image.base64_data}`}
                  label={`Original source image ${index + 1}`}
                />
              ))}
              {!!(!original?.value?.text && source.data?.text) && <Copy>{source.data.text}</Copy>}
              {source.error && (
                <Notice error>
                  The original upload is no longer available here. Check the source yourself before accepting this
                  draft.
                </Notice>
              )}
            </Card>
            {result.warnings.map((warning, index) => (
              <Notice key={index}>{warning}</Notice>
            ))}
            {result.source.coverage_notes.map((note, index) => (
              <Notice key={`coverage-${index}`}>{note}</Notice>
            ))}
            {!!result.evidence.length && (
              <Card>
                <Copy kind="heading">What the source supports</Copy>
                {result.evidence.map((e, index) => (
                  <Copy key={index}>
                    {e.field} · {e.wording}
                    {e.location ? ` (${e.location})` : ""}
                  </Copy>
                ))}
              </Card>
            )}
            {workout && (
              <>
                {editing ? (
                  <WorkoutEditor value={workout} onChange={update} />
                ) : (
                  <>
                    <Copy kind="heading">{workout.title}</Copy>
                    <Copy>Equipment · {workout.equipment_required?.join(", ") || "Not specified"}</Copy>
                    {workout.blocks.map((block) => (
                      <Card key={block.id}>
                        <Copy kind="heading">{block.label}</Copy>
                        <Copy>
                          {block.grouping} · {block.rounds == null ? "Rounds not specified" : `${block.rounds} rounds`}
                        </Copy>
                        {block.exercises.map((e, index) => (
                          <Copy key={index}>
                            {e.name} · {e.sets ?? "Unspecified"} sets · {e.reps_min ?? "Unspecified"}
                            {e.reps_max != null && e.reps_max !== e.reps_min ? `–${e.reps_max}` : ""} reps
                            {e.duration_seconds != null ? ` · ${e.duration_seconds}s` : ""}
                            {e.per_side ? " · each side" : ""}
                          </Copy>
                        ))}
                      </Card>
                    ))}
                  </>
                )}
                <Button
                  title={editing ? "Show workout summary" : "Correct workout details"}
                  secondary
                  disabled={busy}
                  onPress={() => setEditing(!editing)}
                />
                <Choice
                  label="I reviewed the source, missing details and warnings"
                  selected={reviewed}
                  onPress={() => setReviewed(!reviewed)}
                />
                <Button
                  title="Save privately to my library"
                  busy={busy}
                  disabled={!reviewed || !!q.data?.accepted_workout_id}
                  onPress={() => {
                    void accept();
                  }}
                />
              </>
            )}
          </>
        )}
        {q.data && !["cancelled", "expired"].includes(q.data.status) && !q.data.accepted_workout_id && (
          <Button
            title="Cancel import and clear source upload"
            secondary
            busy={busy}
            onPress={() => {
              void cancel();
            }}
          />
        )}
      </QueryState>
      {!!error && <Notice error>{error}</Notice>}
    </Screen>
  );
}
