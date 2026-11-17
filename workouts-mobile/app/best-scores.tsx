import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Card, Copy, Empty, ListRow, Screen, SectionHeader } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import { benchmarkName, benchmarkProgressions, resultsByPart, rowScore, scalingLabel, scoreFromSortValue, shortDate } from "@/lib/results-history";

const settingUp = (e: unknown) => (e as { status?: number } | null)?.status === 503;

/** Best scores: each benchmark's progressions with your best and last, or one benchmark's full history. */
export default function BestScores() {
  const { benchmark_key: key } = useLocalSearchParams<{ benchmark_key?: string }>();
  return key ? <BenchmarkHistory benchmarkKey={key} /> : <Benchmarks />;
}

function Benchmarks() {
  const { api, owner, enrollment, units } = useTraining();
  const q = useQuery({ queryKey: [owner, "benchmarks", enrollment?.generation], enabled: !!enrollment?.enrolled, queryFn: () => api.benchmarks() });
  return (
    <Screen native back title="Best scores" subtitle="Benchmarks you’ve scored, by progression">
      <QueryState hasData={q.data !== undefined} loading={q.isPending && !!enrollment?.enrolled} error={settingUp(q.error) ? null : q.error}
        errorMessage="Your best scores couldn’t load. Check your connection and try again." retry={() => { void q.refetch(); }}>
        {settingUp(q.error) && <Copy tone="muted">Your results history is being set up. Check back soon.</Copy>}
        {q.data && !q.data.length && <Empty icon="trophy-outline" title="No benchmark scores yet"
          description="Score a class part that’s a named benchmark, such as Everest, and your best and last show here." />}
        {benchmarkProgressions(q.data ?? []).map((b) => (
          <Card key={b.key} compact>
            <ListRow title={b.name} detail="See every score" onPress={() => router.push({ pathname: "/best-scores", params: { benchmark_key: b.key } })} />
            {b.stages.map((stage) => (
              <Card key={stage.stage ?? 0} compact tone="sunken">
                {!!stage.stage && <Copy kind="label">Progression {stage.stage}</Copy>}
                {stage.parts.map((g) => (
                  <Copy key={`${g.comparison_key}${g.kind}${g.scaling}`}>
                    {[`${g.block_label} · ${scalingLabel(g.scaling)}`,
                      g.best ? `Best ${scoreFromSortValue(g.kind, g.best.sort_value, units)} (${shortDate(g.best.performed_at)})` : null,
                      g.last && g.last.id !== g.best?.id ? `Last ${scoreFromSortValue(g.kind, g.last.sort_value, units)} (${shortDate(g.last.performed_at)})` : null,
                    ].filter(Boolean).join(" · ")}
                  </Copy>
                ))}
              </Card>
            ))}
          </Card>
        ))}
      </QueryState>
    </Screen>
  );
}

function BenchmarkHistory({ benchmarkKey }: { benchmarkKey: string }) {
  const { api, owner, enrollment } = useTraining();
  const q = useQuery({ queryKey: [owner, "results", enrollment?.generation, "benchmark", benchmarkKey], enabled: !!enrollment?.enrolled,
    queryFn: () => api.results({ benchmark_key: benchmarkKey }) });
  return (
    <Screen native back title={benchmarkName(benchmarkKey)} subtitle="Every score, newest first">
      <QueryState hasData={q.data !== undefined} loading={q.isPending && !!enrollment?.enrolled} error={q.error}
        errorMessage="These scores couldn’t load. Check your connection and try again." retry={() => { void q.refetch(); }}>
        {q.data && !q.data.items.length && <Copy tone="muted">No scores yet.</Copy>}
        {resultsByPart(q.data?.items ?? []).map((part) => <Card key={part.label} compact>
          <SectionHeader title={part.label} />
          {part.items.map((row) => <ListRow key={row.id} title={rowScore(row)} value={row.pr ? "PR" : row.best ? "Best" : undefined}
            detail={[shortDate(row.performed_at), stageOf(row.comparison_key), scalingLabel(row.scaling)].filter(Boolean).join(" · ")}
            onPress={() => router.push({ pathname: "/session/[id]", params: { id: row.session_id } })} />)}
        </Card>)}
      </QueryState>
    </Screen>
  );
}
/** "benchmark:everest:2:A" → "Progression 2". */
const stageOf = (comparisonKey: string) => {
  const stage = Number(comparisonKey.split(":")[2]);
  return stage > 0 ? `Progression ${stage}` : null;
};
