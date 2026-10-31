import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useColors } from "@/components/ui";

export const unstable_settings = { initialRouteName: "train" };
export default function Layout() {
  const c = useColors();
  return <NativeTabs tintColor={c.accent} minimizeBehavior="onScrollDown">
    <NativeTabs.Trigger name="train"><NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf="figure.run" md="directions_run" /></NativeTabs.Trigger>
    <NativeTabs.Trigger name="library"><NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf="square.stack" md="collections_bookmark" /></NativeTabs.Trigger>
    <NativeTabs.Trigger name="discover"><NativeTabs.Trigger.Label>Discover</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf="safari" md="explore" /></NativeTabs.Trigger>
    <NativeTabs.Trigger name="search" role="search"><NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" /></NativeTabs.Trigger>
  </NativeTabs>;
}
