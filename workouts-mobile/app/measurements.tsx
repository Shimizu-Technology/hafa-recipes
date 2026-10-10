import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Button, Card, Choice, Copy, Empty, Notice, Screen } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import { displayLoad, displayHeight } from "@/lib/training";
import { measurementDisplay, type MeasurementKind } from "@/lib/measurements";
export default function Measurements() {
  const { api, owner, enrollment, units } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const [kind, setKind] = useState<MeasurementKind>("weight");
  const [window] = useState(() => {
    const end = new Date();
    return { end: end.toISOString(), start: new Date(end.getTime() - 30 * 86400000).toISOString() };
  });
  const trends = useQuery({
    queryKey: [owner, "measurements", generation, "trend", kind, window],
    queryFn: () => api.measurementTrends(kind, window.start, window.end, generation),
    enabled: !!enrollment?.enrolled,
  });
  const records = [...new Map(trends.data?.map((item) => [item.id, item]) ?? []).values()].sort(
    (a, b) => Date.parse(a.recorded_at ?? "") - Date.parse(b.recorded_at ?? "")
  );
  const delta =
    records.length > 1 && records[0].canonical_value != null && records[records.length - 1].canonical_value != null
      ? records[records.length - 1].canonical_value! - records[0].canonical_value!
      : null;
  const display = kind === "weight" ? displayLoad : displayHeight;
  const unit = kind === "weight" ? (units === "imperial" ? "lb" : "kg") : units === "imperial" ? "in" : "cm";
  const q = useInfiniteQuery({
    queryKey: [owner, "measurements", generation, kind],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.measurements(kind, generation, pageParam),
    getNextPageParam: (page) => (page.has_more ? page.offset + page.items.length : undefined),
    enabled: !!enrollment?.enrolled,
  });
  const entries = [
    ...new Map(q.data?.pages.flatMap((page) => page.items).map((item) => [item.id, item]) ?? []).values(),
  ];
  return (
    <Screen back title="Measurements, over time." subtitle="Values you record, with the original date and unit.">
      <Choice label="Weight history" selected={kind === "weight"} onPress={() => setKind("weight")} />
      <Choice label="Height history" selected={kind === "height"} onPress={() => setKind("height")} />
      <Button
        title={`Record ${kind}`}
        disabled={!enrollment?.enrolled}
        onPress={() => router.push({ pathname: "/measurement", params: { kind } })}
      />
      <Copy>
        Measurements are optional. Recording a value does not infer body composition, calorie needs or medical
        clearance.
      </Copy>
      {!!trends.data?.length && (
        <Card>
          <Copy kind="heading">Your last 30 days</Copy>
          <Copy>{records.length} recorded measurements</Copy>
          {delta != null && (
            <Copy>
              {display(delta, units) > 0 ? "+" : ""}
              {display(delta, units).toFixed(1)} {unit} between your earliest and latest recorded values in this period.
            </Copy>
          )}
          <Copy kind="small">
            Only measurements you recorded in this period are compared. No body composition or calorie estimate is
            inferred.
          </Copy>
        </Card>
      )}
      {trends.error && <Notice error>{trends.error.message} History stays available below.</Notice>}
      <QueryState
        loading={q.isPending && !!enrollment?.enrolled}
        error={q.error}
        retry={() => {
          void q.refetch();
        }}
      >
        {!entries.length ? (
          <Empty
            icon="analytics-outline"
            title={`No recorded ${kind} yet`}
            description="Keep history without changing your current profile, or deliberately update it with a newer measurement."
          />
        ) : (
          entries.map((item) => (
            <Card key={item.id}>
              <Copy kind="heading">{measurementDisplay(item)}</Copy>
              {item.is_current && <Copy kind="label">Current profile value</Copy>}
              <Copy>{item.recorded_at ? new Date(item.recorded_at).toLocaleString() : "Date removed"}</Copy>
              <Button
                title="Review or correct measurement"
                secondary
                onPress={() => router.push({ pathname: "/measurement", params: { id: item.id, kind: item.kind } })}
              />
            </Card>
          ))
        )}
        {q.hasNextPage && (
          <Button
            title="Load earlier measurements"
            secondary
            busy={q.isFetchingNextPage}
            onPress={() => {
              void q.fetchNextPage();
            }}
          />
        )}
      </QueryState>
    </Screen>
  );
}
