import { ScrollView, View, useWindowDimensions } from "react-native";
import { radii, touch } from "@/constants/theme";
import { Copy, useColors } from "./ui";
import { animatedPressableComponent, usePressScale } from "./design/press";
/** A link that navigates; give `selected` to make it an on/off filter that shows its state. */
type Link = { title: string; onPress(): void; disabled?: boolean; selected?: boolean };
// Every link carries the capsule padding so selecting one never shifts the row;
// the row pulls back by the same amount so unselected text lines up with the screen margin.
const CAPSULE_INSET = 10;

function BrowseLink({ title, onPress, disabled = false, selected }: Link) {
  const c = useColors();
  const press = usePressScale(disabled);
  const AnimatedPressable = animatedPressableComponent();
  const on = selected === true;
  return <AnimatedPressable
    accessibilityRole="button"
    accessibilityLabel={title}
    accessibilityState={selected === undefined ? { disabled } : { disabled, selected: on }}
    disabled={disabled}
    onPress={onPress}
    onPressIn={press.onPressIn}
    onPressOut={press.onPressOut}
    style={{ minHeight: touch.min, justifyContent: "center", opacity: press.opacity, transform: [{ scale: press.scale }] }}
  >
    <View style={{ paddingHorizontal: CAPSULE_INSET, paddingVertical: 6, borderRadius: radii.full, backgroundColor: on ? c.accentTint : "transparent" }}>
      <Copy kind="small" color={disabled ? c.muted : c.onActionSoft} style={on ? { fontWeight: "600" } : undefined}>{title}</Copy>
    </View>
  </AnimatedPressable>;
}

/** Keep large-text links in two scrollable rows so content remains near the top. */
export function BrowseLinks({ links }: { links: Link[] }) {
  const { fontScale } = useWindowDimensions();
  // Text-to-text spacing stays proportional to the 15pt subhead; two selected capsules never touch.
  const gap = Math.max(4, 15 * fontScale * 0.75 - 2 * CAPSULE_INSET);
  const middle = Math.ceil(links.length / 2);
  const rows = fontScale >= 1.3 ? [links.slice(0, middle), links.slice(middle)] : [links];
  return <ScrollView horizontal showsHorizontalScrollIndicator={fontScale >= 1.3} accessibilityLabel="Browse links"
    style={{ marginHorizontal: -CAPSULE_INSET }} contentContainerStyle={{ minWidth: "100%" }}>
    <View style={{ gap: 4 }}>{rows.filter(row => row.length).map((row, index) => <View key={index} style={{ flexDirection: "row", gap }}>
      {row.map(link => <BrowseLink key={link.title} {...link} />)}
    </View>)}</View>
  </ScrollView>;
}

/** One quiet left-aligned line naming filters that aren't visible as a selected link. */
export function FilterSummary({ items, onClear }: { items: string[]; onClear(): void }) {
  const c = useColors();
  const press = usePressScale();
  const AnimatedPressable = animatedPressableComponent();
  if (!items.length) return null;
  return <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12 }}>
    <Copy kind="small" tone="muted" style={{ flexShrink: 1 }}>{`Showing: ${items.join(", ")}`}</Copy>
    <AnimatedPressable accessibilityRole="button" accessibilityLabel="Clear filters" onPress={onClear}
      onPressIn={press.onPressIn} onPressOut={press.onPressOut} hitSlop={{ left: 8, right: 8 }}
      style={{ minHeight: touch.min, justifyContent: "center", opacity: press.opacity, transform: [{ scale: press.scale }] }}>
      <Copy kind="small" color={c.onActionSoft}>Clear</Copy>
    </AnimatedPressable>
  </View>;
}
