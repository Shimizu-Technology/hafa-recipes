import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useColors } from "@/components/ui";
export const unstable_settings = { initialRouteName: "(today)" };
export default function TabLayout() {
  const c = useColors();
  return <NativeTabs tintColor={c.action} backgroundColor={c.background}>
    <NativeTabs.Trigger name="(today)">
      <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf="sun.max" md="light_mode" />
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="library">
      <NativeTabs.Trigger.Label>Saved</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf="bookmark" md="bookmark_border" />
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="journal">
      <NativeTabs.Trigger.Label>Journal</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf="book" md="menu_book" />
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="ask">
      <NativeTabs.Trigger.Label>Ask</NativeTabs.Trigger.Label>
      <NativeTabs.Trigger.Icon sf="bubble.left" md="chat_bubble_outline" />
    </NativeTabs.Trigger>
  </NativeTabs>;
}
