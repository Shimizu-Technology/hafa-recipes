import { useState } from "react";
import { Button, Copy, IconButton, ListGroup, ListRow, Row, Sheet, Stack, haptics } from "@/components/ui";
import type { StartChoice } from "@/lib/training";

export const defaultStartRounds = 3;

/**
 * Shown when a workout has no set or round counts. Starting always works:
 * log as you go, pick a round count, or edit the workout first.
 */
export function WorkoutStartSheet({
  visible,
  busy,
  timedParts = false,
  onClose,
  onStart,
  onEdit,
}: {
  visible: boolean;
  busy: boolean;
  /** The workout has several timed parts, so it can't run as one timer. */
  timedParts?: boolean;
  onClose(): void;
  onStart(choice: StartChoice): void;
  onEdit(): void;
}) {
  const [rounds, setRounds] = useState(defaultStartRounds);
  const change = (delta: number) => {
    haptics.tick();
    setRounds((value) => Math.min(100, Math.max(1, value + delta)));
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Start workout">
      <Copy tone="muted">{timedParts
        ? "This workout has more than one timed part, so it can’t run as one timer. Track it without the timer instead."
        : "This workout doesn’t say how many sets or rounds to do."}</Copy>
      <ListGroup>
        <ListRow
          icon="play-outline"
          title="Log as I go"
          detail="Start with one round. Add rounds or sets whenever you want."
          disabled={busy}
          onPress={() => onStart({ log_as_you_go: true })}
        />
      </ListGroup>
      <Stack gap={10}>
        <Row justify="space-between">
          <Copy kind="label">Set rounds</Copy>
          <Row gap={14}>
            <IconButton icon="remove" label="Fewer rounds" disabled={busy || rounds <= 1} onPress={() => change(-1)} />
            <Copy kind="numericSmall" accessibilityLabel={`${rounds} ${rounds === 1 ? "round" : "rounds"}`}
              style={{ minWidth: 28, textAlign: "center" }}>{rounds}</Copy>
            <IconButton icon="add" label="More rounds" disabled={busy || rounds >= 100} onPress={() => change(1)} />
          </Row>
        </Row>
        <Button title={`Start ${rounds} ${rounds === 1 ? "round" : "rounds"}`} icon="play" busy={busy}
          onPress={() => onStart({ rounds })} />
      </Stack>
      <ListGroup>
        <ListRow icon="create-outline" title="Edit workout" detail={timedParts ? "Split the timed parts first" : "Add sets and reps first"} disabled={busy} onPress={onEdit} />
      </ListGroup>
    </Sheet>
  );
}
