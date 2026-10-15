import { Card, Copy } from "./ui";
export function WorkoutInstructions({ instructions, notes }: { instructions?: string[]; notes?: string[] }) {
  return <>
    {!!instructions?.length && <Card compact>
      <Copy kind="subheading">Workout instructions</Copy>
      {instructions.map((line, index) => <Copy key={index} kind="small">{line}</Copy>)}
    </Card>}
    {!!notes?.length && <Card compact>
      <Copy kind="subheading">Private notes · only you</Copy>
      {notes.map((note, index) => <Copy key={index} kind="small">{note}</Copy>)}
    </Card>}
  </>;
}
