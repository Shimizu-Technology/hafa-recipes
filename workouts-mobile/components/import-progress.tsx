import { useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";
import { Button, Card, Copy, Notice } from "./ui";
import type { ImportJob } from "@/lib/capture";
import { importProgressState } from "@/lib/import-progress";

/** Job states are real; provider stages and estimated completion times are not available. */
export function ImportProgress({ job, autoSave, connectionError, refreshing, refresh, openLibrary, active = true }: {
  job: ImportJob; autoSave?: boolean; connectionError?: Error | null; refreshing: boolean;
  refresh(): void; openLibrary(): void; active?: boolean;
}) {
  const [waiting, setWaiting] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setWaiting(false);
    setNow(Date.now());
    if (!active) return;
    const timer = setTimeout(() => setWaiting(true), 45000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(timer); clearInterval(clock); };
  }, [job.id, job.status, job.attempt_count, active]);
  const progress = importProgressState(job, now);
  return <Card compact>
    {!progress.retrying && <ActivityIndicator accessibilityLabel={progress.phase} />}
    <Copy kind="caption" tone="accent">{progress.phase}</Copy>
    <Copy kind="heading">{progress.title}</Copy>
    {progress.attempt && <Copy kind="small" tone="muted">{progress.attempt}</Copy>}
    {progress.elapsed && <Copy kind="small" tone="muted">{progress.elapsed}</Copy>}
    <Copy kind="small">{autoSave ? "A complete workout saves to your library. If details are missing, the source can be kept as a private draft to check." : "Your import continues in the background. Open it to review the result when it is ready."}</Copy>
    {connectionError ? <Notice tone="warning">Could not refresh progress. Your import may still be running; reconnect to check its latest status.</Notice> : waiting && !progress.retrying && <Notice>Still working. You can keep browsing and return here to check the result.</Notice>}
    <Button title={connectionError ? "Reconnect to check progress" : "Refresh import status"} variant="ghost" busy={refreshing} onPress={refresh} />
    <Button title="Keep browsing my library" secondary onPress={openLibrary} />
  </Card>;
}
