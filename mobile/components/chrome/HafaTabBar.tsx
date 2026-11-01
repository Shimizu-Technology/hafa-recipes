import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useRouter } from 'expo-router';
import { Text, useColors } from '@/components/Themed';
import { reportTabScreenBottomInset } from '@/lib/bottomOverlay';
import { scrollTabToTop } from '@/lib/tabScrollToTop';
import { lightHaptic } from '@/utils/haptics';

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

function useKeyboardVisible() {
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
export function HafaTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
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
      accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: focused }} testID={`tab-${route.name}`}
      style={({ pressed }) => [styles.slot, pressed && styles.pressed]}>
      <View style={[styles.indicator, focused && { backgroundColor: colors.chromeIndicator }]}>
        <Ionicons name={focused ? selectedIcon : icon} size={24} color={focused ? colors.tint : colors.tabIconDefault} />
      </View>
      <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={[styles.label, { color: focused ? colors.tint : colors.tabIconDefault }]}>{label}</Text>
    </Pressable>;
  });

  const importAction = <Pressable key="import" onPress={() => { lightHaptic(); router.push('/'); }}
    accessibilityRole="button" accessibilityLabel="Import a recipe" testID="tab-import"
    style={({ pressed }) => [styles.slot, pressed && styles.pressed]}>
    <View style={[styles.importAction, { backgroundColor: colors.tint }]}>
      <Ionicons name="add" size={24} color={colors.onTint} />
    </View>
    <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={[styles.label, { color: colors.tabIconDefault }]}>Import</Text>
  </Pressable>;

  return <View style={[styles.bar, { height, paddingBottom: bottom, backgroundColor: colors.chromeBar, borderTopColor: colors.chromeHairline }]}>
    {[...tabs.slice(0, IMPORT_SLOT), importAction, ...tabs.slice(IMPORT_SLOT)]}
  </View>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4 },
  slot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 44 },
  pressed: { opacity: 0.6 },
  indicator: { width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  // Same footprint as the selected pill so every icon and label lines up across the bar.
  importAction: { width: 48, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, lineHeight: 13, fontWeight: '600' },
});
