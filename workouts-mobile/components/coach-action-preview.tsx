import { Card, Copy, Notice } from "./ui";
import { ProgramPreview, PrescriptionPreview } from "./program-preview";
import { goalLabels } from "@/lib/models";
import type { CoachAction } from "@/lib/coach";
import type { ProgramReceipt } from "@/lib/plans";
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export function CoachActionPreview({ action }: { action: CoachAction }) {
  const p = action.proposal;
  const programme = p.program?.proposal ?? (p.sessions ? p : null);
  const receipt = programme
    ? ({ proposal: programme, expires_at: action.expires_at } as Pick<ProgramReceipt, "proposal" | "expires_at">)
    : null;
  return (
    <>
      <Copy kind="heading">
        {action.kind === "program"
          ? "A proposed training plan"
          : action.kind === "profile"
            ? "Proposed preferences"
            : action.kind === "schedule"
              ? "Proposed future schedule"
              : "A proposed workout variation"}
      </Copy>
      <Copy>
        {p.status.replaceAll("_", " ")} · Expires {new Date(action.expires_at).toLocaleString()}
      </Copy>
      {!!p.review_notice && <Notice>{p.review_notice}</Notice>}
      {!receipt && p.warnings?.map((warning, index) => <Notice key={`w${index}`}>{warning}</Notice>)}
      {!receipt && p.questions?.map((question, index) => <Notice key={`q${index}`}>{question}</Notice>)}
      {!receipt && p.assumptions?.map((assumption, index) => <Copy key={`a${index}`}>{assumption}</Copy>)}
      {!!p.evaluation?.reason && <Notice>{p.evaluation.reason}</Notice>}
      {p.changes && (
        <Card>
          <Copy kind="heading">Changes to review</Copy>
          {Object.entries(p.changes).map(([key, value]) => (
            <Copy key={key}>
              {key === "primary_goal"
                ? "Goal"
                : key === "session_minutes"
                  ? "Minutes per session"
                  : key === "available_days"
                    ? "Usual training days"
                    : key === "running_baseline.accepted_stage"
                      ? "Running foundation stage"
                      : key.replaceAll("_", " ")}{" "}
              ·{" "}
              {key === "primary_goal" && typeof value === "string"
                ? (goalLabels[value as keyof typeof goalLabels] ?? value)
                : key === "available_days" && Array.isArray(value)
                  ? value.map((day) => days[Number(day)]).join(", ")
                  : Array.isArray(value)
                    ? value.join(", ") || "None"
                    : value == null
                      ? "Unknown"
                      : String(value)}
            </Copy>
          ))}
        </Card>
      )}
      {p.workout && <PrescriptionPreview workout={p.workout} />} {receipt && <ProgramPreview receipt={receipt} />}{" "}
      {p.program?.schedule_state?.status === "paused" && (
        <>
          <Copy kind="heading">Paused future sessions stay saved</Copy>
          <Notice>
            These sessions stay in their original order. They are dormant until you review a return with a current
            comfortable baseline.
          </Notice>
          {p.program.schedule_state.paused_sessions?.map((session, index) => (
            <Card key={session.id}>
              <Copy>
                {index + 1} · {session.date} · {session.workout.title}
              </Copy>
              <PrescriptionPreview workout={session.workout} />
            </Card>
          ))}
        </>
      )}
    </>
  );
}
