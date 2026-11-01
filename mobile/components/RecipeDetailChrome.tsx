import { useState, type ReactNode } from 'react';
import { Pressable, StatusBar, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type DerivedValue,
} from 'react-native-reanimated';

import { Text, useColors } from '@/components/Themed';

export type RecipeHeaderAction = {
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
  onPress: () => void;
};

/** Bar height below the status bar; 36pt circles sit centred with room to breathe. */
export const RECIPE_HEADER_BAR = 52;
/** Distance over which the header turns from "over the photo" to opaque. */
const SOLID_FADE = 48;
const TITLE_FADE = 32;

/** Scroll offsets at which the bar turns opaque and its title appears. Without a photo the bar is always opaque. */
export function recipeHeaderRanges(heroHeight: number, headerHeight: number) {
  const solidAt = heroHeight > 0 ? Math.max(heroHeight - headerHeight, 0) : 0;
  const titleAt = solidAt + 24;
  return {
    solid: heroHeight > 0 ? [solidAt - SOLID_FADE, solidAt] : null,
    title: [titleAt, titleAt + TITLE_FADE],
  };
}

function headerFills(dark: boolean) {
  return {
    solid: dark ? 'rgba(28,28,30,0.92)' : 'rgba(255,255,255,0.92)',
    tonal: dark ? 'rgba(118,118,128,0.24)' : 'rgba(118,118,128,0.12)',
    hairline: dark ? 'rgba(84,84,88,0.5)' : 'rgba(60,60,67,0.18)',
  };
}

/** A 36pt circle in a 44pt target: solid over the photo, tonal once the bar is opaque. */
function HeaderCircle({ action, solid }: { action: RecipeHeaderAction; solid: DerivedValue<number> }) {
  const colors = useColors();
  const fills = headerFills(colors.background === '#000000');
  const solidStyle = useAnimatedStyle(() => ({ opacity: 1 - solid.value }));
  const tonalStyle = useAnimatedStyle(() => ({ opacity: solid.value }));
  return (
    <Pressable
      onPress={action.onPress}
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel}
      hitSlop={4}
      style={({ pressed }) => [styles.circleTarget, pressed && styles.pressed]}
    >
      <Animated.View style={[styles.circle, styles.circleShadow, { backgroundColor: fills.solid }, solidStyle]} />
      <Animated.View style={[styles.circle, { backgroundColor: fills.tonal }, tonalStyle]} />
      <Ionicons name={action.icon} size={20} color={colors.text} />
    </Pressable>
  );
}

/**
 * The recipe header we draw ourselves so it reads the same on iOS 18, iOS 26 and Android:
 * solid circles over the photo, then an opaque bar with the title once the photo scrolls away.
 */
export function RecipeDetailHeader({ title, actions = [], solid, titleShown }: {
  title?: string;
  actions?: RecipeHeaderAction[];
  solid: DerivedValue<number>;
  titleShown: DerivedValue<number>;
}) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const dark = colors.background === '#000000';
  const [overPhoto, setOverPhoto] = useState(false);
  useAnimatedReaction(() => solid.value < 0.5, (next, previous) => {
    if (next !== previous) runOnJS(setOverPhoto)(next);
  });
  const barStyle = useAnimatedStyle(() => ({ opacity: solid.value }));
  const titleStyle = useAnimatedStyle(() => ({ opacity: titleShown.value }));
  // Left and right slots share a width so the title stays centred.
  const sideWidth = Math.max(actions.length, 1) * 44 + Math.max(actions.length - 1, 0) * 4;
  const back: RecipeHeaderAction = {
    icon: 'chevron-back',
    accessibilityLabel: 'Back',
    onPress: () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/recipes')),
  };

  return (
    <View pointerEvents="box-none" style={[styles.header, { paddingTop: insets.top, height: insets.top + RECIPE_HEADER_BAR }]}>
      {isFocused && <StatusBar barStyle={overPhoto || dark ? 'light-content' : 'dark-content'} animated />}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }, barStyle]} />
      <Animated.View pointerEvents="none" style={[styles.hairline, { backgroundColor: headerFills(dark).hairline }, titleStyle]} />
      <View pointerEvents="box-none" style={styles.row}>
        <View style={{ width: sideWidth }}><HeaderCircle action={back} solid={solid} /></View>
        <Animated.View style={[styles.titleWrap, titleStyle]} pointerEvents="none"
          accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={[styles.title, { color: colors.text }]}>{title}</Text>
        </Animated.View>
        <View style={[styles.actions, { width: sideWidth }]}>
          {actions.map((action) => <HeaderCircle key={action.accessibilityLabel} action={action} solid={solid} />)}
        </View>
      </View>
    </View>
  );
}

/** Header-only frame for loading and error states: opaque, Back only, content below the bar. */
export function RecipeDetailFrame({ children }: { children: ReactNode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const opaque = useSharedValue(1);
  const hidden = useSharedValue(0);
  return (
    <View style={[styles.fill, { backgroundColor: colors.background, paddingTop: insets.top + RECIPE_HEADER_BAR }]}>
      <RecipeDetailHeader solid={opaque} titleShown={hidden} />
      {children}
    </View>
  );
}

/**
 * Scroll container for recipe detail. With a hero the photo runs full-bleed under the bar;
 * without one (missing or failed photo) content starts below an opaque bar.
 */
export function RecipeDetailScroll({ title, hero, expectHero, actions, children, contentContainerStyle }: {
  title: string;
  hero: ReactNode;
  /** Whether a photo is expected, so the first frame doesn't flash an opaque bar. */
  expectHero: boolean;
  actions?: RecipeHeaderAction[];
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const headerHeight = insets.top + RECIPE_HEADER_BAR;
  const [heroHeight, setHeroHeight] = useState(expectHero ? Math.round(width * 0.75) : 0);
  const ranges = recipeHeaderRanges(heroHeight, headerHeight);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => { scrollY.value = event.contentOffset.y; });
  const solid = useDerivedValue(() => (ranges.solid
    ? interpolate(scrollY.value, ranges.solid, [0, 1], Extrapolation.CLAMP) : 1));
  const titleShown = useDerivedValue(() => interpolate(scrollY.value, ranges.title, [0, 1], Extrapolation.CLAMP));
  // Pulling down stretches the photo from its top edge instead of showing a gap above it.
  const heroStyle = useAnimatedStyle(() => {
    const pull = Math.min(scrollY.value, 0);
    return heroHeight > 0 && pull < 0
      ? { transform: [{ translateY: pull / 2 }, { scale: 1 - pull / heroHeight }] }
      : { transform: [] };
  });

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      {/* First in reading order so VoiceOver reaches Back before the recipe; zIndex keeps it above the scroll. */}
      <RecipeDetailHeader title={title} actions={actions} solid={solid} titleShown={titleShown} />
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={contentContainerStyle}
      >
        {heroHeight === 0 && <View style={{ height: headerHeight }} />}
        <Animated.View style={heroStyle} onLayout={(event) => setHeroHeight(Math.round(event.nativeEvent.layout.height))}>
          {hero}
        </Animated.View>
        {children}
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1, elevation: 3 },
  hairline: { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 4 },
  titleWrap: { flex: 1, paddingHorizontal: 8 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 4 },
  circleTarget: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  circle: { position: 'absolute', width: 36, height: 36, borderRadius: 18 },
  circleShadow: { shadowColor: '#000000', shadowOffset: { width: 0, height: 1 }, shadowRadius: 3, shadowOpacity: 0.18, elevation: 2 },
  pressed: { opacity: 0.6 },
});
