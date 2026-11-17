import { View } from "react-native";
import type { Workout } from "@/lib/models";
import { Button, Card, Choice, Copy, IconButton, Row, useColors } from "@/components/ui";
import { blockSummary } from "@/lib/amrap-editor";
import { formatSeconds, prescriptionLine } from "@/lib/discover";
import { keepPrescriptionTokens, partTags, restAfterText, segmentLabel } from "@/lib/class-parts";
import { intervalWord, wantsRotation, wantsRounds, type ReviewNotice, type ReviewProblem } from "@/lib/import-review";

type Block = Workout["blocks"][number];
const MAX_ROUNDS = 100;

/**
 * One class part on the review screen. What can be wrong with a part is fixed here, in one tap: how an EMOM
 * rotates its moves and how many rounds a superset or circuit has. Anything else opens the full editor.
 */
export function ClassPartReview({ block, notices, problems, inferred, disabled, onRotation, onRounds, onEdit, onLayout }: {
  block: Block;
  notices: ReviewNotice[];
  /** Problems to show on this part (only after Save was tried). */
  problems: ReviewProblem[];
  /** The rotation was chosen from the part's "Minute 1 … N" wording rather than by the person. */
  inferred: boolean;
  disabled: boolean;
  onRotation(rotation: "alternating" | "together"): void;
  onRounds(rounds: number | null): void;
  onEdit(): void;
  onLayout?(y: number): void;
}) {
  const c = useColors();
  const rotation = block.execution?.mode === "emom" ? block.execution.rotation : null;
  const word = intervalWord(block);
  const rotationProblems = problems.filter(problem => problem.fix === "rotation");
  const otherProblems = problems.filter(problem => problem.fix !== "rotation");
  const summary = blockSummary(block, block.label);
  return (
    <View onLayout={onLayout ? event => onLayout(event.nativeEvent.layout.y) : undefined}>
      <Card style={problems.length ? { borderWidth: 2, borderColor: c.error } : undefined}>
        <Copy kind="subheading">{block.label}</Copy>
        {block.instructions?.map((line, index) => <Copy key={index} kind="small">{line}</Copy>)}
        {!!partTags(block).length && <Copy kind="small">{partTags(block).join(" · ")}</Copy>}
        {!!summary && <Copy kind="small" tone="muted">
          {summary}{block.rest_between_rounds_seconds != null ? `${summary ? " · " : ""}${formatSeconds(block.rest_between_rounds_seconds)} between rounds` : ""}
        </Copy>}
        {block.exercises.map((e, index) => (
          <Copy key={index}>
            <Copy kind="label">{segmentLabel(e) ? `${segmentLabel(e)} · ` : ""}{e.name}</Copy>
            {" · "}
            <Copy>{keepPrescriptionTokens(prescriptionLine(e))}</Copy>
            {e.instructions ? <Copy kind="small">{"\n"}{e.instructions}</Copy> : null}
            {e.notes ? <Copy kind="small">{"\n"}Private note · {e.notes}</Copy> : null}
          </Copy>
        ))}
        {!!restAfterText(block) && <Copy kind="label">{restAfterText(block)} before the next part</Copy>}
        {notices.map((notice, index) => <Copy key={index} kind="small" tone={notice.kind === "check" ? "accent" : "muted"}>
          {notice.kind === "check" ? "Check · " : ""}{notice.text}
        </Copy>)}
        {wantsRotation(block) && <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={`How ${block.label} runs`}>
          <Copy kind="label">How the moves rotate</Copy>
          {rotationProblems.map(problem => <Copy key={problem.key} kind="small" tone="error">{problem.message}</Copy>)}
          <Choice role="radio" disabled={disabled} selected={rotation === "alternating"} label={`Alternate moves each ${word}`}
            detail={`One move per ${word}, in order.`} onPress={() => onRotation("alternating")} />
          <Choice role="radio" disabled={disabled} selected={rotation === "together"} label={`Every move each ${word}`}
            detail={`Do all of them inside each ${word}.`} onPress={() => onRotation("together")} />
          {inferred && rotation === "alternating" && <Copy kind="small" tone="muted">Chosen because the part lists one move for each {word}. Change it if that is wrong.</Copy>}
        </View>}
        {wantsRounds(block) && <Row gap={12} justify="space-between" wrap>
          <View style={{ flexShrink: 1 }}>
            <Copy kind="label">Rounds</Copy>
            {block.rounds == null && <Copy kind="small" tone="accent">Not specified</Copy>}
          </View>
          <Row gap={8}>
            <IconButton icon="remove" label={`Fewer rounds for ${block.label}`} disabled={disabled || block.rounds == null}
              onPress={() => onRounds(block.rounds! <= 1 ? null : block.rounds! - 1)} />
            <Copy kind="heading" align="center" style={{ minWidth: 36 }} accessibilityLabel={block.rounds == null ? "Rounds not set" : `${block.rounds} rounds`}>{block.rounds ?? "–"}</Copy>
            <IconButton icon="add" label={`More rounds for ${block.label}`} disabled={disabled || (block.rounds ?? 0) >= MAX_ROUNDS}
              onPress={() => onRounds((block.rounds ?? 0) + 1)} />
          </Row>
        </Row>}
        {otherProblems.length > 0 && <View accessibilityLiveRegion="polite" style={{ gap: 4 }}>
          {otherProblems.map(problem => <Copy key={problem.key} kind="small" tone="error">{problem.message}</Copy>)}
        </View>}
        {otherProblems.length > 0 && <Button title="Correct this part" secondary disabled={disabled} icon="create-outline" onPress={onEdit} />}
      </Card>
    </View>
  );
}
