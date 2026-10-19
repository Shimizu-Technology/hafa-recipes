import { useState } from "react";
import { Pressable, View } from "react-native";
import { Card, Copy, Notice } from "./ui";
import type { ProgramReceipt } from "@/lib/plans";
import type { Workout } from "@/lib/models";
import { amrapCap, blockSummary } from "@/lib/amrap-editor";
import { exerciseTargets, formatPlanDate, provenanceLabels, sharedEffort } from "@/lib/plan-presentation";

/** A movement cue that starts as one line in long proposals; tap to read all of it. */
function Cue({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityHint={open ? "Shows one line" : "Shows the full cue"}
      onPress={() => setOpen(!open)}
      hitSlop={8}
    >
      <Copy kind="small" numberOfLines={open ? undefined : 1}>{text}</Copy>
    </Pressable>
  );
}

/**
 * Exercise-by-exercise prescription. `effort` is guidance already shown once
 * above (proposals), so exercises only repeat an effort note that differs.
 */
export function PrescriptionPreview({ workout, effort, compact = false }: { workout: Workout; effort?: string | null; compact?: boolean }) {
  return (
    <View style={{ gap: 14 }}>
      {!!workout.instructions?.length && <View style={{ gap: 4 }}>
        <Copy kind="label">Workout instructions</Copy>
        {workout.instructions.map((line, index) => <Copy key={index} kind="small">{line}</Copy>)}
      </View>}
      {!!workout.notes?.length && <View style={{ gap: 4 }}>
        <Copy kind="label">Private notes · only you</Copy>
        {workout.notes.map((note, index) => <Copy key={index} kind="small">{note}</Copy>)}
      </View>}
      {workout.blocks.map((block) => (
        <View key={block.id} style={{ gap: 10 }}>
          <Copy kind="label" tone="muted">
            {block.label} · {blockSummary(block)}
            {block.rest_between_rounds_seconds != null ? ` · ${block.rest_between_rounds_seconds}s between rounds` : ""}
          </Copy>
          {block.exercises.map((e, index) => {
            const provenance = e.provenance && e.provenance !== workout.provenance ? provenanceLabels[e.provenance] : null;
            return (
              <View key={index} style={{ gap: 2 }}>
                <Copy kind="subheading">{e.name}</Copy>
                <Copy kind="small" tone="muted">{exerciseTargets(e, e.sets == null && amrapCap(block) != null)}</Copy>
                {!!e.effort && e.effort !== effort && <Copy kind="small">Effort · {e.effort}</Copy>}
                {!!e.instructions && (compact ? <Cue text={e.instructions} /> : <Copy kind="small">{e.instructions}</Copy>)}
                {!!e.notes && <Copy kind="small">Private note · {e.notes}</Copy>}
                {!!provenance && <Copy kind="small" tone="muted">{provenance}</Copy>}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
export function ProgramPreview({ receipt }: { receipt: Pick<ProgramReceipt, "proposal" | "expires_at"> }) {
  const proposal = receipt.proposal;
  const effort = sharedEffort(proposal.sessions.map((session) => session.workout));
  return (
    <>
      <Copy kind="heading">Review the proposed sessions</Copy>
      <Copy kind="small" tone="muted">
        {{ ready: "Ready to add", needs_information: "Needs information", conflicts: "Has conflicts", unsupported: "Not supported" }[proposal.status] ?? proposal.status} · Proposal expires{" "}
        {new Date(receipt.expires_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
      </Copy>
      {proposal.questions.length + proposal.warnings.length > 0 && (
        <Card>
          <Copy kind="subheading">{proposal.status === "ready" ? "Good to know" : "Before this plan is ready"}</Copy>
          {[
            ...proposal.questions,
            ...proposal.warnings.map((warning) => warning.replace("qualified programming review is pending (D03).", "qualified programming review is pending.")),
          ].map((line, index) => (
            <Copy key={index} kind="small">{`• ${line}`}</Copy>
          ))}
        </Card>
      )}
      {proposal.assumptions.map((assumption, index) => (
        <Copy key={`a${index}`} kind="small">{assumption}</Copy>
      ))}
      {!!effort && <Notice>Effort for every exercise · {effort}</Notice>}
      {proposal.sessions.map((session) => (
        <Card key={session.id}>
          <View style={{ gap: 2 }}>
            <Copy kind="heading">
              {formatPlanDate(session.date)} · {session.workout.title}
            </Copy>
            <Copy kind="small" tone="muted">{session.purpose}</Copy>
            <Copy kind="small" tone="muted">{provenanceLabels[session.workout.provenance] ?? "Source not specified"}</Copy>
          </View>
          <PrescriptionPreview workout={session.workout} effort={effort} compact />
        </Card>
      ))}
    </>
  );
}
