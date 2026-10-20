import { useBaby } from "@/lib/context";
import { Chips } from "./ui";
export function ChildFilter() {
  const b = useBaby();
  return b.state.bootstrap!.children.length > 0 ? (
    <Chips
      value={b.state.selectedChild ?? ""}
      options={[
        { label: "Everything", value: "" },
        ...b.state.bootstrap!.children.map((child) => ({ label: child.name, value: child.id })),
      ]}
      onChange={(id) => void b.commit((s) => ({ ...s, selectedChild: id || null }))}
    />
  ) : null;
}
