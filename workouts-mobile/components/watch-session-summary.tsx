import { Card, Copy } from "./ui";
import type { WatchDetails } from "@/lib/watch-sync";
import type { SessionRequest, Workout } from "@/lib/models";
import type { Segment } from "@/lib/class-session";
import { splitTime } from "@/lib/class-view";

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, "0")}`;
function heart(hr: WatchDetails["heart_rate"]) {
  return [hr?.average != null ? `Avg ${Math.round(hr.average)}` : null, hr?.max != null ? `Max ${Math.round(hr.max)}` : null].filter(Boolean).join(" · ");
}
function SplitRows({ workout, segments, time }: {
  workout: Workout; segments: Segment[]; time(segment: Segment, block: Workout["blocks"][number] | undefined): string;
}) {
  return segments.map((s) => {
    const block = workout.blocks.find((b) => b.id === s.block_id);
    const kind = s.kind === "buy_in" ? "Buy-in" : s.kind === "station" ? "Set" : s.kind === "round" ? "Round" : s.kind;
    return <Copy key={`${s.block_id}:${s.kind}:${s.index}`} kind="small">{`${block?.label ?? s.block_id} · ${kind} ${s.index} · ${time(s, block)}`}</Copy>;
  });
}

export function SessionRoundSplits({ workout, segments, activeIntervals }: {
  workout: Workout; segments: Segment[]; activeIntervals?: SessionRequest["active_intervals"];
}) {
  const rounds = segments.filter((s) => s.kind === "round");
  if (!rounds.length) return null;
  return <Card compact>
    <Copy kind="label">Round splits</Copy>
    <SplitRows workout={workout} segments={rounds} time={(s, block) => splitTime(s, block, activeIntervals)} />
  </Card>;
}

export function WatchSessionSummary({ details, workout, segments = [], embedded = false }: { details?: WatchDetails; workout: Workout; segments?: Segment[]; embedded?: boolean }) {
  if (!details) return null;
  const content = <>
    <Copy kind="label">Recorded on Apple Watch</Copy>
    {!!heart(details.heart_rate) && <Copy>Heart rate · {heart(details.heart_rate)} bpm</Copy>}
    {details.parts.filter(p => p.start && p.end).map(p => <Copy key={p.block_id}>
      {workout.blocks.find(b => b.id === p.block_id)?.label ?? p.block_id} · {clock(p.active_seconds)}{heart(p.heart_rate) ? ` · ${heart(p.heart_rate)} bpm` : ""}{p.skipped ? " · Skipped" : ""}
    </Copy>)}
    <SplitRows workout={workout} segments={segments} time={(s) => clock((Date.parse(s.ended_at) - Date.parse(s.started_at)) / 1000)} />
    <Copy kind="small">Heart rate stays on this phone and in Health.</Copy>
  </>;
  return embedded ? content : <Card compact>{content}</Card>;
}
