import { Card, Copy, Notice } from "./ui";
import type { ProgramReceipt } from "@/lib/plans";
import type { Workout } from "@/lib/models";
export function PrescriptionPreview({ workout }: { workout: Workout }) {
  return (
    <>
      {workout.blocks.map((block) => (
        <Card key={block.id}>
          <Copy kind="label">
            {block.label} · {block.grouping}
            {block.rounds != null ? ` · ${block.rounds} rounds` : ""}
          </Copy>
          {block.rest_between_rounds_seconds != null && (
            <Copy kind="small">{block.rest_between_rounds_seconds}s between rounds</Copy>
          )}
          {block.exercises.map((e, index) => (
            <Card key={index}>
              <Copy kind="heading">{e.name}</Copy>
              <Copy>
                {e.sets == null ? "Sets not specified" : `${e.sets} sets`} ·{" "}
                {e.reps_min == null
                  ? "Reps not specified"
                  : e.reps_max != null && e.reps_max !== e.reps_min
                    ? `${e.reps_min}–${e.reps_max} reps`
                    : `${e.reps_min} reps`}
                {e.per_side ? " · each side" : ""}
              </Copy>
              {e.duration_seconds != null && <Copy>{e.duration_seconds}s target time</Copy>}
              {e.distance_meters != null && <Copy>{e.distance_meters}m target distance</Copy>}
              {e.load != null && (
                <Copy>
                  {e.load} {e.load_unit ?? "unit not specified"} ·{" "}
                  {e.load_convention?.replaceAll("_", " ") ?? "load convention not specified"}
                </Copy>
              )}
              {e.rest_seconds != null && <Copy>{e.rest_seconds}s rest</Copy>}
              {!!e.tempo && <Copy>Tempo · {e.tempo}</Copy>}
              {!!e.effort && <Copy>Effort · {e.effort}</Copy>}
              {!!e.notes && <Copy>{e.notes}</Copy>}
              <Copy kind="small">{e.provenance ?? workout.provenance} prescription</Copy>
            </Card>
          ))}
        </Card>
      ))}
    </>
  );
}
export function ProgramPreview({ receipt }: { receipt: Pick<ProgramReceipt, "proposal" | "expires_at"> }) {
  const proposal = receipt.proposal;
  return (
    <>
      <Copy kind="heading">Review the proposed sessions</Copy>
      <Copy kind="small">
        {proposal.status.replaceAll("_", " ")} · Expires {new Date(receipt.expires_at).toLocaleString()}
      </Copy>
      {proposal.warnings.map((warning, index) => (
        <Notice key={`w${index}`}>{warning.replace("qualified programming review is pending (D03).", "qualified programming review is pending.")}</Notice>
      ))}
      {proposal.questions.map((question, index) => (
        <Notice key={`q${index}`}>{question}</Notice>
      ))}
      {proposal.assumptions.map((assumption, index) => (
        <Copy key={`a${index}`}>{assumption}</Copy>
      ))}
      {proposal.sessions.map((session) => (
        <Card key={session.id}>
          <Copy kind="heading">
            {session.date} · {session.workout.title}
          </Copy>
          <Copy>{session.purpose}</Copy>
          <PrescriptionPreview workout={session.workout} />
        </Card>
      ))}
    </>
  );
}
