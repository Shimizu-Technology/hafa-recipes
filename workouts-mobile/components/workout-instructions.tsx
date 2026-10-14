import { Card, Copy } from "./ui";
export function WorkoutInstructions({ notes }: { notes?: string[] }) {
  if (!notes?.length) return null;
  return <Card compact>
    <Copy kind="subheading">Workout instructions</Copy>
    {notes.map((note, index) => <Copy key={index} kind="small">{note}</Copy>)}
  </Card>;
}
