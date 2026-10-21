import { Card, Copy, Notice } from "./ui";
import { ProgramPreview, PrescriptionPreview } from "./program-preview";
import type { CoachAction } from "@/lib/coach";
import { proposalStatusLabel } from "@/lib/labels";
import type { ProgramReceipt } from "@/lib/plans";
import { formatPlanDate } from "@/lib/plan-presentation";

/** Everything a suggestion would save, below the short before → after summary. */
export function CoachActionPreview({ action }: { action: CoachAction }) {
  const p = action.proposal;
  const programme = p.program?.proposal ?? (p.sessions ? p : null);
  const receipt = programme
    ? ({ proposal: programme, expires_at: action.expires_at } as Pick<ProgramReceipt, "proposal" | "expires_at">)
    : null;
  return (
    <>
      <Copy kind="small" tone="muted">
        {proposalStatusLabel(p.status)} · Expires {new Date(action.expires_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
      </Copy>
      {!!p.review_notice && <Notice>{p.review_notice}</Notice>}
      {!receipt && p.warnings?.map((warning, index) => <Copy key={`w${index}`} kind="small">• {warning}</Copy>)}
      {!receipt && p.questions?.map((question, index) => <Copy key={`q${index}`} kind="small">• {question}</Copy>)}
      {!receipt && p.assumptions?.map((assumption, index) => <Copy key={`a${index}`} kind="small">{assumption}</Copy>)}
      {!!p.evaluation?.reason && <Copy kind="small">{p.evaluation.reason}</Copy>}
      {p.workout && <PrescriptionPreview workout={p.workout} />}
      {receipt && <ProgramPreview receipt={receipt} />}
      {p.program?.schedule_state?.status === "paused" && (
        <>
          <Copy kind="heading">Paused sessions stay saved</Copy>
          <Copy kind="small" tone="muted">
            They keep their order and wait until you resume. Coach checks in with you before they come back.
          </Copy>
          {p.program.schedule_state.paused_sessions?.map((session, index) => (
            <Card key={session.id}>
              <Copy kind="label">
                {index + 1} · {formatPlanDate(session.date)} · {session.workout.title}
              </Copy>
              <PrescriptionPreview workout={session.workout} />
            </Card>
          ))}
        </>
      )}
    </>
  );
}
