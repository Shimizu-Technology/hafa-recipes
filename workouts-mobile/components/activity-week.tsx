import { AppState } from "react-native";
import { useCallback, useEffect } from "react";
import { useFocusEffect, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Copy, Notice } from "./ui";
import { useTraining } from "@/lib/context";
import { activityFrequency, weekActivity } from "@/lib/activity-log";
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
      <Copy kind="heading">Your last seven days</Copy>
      {q.isPending ? (
        <Copy>Loading saved activity…</Copy>
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
            <Copy>
              {summary.days}
              {q.data?.complete ? "" : "+"} {summary.days === 1 && q.data?.complete ? "day" : "days"} with recorded training
            </Copy>
            <Copy>
              {summary.sessions} workout {summary.sessions === 1 ? "session" : "sessions"} with recorded actuals · {summary.activities}
              {q.data?.complete ? "" : "+"} confirmed activity {summary.activities === 1 && q.data?.complete ? "entry" : "entries"}
            </Copy>
            <Copy kind="small">
              {q.data?.from} – {q.data?.to} · {q.data?.timezone}. Partial sessions with recorded sets count as activity;
              elapsed time alone does not.
            </Copy>
            {!q.data?.complete && <Notice>This is a lower bound because the activity paging limit was reached.</Notice>}
          </>
        )
      )}
      <Copy kind="small">
        Imported/legacy observations awaiting review stay separate from manual counts. Two genuine same-day activities
        stay two records; days are counted once.
      </Copy>
      <Button title="Inspect completed activity" secondary onPress={() => router.push("/activity-log")} />
    </Card>
  );
}
