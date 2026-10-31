import { ScrollView, View, useWindowDimensions } from "react-native";
import { Button } from "./ui";
type Link = { title: string; onPress(): void; disabled?: boolean };
/** Keep large-text links in two scrollable rows so content remains near the top. */
export function BrowseLinks({ links }: { links: Link[] }) {
  const { fontScale } = useWindowDimensions();
  // Keep the space between links proportional to the 15pt subhead text.
  const gap = Math.max(16, 15 * fontScale * 0.75);
  const middle = Math.ceil(links.length / 2);
  const rows = fontScale >= 1.3 ? [links.slice(0, middle), links.slice(middle)] : [links];
  return <ScrollView horizontal showsHorizontalScrollIndicator={fontScale >= 1.3} accessibilityLabel="Browse links" contentContainerStyle={{ minWidth: "100%" }}>
    <View style={{ gap: 4 }}>{rows.filter(row => row.length).map((row, index) => <View key={index} style={{ flexDirection: "row", gap }}>
      {row.map(link => <Button key={link.title} {...link} variant="ghost" size="sm" inline textLink />)}
    </View>)}</View>
  </ScrollView>;
}
