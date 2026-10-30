import { AppState } from "react-native";
import { useCallback, useEffect } from "react";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Copy, Notice, Skeleton } from "./ui";
import { useTraining } from "@/lib/context";
import { activityFrequency, weekActivity } from "@/lib/activity-log";
import { dateInTimezone } from "@/lib/training";
import { weekStreak } from "@/lib/progress-insights";
function shortDate(iso?: string) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso ?? "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}
export function ActivityWeek({ sessions }: { sessions: Array<{ started_at: string; recorded: boolean; active_seconds?: number }> }) {
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
  // Weeks in a row with training, in the account timezone. Shown from two weeks so it reads as encouragement, not pressure.
  const streak = q.data ? weekStreak(sessions, new Date(), q.data.timezone) : 0;
  const minutes = q.data ? Math.round(sessions.reduce((total, s) => {
    if (!s.recorded || !s.active_seconds || !Number.isFinite(Date.parse(s.started_at))) return total;
    const date = dateInTimezone(new Date(s.started_at), q.data!.timezone);
    return date >= q.data!.from && date <= q.data!.to ? total + s.active_seconds : total;
  }, 0) / 60) : 0;
  return (
    <Card>
      {q.error && q.data && <>
        <Notice error>Couldn’t refresh this week. Showing saved activity.</Notice>
        <Button title="Try again" secondary size="sm" onPress={() => { void q.refetch(); }} />
      </>}
      {q.isPending && !q.data ? (
        <>
          <Skeleton height={26} width="70%" />
          <Copy tone="muted">Loading saved activity…</Copy>
        </>
      ) : q.error && !q.data ? (
        <>
          <Notice error>This week’s activity couldn’t load.</Notice>
          <Button
            title="Try again"
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
              {summary.sessions} {summary.sessions === 1 ? "session" : "sessions"} · {minutes} workout minutes · {summary.activities}
              {q.data?.complete ? "" : "+"} {summary.activities === 1 && q.data?.complete ? "activity" : "activities"}
            </Copy>
            <Copy kind="small" tone="muted">
              Last 7 days · {shortDate(q.data?.from)} – {shortDate(q.data?.to)}
            </Copy>
            {streak >= 2 && <Copy kind="label" tone="accent">Active {streak} weeks in a row</Copy>}
            {!q.data?.complete && <Notice>Showing the first page of activity, so the real count may be higher.</Notice>}
          </>
        )
      )}
    </Card>
  );
}
