import { useEffect, useState } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { reportTabScreenBottomInset } from "@/lib/bottom-overlay";
import { haptics, useColors } from "./foundation";
import type { IconName } from "./controls";

/** Bar content height above the home indicator (spec v2 §1.1). */
export const TAB_BAR_HEIGHT = 56;

type TabSpec = { route: string; label: string; icon: IconName; selectedIcon: IconName };
/** Today · Library · Add · Discover · Progress. Add is an action, not a route. */
export const tabs: TabSpec[] = [
  { route: "train", label: "Today", icon: "today-outline", selectedIcon: "today" },
  { route: "library", label: "Library", icon: "albums-outline", selectedIcon: "albums" },
  { route: "discover", label: "Discover", icon: "compass-outline", selectedIcon: "compass" },
  { route: "progress", label: "Progress", icon: "stats-chart-outline", selectedIcon: "stats-chart" },
];

/** iOS covers the bar with the keyboard; Android pushes it up. Hide it on both while typing. */
export function useKeyboardShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () => setShown(true));
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setShown(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return shown;
}

/**
 * Solid, JS-drawn tab bar: the same pixels on iOS 18, iOS 26 and Android.
 * Selected tabs get the accent with a tonal pill behind the icon; the centre slot is the same
 * pill filled with the accent, so it reads as the action without rising out of the bar.
 */
export function AppTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const c = useColors();
  const keyboard = useKeyboardShown();
  const focused = state.routes[state.index]?.name;
  if (keyboard) return null;
  const item = (tab: TabSpec) => {
    const route = state.routes.find(r => r.name === tab.route);
    if (!route) return null;
    const selected = focused === tab.route;
    const color = selected ? c.accentText : c.muted;
    return <Pressable key={tab.route} testID={`tab-${tab.route}`} accessibilityRole="tab" accessibilityLabel={tab.label}
      accessibilityState={{ selected }}
      onPress={() => {
        const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
        if (!selected && !event.defaultPrevented) { haptics.tick(); navigation.navigate(route.name, route.params); }
      }}
      onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
      style={({ pressed }) => [styles.slot, { opacity: pressed ? 0.6 : 1 }]}>
      <View style={[styles.indicator, { backgroundColor: selected ? c.accentTint : "transparent" }]}>
        <Ionicons name={selected ? tab.selectedIcon : tab.icon} size={24} color={color} />
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, { color }]}>{tab.label}</Text>
    </Pressable>;
  };
  return <View
    onLayout={event => reportTabScreenBottomInset(event.nativeEvent.layout.height)}
    style={{ backgroundColor: c.tabBar, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.tabBarBorder, paddingBottom: insets.bottom, paddingHorizontal: Math.max(insets.left, insets.right) }}>
    <View style={styles.row}>
      {item(tabs[0])}
      {item(tabs[1])}
      <Pressable testID="tab-add" accessibilityRole="button" accessibilityLabel="Add a workout" accessibilityHint="Import from a link, video or photo, or build one"
        onPress={() => { haptics.light(); router.push("/add"); }}
        style={({ pressed }) => [styles.slot, { opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] }]}>
        <View style={[styles.indicator, { backgroundColor: c.action }]}><Ionicons name="add" size={26} color={c.onAction} /></View>
        <Text allowFontScaling={false} style={[styles.label, { color: c.muted }]}>Add</Text>
      </Pressable>
      {item(tabs[2])}
      {item(tabs[3])}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { height: TAB_BAR_HEIGHT, flexDirection: "row", alignItems: "center" },
  slot: { flex: 1, height: TAB_BAR_HEIGHT, alignItems: "center", justifyContent: "center", gap: 2 },
  indicator: { width: 56, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 11, lineHeight: 13, fontWeight: "600" },
});
