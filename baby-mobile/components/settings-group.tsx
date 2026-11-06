import { View } from "react-native";
import { Copy, Grouped, sectionHeadingLimit } from "./ui";

/** A heading over its rows, with no card around them, so the rows line up with the page's other rows. */
export function SettingsGroup({ title, note, children }: { title?: string; note?: string; children: React.ReactNode }) {
  return <View style={{ gap: 10 }}>
    {!!title && <Copy kind="heading" limit={sectionHeadingLimit}>{title}</Copy>}
    <Grouped>{children}</Grouped>
    {!!note && <Copy kind="small" tone="muted">{note}</Copy>}
  </View>;
}
