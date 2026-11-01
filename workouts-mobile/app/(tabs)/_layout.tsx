import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useColors } from "@/components/ui";

export const unstable_settings = { initialRouteName: "train" };
export default function Layout() {
  const c = useColors();
  // iOS 18 draws a full-width bar that turns transparent at the scroll edge, so labels vanish over
  // the photo grid. Keep its material on; iOS 26 Liquid Glass ignores this and still floats.
  return <NativeTabs tintColor={c.accent} minimizeBehavior="onScrollDown" disableTransparentOnScrollEdge>
    <NativeTabs.Trigger name="train"><NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf="figure.run" md="directions_run" /></NativeTabs.Trigger>
    <NativeTabs.Trigger name="library"><NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf={{ default: "square.stack", selected: "square.stack.fill" }} md="collections_bookmark" /></NativeTabs.Trigger>
    <NativeTabs.Trigger name="discover"><NativeTabs.Trigger.Label>Discover</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf={{ default: "safari", selected: "safari.fill" }} md="explore" /></NativeTabs.Trigger>
    <NativeTabs.Trigger name="search" role="search"><NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" /></NativeTabs.Trigger>
  </NativeTabs>;
}
