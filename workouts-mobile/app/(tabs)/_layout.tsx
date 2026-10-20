import { Tabs } from "expo-router";
import type { ColorValue } from "react-native";
import { AddTabIcon, TabIcon, useColors } from "@/components/ui";
import { WorkoutsTabBar } from "@/components/workouts-tab-bar";
import { fonts } from "@/constants/theme";

const visible = ["Discover", "Library", "Add", "Train", "Progress"];

// Mirrors Håfa Recipes: Discover, Library, a filled center Add, then Train and Progress.
// Today (`index`) stays deep-linkable; its content lives at the top of Train.
export default function Layout() {
  const c = useColors();
  const tab = (title: string, route: Parameters<typeof TabIcon>[0]["route"], label = title) => ({
    title,
    // The hidden Today route must not inflate the spoken visible-tab count.
    tabBarAccessibilityLabel: `${label}, tab, ${visible.indexOf(title) + 1} of ${visible.length}`,
    tabBarIcon: ({ color, focused }: { color: ColorValue; focused: boolean }) => (
      <TabIcon route={route} focused={focused} color={color} />
    ),
  });
  return (
    <Tabs
      initialRouteName="library"
      tabBar={props => <WorkoutsTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: c.onActionSoft,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.2 },
        sceneStyle: { backgroundColor: c.background },
      }}
    >
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="discover" options={tab("Discover", "discover")} />
      <Tabs.Screen name="library" options={tab("Library", "library")} />
      <Tabs.Screen
        name="extract"
        options={{
          ...tab("Add", "extract", "Add a workout"),
          tabBarIcon: ({ focused }: { focused: boolean }) => <AddTabIcon focused={focused} />,
        }}
      />
      <Tabs.Screen name="plan" options={tab("Train", "plan")} />
      <Tabs.Screen name="progress" options={tab("Progress", "progress")} />
    </Tabs>
  );
}
