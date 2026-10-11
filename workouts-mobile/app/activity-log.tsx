import { AppState } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button, Card, Copy, Empty, Notice, Screen } from "@/components/ui";
import { CalendarDate } from "@/components/calendar-date";
import { useTraining } from "@/lib/context";
import { isISODate } from "@/lib/sharing";
export default function ActivityLog() {
  const { api, owner, enrollment, units } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ from?: string; to?: string }>({});
  const [error, setError] = useState("");
  const q = useInfiniteQuery({
    queryKey: [owner, "activity-log", generation, applied.from, applied.to],
    queryFn: ({ pageParam }) => api.activityLog(generation, pageParam, applied.from, applied.to),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.has_more && last.offset + last.limit <= 10000 ? last.offset + last.limit : undefined,
    enabled: !!enrollment?.enrolled,
  });
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && enrollment?.enrolled) void q.refetch();
    });
    return () => sub.remove();
  }, [q.refetch, enrollment?.enrolled]);
  useFocusEffect(
    useCallback(() => {
      if (enrollment?.enrolled) void q.refetch();
    }, [q.refetch, enrollment?.enrolled])
  );
  const rows = [...new Map(q.data?.pages.flatMap((page) => page.items).map((row) => [row.id, row])).values()];
  function filter() {
    if ((from && !isISODate(from)) || (to && !isISODate(to)) || (from && to && from > to)) {
      setError("Choose a valid calendar range with the start before the end.");
      return;
    }
    setError("");
    setApplied({ from: from ?? undefined, to: to ?? undefined });
  }
  return (
    <Screen
      back
      title="Activity you recorded."
      subtitle="Completed activity, separate from future schedule declarations."
    >
      <Button title="Log completed activity" icon="add" onPress={() => router.push("/activity")} />
      {!enrollment?.enrolled && <Button title="Set up Workouts" onPress={() => router.push("/onboarding")} />}
      <Card>
        <Copy kind="heading">Find activity by date</Copy>
        <CalendarDate optional label="From date" value={from} onChange={setFrom} />
        <CalendarDate optional label="Through date" value={to} onChange={setTo} />
        <Button title="Apply date range" secondary busy={q.isFetching} onPress={filter} />
        <Button
          title="Clear date range"
          secondary
          onPress={() => {
            setFrom(null);
            setTo(null);
            setApplied({});
            setError("");
          }}
        />
        <Copy kind="small">
          {q.data?.pages[0]?.timezone ?? "Your saved training timezone"} · {rows.length} loaded {rows.length === 1 ? "record" : "records"}
        </Copy>
      </Card>
      {q.isPending && !!enrollment?.enrolled && <Copy>Loading saved activity…</Copy>}
      {q.error && (
        <>
          <Notice error>{q.error.message}</Notice>
          <Button
            title="Retry activity history"
            secondary
            onPress={() => {
              void q.refetch();
            }}
          />
        </>
      )}
      {!!error && <Notice error>{error}</Notice>}
      {!q.isPending && !q.error && !rows.length && (
        <Empty
          title="No activity in this selection"
          description="Log a completed run, walk, basketball session or other activity. Future commitments stay in profile schedule declarations."
          icon="walk-outline"
        />
      )}
      {rows.map((row) => (
        <Card key={row.id}>
          <Copy kind="small">
            {row.content?.date ?? "Removed"} ·{" "}
            {row.read_only
              ? "Imported · read only"
              : row.legacy
                ? "Existing entry · review needed"
                : "Confirmed completed activity"}
          </Copy>
          <Copy kind="heading">{row.content?.name ?? "Removed activity"}</Copy>
          <Copy>
            {row.content?.duration_minutes == null
              ? "Duration not specified"
              : `${row.content.duration_minutes} recorded minutes`}
            {row.content?.distance_km != null
              ? ` · ${Number((units === "imperial" ? row.content.distance_km / 1.609344 : row.content.distance_km).toFixed(3))} ${units === "imperial" ? "miles" : "km"}`
              : ""}
          </Copy>
          <Copy kind="small">
            Demand ·{" "}
            {row.content?.strenuous == null ? "Not specified" : row.content.strenuous ? "Strenuous" : "Light / easy"}
          </Copy>
          {row.legacy && !row.read_only && (
            <Notice>
              This entry does not count as confirmed completed activity yet. Review/adopt it rather than creating a
              duplicate.
            </Notice>
          )}
          <Button
            title={
              row.read_only
                ? "Inspect imported activity"
                : row.legacy
                  ? "Review and adopt this entry"
                  : "Review, correct or remove activity"
            }
            secondary
            onPress={() => router.push({ pathname: "/activity", params: { id: row.id } })}
          />
        </Card>
      ))}
      {q.hasNextPage && (
        <Button
          title="Load more activity"
          secondary
          busy={q.isFetchingNextPage}
          onPress={() => {
            void q.fetchNextPage();
          }}
        />
      )}
      {q.data?.pages.at(-1)?.has_more && !q.hasNextPage && (
        <Notice>This selection reached the paging limit. Narrow the date range to inspect more history.</Notice>
      )}
      <Notice>
        Same-day activities and workout sessions remain separate records. Imported observations are read only here; use
        their Health connection or the originating app for changes.
      </Notice>
      <Button
        title="Refresh activity history"
        secondary
        busy={q.isFetching}
        onPress={() => {
          void q.refetch();
        }}
      />
    </Screen>
  );
}
