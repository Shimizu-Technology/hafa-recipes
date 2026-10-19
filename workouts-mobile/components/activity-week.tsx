import { AppState } from "react-native";
import { useCallback, useEffect } from "react";
import { useFocusEffect, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Copy, ListRow, Notice, Skeleton } from "./ui";
import { useTraining } from "@/lib/context";
import { activityFrequency, weekActivity } from "@/lib/activity-log";
function shortDate(iso?: string) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso ?? "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}
export function ActivityWeek({ sessions }: { sessions: Array<{ started_at: string; recorded: boolean }> }) {
  const { api, owner, enrollment } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const q = useQuery({
    queryKey: [owner, "activity-week", generation],
    queryFn: () => weekActivity((offset, from, to) => api.activityLog(generation, offset, from, to)),
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
  if (!enrollment?.enrolled) return null;
  const summary = q.data ? activityFrequency(q.data.items, sessions, q.data.timezone, q.data.from, q.data.to) : null;
  return (
    <Card>
      {q.isPending ? (
        <>
          <Skeleton height={26} width="70%" />
          <Copy tone="muted">Loading saved activity…</Copy>
        </>
      ) : q.error ? (
        <>
          <Notice error>{q.error.message}</Notice>
          <Button
            title="Retry weekly activity"
            secondary
            onPress={() => {
              void q.refetch();
            }}
          />
        </>
      ) : (
        summary && (
          <>
            <Copy kind="heading">
              {summary.days}
              {q.data?.complete ? "" : "+"} {summary.days === 1 && q.data?.complete ? "day" : "days"} with training
            </Copy>
            <Copy tone="muted">
              {summary.sessions} {summary.sessions === 1 ? "session" : "sessions"} · {summary.activities}
              {q.data?.complete ? "" : "+"} {summary.activities === 1 && q.data?.complete ? "activity" : "activities"}
            </Copy>
            <Copy kind="small" tone="muted">
              Last 7 days · {shortDate(q.data?.from)} – {shortDate(q.data?.to)}
            </Copy>
            {!q.data?.complete && <Notice>Showing the first page of activity, so the real count may be higher.</Notice>}
          </>
        )
      )}
      <ListRow icon="list-outline" title="See all activity" onPress={() => router.push("/activity-log")} />
    </Card>
  );
}
