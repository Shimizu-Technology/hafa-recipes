import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import Svg, { Line } from "react-native-svg";
import { router } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { useBaby } from "@/lib/context";
import { useLook, useLookColors } from "@/lib/look-context";
import { uiFace } from "@/lib/looks";
import { careLogsStarted, profileToday } from "@/lib/timing";
import { reportTabBarHeight } from "@/lib/bottom-overlay";
import { Icon, PressTarget, tap } from "@/components/ui";
import { TAB_BAR_HEIGHT, tabs, useKeyboardShown } from "@/components/tab-bar";
import { reduceMotion, spring } from "./motion";

/** Slot order in the bar: Today, Saved, [Add], Journal, Ask. */
const slotOf = [0, 1, 3, 4];

/**
 * The looks' tab bars: the same solid, JS-drawn bar and centre Add on every OS, with a selected backing that slides
 * between tabs on a critically damped ~300ms spring (a crossfade-free jump under Reduce Motion).
 *   pill (Soft): blush pill behind the icon; Add is a deep-clay circle.
 *   tape (Scrapbook): paper bar with a dotted top edge; a strip of washi tape under the label; Add is a cocoa stamp.
 *   tint (Warm): a clay-tint pill around icon and label; Add is a deep-clay circle.
 */
export function LookTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const { look } = useLook(), c = useLookColors(), keyboard = useKeyboardShown(), bootstrap = useBaby().state.bootstrap,
    care = !bootstrap || careLogsStarted(bootstrap.children, profileToday(new Date(), bootstrap.profile.timezone)),
    focused = state.routes[state.index]?.name, variant = look.variants.tabBar,
    selectedIndex = Math.max(0, tabs.findIndex((tab) => tab.route === focused)),
    [width, setWidth] = useState(0), slot = width / 5,
    x = useRef(new Animated.Value(0)).current, placed = useRef(false);
  const target = slot * slotOf[selectedIndex]!;
  useEffect(() => {
    if (!slot) return;
    const motion = look.motion.tabIndicator;
    if (!placed.current || !motion || reduceMotion()) { x.setValue(target); placed.current = true; return; }
    spring(x, target, motion.durationMs, motion.dampingRatio).start();
  }, [target, slot]);
  if (keyboard) return null;
  const indicator = variant === "tape"
    ? { width: 48, height: 13, top: 41, borderRadius: 2, transform: [{ rotate: "-2deg" }] }
    : variant === "tint" ? { width: 66, height: 52, top: 2, borderRadius: 16 } : { width: 56, height: 30, top: 5, borderRadius: 15 };
  return <View onLayout={(event) => reportTabBarHeight(event.nativeEvent.layout.height)}
    style={{ backgroundColor: c.tabBar, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right,
      ...(variant === "tape" ? {} : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.tabBarBorder }) }}>
    {variant === "tape" && width > 0 && <Svg width={width} height={2} style={{ position: "absolute", top: 0, left: insets.left }}>
      <Line x1={2} y1={1} x2={width} y2={1} stroke={c.tabBarBorder} strokeWidth={1.5} strokeDasharray="1.5 5" strokeLinecap="round" />
    </Svg>}
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ height: TAB_BAR_HEIGHT, flexDirection: "row", alignItems: "center" }}>
      {slot > 0 && <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, top: indicator.top, width: slot, alignItems: "center",
        transform: [{ translateX: x }] }}>
        <View style={{ width: indicator.width, height: indicator.height, borderRadius: indicator.borderRadius, backgroundColor: c.tabIndicator,
          transform: "transform" in indicator ? indicator.transform : undefined, opacity: variant === "tape" ? 0.7 : 1 }} />
      </Animated.View>}
      {[0, 1].map((index) => <Item key={index} index={index} {...{ state, navigation }} />)}
      <PressTarget testID="tab-add" accessibilityRole="button" accessibilityLabel="Add" accessibilityShowsLargeContentViewer accessibilityLargeContentTitle="Add"
        accessibilityHint={care ? "Save a source, write, or log care" : "Save a source, write in your journal, or keep a doctor question"}
        onPress={() => { tap(); router.push("/add"); }} style={styles.slot}>
        <View style={variant === "tape"
          ? { width: 50, height: 32, marginVertical: 2, borderRadius: 9, backgroundColor: c.addFill, alignItems: "center", justifyContent: "center", transform: [{ rotate: "-1deg" }] }
          : { width: 36, height: 36, borderRadius: 18, backgroundColor: c.addFill, alignItems: "center", justifyContent: "center" }}>
          <Icon name="add" size={variant === "tape" ? 24 : 26} color={c.onAdd} />
        </View>
        <Text allowFontScaling={false} style={[styles.label, uiFace(look, "semibold"), { color: c.muted }]}>Add</Text>
      </PressTarget>
      {[2, 3].map((index) => <Item key={index} index={index} {...{ state, navigation }} />)}
    </View>
  </View>;
}

function Item({ index, state, navigation }: { index: number } & Pick<BottomTabBarProps, "state" | "navigation">) {
  const { look } = useLook(), c = useLookColors(), tab = tabs[index]!, route = state.routes.find((r) => r.name === tab.route);
  if (!route) return null;
  const selected = state.routes[state.index]?.name === tab.route, color = selected ? c.tabInk : c.muted;
  return <PressTarget testID={`tab-${tab.label.toLowerCase()}`} accessibilityRole="tab"
    accessibilityLabel={tab.label} accessibilityShowsLargeContentViewer accessibilityLargeContentTitle={tab.label} accessibilityState={{ selected }}
    onPress={() => {
      const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
      if (!selected && !event.defaultPrevented) { tap(); navigation.navigate(route.name, route.params); }
    }}
    onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
    style={styles.slot}>
    {/* 36pt icon box so labels line up with the 36pt Add. */}
    <View style={{ width: 56, height: 36, alignItems: "center", justifyContent: "center" }}>
      <Icon name={selected ? tab.selectedIcon : tab.icon} size={24} color={color} />
    </View>
    <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, uiFace(look, selected ? "bold" : "semibold"), { color }]}>{tab.label}</Text>
  </PressTarget>;
}

const styles = StyleSheet.create({
  slot: { flex: 1, minWidth: 44, height: TAB_BAR_HEIGHT, alignItems: "center", justifyContent: "center", gap: 3 },
  label: { fontSize: 11, lineHeight: 13 },
});
