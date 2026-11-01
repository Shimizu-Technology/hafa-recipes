import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useColors } from "@/components/ui";
export const unstable_settings = { initialRouteName: "(today)" };
export default function TabLayout() {
  const c = useColors();
  // iOS 18 draws a full-width bar that turns transparent at the scroll edge, so labels vanish over
  // saved posts. Keep its background on; iOS 26 Liquid Glass ignores this and still floats.
  return <NativeTabs tintColor={c.action} backgroundColor={c.background} disableTransparentOnScrollEdge>
    <NativeTabs.Trigger name="(today)">
      <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf={{ default: "sun.max", selected: "sun.max.fill" }} md="light_mode" />
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="library">
      <NativeTabs.Trigger.Label>Saved</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf={{ default: "bookmark", selected: "bookmark.fill" }} md="bookmark_border" />
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="journal">
      <NativeTabs.Trigger.Label>Journal</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf={{ default: "book", selected: "book.fill" }} md="menu_book" />
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="ask">
      <NativeTabs.Trigger.Label>Ask</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf={{ default: "bubble.left", selected: "bubble.left.fill" }} md="chat_bubble_outline" />
    </NativeTabs.Trigger>
  </NativeTabs>;
}
