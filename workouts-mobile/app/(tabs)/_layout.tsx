import { Tabs } from "expo-router";
import type { ColorValue } from "react-native";
import { TabIcon, useColors } from "@/components/ui";
import { fonts } from "@/constants/theme";

// Today stays deep-linkable and reachable from Plan; five destinations stay visible.
export default function Layout() {
  const c = useColors();
  const tab = (title: string, route: Parameters<typeof TabIcon>[0]["route"]) => ({
    title,
    // The hidden Today route must not inflate the spoken visible-tab count.
    tabBarAccessibilityLabel: `${title}, tab, ${["Discover", "Library", "Extract", "Plan", "Progress"].indexOf(title) + 1} of 5`,
    tabBarIcon: ({ color, focused }: { color: ColorValue; focused: boolean }) => (
      <TabIcon route={route} focused={focused} color={color} />
    ),
  });
  return (
    <Tabs
      initialRouteName="library"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accentText,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.2 },
        sceneStyle: { backgroundColor: c.background },
      }}
    >
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="discover" options={tab("Discover", "discover")} />
      <Tabs.Screen name="library" options={tab("Library", "library")} />
      <Tabs.Screen name="extract" options={tab("Extract", "extract")} />
      <Tabs.Screen name="plan" options={tab("Plan", "plan")} />
      <Tabs.Screen name="progress" options={tab("Progress", "progress")} />
    </Tabs>
  );
}
