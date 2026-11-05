import { useWindowDimensions } from "react-native";
import { useBaby } from "@/lib/context";
import { Chips } from "./ui";
/** `only` is for a screen that's always about one baby: it names that baby, and "Everything" isn't offered. */
export function ChildFilter({ scroll = false, only }: { scroll?: boolean; only?: string }) {
  const b = useBaby(), { fontScale } = useWindowDimensions();
  // With one baby, "Everything" and her name show the same entries; the filter only helps with several.
  return b.state.bootstrap!.children.length > 1 ? (
    <Chips
      // At large text wrapped names can fill a screen before anything else shows.
      scroll={scroll || fontScale >= 1.3}
      value={only ?? b.state.selectedChild ?? ""}
      label="Baby"
      options={[
        ...(only ? [] : [{ label: "Everything", value: "" }]),
        ...b.state.bootstrap!.children.map((child) => ({ label: child.name, value: child.id })),
      ]}
      onChange={(id) => void b.commit((s) => ({ ...s, selectedChild: id || null }))}
    />
  ) : null;
}
