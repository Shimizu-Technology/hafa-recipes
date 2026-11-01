import { Card, Copy } from "./ui";
/** `said`: a line already shown on the screen (the format chip), skipped when an instruction only repeats it. */
export function WorkoutInstructions({ instructions: all, notes, said }: { instructions?: string[]; notes?: string[]; said?: string | null }) {
  const instructions = said ? all?.filter(line => line.trim().toLowerCase() !== said.toLowerCase()) : all;
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
