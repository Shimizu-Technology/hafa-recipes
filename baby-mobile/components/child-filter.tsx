import { useBaby } from "@/lib/context";
import { Chips } from "./ui";
export function ChildFilter({ scroll = false }: { scroll?: boolean }) {
  const b = useBaby();
  // With one baby, "Everything" and her name show the same entries; the filter only helps with several.
  return b.state.bootstrap!.children.length > 1 ? (
    <Chips
      scroll={scroll}
      value={b.state.selectedChild ?? ""}
      label="Baby"
      options={[
        { label: "Everything", value: "" },
        ...b.state.bootstrap!.children.map((child) => ({ label: child.name, value: child.id })),
      ]}
      onChange={(id) => void b.commit((s) => ({ ...s, selectedChild: id || null }))}
    />
  ) : null;
}
