import { useLook } from "@/lib/look-context";
import { SPRING } from "./look-motion";
import { usePressScale, animatedPressableComponent } from "./press";
import { useReducedMotion } from "./foundation";
import { useEffect, useRef, useState } from "react";
import { Animated, Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";
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

/**
 * Solid, JS-drawn tab bar: the same pixels on iOS 18, iOS 26 and Android.
 * Selected tabs get the accent with a tonal pill behind the icon; the centre slot is the same
 * pill filled with the accent, so it reads as the action without rising out of the bar.
 */
function CurrentTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const c = useColors();
  const keyboard = useKeyboardShown();
  const focused = state.routes[state.index]?.name;
  if (keyboard) return null;
  const item = (tab: TabSpec) => {
    const route = state.routes.find(r => r.name === tab.route);
    if (!route) return null;
    const selected = focused === tab.route;
    const color = selected ? c.accentText : c.muted;
    return <Pressable key={tab.route} testID={`tab-${tab.route}`} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityShowsLargeContentViewer accessibilityLargeContentTitle={tab.label}
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
      <Pressable testID="tab-add" accessibilityRole="button" accessibilityLabel="Add a workout" accessibilityShowsLargeContentViewer accessibilityLargeContentTitle="Add" accessibilityHint="Import from a link, video or photo, or build one"
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

/** Each preview has authored opaque chrome; Current above remains the original implementation. */
export function AppTabBar(props: BottomTabBarProps) {
  return useLook().id === "current" ? <CurrentTabBar {...props} /> : <PreviewTabBar {...props} />;
}
function PreviewTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const c = useColors(), look = useLook(), reduced = useReducedMotion();
  const keyboard = useKeyboardShown();
  const [width, setWidth] = useState(0);
  const selected = tabs.findIndex(t => t.route === state.routes[state.index]?.name);
  const slotIndex = selected > 1 ? selected + 1 : Math.max(0, selected);
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const toValue = slotIndex * width / 5;
    if (reduced || !width) { x.setValue(toValue); return; }
    const a = Animated.spring(x, { toValue, ...SPRING.snappy, useNativeDriver: Platform.OS !== "web" });
    a.start(); return () => a.stop();
  }, [slotIndex, width, reduced, x]);
  if (keyboard) return null;
  return <View onLayout={e => reportTabScreenBottomInset(e.nativeEvent.layout.height)} style={{ backgroundColor: c.tabBar, borderTopWidth: look.id === "athletic" ? 0 : StyleSheet.hairlineWidth, borderTopColor: c.tabBarBorder, paddingBottom: insets.bottom, paddingHorizontal: Math.max(insets.left, insets.right) }}>
    <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={styles.row}>
      {!!width && <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, top: look.id === "athletic" ? 0 : 6, width: width / 5, alignItems: "center", transform: [{ translateX: x }] }}>
        <View style={{ width: look.id === "pro" ? 4 : look.id === "athletic" ? 28 : 50, height: look.id === "pro" ? 4 : look.id === "athletic" ? 3 : 30, borderRadius: look.id === "coach" ? 15 : 2, backgroundColor: look.id === "coach" ? c.sunken : c.accent }} />
      </Animated.View>}
      {[tabs[0], tabs[1], null, tabs[2], tabs[3]].map((tab, i) => <PreviewSlot key={tab?.route ?? "add"} label={tab?.label ?? "Add"} selected={i === slotIndex} icon={tab ? i === slotIndex ? tab.selectedIcon : tab.icon : "add"} add={!tab} onPress={() => {
        if (!tab) { haptics.light(); router.push("/add"); return; }
        const route = state.routes.find(r => r.name === tab.route);
        if (!route) return;
        const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
        if (i !== slotIndex && !e.defaultPrevented) { haptics.tick(); navigation.navigate(route.name, route.params); }
      }} />)}
    </View>
  </View>;
}
function PreviewSlot({ label, selected, icon, add, onPress }: { label: string; selected: boolean; icon: IconName; add: boolean; onPress(): void }) {
  const c = useColors(), look = useLook(), press = usePressScale();
  const Target = animatedPressableComponent();
  const fill = look.id === "pro" ? c.text : c.accent;
  const fg = look.id === "pro" ? c.background : c.onAccent;
  return <Target accessibilityRole={add ? "button" : "tab"} accessibilityLabel={add ? "Add a workout" : label} accessibilityState={add ? undefined : { selected }} accessibilityShowsLargeContentViewer accessibilityLargeContentTitle={label} onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={[styles.slot, { opacity: press.opacity, transform: [{ scale: press.scale }] }]}>
    <View style={{ width: look.id === "coach" && add ? 36 : 50, height: add && look.id === "coach" ? 36 : 30, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: add ? fill : "transparent" }}><Ionicons name={icon} size={add ? 25 : 23} color={add ? fg : selected ? c.text : c.muted} /></View>
    <Text allowFontScaling={false} style={[styles.label, { color: selected ? c.text : c.muted, fontFamily: look.fonts.semibold }]}>{label}</Text>
  </Target>;
}
