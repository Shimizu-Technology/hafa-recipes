import { Card, Copy } from "./ui";
import type { WatchDetails } from "@/lib/watch-sync";
import type { Workout } from "@/lib/models";
import type { Segment } from "@/lib/class-session";

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, "0")}`;
function heart(hr: WatchDetails["heart_rate"]) {
  return [hr?.average != null ? `Avg ${Math.round(hr.average)}` : null, hr?.max != null ? `Max ${Math.round(hr.max)}` : null].filter(Boolean).join(" · ");
}
export function WatchSessionSummary({ details, workout, segments = [], embedded = false }: { details?: WatchDetails; workout: Workout; segments?: Segment[]; embedded?: boolean }) {
  if (!details) return null;
  const content = <>
    <Copy kind="label">Recorded on Apple Watch</Copy>
    {!!heart(details.heart_rate) && <Copy>Heart rate · {heart(details.heart_rate)} bpm</Copy>}
    {details.parts.filter(p => p.start && p.end).map(p => <Copy key={p.block_id}>
      {workout.blocks.find(b => b.id === p.block_id)?.label ?? p.block_id} · {clock(p.active_seconds)}{heart(p.heart_rate) ? ` · ${heart(p.heart_rate)} bpm` : ""}{p.skipped ? " · Skipped" : ""}
    </Copy>)}
    {segments.map((s, i) => <Copy key={`${s.block_id}:${s.kind}:${s.index}:${i}`} kind="small">
      {workout.blocks.find(b => b.id === s.block_id)?.label ?? s.block_id} · {s.kind === "buy_in" ? "Buy-in" : s.kind === "station" ? "Set" : s.kind === "round" ? "Round" : s.kind} {s.index} · {clock((Date.parse(s.ended_at) - Date.parse(s.started_at)) / 1000)}
    </Copy>)}
    <Copy kind="small">Heart rate stays on this phone and in Health.</Copy>
  </>;
  return embedded ? content : <Card compact>{content}</Card>;
}
