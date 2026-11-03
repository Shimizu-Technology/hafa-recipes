import { useEffect, useState } from 'react';
import { Animated, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useRouter } from 'expo-router';
import { useColors } from '@/components/Themed';
import { reportTabScreenBottomInset } from '@/lib/bottomOverlay';
import { scrollTabToTop } from '@/lib/tabScrollToTop';
import { lightHaptic, selectionHaptic } from '@/utils/haptics';
import { LookPressable, useIndicatorX } from '@/components/lookMotion';
import { useLook } from '@/contexts/LookContext';
import { uiFontFor, type Look } from '@/constants/looks';

/** Content height above the home indicator; overlays and lists read the total through `bottomOverlay`. */
export const TAB_BAR_HEIGHT = 56;
/** Island's floating dock: its own height, the gap above it and the gap above the home indicator. */
const DOCK_HEIGHT = 64;
const DOCK_TOP_GAP = 6;
const dockBottomGap = (bottom: number) => (bottom > 0 ? Math.max(bottom - 8, 8) : 12);

/** Total height the active look's tab bar takes, including the home indicator. */
export function tabBarTotalHeight(look: Look, bottom: number) {
  return look.variants.tabBar === 'dock' ? DOCK_TOP_GAP + DOCK_HEIGHT + dockBottomGap(bottom) : TAB_BAR_HEIGHT + bottom;
}
export function useTabBarHeight() {
  const look = useLook();
  const { bottom } = useSafeAreaInsets();
  return tabBarTotalHeight(look, bottom);
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const TAB_ICONS: Record<string, [IconName, IconName]> = {
  recipes: ['library-outline', 'library'],
  discover: ['compass-outline', 'compass'],
  planner: ['calendar-outline', 'calendar'],
  grocery: ['cart-outline', 'cart'],
};
/** The Import action sits in the middle slot, between these two halves of the route list. */
const IMPORT_SLOT = 2;

/** True while the software keyboard is up (iOS reports it as it starts to rise). */
export function useKeyboardVisible() {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    // iOS fires the "will" events early enough that the bar leaves with the keyboard.
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return visible;
}

/**
 * Håfa's own tab bar: an opaque surface that looks the same on iOS 18, iOS 26 and Android,
 * a tonal pill behind the selected icon, and a centre Import action that opens the import screen.
 */
export function HafaTabBar(props: BottomTabBarProps) {
  const look = useLook();
  return look.variants.tabBar === 'current' ? <CurrentTabBar {...props} /> : <LookTabBar {...props} look={look} />;
}

function CurrentTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const colors = useColors();
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const height = TAB_BAR_HEIGHT + bottom;
  useEffect(() => { reportTabScreenBottomInset(height); }, [height]);
  if (keyboardVisible) return null;

  const tabs = state.routes.map((route, index) => {
    const { options } = descriptors[route.key];
    const focused = state.index === index;
    const label = typeof options.title === 'string' ? options.title : route.name;
    const [icon, selectedIcon] = TAB_ICONS[route.name] ?? ['ellipse-outline', 'ellipse'];
    const onPress = () => {
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (event.defaultPrevented) return;
      // Re-tapping the selected tab returns its list to the top, as the system tab bar does.
      if (focused) { scrollTabToTop(route.name); return; }
      lightHaptic();
      navigation.navigate(route.name, route.params);
    };
    return <Pressable key={route.key} onPress={onPress} onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
      accessibilityRole="tab" accessibilityLabel={label} accessibilityShowsLargeContentViewer accessibilityLargeContentTitle={label} accessibilityState={{ selected: focused }} testID={`tab-${route.name}`}
      style={({ pressed }) => [styles.slot, pressed && styles.pressed]}>
      <View style={[styles.indicator, focused && { backgroundColor: colors.chromeIndicator }]}>
        <Ionicons name={focused ? selectedIcon : icon} size={24} color={focused ? colors.tint : colors.tabIconDefault} />
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, { color: focused ? colors.tint : colors.tabIconDefault }]}>{label}</Text>
    </Pressable>;
  });

  const importAction = <Pressable key="import" onPress={() => { lightHaptic(); router.push('/'); }}
    accessibilityRole="button" accessibilityLabel="Import a recipe" accessibilityShowsLargeContentViewer accessibilityLargeContentTitle="Import" testID="tab-import"
    style={({ pressed }) => [styles.slot, pressed && styles.pressed]}>
    <View style={[styles.importAction, { backgroundColor: colors.tint }]}>
      <Ionicons name="add" size={24} color={colors.onTint} />
    </View>
    <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, { color: colors.tabIconDefault }]}>Import</Text>
  </Pressable>;

  return <View style={[styles.bar, { height, paddingBottom: bottom, backgroundColor: colors.chromeBar, borderTopColor: colors.chromeHairline }]}>
    {[...tabs.slice(0, IMPORT_SLOT), importAction, ...tabs.slice(IMPORT_SLOT)]}
  </View>;
}

/**
 * Design-preview bars. Cookbook: paper bar, ink selection and a sliding reef dot, Import as a 40pt circle.
 * Island: a floating opaque dock with a sliding sand pill and a 48pt reef Import in the centre slot.
 * Calm: a flush bar, filled ink selection under a sliding top marker, Import as a 44x32 reef capsule.
 */
function LookTabBar({ state, descriptors, navigation, look }: BottomTabBarProps & { look: Look }) {
  const colors = useColors();
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const [rowWidth, setRowWidth] = useState(0);
  const variant = look.variants.tabBar;
  const dock = variant === 'dock';
  const height = tabBarTotalHeight(look, bottom);
  useEffect(() => { reportTabScreenBottomInset(height); }, [height]);
  const slotCount = state.routes.length + 1;
  const slotWidth = rowWidth / slotCount;
  const selectedSlot = state.index < IMPORT_SLOT ? state.index : state.index + 1;
  const markerWidth = variant === 'dock' ? 64 : variant === 'calm' ? 24 : 4;
  const x = useIndicatorX(rowWidth ? selectedSlot * slotWidth + (slotWidth - markerWidth) / 2 : 0);
  const markerStyle = { transform: [{ translateX: x }] };
  const labelFont = look.fonts ? { fontFamily: uiFontFor(look.fonts, '600') } : { fontWeight: '600' as const };
  if (keyboardVisible) return null;

  const tabs = state.routes.map((route, index) => {
    const { options } = descriptors[route.key];
    const focused = state.index === index;
    const label = typeof options.title === 'string' ? options.title : route.name;
    const [icon, selectedIcon] = TAB_ICONS[route.name] ?? ['ellipse-outline', 'ellipse'];
    const tone = focused ? colors.text : colors.tabIconDefault;
    const onPress = () => {
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (event.defaultPrevented) return;
      if (focused) { scrollTabToTop(route.name); return; }
      selectionHaptic();
      navigation.navigate(route.name, route.params);
    };
    return <LookPressable key={route.key} onPress={onPress} onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
      accessibilityRole="tab" accessibilityLabel={label} accessibilityShowsLargeContentViewer accessibilityLargeContentTitle={label} accessibilityState={{ selected: focused }} testID={`tab-${route.name}`}
      style={styles.slot}>
      <View style={dock ? styles.dockIcon : null}>
        <Ionicons name={focused ? selectedIcon : icon} size={24} color={tone} />
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, labelFont, { color: tone }]}>{label}</Text>
      {variant === 'cookbook' && <View style={styles.dotSpace} />}
    </LookPressable>;
  });

  const importVisual = variant === 'calm'
    ? <><View style={styles.capsuleSlot}><View style={[styles.capsule, { backgroundColor: colors.tint }]}><Ionicons name="add" size={24} color={colors.onTint} /></View></View>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, labelFont, { color: colors.tabIconDefault }]}>Import</Text></>
    : <View style={[styles.circle, { width: dock ? 48 : 40, height: dock ? 48 : 40, borderRadius: dock ? 24 : 20, backgroundColor: colors.tint }]}>
      <Ionicons name="add" size={dock ? 28 : 26} color={colors.onTint} />
    </View>;
  const importAction = <LookPressable key="import" onPress={() => { lightHaptic(); router.push('/'); }}
    accessibilityRole="button" accessibilityLabel="Import a recipe" accessibilityShowsLargeContentViewer accessibilityLargeContentTitle="Import" testID="tab-import"
    style={styles.slot}>{importVisual}</LookPressable>;

  const marker = variant === 'cookbook'
    ? <Animated.View pointerEvents="none" style={[styles.dot, { backgroundColor: colors.highlight }, markerStyle]} />
    : variant === 'calm'
      ? <Animated.View pointerEvents="none" style={[styles.topMarker, { backgroundColor: colors.text }, markerStyle]} />
      : <Animated.View pointerEvents="none" style={[styles.dockPill, { backgroundColor: colors.chromeIndicator }, markerStyle]} />;

  const row = <View style={[styles.lookRow, dock && { height: DOCK_HEIGHT }]} onLayout={event => setRowWidth(event.nativeEvent.layout.width)}>
    {rowWidth > 0 && marker}
    {[...tabs.slice(0, IMPORT_SLOT), importAction, ...tabs.slice(IMPORT_SLOT)]}
  </View>;

  if (dock) {
    return <View style={{ height, paddingTop: DOCK_TOP_GAP, paddingBottom: dockBottomGap(bottom), paddingHorizontal: 12, backgroundColor: colors.background }}>
      <View style={[styles.dock, look.shadows.float, styles.dockLift, { backgroundColor: colors.chromeBar, borderColor: colors.dark ? 'rgba(244,238,230,0.10)' : colors.border }]}>{row}</View>
    </View>;
  }
  return <View style={[styles.lookBar, { height, paddingBottom: bottom, backgroundColor: colors.chromeBar, borderTopColor: colors.chromeHairline }]}>{row}</View>;
}

const styles = StyleSheet.create({
  lookBar: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4 },
  lookRow: { flex: 1, flexDirection: 'row' },
  dock: { borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4 },
  dockLift: { shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.16, shadowRadius: 20 },
  dockIcon: { height: 28, justifyContent: 'center' },
  dockPill: { position: 'absolute', top: 6, width: 64, height: 52, borderRadius: 18 },
  dot: { position: 'absolute', bottom: 5, width: 4, height: 4, borderRadius: 2 },
  dotSpace: { height: 4 },
  topMarker: { position: 'absolute', top: 0, width: 24, height: 2, borderRadius: 1 },
  circle: { alignItems: 'center', justifyContent: 'center' },
  // The capsule overhangs a 24pt slot so the Import label sits on the same line as the tab labels.
  capsuleSlot: { height: 24, alignItems: 'center', justifyContent: 'center' },
  capsule: { width: 44, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4 },
  slot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 44 },
  pressed: { opacity: 0.6 },
  indicator: { width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  // Same footprint as the selected pill so every icon and label lines up across the bar.
  importAction: { width: 48, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, lineHeight: 13, fontWeight: '600' },
});
