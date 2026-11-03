import { useEffect, useState } from 'react';
import { Animated, Keyboard, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useRouter } from 'expo-router';
import { useColors } from '@/components/Themed';
import { reportTabScreenBottomInset } from '@/lib/bottomOverlay';
import { scrollTabToTop } from '@/lib/tabScrollToTop';
import { lightHaptic } from '@/utils/haptics';
import { PressScale, useIndicatorX } from '@/components/chrome/motion';
import { fontFamily } from '@/constants/Colors';

/** Content height above the home indicator; overlays and lists read the total through `bottomOverlay`. */
export const TAB_BAR_HEIGHT = 56;

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
 * Håfa's own tab bar: a flush opaque surface that looks the same on iOS 18, iOS 26 and Android.
 * The selected tab is a filled ink icon and label under a 24×2 marker that slides along the top edge;
 * Import is the bar's one accent object, a 44×32 reef capsule in the centre slot.
 */
export function HafaTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const colors = useColors();
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const [rowWidth, setRowWidth] = useState(0);
  const height = TAB_BAR_HEIGHT + bottom;
  useEffect(() => { reportTabScreenBottomInset(height); }, [height]);
  const slotWidth = rowWidth / (state.routes.length + 1);
  const selectedSlot = state.index < IMPORT_SLOT ? state.index : state.index + 1;
  const markerX = useIndicatorX(rowWidth ? selectedSlot * slotWidth + (slotWidth - MARKER_WIDTH) / 2 : 0, selectedSlot);
  if (keyboardVisible) return null;

  const tabs = state.routes.map((route, index) => {
    const { options } = descriptors[route.key];
    const focused = state.index === index;
    const label = typeof options.title === 'string' ? options.title : route.name;
    const [icon, selectedIcon] = TAB_ICONS[route.name] ?? ['ellipse-outline', 'ellipse'];
    const tone = focused ? colors.tabIconSelected : colors.tabIconDefault;
    const onPress = () => {
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (event.defaultPrevented) return;
      // Re-tapping the selected tab returns its list to the top, as the system tab bar does.
      if (focused) { scrollTabToTop(route.name); return; }
      lightHaptic();
      navigation.navigate(route.name, route.params);
    };
    return <PressScale key={route.key} onPress={onPress} onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
      accessibilityRole="tab" accessibilityLabel={label} accessibilityShowsLargeContentViewer accessibilityLargeContentTitle={label} accessibilityState={{ selected: focused }} testID={`tab-${route.name}`}
      style={styles.slot}>
      <View style={styles.iconSlot}>
        <Ionicons name={focused ? selectedIcon : icon} size={24} color={tone} />
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, { color: tone }]}>{label}</Text>
    </PressScale>;
  });

  const importAction = <PressScale key="import" onPress={() => { lightHaptic(); router.push('/'); }}
    accessibilityRole="button" accessibilityLabel="Import a recipe" accessibilityShowsLargeContentViewer accessibilityLargeContentTitle="Import" testID="tab-import"
    style={styles.slot}>
    {/* The capsule overhangs a 24pt slot so the Import label sits on the same line as the tab labels. */}
    <View style={styles.iconSlot}>
      <View style={[styles.importAction, { backgroundColor: colors.tint }]}>
        <Ionicons name="add" size={24} color={colors.onTint} />
      </View>
    </View>
    <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, { color: colors.tabIconDefault }]}>Import</Text>
  </PressScale>;

  return <View style={[styles.bar, { height, paddingBottom: bottom, backgroundColor: colors.chromeBar, borderTopColor: colors.chromeHairline }]}>
    <View style={styles.row} onLayout={event => setRowWidth(event.nativeEvent.layout.width)}>
      {rowWidth > 0 && <Animated.View pointerEvents="none" style={[styles.marker, { backgroundColor: colors.tabIconSelected, transform: [{ translateX: markerX }] }]} />}
      {[...tabs.slice(0, IMPORT_SLOT), importAction, ...tabs.slice(IMPORT_SLOT)]}
    </View>
  </View>;
}

const MARKER_WIDTH = 24;

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4 },
  row: { flex: 1, flexDirection: 'row' },
  slot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 44 },
  iconSlot: { height: 24, alignItems: 'center', justifyContent: 'center' },
  marker: { position: 'absolute', top: 0, width: MARKER_WIDTH, height: 2, borderRadius: 1 },
  importAction: { width: 44, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, lineHeight: 13, fontFamily: fontFamily.semibold },
});
