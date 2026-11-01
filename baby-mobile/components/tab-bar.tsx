import { useEffect, useState } from "react";
import { Keyboard, Platform, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { useBaby } from "@/lib/context";
import { careLogsStarted, profileToday } from "@/lib/timing";
import { reportTabBarHeight } from "@/lib/bottom-overlay";
import { Icon, PressTarget, tap, useColors, type IconName } from "./ui";

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

/**
 * A solid, JS-drawn tab bar, so iOS 18, iOS 26 and Android show the same calm bar.
 * The selected tab sits in a soft pill; the centre Add is the same pill filled with cocoa.
 */
export function BabyTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const c = useColors(), keyboard = useKeyboardShown(), bootstrap = useBaby().state.bootstrap,
    // Before birth the Add sheet has no feed, sleep or diaper logs, so don't promise them.
    care = !bootstrap || careLogsStarted(bootstrap.children, profileToday(new Date(), bootstrap.profile.timezone)),
    focused = state.routes[state.index]?.name;
  if (keyboard) return null;
  const item = (tab: TabSpec) => {
    const route = state.routes.find((r) => r.name === tab.route);
    if (!route) return null;
    const selected = focused === tab.route, color = selected ? c.action : c.muted;
    return <PressTarget key={tab.route} testID={`tab-${tab.label.toLowerCase()}`} accessibilityRole="tab"
      accessibilityLabel={tab.label} accessibilityState={{ selected }}
      onPress={() => {
        // A second tap on the current tab lets its stack return to the top.
        const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
        if (!selected && !event.defaultPrevented) { tap(); navigation.navigate(route.name, route.params); }
      }}
      onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
      style={styles.slot}>
      <View style={[styles.indicator, { backgroundColor: selected ? c.accentTint : "transparent" }]}>
        <Icon name={selected ? tab.selectedIcon : tab.icon} size={24} color={color} />
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, { color }]}>{tab.label}</Text>
    </PressTarget>;
  };
  return <View onLayout={(event) => reportTabBarHeight(event.nativeEvent.layout.height)}
    style={{ backgroundColor: c.tabBar, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.tabBarBorder,
      paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }}>
    <View style={styles.row}>
      {item(tabs[0])}
      {item(tabs[1])}
      <PressTarget testID="tab-add" accessibilityRole="button" accessibilityLabel="Add"
        accessibilityHint={care ? "Save a source, write, or log care" : "Save a source, write in your journal, or keep a doctor question"}
        onPress={() => { tap(); router.push("/add"); }} style={styles.slot}>
        <View style={[styles.indicator, { backgroundColor: c.action }]}><Icon name="add" size={26} color={c.onAction} /></View>
        <Text allowFontScaling={false} style={[styles.label, { color: c.muted }]}>Add</Text>
      </PressTarget>
      {item(tabs[2])}
      {item(tabs[3])}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { height: TAB_BAR_HEIGHT, flexDirection: "row", alignItems: "center" },
  slot: { flex: 1, height: TAB_BAR_HEIGHT, alignItems: "center", justifyContent: "center", gap: 3 },
  indicator: { width: 56, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 11, lineHeight: 13, fontWeight: "600" },
});
