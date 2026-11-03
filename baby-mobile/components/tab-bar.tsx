import { useEffect, useRef, useState } from "react";
import { Animated, Keyboard, Platform, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { useBaby } from "@/lib/context";
import { careLogsStarted, profileToday } from "@/lib/timing";
import { reportTabBarHeight } from "@/lib/bottom-overlay";
import { Icon, PressTarget, fonts, tap, useColors, type IconName } from "./ui";
import { useReducedMotion } from "./motion";

/** Bar content height above the home indicator; the same in all three Håfa apps. */
export const TAB_BAR_HEIGHT = 56;

type TabSpec = { route: string; label: string; icon: IconName; selectedIcon: IconName };
/** Today · Saved · Add · Journal · Ask. Add opens the Add sheet; it is an action, not a tab. */
export const tabs: TabSpec[] = [
  { route: "(today)", label: "Today", icon: "sunny-outline", selectedIcon: "sunny" },
  { route: "library", label: "Saved", icon: "bookmark-outline", selectedIcon: "bookmark" },
  { route: "journal", label: "Journal", icon: "book-outline", selectedIcon: "book" },
  { route: "ask", label: "Ask", icon: "chatbubble-ellipses-outline", selectedIcon: "chatbubble-ellipses" },
];

/** iOS covers the bar with the keyboard and Android pushes it up; hide it on both while typing. */
function useKeyboardShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () => setShown(true));
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setShown(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return shown;
}

/** Slot order in the bar: Today, Saved, [Add], Journal, Ask. */
const slotOf = [0, 1, 3, 4];

/**
 * A solid, JS-drawn tab bar, so iOS 18, iOS 26 and Android show the same calm bar.
 * A blush pill slides to the selected tab on a ~300ms critically damped spring (it jumps under Reduce Motion);
 * the centre Add is a deep-clay circle, the one filled object in the bar.
 */
export function BabyTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const c = useColors(), keyboard = useKeyboardShown(), reduced = useReducedMotion(), bootstrap = useBaby().state.bootstrap,
    // Before birth the Add sheet has no feed, sleep or diaper logs, so don't promise them.
    care = !bootstrap || careLogsStarted(bootstrap.children, profileToday(new Date(), bootstrap.profile.timezone)),
    focused = state.routes[state.index]?.name,
    selectedIndex = tabs.findIndex((tab) => tab.route === focused),
    [width, setWidth] = useState(0), slot = width / 5,
    x = useRef(new Animated.Value(0)).current, placed = useRef(false),
    target = slot * (slotOf[selectedIndex] ?? 0);
  useEffect(() => {
    if (!slot || selectedIndex < 0) return;
    if (!placed.current || reduced) { x.setValue(target); placed.current = true; return; }
    // Perceptual duration 300ms, damping ratio 1 (mass 1): stiffness (2π/0.3)², damping 2√stiffness.
    const stiffness = (2 * Math.PI / 0.3) ** 2;
    Animated.spring(x, { toValue: target, stiffness, damping: 2 * Math.sqrt(stiffness), mass: 1, useNativeDriver: Platform.OS !== "web" }).start();
  }, [target, slot, reduced, selectedIndex, x]);
  if (keyboard) return null;
  const item = (tab: TabSpec) => {
    const route = state.routes.find((r) => r.name === tab.route);
    if (!route) return null;
    const selected = focused === tab.route, color = selected ? c.tabInk : c.muted;
    return <PressTarget key={tab.route} testID={`tab-${tab.label.toLowerCase()}`} accessibilityRole="tab"
      accessibilityLabel={tab.label} accessibilityShowsLargeContentViewer accessibilityLargeContentTitle={tab.label} accessibilityState={{ selected }}
      onPress={() => {
        // A second tap on the current tab lets its stack return to the top.
        const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
        if (!selected && !event.defaultPrevented) { tap(); navigation.navigate(route.name, route.params); }
      }}
      onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
      style={styles.slot}>
      {/* A 36pt icon box, so every label lines up with the 36pt Add. */}
      <View style={styles.icon}>
        <Icon name={selected ? tab.selectedIcon : tab.icon} size={24} color={color} />
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, { color, fontFamily: selected ? fonts.bold : fonts.semibold }]}>{tab.label}</Text>
    </PressTarget>;
  };
  return <View onLayout={(event) => reportTabBarHeight(event.nativeEvent.layout.height)}
    style={{ backgroundColor: c.tabBar, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.tabBarBorder,
      paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }}>
    <View style={styles.row} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {slot > 0 && selectedIndex >= 0 && <Animated.View pointerEvents="none" testID="tab-indicator"
        style={[styles.track, { width: slot, transform: [{ translateX: x }] }]}>
        <View style={[styles.pill, { backgroundColor: c.tabIndicator }]} />
      </Animated.View>}
      {item(tabs[0])}
      {item(tabs[1])}
      <PressTarget testID="tab-add" accessibilityRole="button" accessibilityLabel="Add" accessibilityShowsLargeContentViewer accessibilityLargeContentTitle="Add"
        accessibilityHint={care ? "Save a source, write, or log care" : "Save a source, write in your journal, or keep a doctor question"}
        onPress={() => { tap(); router.push("/add"); }} style={styles.slot}>
        <View style={[styles.add, { backgroundColor: c.addFill }]}><Icon name="add" size={26} color={c.onAdd} /></View>
        <Text allowFontScaling={false} style={[styles.label, { color: c.muted, fontFamily: fonts.semibold }]}>Add</Text>
      </PressTarget>
      {item(tabs[2])}
      {item(tabs[3])}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { height: TAB_BAR_HEIGHT, flexDirection: "row", alignItems: "center" },
  // The whole slot is the target: at least 44×44 even on the narrowest phone, whatever the pill size.
  slot: { flex: 1, minWidth: 44, height: TAB_BAR_HEIGHT, alignItems: "center", justifyContent: "center", gap: 3 },
  icon: { width: 56, height: 36, alignItems: "center", justifyContent: "center" },
  // The sliding pill sits behind the 36pt icon box of the selected slot.
  track: { position: "absolute", left: 0, top: (TAB_BAR_HEIGHT - 52) / 2 + 3, alignItems: "center" },
  pill: { width: 56, height: 30, borderRadius: 15 },
  add: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 11, lineHeight: 13 },
});
