import { ScrollView, View, useWindowDimensions } from "react-native";
import { Button } from "./ui";
/** One quiet row; large text wraps instead of shrinking or clipping. */
export function BrowseLinks({ links }: { links: Array<{ title: string; onPress(): void; disabled?: boolean }> }) {
  const { fontScale } = useWindowDimensions();
  const row = <View style={{ flexDirection: "row", flexWrap: fontScale >= 1.3 ? "wrap" : "nowrap", gap: 16 }}>
    {links.map(link => <Button key={link.title} {...link} variant="ghost" size="sm" inline textLink />)}
  </View>;
  return fontScale >= 1.3 ? row : <ScrollView horizontal showsHorizontalScrollIndicator={false}>{row}</ScrollView>;
}
