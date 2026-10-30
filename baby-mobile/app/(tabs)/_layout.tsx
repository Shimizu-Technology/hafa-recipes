import { Tabs, router, useSegments } from "expo-router";
import type { Ref } from "react";
import { Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, PressTarget, fonts, useColors, type IconName } from "@/components/ui";
export default function TabLayout() {
  const c = useColors(),
    insets = useSafeAreaInsets(),
    { fontScale } = useWindowDimensions(),
    barHeight = Math.max(64, Math.ceil(40 + 28 * fontScale)),
    segments = useSegments(),
    // Ask has its own docked composer; the Add button would sit on top of it.
    showAdd = segments[segments.length - 1] !== "ask";
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: c.text,
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
          tabBarButton:
            Platform.OS === "web"
              ? undefined
              : ({ style, ref, ...props }) => (
                  <PressTarget
                    {...props}
                    ref={ref as Ref<View>}
                    style={style}
                  />
                ),
          sceneStyle: { backgroundColor: c.background, paddingBottom: showAdd ? 76 : 0 },
        }}
      >
        {[
          { name: "index", title: "Today", icon: "sunny-outline", selectedIcon: "sunny" },
          { name: "library", title: "Saved", icon: "bookmark-outline", selectedIcon: "bookmark" },
          { name: "journal", title: "Journal", icon: "book-outline", selectedIcon: "book" },
          { name: "ask", title: "Ask", icon: "chatbubble-outline", selectedIcon: "chatbubble" },
        ].map((t) => (
          <Tabs.Screen
            key={t.name}
            name={t.name}
            options={{
              title: t.title,
              // Labels wrap and the bar grows when Dynamic Type changes.
              tabBarLabel: ({ color }) => (
                <Text maxFontSizeMultiplier={0} style={{ fontSize: 11, fontFamily: fonts.semibold, color, textAlign: "center" }}>
                  {t.title}
                </Text>
              ),
              tabBarIcon: ({ color, focused }) => (
                <View
                  style={{
                    width: 54,
                    height: 32,
                    borderRadius: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: focused ? c.tile : "transparent",
                  }}
                >
                  <Icon
                    name={(focused ? t.selectedIcon : t.icon) as IconName}
                    color={focused ? c.text : color}
                    size={23}
                  />
                </View>
              ),
            }}
          />
        ))}
      </Tabs>
      {showAdd && <PressTarget
        accessibilityRole="button"
        accessibilityLabel="Add a source, note, or care log"
        onPress={() => router.push(segments[segments.length - 1] === "library" ? { pathname: "/edit", params: { kind: "source" } } : segments[segments.length - 1] === "journal" ? { pathname: "/edit", params: { kind: "journal" } } : "/add")}
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
          shadowColor: "#2D2420",
          shadowOpacity: 0.14,
          shadowRadius: 9,
          shadowOffset: { width: 0, height: 4 },
          elevation: 3,
        })}
      >
        <Icon name="add" color={c.onAction} size={28} />
      </PressTarget>}
    </View>
  );
}
