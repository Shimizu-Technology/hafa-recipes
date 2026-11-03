import { fonts } from "@/constants/theme";
import { animatedPressableComponent, usePressScale } from "./press";
import { useEffect, useRef, useState } from "react";
import { Animated, Keyboard, Platform, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { reportTabScreenBottomInset } from "@/lib/bottom-overlay";
import { haptics, useColors, useReducedMotion } from "./foundation";
import type { IconName } from "./controls";

/** Bar content height above the home indicator (spec v2 §1.1). */
export const TAB_BAR_HEIGHT = 56;

type TabSpec = { route: string; label: string; icon: IconName; selectedIcon: IconName };
/** Today · Library · Add · Discover · Progress. Add is an action, not a route. */
export const tabs: TabSpec[] = [
  { route: "train", label: "Today", icon: "today-outline", selectedIcon: "today" },
  { route: "library", label: "Library", icon: "albums-outline", selectedIcon: "albums" },
  { route: "discover", label: "Discover", icon: "compass-outline", selectedIcon: "compass" },
  { route: "history", label: "Progress", icon: "stats-chart-outline", selectedIcon: "stats-chart" },
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

export function AppTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const c = useColors(), reduced = useReducedMotion();
  const keyboard = useKeyboardShown();
  const [width, setWidth] = useState(0);
  const selected = tabs.findIndex(t => t.route === state.routes[state.index]?.name);
  const slotIndex = selected > 1 ? selected + 1 : selected;
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const toValue = slotIndex * width / 5;
    if (reduced || !width) { x.setValue(toValue); return; }
    const a = Animated.spring(x, { toValue, stiffness: 500, damping: 35, mass: 1, useNativeDriver: Platform.OS !== "web" });
    a.start(); return () => a.stop();
  }, [slotIndex, width, reduced, x]);
  if (keyboard) return null;
  return <View onLayout={e => reportTabScreenBottomInset(e.nativeEvent.layout.height)} style={{ backgroundColor: c.tabBar, borderTopWidth: 0, borderTopColor: c.tabBarBorder, paddingBottom: insets.bottom, paddingHorizontal: Math.max(insets.left, insets.right) }}>
    <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={styles.row}>
      {!!width && selected >= 0 && <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: width / 5, alignItems: "center", transform: [{ translateX: x }] }}>
        <View style={{ width: 28, height: 3, borderRadius: 2, backgroundColor: c.accent }} />
      </Animated.View>}
      {[tabs[0], tabs[1], null, tabs[2], tabs[3]].map((tab, i) => <TabSlot key={tab?.route ?? "add"} label={tab?.label ?? "Add"} selected={i === slotIndex} icon={tab ? i === slotIndex ? tab.selectedIcon : tab.icon : "add"} add={!tab} testID={tab ? `tab-${tab.route}` : "tab-add"} onLongPress={tab ? () => { const route = state.routes.find(r => r.name === tab.route); if (route) navigation.emit({ type: "tabLongPress", target: route.key }); } : undefined} onPress={() => {
        if (!tab) { haptics.light(); router.push("/add"); return; }
        const route = state.routes.find(r => r.name === tab.route);
        if (!route) return;
        const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
        if (i !== slotIndex && !e.defaultPrevented) { haptics.tick(); navigation.navigate(route.name, route.params); }
      }} />)}
    </View>
  </View>;
}
function TabSlot({ label, selected, icon, add, testID, onLongPress, onPress }: { label: string; selected: boolean; icon: IconName; add: boolean; testID: string; onLongPress?(): void; onPress(): void }) {
  const c = useColors(), press = usePressScale();
  const Target = animatedPressableComponent();
  const fill = c.accent;
  const fg = c.onAccent;
  return <Target testID={testID} onLongPress={onLongPress} accessibilityRole={add ? "button" : "tab"} accessibilityLabel={add ? "Add a workout" : label} accessibilityHint={add ? "Import from a link, video or photo, or build one" : undefined} accessibilityState={add ? undefined : { selected }} accessibilityShowsLargeContentViewer accessibilityLargeContentTitle={label} onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={[styles.slot, { opacity: press.opacity, transform: [{ scale: press.scale }] }]}>
    <View style={{ width: 50, height: 30, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: add ? fill : "transparent" }}><Ionicons name={icon} size={add ? 25 : 23} color={add ? fg : selected ? c.text : c.muted} /></View>
    <Text allowFontScaling={false} style={[styles.label, { color: selected ? c.text : c.muted, fontFamily: fonts.semibold }]}>{label}</Text>
  </Target>;
}

const styles = StyleSheet.create({
  row: { height: TAB_BAR_HEIGHT, flexDirection: "row", alignItems: "center" },
  slot: { flex: 1, height: TAB_BAR_HEIGHT, alignItems: "center", justifyContent: "center", gap: 2 },
  label: { fontSize: 11, lineHeight: 13, fontWeight: "400" },
});
