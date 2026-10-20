import { Tabs, router, useSegments } from "expo-router";
import type { Ref } from "react";
import { Platform, Pressable, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, fonts, useColors, type IconName } from "@/components/ui";
export default function TabLayout() {
  const c = useColors(),
    insets = useSafeAreaInsets(),
    { fontScale } = useWindowDimensions(),
    barHeight = fontScale > 1.3 ? 90 : 64,
    segments = useSegments(),
    // Ask has its own docked composer; the Add button would sit on top of it.
    showAdd = segments[segments.length - 1] !== "ask";
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: c.action,
          tabBarInactiveTintColor: c.muted,
          tabBarStyle: {
            backgroundColor: c.background,
            borderTopColor: c.border,
            height: barHeight + insets.bottom,
            paddingTop: 8,
            paddingBottom: Math.max(10, insets.bottom),
          },
          tabBarIconStyle: { width: 54, height: 32 },
          tabBarLabelStyle: { fontSize: 11, fontFamily: fonts.semibold },
          tabBarAllowFontScaling: false,
          tabBarButton:
            Platform.OS === "web"
              ? undefined
              : ({ style, ref, ...props }) => (
                  <Pressable
                    {...props}
                    ref={ref as Ref<View>}
                    style={({ pressed }) => [style, { opacity: pressed ? 0.55 : 1 }]}
                  />
                ),
          sceneStyle: { backgroundColor: c.background },
        }}
      >
        {[
          { name: "index", title: "Today", icon: "sunny-outline", selectedIcon: "sunny" },
          { name: "library", title: "Library", icon: "bookmark-outline", selectedIcon: "bookmark" },
          { name: "journal", title: "Journal", icon: "book-outline", selectedIcon: "book" },
          { name: "routines", title: "Routines", icon: "checkmark-circle-outline", selectedIcon: "checkmark-circle" },
          { name: "ask", title: "Ask", icon: "chatbubble-outline", selectedIcon: "chatbubble" },
        ].map((t) => (
          <Tabs.Screen
            key={t.name}
            name={t.name}
            options={{
              title: t.title,
              tabBarIcon: ({ color, focused }) => (
                <View
                  style={{
                    width: 54,
                    height: 32,
                    borderRadius: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: focused ? c.action : "transparent",
                  }}
                >
                  <Icon
                    name={(focused ? t.selectedIcon : t.icon) as IconName}
                    color={focused ? c.onAction : color}
                    size={23}
                  />
                </View>
              ),
            }}
          />
        ))}
      </Tabs>
      {showAdd && <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add a source, note, or care log"
        onPress={() => router.push("/add")}
        style={({ pressed }) => ({
          position: "absolute",
          right: 20,
          bottom: barHeight + 16 + insets.bottom,
          width: 54,
          height: 54,
          borderRadius: 27,
          backgroundColor: c.action,
          justifyContent: "center",
          alignItems: "center",
          shadowColor: "#000",
          shadowOpacity: 0.14,
          shadowRadius: 9,
          shadowOffset: { width: 0, height: 4 },
          elevation: 3,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Icon name="add" color={c.onAction} size={28} />
      </Pressable>}
    </View>
  );
}
