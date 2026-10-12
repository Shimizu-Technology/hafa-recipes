import { Card, Copy, Notice } from "./ui";
import type { ShareSnapshot, SharedProgram } from "@/lib/sharing";
import type { AuthoredWorkout } from "@/lib/models";
export function SharedSnapshot({ snapshot }: { snapshot: ShareSnapshot }) {
  return (
    <>
      {!!snapshot.attribution.shared_by_display_name && (
        <Copy>Shared by {snapshot.attribution.shared_by_display_name}</Copy>
      )}
      <Notice>
        This snapshot contains the selected prescription and displayed attribution. It does not include profile, health
        data, chat or training history.
      </Notice>
      {snapshot.kind === "program" ? (
        <>
          {!!(snapshot.content as SharedProgram).notice && (
            <Notice>{(snapshot.content as SharedProgram).notice}</Notice>
          )}
          <Copy kind="heading">{snapshot.content.title}</Copy>
          {(snapshot.content as SharedProgram).sessions.map((s) => (
            <Card key={s.sequence}>
              <Copy>
                Session {s.sequence} · day {s.day_offset + 1}
              </Copy>
              <WorkoutSummary workout={s.workout} />
            </Card>
          ))}
        </>
      ) : (
        <WorkoutSummary workout={snapshot.content as AuthoredWorkout} />
      )}
    </>
  );
}
function WorkoutSummary({ workout }: { workout: AuthoredWorkout }) {
  return (
    <>
      <Copy kind="heading">{workout.title}</Copy>
      <Copy>Equipment · {workout.equipment_required?.join(", ") || "Not specified"}</Copy>
      {!!workout.source_url && <Copy>Source · {workout.source_url}</Copy>}
      {workout.blocks.map((block) => (
        <Card key={block.id}>
          <Copy kind="heading">{block.label}</Copy>
          <Copy>
            {block.grouping}
            {block.rounds != null ? ` · ${block.rounds} rounds` : " · rounds not specified"}
          </Copy>
          {block.exercises.map((e, index) => (
            <Copy key={index}>
              {e.name} · {e.sets ?? "Unspecified"} sets · {e.reps_min ?? "Unspecified"}
              {e.reps_max != null && e.reps_max !== e.reps_min ? `–${e.reps_max}` : ""} reps
              {e.per_side ? " each side" : ""}
              {e.duration_seconds != null ? ` · ${e.duration_seconds}s` : ""}
              {e.distance_meters != null ? ` · ${e.distance_meters}m` : ""}
              {e.rest_seconds != null ? ` · rest ${e.rest_seconds}s` : ""}
              {e.load != null ? ` · ${e.load} ${e.load_unit} (${e.load_convention?.replaceAll("_", " ")})` : ""}
              {e.tempo ? ` · tempo ${e.tempo}` : ""}
            </Copy>
          ))}
        </Card>
      ))}
    </>
  );
}
