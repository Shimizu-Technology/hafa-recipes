import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Card, Copy, ListRow, SectionHeader } from "@/components/ui";
import { useTraining } from "@/lib/context";
import { resultsByPart, rowScore, scalingLabel, shortDate } from "@/lib/results-history";

/** Workout detail: your scores for this workout by part, newest first, with your best marked. Hidden when there are none. */
export function YourResults({ workoutId, benchmarkKey }: { workoutId: string; benchmarkKey?: string | null }) {
  const { api, owner, enrollment } = useTraining();
  const q = useQuery({ queryKey: [owner, "results", enrollment?.generation, workoutId], enabled: !!enrollment?.enrolled,
    queryFn: () => api.results({ workout_id: workoutId }) });
  if (!q.data?.items.length) return null;
  return (
    <>
      <SectionHeader title="Your results" action={benchmarkKey ? { label: "Best scores", onPress: () => router.push({ pathname: "/best-scores", params: { benchmark_key: benchmarkKey } }) } : undefined} />
      {resultsByPart(q.data.items).map((part) => (
        <Card compact key={part.label}>
          <Copy kind="label">{part.label}</Copy>
          {part.items.slice(0, 5).map((row) => (
            <ListRow key={row.id} title={rowScore(row)} detail={[shortDate(row.performed_at), scalingLabel(row.scaling)].join(" · ")}
              value={row.pr ? "PR" : row.best ? "Best" : undefined}
              onPress={() => router.push({ pathname: "/session/[id]", params: { id: row.session_id } })} />
          ))}
        </Card>
      ))}
      {q.data.history_limited && <Copy kind="small" tone="muted">Older results are still being added to your history.</Copy>}
    </>
  );
}
