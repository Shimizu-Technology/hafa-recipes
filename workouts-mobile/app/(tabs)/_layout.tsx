import { Tabs } from "expo-router";
import type { ColorValue } from "react-native";
import { TabIcon, useColors } from "@/components/ui";
import { fonts } from "@/constants/theme";

// Tab order: Today · (Discover) · Library · Plan · Progress.
// To add Discover, create app/(tabs)/discover.tsx and add
// <Tabs.Screen name="discover" options={tab("Discover", "discover")} /> after "index".
// TabIcon already has its icons.
export default function Layout() {
  const c = useColors();
  const tab = (title: string, route: Parameters<typeof TabIcon>[0]["route"]) => ({
    title,
    tabBarIcon: ({ color, focused }: { color: ColorValue; focused: boolean }) => (
      <TabIcon route={route} focused={focused} color={color} />
    ),
  });
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accentText,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.2 },
        sceneStyle: { backgroundColor: c.background },
      }}
    >
      <Tabs.Screen name="index" options={tab("Today", "index")} />
      <Tabs.Screen name="library" options={tab("Library", "library")} />
      <Tabs.Screen name="plan" options={tab("Plan", "plan")} />
      <Tabs.Screen name="progress" options={tab("Progress", "progress")} />
    </Tabs>
  );
}
