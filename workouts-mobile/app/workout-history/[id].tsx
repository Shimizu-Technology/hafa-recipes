import { useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Copy, Notice, Screen, SectionHeader } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { WorkoutInstructions } from "@/components/workout-instructions";
import { WorkoutSource } from "@/components/workout-source";
import { useTraining } from "@/lib/context";
import { blockSummary } from "@/lib/amrap-editor";
import { prescriptionLine } from "@/lib/discover";
import { ApiError, type WorkoutVersion } from "@/lib/api";
import type { Workout } from "@/lib/models";

export default function WorkoutHistory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const cache = useQueryClient();
  const generation = enrollment?.generation;
  const scope = `${owner}:${generation}:${id}`;
  const live = useRef(scope); live.current = scope;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && live.current === scope && storage.isCurrent() && isCurrentAccount();
  const detailKey = [owner, "workout", id, generation];
  const historyKey = [owner, "workout-versions", id, generation];
  const q = useQuery({ queryKey: detailKey, queryFn: () => api.workout(id), enabled: !!enrollment?.enrolled });
  const versions = useInfiniteQuery({
    queryKey: historyKey, initialPageParam: 0,
    queryFn: ({ pageParam }) => api.workoutVersions(id, pageParam),
    getNextPageParam: (last, pages) => last.length === 20 ? pages.flat().length : undefined,
    enabled: !!enrollment?.enrolled,
  });
  const [selected, setSelected] = useState<WorkoutVersion | null>(null);
  const [command, setCommand] = useState<{ workout: Workout; versionId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const working = useRef<object | null>(null);
  useEffect(() => { working.current = null; setSelected(null); setCommand(null); setBusy(false); setError(""); }, [scope]);
  async function restore() {
    if (!selected || !q.data || working.current || !current() || q.data.generation !== generation || selected.workout.generation !== generation) return;
    const operation = {}; working.current = operation; setBusy(true); setError("");
    const frozen = command ?? { workout: q.data, versionId: selected.id };
    setCommand(frozen);
    try {
      const saved = await api.restoreWorkoutVersion(frozen.workout, frozen.versionId);
      if (!current()) return;
      cache.setQueryData(detailKey, saved);
      void cache.invalidateQueries({ queryKey: historyKey });
      void cache.invalidateQueries({ queryKey: [owner, "library"] });
      void cache.invalidateQueries({ queryKey: [owner, "discover"] });
      router.dismissTo({ pathname: "/workout/[id]", params: { id } });
    } catch (e) {
      if (current()) setError(e instanceof ApiError && e.status === 409
        ? "This workout changed. Reload its latest version before restoring again."
        : "Could not confirm the restore. Retry sends the same request, or reload to check what was saved.");
    } finally { if (working.current === operation) working.current = null; if (current()) setBusy(false); }
  }
  async function reload() {
    if (working.current || !current()) return;
    const operation = {}; working.current = operation; setBusy(true);
    try {
      const saved = await api.workout(id);
      if (!current()) return;
      cache.setQueryData(detailKey, saved); setCommand(null); setError("");
      void versions.refetch();
    } catch { if (current()) setError("Could not load the latest workout. Check your connection and try again."); }
    finally { if (working.current === operation) working.current = null; if (current()) setBusy(false); }
  }
  const workout = selected?.workout;
  return <Screen back title="Version history." subtitle="Restore an earlier prescription as a new version. Recorded sessions and plans keep their original workout.">
    <QueryState loading={q.isPending || versions.isPending} error={q.error ?? versions.error} retry={() => { void q.refetch(); void versions.refetch(); }}>
      {!selected && <>
        <SectionHeader title={q.data ? `Current · Version ${q.data.revision}` : "Saved versions"} />
        {versions.data?.pages.flat().map((version) => <Button key={version.id}
          title={`Review version ${version.revision} · ${new Date(version.created_at).toLocaleDateString()}`}
          secondary disabled={busy || !!command} onPress={() => { setSelected(version); setError(""); }} />)}
        {versions.hasNextPage && <Button title="Load older versions" secondary busy={versions.isFetchingNextPage} onPress={() => { void versions.fetchNextPage(); }} />}
      </>}
      {selected && workout && <>
        <Button title="All saved versions" secondary disabled={busy || !!command} onPress={() => setSelected(null)} />
        <SectionHeader title={`Version ${selected.revision} · ${workout.title}`} />
        <WorkoutInstructions {...workout} />
        <Copy tone="muted">{workout.estimated_minutes == null ? "Time not specified" : `${workout.estimated_minutes} minutes`} · {workout.equipment_required?.join(", ") || "Equipment not specified"}</Copy>
        {workout.blocks.map((block) => <Card key={block.id}>
          <Copy kind="subheading">{block.label} · {blockSummary(block)}</Copy>
          {block.rest_between_rounds_seconds != null && <Copy>{block.rest_between_rounds_seconds} seconds rest between rounds</Copy>}
          {block.exercises.map((exercise, index) => <Copy key={index}>
            {exercise.name}{"\n"}{prescriptionLine(exercise)}
            {"instructions" in exercise && typeof exercise.instructions === "string" ? `\n${exercise.instructions}` : ""}
            {exercise.notes ? `\nPrivate note · ${exercise.notes}` : ""}
          </Copy>)}
        </Card>)}
        <WorkoutSource source={workout} />
        {!!workout.source_url && <Copy kind="small" tone="muted">{workout.source_url}</Copy>}
        <Copy kind="small" tone="muted">This restores the selected version’s instructions, source and notes. Your organization stays the same.</Copy>
        <Button title={command ? "Retry restoring this version" : "Restore as new version"} busy={busy}
          disabled={selected.revision === q.data?.revision} onPress={() => { void restore(); }} />
      </>}
    </QueryState>
    {!!error && <Notice error>{error}</Notice>}
    {!!command && <Button title="Reload latest workout" secondary busy={busy} onPress={() => { void reload(); }} />}
  </Screen>;
}
