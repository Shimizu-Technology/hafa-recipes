import { Children, forwardRef, createContext, useContext, useEffect, useRef, useState, type PropsWithChildren, type RefObject } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  RefreshControl,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
  type PressableProps,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
  type ColorValue,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Stack, router, useScrollToTop, useSegments } from "expo-router";
import { NavigationContext } from "expo-router/react-navigation";
import { isTabRoute, overlayBottom, reportDockedFooter, useDockedFooterHeight, useTabBarHeight } from "../lib/bottom-overlay";
import { inputTraits, type InputPurpose } from "@/lib/input-purpose";
import { BrandMark } from "./brand-mark";

/**
 * Soft, Kami's Sand & Cocoa: sand behind the whole app (the light splash), the warm near-black splash ground at night,
 * cocoa for actions, clay only in fills, and deep clay for clay-coloured text and the Add circle.
 */
const light = {
  background: "#F8F3EE", groupedBackground: "#F8F3EE", surface: "#FFFFFF",
  soft: "#EFE5DC", tile: "#F3E9E1", hero: "#F1DDD3",
  text: "#5A4740", muted: "#725F56", action: "#5A4740", onAction: "#F8F3EE",
  border: "rgba(90,71,64,0.14)", outline: "rgba(90,71,64,0.24)",
  accent: "#C9907E", accentText: "#8E4F3D", error: "#B3261E", errorBg: "#FBE3DE",
  // Tonal fill behind a selected text link; accentText on it stays ≥4.5:1.
  accentTint: "#F1DDD3",
  scrim: "rgba(45,36,32,0.42)",
  // JS-drawn chrome: the same solid bar and tonal header buttons on iOS 18, iOS 26 and Android.
  tabBar: "#FFFDFB", tabBarBorder: "#EADFD2", headerFill: "#EFE5DC",
  // The selected tab's blush pill, and the deep-clay Add: the one filled object in the bar.
  tabIndicator: "#F1DDD3", tabInk: "#5A4740", addFill: "#9A5744", onAdd: "#FFFFFF",
  // The 34-of-40 pregnancy bar, and the blush monogram tile for sources without a photo.
  progressTrack: "rgba(154,87,68,0.16)", progressFill: "#9A5744", placeholder: "#F1DDD3", placeholderInk: "#8E4F3D",
  // Calendar events, by category. Each also has its own icon and name, so colour is never the only signal.
  categories: { appointment: "#9A5744", family: "#557A52", celebration: "#A06F0C", milestone: "#85568A", reminder: "#44708F", other: "#725F56" },
};
const dark: typeof light = {
  background: "#14110F", groupedBackground: "#14110F", surface: "#221B18",
  soft: "#2E2522", tile: "#2A221F", hero: "#33251F",
  text: "#F3E9E2", muted: "#B5A39A", action: "#EBD7CA", onAction: "#2D2420",
  border: "rgba(243,233,226,0.12)", outline: "rgba(243,233,226,0.22)",
  accent: "#E0A894", accentText: "#E0A894", error: "#FF6B61", errorBg: "#3A1F1C",
  accentTint: "#3A2A23",
  scrim: "rgba(0,0,0,0.6)",
  tabBar: "#1C1714", tabBarBorder: "#2E2622", headerFill: "#2A221F",
  tabIndicator: "#3A2A23", tabInk: "#F3E9E2", addFill: "#E0A894", onAdd: "#2A1B16",
  progressTrack: "rgba(224,168,148,0.2)", progressFill: "#E0A894", placeholder: "#33251F", placeholderInk: "#E0A894",
  categories: { appointment: "#E0A894", family: "#9CC497", celebration: "#E6C069", milestone: "#CDA2D2", reminder: "#96BEDB", other: "#B5A39A" },
};
export const palettes = { light, dark };
export function useColors() {
  return useColorScheme() === "dark" ? dark : light;
}
/**
 * Newsreader for titles and the week numeral, DM Sans for everything else. Each weight is its own family
 * (loaded in app/_layout.tsx), so styles name a family and never set fontWeight.
 */
export const fonts = {
  regular: "DMSans_400Regular", medium: "DMSans_500Medium", semibold: "DMSans_600SemiBold", bold: "DMSans_700Bold",
  display: "Newsreader_500Medium", displayItalic: "Newsreader_500Medium_Italic",
} as const;
export const typeScale = {
  largeTitle: { fontSize: 32, lineHeight: 38, fontFamily: fonts.display },
  title1: { fontSize: 28, lineHeight: 34, fontFamily: fonts.display },
  title2: { fontSize: 22, lineHeight: 28, fontFamily: fonts.display },
  title3: { fontSize: 24, lineHeight: 30, fontFamily: fonts.display },
  headline: { fontSize: 17, lineHeight: 23, fontFamily: fonts.semibold },
  body: { fontSize: 17, lineHeight: 24, fontFamily: fonts.regular },
  callout: { fontSize: 16, lineHeight: 21, fontFamily: fonts.regular },
  subhead: { fontSize: 15, lineHeight: 20, fontFamily: fonts.regular },
  footnote: { fontSize: 14, lineHeight: 19, fontFamily: fonts.regular },
  caption: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular },
  caption2: { fontSize: 11, lineHeight: 13, fontFamily: fonts.regular },
  number: { fontSize: 44, lineHeight: 50, fontFamily: fonts.semibold, fontVariant: ["tabular-nums"] },
} satisfies Record<string, TextStyle>;
/** One radius scale: pills for buttons and chips, 22–28 for surfaces. */
export const radii = { hero: 28, card: 24, grouped: 22, field: 16, notice: 20, thumb: 14, tile: 22, toast: 24, bubble: 22 } as const;
/** Strong ease-out for every UI transition; never ease-in. */
export const easeOut = Easing.bezier(0.23, 1, 0.32, 1);
const type = {
  title: typeScale.largeTitle, heading: typeScale.title3, body: typeScale.body,
  label: typeScale.headline, small: typeScale.footnote,
};
/** Tab roots supply their title and controls through a native stack. */
export const NativeHeaderContext = createContext(false);
/** Tab roots end at the top of the JS tab bar, so the home indicator inset is the bar's, not theirs. */
export const TabScreenContext = createContext(false);
const GroupedPageContext = createContext(false);
/** Inside a white (warm-dark at night) card or grouped section, fields take the page ground so they stay visible. */
const OnSurfaceContext = createContext(false);

/** Gentle confirmation on deliberate choices; skipped where the platform has no haptics. */
export function tap(kind: "select" | "success" = "select") {
  if (Platform.OS === "web") return;
  void (kind === "success"
    ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    : Haptics.selectionAsync()
  ).catch(() => undefined);
}
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
/** One press response for daily controls, with no movement under Reduce Motion. */
export const PressTarget = forwardRef<View, PressableProps>(function PressTarget(
  { style, disabled, onPressIn, onPressOut, onHoverIn, onHoverOut, ...props }, ref
) {
  const scale = useRef(new Animated.Value(1)).current,
    opacity = useRef(new Animated.Value(1)).current,
    [reduced, setReduced] = useState(true),
    [pressed, setPressed] = useState(false),
    [hovered, setHovered] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduced(value); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => { active = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    scale.stopAnimation(); opacity.stopAnimation();
    scale.setValue(1); opacity.setValue(disabled ? 0.5 : 1);
    if (disabled) setPressed(false);
  }, [reduced, disabled, scale, opacity]);
  function respond(down: boolean) {
    Animated.parallel([
      Animated.timing(scale, { toValue: down && !reduced ? 0.98 : 1,
        duration: down ? 120 : 180, easing: easeOut, useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(opacity, { toValue: disabled ? 0.5 : down ? 0.88 : 1,
        duration: down ? 120 : 180, easing: easeOut, useNativeDriver: Platform.OS !== "web" }),
    ]).start();
  }
  return <AnimatedPressable {...props} ref={ref} disabled={disabled}
    onPressIn={event => { if (!disabled) { setPressed(true); respond(true); } onPressIn?.(event); }}
    onPressOut={event => { setPressed(false); respond(false); onPressOut?.(event); }}
    onHoverIn={event => { setHovered(true); onHoverIn?.(event); }}
    onHoverOut={event => { setHovered(false); onHoverOut?.(event); }}
    style={[typeof style === "function" ? style({ pressed, hovered }) : style, { opacity, transform: [{ scale }] }]} />;
});

type CareGlyph = "baby-bottle-outline" | "human-baby-changing-table" | "mother-nurse";
/** Ionicons throughout, plus the baby-care glyphs Ionicons lacks (prefixed "care:"). */
export type IconName = React.ComponentProps<typeof Ionicons>["name"] | `care:${CareGlyph}`;
export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: ColorValue }) {
  const c = useColors();
  if (name.startsWith("care:"))
    return (
      <MaterialCommunityIcons
        name={name.slice(5) as CareGlyph}
        size={size + 2}
        color={color ?? c.action}
        accessible={false}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
    );
  return (
    <Ionicons
      name={name as React.ComponentProps<typeof Ionicons>["name"]}
      size={size}
      color={color ?? c.action}
      accessible={false}
      importantForAccessibility="no"
      accessibilityElementsHidden
    />
  );
}
export function Copy({
  children,
  kind = "body",
  tone,
  align,
  lines,
  numeric = false,
}: {
  children: React.ReactNode;
  kind?: "body" | "small" | "heading" | "title" | "label";
  tone?: "muted" | "error" | "accent";
  align?: "left" | "center";
  lines?: number;
  numeric?: boolean;
}) {
  const c = useColors(), { fontScale } = useWindowDimensions(),
    style = type[kind];
  return (
    <Text
      key={`${kind}:${fontScale}`}
      numberOfLines={lines}
      maxFontSizeMultiplier={0}
      accessibilityRole={kind === "title" || kind === "heading" ? "header" : undefined}
      style={{
        ...style,
        // Never undefined: when `numeric` turns off on a mounted Text, React Native diffs a removed
        // fontVariant to null and processFontVariant(null) throws a render error.
        fontVariant: numeric ? ["tabular-nums"] : [],
        flexShrink: 1,
        color: tone === "error" ? c.error : tone === "muted" ? c.muted : tone === "accent" ? c.accentText : c.text,
        textAlign: align,
      }}
    >
      {children}
    </Text>
  );
}
/** Fixed bar above scrolling content so Back and Close never scroll away. */
function TopBar({ back, close }: { back: boolean; close: boolean }) {
  const c = useColors(), { fontScale } = useWindowDimensions(),
    leave = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/(today)"));
  if (!back && !close) return null;
  return (
    <View
      style={{
        minHeight: 48,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: close ? "flex-end" : "flex-start",
        width: "100%",
        maxWidth: 720,
        alignSelf: "center",
      }}
    >
      <PressTarget
        accessibilityRole="button"
        accessibilityLabel={close ? "Close" : "Go back"}
        hitSlop={8}
        onPress={leave}
        style={({ pressed: on }) => ({
          minHeight: 44,
          minWidth: 44,
          paddingHorizontal: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 2,
          opacity: on ? 0.55 : 1,
        })}
      >
        {close ? (
          <Text key={fontScale} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, color: c.action }}>
            Close
          </Text>
        ) : (
          <>
            <Icon name="chevron-back" size={24} />
            <Text key={fontScale} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.regular, fontSize: 17, lineHeight: 22, color: c.action }}>
              Back
            </Text>
          </>
        )}
      </PressTarget>
    </View>
  );
}
/** Whether this screen is focused; screens outside a navigator (the root gates) always are. */
function useScreenFocused() {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true);
  useEffect(() => {
    if (!navigation) return;
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener("focus", () => setFocused(true));
    const offBlur = navigation.addListener("blur", () => setFocused(false));
    return () => { offFocus(); offBlur(); };
  }, [navigation]);
  return focused;
}

/**
 * Re-tapping the current tab returns its root list to the top, large title included, as native tabs did.
 * iOS rests a large-title list at a negative offset (the bar's inset), so scroll to where the first drag began.
 */
function ScrollToTopOnTabPress({ scroller, top }: { scroller: RefObject<ScrollView | null>; top: RefObject<number | null> }) {
  useScrollToTop(useRef({ scrollToTop: () => {
    const y = top.current ?? (Platform.OS === "ios" ? null : 0);
    // Never dragged on iOS means it's still at rest at the top.
    if (y !== null) scroller.current?.scrollTo({ y, animated: true });
  } }));
  return null;
}
export function Screen({
  children,
  title,
  subtitle,
  numericSubtitle = false,
  titleKind = "title",
  nativeHeader: nativeHeaderOverride,
  back = false,
  close = false,
  action,
  scroll = true,
  brand = false,
  footer,
  followEnd = false,
  onRefresh,
  scrollRef,
  onContentReady,
}: {
  scrollRef?: RefObject<ScrollView | null>;
  onContentReady?: () => void;
  children: React.ReactNode;
  title: string;
  titleKind?: "title" | "heading";
  /** Independent RN modals must keep their own title and top safe area. */
  nativeHeader?: boolean;
  /** Show the Håfa Baby mark above the title (welcome and first-run screens). */
  brand?: boolean;
  /** Docked below the scrolling content and above the keyboard, for example a message composer. */
  footer?: React.ReactNode;
  /** Keep the newest content in view as it grows (a conversation). */
  followEnd?: boolean;
  /** Pull to refresh. */
  onRefresh?: () => Promise<unknown> | void;
  subtitle?: string;
  numericSubtitle?: boolean;
  back?: boolean;
  /** For screens presented as a sheet: a Close button replaces Back. */
  close?: boolean;
  action?: React.ReactNode;
  scroll?: boolean;
}) {
  const inheritedNativeHeader = useContext(NativeHeaderContext),
    nativeHeader = nativeHeaderOverride ?? inheritedNativeHeader, safeArea = useSafeAreaInsets(),
    // An RN modal (nativeHeader={false}) covers the tab bar and reaches the home indicator again.
    inTabBar = useContext(TabScreenContext) && nativeHeader,
    insets = inTabBar ? { ...safeArea, bottom: 0 } : safeArea,
    { fontScale } = useWindowDimensions();
  const c = useColors(),
    localScroller = useRef<ScrollView>(null), scroller = scrollRef ?? localScroller, restingTop = useRef<number | null>(null),
    [footerHeight, setFooterHeight] = useState(0),
    [keyboardVisible, setKeyboardVisible] = useState(false),
    [refreshing, setRefreshing] = useState(false);
  const hasFooter = !!footer;
  const focused = useScreenFocused();
  // Toasts float above the docked footer while this screen shows it; above the keyboard it is out of their way.
  const dockedFooter = hasFooter && focused && !keyboardVisible ? footerHeight : 0;
  useEffect(() => {
    const owner = {};
    reportDockedFooter(owner, dockedFooter);
    return () => reportDockedFooter(owner, 0);
  }, [dockedFooter]);
  useEffect(() => {
    if (!hasFooter) return;
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, [hasFooter]);
  async function pull() {
    setRefreshing(true);
    try {
      await onRefresh?.();
    } finally {
      setRefreshing(false);
    }
  }
  const grouped = back || close;
  const content = (
    <View
      style={{
        paddingHorizontal: 16,
        paddingTop: back || close ? 2 : 14,
        paddingBottom: footer || nativeHeader ? 24 : Math.max(24, insets.bottom),
        gap: 26,
        width: "100%",
        maxWidth: 720,
        alignSelf: "center",
      }}
    >
      {brand && <BrandMark size={64} />}
      {(!nativeHeader || !!subtitle || (action && !grouped) || titleKind === "heading") && <View style={{ flexDirection: fontScale >= 1.5 ? "column" : "row", alignItems: fontScale >= 1.5 ? "stretch" : "flex-start", gap: 12 }}>
        <View style={{ flex: fontScale >= 1.5 ? undefined : 1, gap: 4 }}>
          {(!nativeHeader || titleKind === "heading") && <Copy kind={titleKind}>{title}</Copy>}
          {!!subtitle && <Copy numeric={numericSubtitle} tone="muted">{subtitle}</Copy>}
        </View>
        {(!nativeHeader || !grouped) && action}
      </View>}
      <GroupedPageContext.Provider value={grouped}>{children}</GroupedPageContext.Provider>
    </View>
  );
  return (
    <SafeAreaView collapsable={false} edges={nativeHeader ? ["left", "right"] : ["top", "left", "right"]} style={{ flex: 1, backgroundColor: grouped ? c.groupedBackground : c.background }}>
      {nativeHeader && <Stack.Screen options={{ title: titleKind === "heading" ? "Entry" : title, headerShown: true,
        headerLargeTitle: titleKind !== "heading",
        ...(grouped && action ? { headerRight: () => action } : {}),
        headerLeft: close || (back && !router.canGoBack())
          ? () => <HeaderAction title={close ? "Close" : "Back"}
            onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/(today)")} /> : undefined,
      }} />}
      <TopBar back={!nativeHeader && back && !close} close={!nativeHeader && close} />
      <KeyboardAvoidingView collapsable={false} behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View collapsable={false} style={{ flex: 1 }}>
        {scroll && inTabBar && <ScrollToTopOnTabPress scroller={scroller} top={restingTop} />}
        {scroll ? (
          <ScrollView
            style={{ flex: 1 }}
            ref={scroller}
            // The first drag from the content start marks the resting top (Ask may open scrolled to its newest
            // message); scrollTo may go past 0 to get back there.
            onScrollBeginDrag={inTabBar ? event => {
              const y = event.nativeEvent.contentOffset.y;
              if (restingTop.current === null && y <= 0) restingTop.current = y;
            } : undefined}
            scrollToOverflowEnabled={inTabBar}
            refreshControl={
              onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={() => void pull()} tintColor={c.muted} /> : undefined
            }
            onContentSizeChange={() => { if (followEnd) scroller.current?.scrollToEnd({ animated: true }); onContentReady?.(); }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentInsetAdjustmentBehavior="automatic"
            // On iOS the automatic content inset already covers the home indicator that the docked footer pads (tab roots have none).
            contentContainerStyle={{ flexGrow: 1, paddingBottom: footer ? Math.max(0, footerHeight - (keyboardVisible || Platform.OS !== "ios" ? 0 : insets.bottom)) : 0 }}
          >
            {content}
          </ScrollView>
        ) : (
          content
        )}
        {footer && (
          <View
            onLayout={event => setFooterHeight(event.nativeEvent.layout.height)}
            style={{
              position: "absolute", bottom: 0,
              backgroundColor: c.background,
              paddingHorizontal: 16,
              paddingTop: 10,
              paddingBottom: keyboardVisible ? 10 : Math.max(10, insets.bottom),
              width: "100%",
              maxWidth: 720,
              alignSelf: "center",
            }}
          >
            {footer}
          </View>
        )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function Card({
  children,
  tone = "normal",
  style,
}: {
  children: React.ReactNode;
  tone?: "normal" | "hero" | "soft";
  style?: ViewStyle;
}) {
  // A card inside another card or grouped section takes the page ground, so it never melts into its parent.
  const c = useColors(), nested = useContext(OnSurfaceContext);
  return (
    <View
      style={[
        {
          padding: 22,
          gap: 12,
          borderRadius: tone === "hero" ? radii.hero : radii.card,
          backgroundColor: tone === "hero" ? c.hero : tone === "soft" ? c.tile : nested ? c.background : c.surface,
        },
        style,
      ]}
    >
      <OnSurfaceContext.Provider value={tone === "normal"}>{children}</OnSurfaceContext.Provider>
    </View>
  );
}
export function Button({
  title,
  accessibilityLabel,
  onPress,
  busy = false,
  disabled = false,
  secondary = false,
  variant,
  icon,
  size,
  numeric = false,
}: {
  title: string;
  accessibilityLabel?: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  secondary?: boolean;
  /** ghost: text-only; destructive: text-only in the error colour for permanent actions. */
  variant?: "ghost" | "destructive";
  icon?: IconName;
  size?: "lg";
  numeric?: boolean;
}) {
  const c = useColors(), { fontScale } = useWindowDimensions(),
    plain = variant === "ghost" || variant === "destructive",
    quiet = secondary || plain,
    ink = variant === "destructive" ? c.error : plain ? c.action : quiet ? c.text : c.onAction;
  return (
    <PressTarget
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed: on }) => ({
        minHeight: size === "lg" ? 56 : 50,
        paddingHorizontal: 20,
        paddingVertical: 13,
        borderRadius: 999,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 9,
        backgroundColor: plain ? "transparent" : quiet ? c.soft : c.action,


      })}
    >
      {busy ? <ActivityIndicator color={ink} /> : icon && <Icon name={icon} size={19} color={ink} />}
      <Text
        key={fontScale}
        maxFontSizeMultiplier={0}
        style={{ fontFamily: fonts.semibold, fontVariant: numeric ? ["tabular-nums"] : [], fontSize: 17, lineHeight: 22, color: ink, textAlign: "center", flexShrink: 1 }}
      >
        {title}
      </Text>
    </PressTarget>
  );
}
/** A scalable text action for a screen header. */
const headerTextLimit = 1.6;
export function HeaderAction({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <PressTarget accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress}
    style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 8, justifyContent: "center", alignItems: "center" }}>
    {/* The bar stays one height, so the words stop growing before it would cut them off. */}
    <Text key={fontScale} numberOfLines={1} maxFontSizeMultiplier={headerTextLimit} style={{ ...typeScale.headline, color: c.action }}>{title}</Text>
  </PressTarget>;
}
let accessoryCount = 0;
/** Number pads have no return key on iOS; a Done bar keeps Save reachable. */
function KeyboardDone({ id }: { id: string }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  if (Platform.OS !== "ios") return null;
  return (
    <InputAccessoryView nativeID={id}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "flex-end",
          backgroundColor: c.surface,
          borderTopWidth: 1,
          borderColor: c.border,
          paddingHorizontal: 12,
        }}
      >
        <PressTarget
          accessibilityRole="button"
          accessibilityLabel="Done"
          onPress={() => Keyboard.dismiss()}
          style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: "center" }}
        >
          <Text key={fontScale} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, color: c.action }}>Done</Text>
        </PressTarget>
      </View>
    </InputAccessoryView>
  );
}
export function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  secret,
  purpose,
  numeric,
  disabled,
  inputRef,
  onSubmit,
  returnKeyType,
  maxLength,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  secret?: boolean;
  purpose?: InputPurpose;
  numeric?: boolean;
  disabled?: boolean;
  inputRef?: RefObject<TextInput | null>;
  onSubmit?: () => void;
  returnKeyType?: TextInputProps["returnKeyType"];
  maxLength?: number;
  autoFocus?: boolean;
}) {
  const c = useColors(), { fontScale } = useWindowDimensions(), onSurface = useContext(OnSurfaceContext),
    traits = inputTraits(purpose, Platform.OS, numeric),
    pad = traits.keyboardType === "number-pad" || traits.keyboardType === "decimal-pad" || traits.keyboardType === "numeric",
    [accessory] = useState(() => `field-done-${++accessoryCount}`);
  return (
    <View style={{ gap: 7 }}>
      <Copy kind="small">{label}</Copy>
      <TextInput
        key={fontScale}
        ref={inputRef}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        secureTextEntry={!!secret}
        editable={!disabled}
        multiline={multiline}
        autoFocus={autoFocus}
        autoCapitalize={purpose || secret ? "none" : "sentences"}
        {...traits}
        maxLength={maxLength ?? traits.maxLength ?? (multiline ? 30000 : 1000)}
        onSubmitEditing={onSubmit}
        returnKeyType={returnKeyType}
        inputAccessoryViewID={pad || multiline ? accessory : undefined}
        textAlignVertical={multiline ? "top" : "center"}
        maxFontSizeMultiplier={0}
        style={{
          backgroundColor: onSurface ? c.background : c.surface,
          ...(onSurface ? { borderWidth: 1, borderColor: c.border } : {}),
          color: c.text,
          borderRadius: radii.field,
          padding: 16,
          fontFamily: fonts.regular,
          fontVariant: numeric ? ["tabular-nums"] : [],
          fontSize: 17,
          lineHeight: 22,
          minHeight: multiline ? 150 : 52,
        }}
      />
      {(pad || multiline) && <KeyboardDone id={accessory} />}
    </View>
  );
}
export function Notice({ children, error }: { children: React.ReactNode; error?: boolean }) {
  const c = useColors();
  return (
    <View
      accessibilityRole={error ? "alert" : undefined}
      style={{ padding: 16, borderRadius: radii.notice, backgroundColor: error ? c.errorBg : c.tile }}
    >
      <Copy tone={error ? "error" : "muted"}>{children}</Copy>
    </View>
  );
}
export function Choice({
  label,
  detail,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <PressTarget
      accessibilityRole="checkbox"
      accessibilityLabel={[label, detail].filter(Boolean).join(". ")}
      accessibilityState={{ checked: selected, disabled }}
      onPress={() => {
        tap();
        onPress();
      }}
      disabled={disabled}
      style={({ pressed: on }) => ({
        paddingVertical: 13,
        minHeight: 50,
        flexDirection: "row",
        gap: 12,
        alignItems: "flex-start",
        opacity: on ? 0.6 : disabled ? 0.5 : 1,
      })}
    >
      <Icon name={selected ? "checkbox" : "square-outline"} color={selected ? c.action : c.muted} />
      <View style={{ flex: 1, gap: 3 }}>
        <Copy>{label}</Copy>
        {detail && (
          <Copy kind="small" tone="muted">
            {detail}
          </Copy>
        )}
      </View>
    </PressTarget>
  );
}
export function Chips({
  options,
  value,
  onChange,
  label,
  scroll = false,
}: {
  options: { label: string; value: string; dot?: ColorValue }[];
  value: string;
  onChange: (v: string) => void;
  /** Read before each option by VoiceOver, for example "Feeding method". */
  label?: string;
  /** Single-row filters scroll; form choices keep their wrapping layout. */
  scroll?: boolean;
}) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  const choices = (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: scroll ? "nowrap" : "wrap", gap: 8 }}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <PressTarget
            key={o.value}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: on, checked: on }}
            onPress={() => {
              if (!on) tap();
              onChange(o.value);
            }}
            style={({ pressed: down }) => ({
              minHeight: 44,
              flexShrink: scroll ? 0 : 1,
              maxWidth: scroll ? undefined : "100%",
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: 999,
              flexDirection: "row",
              gap: 7,
              justifyContent: "center",
              alignItems: "center",
              backgroundColor: on ? c.action : c.soft,

            })}
          >
            {!!o.dot && <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: o.dot }} />}
            <Text
              key={fontScale}
              maxFontSizeMultiplier={0}
              style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, textAlign: "center", flexShrink: 1, color: on ? c.onAction : c.text }}
            >
              {o.label}
            </Text>
          </PressTarget>
        );
      })}
    </View>
  );
  return scroll ? <ScrollView horizontal showsHorizontalScrollIndicator={false}
    contentContainerStyle={{ paddingBottom: 2 }} keyboardShouldPersistTaps="handled">{choices}</ScrollView> : choices;
}
export interface FilterChip { label: string; value: string; icon?: IconName }
/**
 * The sub-navigation chip row at the top of a list: 34pt pills that scroll edge to edge and fade
 * at the trailing edge instead of clipping a word. Selected is filled cocoa; the rest are sand.
 */
export function FilterChips({ options, value, onChange, label }: { options: FilterChip[]; value: string; onChange: (value: string) => void; label: string }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), scroller = useRef<ScrollView>(null),
    frames = useRef<Record<string, { x: number; width: number }>>({}), view = useRef({ x: 0, width: 0 });
  // Bring a chip chosen elsewhere (Today's "See all", a category row) into view; leave visible ones still.
  useEffect(() => {
    const frame = frames.current[value], { x, width } = view.current;
    if (!frame || !width) return;
    // Chip x is inside the 16pt content padding; keep 48pt of context on the side it comes from.
    const left = frame.x + 16, right = left + frame.width;
    if (left < x) scroller.current?.scrollTo({ x: Math.max(0, left - 48), animated: true });
    else if (right > x + width - 32) scroller.current?.scrollTo({ x: right - width + 48, animated: true });
  }, [value]);
  return <View style={{ marginHorizontal: -16 }}>
    <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
      onLayout={(event) => { view.current.width = event.nativeEvent.layout.width; }} scrollEventThrottle={64}
      onScroll={(event) => { view.current.x = event.nativeEvent.contentOffset.x; }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingRight: 40 }}>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {options.map((option) => {
          const on = value === option.value, ink = on ? c.onAction : c.text;
          return <PressTarget key={option.value} accessibilityRole="radio" accessibilityLabel={option.label}
            accessibilityState={{ selected: on, checked: on }}
            onLayout={(event) => { const { x, width } = event.nativeEvent.layout; frames.current[option.value] = { x, width }; }}
            onPress={() => { if (!on) tap(); onChange(option.value); }}
            // A 44×44 minimum target around the 34pt pill, so even a one-word chip is easy to hit.
            style={{ minWidth: 44, minHeight: 44, justifyContent: "center" }}>
            <View style={{ minHeight: 34, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 17, flexDirection: "row", alignItems: "center", gap: 6,
              backgroundColor: on ? c.action : c.surface }}>
              {option.icon && <Icon name={option.icon} size={16} color={ink} />}
              <Text key={fontScale} maxFontSizeMultiplier={0}
                style={{ ...typeScale.subhead, fontFamily: on ? fonts.semibold : fonts.medium, color: ink }}>{option.label}</Text>
            </View>
          </PressTarget>;
        })}
      </View>
    </ScrollView>
    <EdgeFade color={c.background} />
  </View>;
}
/** 2pt bands easing from clear to the page colour: a soft trailing fade without a gradient module. */
const fadeBands = Array.from({ length: 20 }, (_, index) => Math.min(1, ((index + 1) / 16) ** 1.6));
function EdgeFade({ color }: { color: string }) {
  return <View pointerEvents="none" style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 40, flexDirection: "row" }}>
    {fadeBands.map((opacity, index) => <View key={index} style={{ flex: 1, backgroundColor: color, opacity }} />)}
  </View>;
}
export function Empty({
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8, paddingVertical: 24 }}>
      <Copy kind="heading">{title}</Copy>
      <Copy tone="muted">{body}</Copy>
      {action}
    </View>
  );
}
export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const c = useColors(), grouped = useContext(GroupedPageContext);
  return (
    <View style={{ gap: 12, ...(grouped ? { padding: 16, borderRadius: radii.grouped, backgroundColor: c.surface } : {}) }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <Copy kind="heading">{title}</Copy>
        </View>
        {action}
      </View>
      <OnSurfaceContext.Provider value={grouped}>{children}</OnSurfaceContext.Provider>
    </View>
  );
}
/** Inset grouped cells share one quiet surface and text-inset separators. */
export function Grouped({ children, separatorInset = 72 }: PropsWithChildren<{ separatorInset?: number }>) {
  const c = useColors(), rows = Children.toArray(children);
  return <View style={{ borderRadius: radii.grouped, overflow: "hidden", backgroundColor: c.surface }}>
    {rows.map((row, index) => <View key={index}>
      {index > 0 && <View style={{ marginLeft: separatorInset, height: 0.5, backgroundColor: c.border }} />}
      {row}
    </View>)}
  </View>;
}
export function Row({
  title,
  detail,
  icon,
  onPress,
  trailing,
  hint,
  numericTitle = false,
  numericDetail = false,
  leading,
}: {
  title: string;
  detail?: string;
  icon?: IconName;
  /** Replaces the icon tile, for example a journal entry's date block. */
  leading?: React.ReactNode;
  onPress: () => void;
  trailing?: React.ReactNode;
  hint?: string;
  numericTitle?: boolean;
  numericDetail?: boolean;
}) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  const firstLineHeight = typeScale.headline.lineHeight * fontScale;
  const firstLineTop = icon || leading ? Math.max(0, (44 - firstLineHeight) / 2) : 0;
  return (
    <PressTarget
      accessibilityRole="button"
      accessibilityLabel={[title, detail].filter(Boolean).join(". ")}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed: on }) => ({
        minHeight: 68,
        backgroundColor: c.surface,

        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: radii.grouped,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "flex-start",
        gap: 12,

      })}
    >
      {/* A blush tile around the glyph, the same family as the monogram tiles on saved posts. */}
      {leading ? <View style={{ marginTop: Math.max(0, (firstLineHeight - 44) / 2) }}>{leading}</View>
        : icon && <View style={{ width: 44, minHeight: 44, marginTop: Math.max(0, (firstLineHeight - 44) / 2), alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: c.placeholder, alignItems: "center", justifyContent: "center" }}>
          <Icon name={icon} size={20} color={c.placeholderInk} />
        </View>
      </View>}
      <View style={{ flex: 1, minWidth: 0, gap: 2, paddingTop: firstLineTop }}>
        <Copy numeric={numericTitle} kind="label" lines={fontScale >= 1.3 ? undefined : 2}>{title}</Copy>
        {detail && (
          <Copy numeric={numericDetail} kind="small" tone="muted" lines={fontScale >= 1.3 ? undefined : 2}>
            {detail}
          </Copy>
        )}
      </View>
      <View style={{ paddingTop: firstLineTop + Math.max(0, (firstLineHeight - 17) / 2) }}>
        {trailing ?? <Icon name="chevron-forward" size={17} color={c.muted} />}
      </View>
    </PressTarget>
  );
}
export interface ToastAction {
  label: string;
  onPress: () => void | Promise<void>;
}
type ShowToast = (value: string, action?: ToastAction) => void;
const ToastContext = createContext<ShowToast>(() => undefined);
export function useToast() {
  return useContext(ToastContext);
}
export function ToastProvider({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets(), { fontScale } = useWindowDimensions();
  const inTabs = isTabRoute(useSegments());
  const tabInset = useTabBarHeight();
  const footer = useDockedFooterHeight();
  // Above the tab bar in tabs (Undo after a quick log) and any docked footer such as the Ask composer.
  const bottom = overlayBottom({ inTabs, tabInset, windowInset: insets.bottom, clearance: 88, footer });
  const [toast, setToast] = useState<{ message: string; action?: ToastAction; key: number } | null>(null),
    c = useColors(),
    enter = useRef(new Animated.Value(0)).current,
    [still, setStill] = useState(false),
    show = useRef<ShowToast>((message, action) => setToast(message ? { message, action, key: Date.now() } : null));
  useEffect(() => {
    if (!toast) return;
    // Rise 8pt and fade in quickly; with Reduce Motion only the fade remains. VoiceOver hears the
    // message, and an Undo stays much longer so it can be reached by swiping.
    let timer: ReturnType<typeof setTimeout> | undefined,
      active = true;
    enter.setValue(0);
    void Promise.all([AccessibilityInfo.isReduceMotionEnabled(), AccessibilityInfo.isScreenReaderEnabled()]).then(
      ([reduce, reader]) => {
        if (!active) return;
        setStill(reduce);
        if (reader) AccessibilityInfo.announceForAccessibility(toast.action ? `${toast.message}. ${toast.action.label} available.` : toast.message);
        Animated.timing(enter, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        timer = setTimeout(
          () =>
            Animated.timing(enter, { toValue: 0, duration: 150, easing: easeOut, useNativeDriver: true }).start(
              () => setToast((current) => (current?.key === toast.key ? null : current))
            ),
          // Leave time to reach Undo; plain confirmations clear sooner.
          toast.action ? (reader ? 20000 : 6500) : 4500
        );
      }
    );
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [toast]);
  return (
    <ToastContext.Provider value={show.current}>
      {children}
      {!!toast && (
        <Animated.View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{
            position: "absolute",
            bottom,
            left: 22,
            right: 22,
            backgroundColor: c.text,
            paddingVertical: 8,
            paddingLeft: 17,
            paddingRight: 8,
            borderRadius: radii.toast,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            minHeight: 56,
            opacity: enter,
            transform: still ? [] : [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
            shadowColor: "#000",
            shadowOpacity: 0.16,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 6 },
            elevation: 6,
          }}
        >
          <PressTarget style={{ flex: 1, paddingVertical: 9 }} onPress={() => setToast(null)}>
            <Text key={fontScale} maxFontSizeMultiplier={2} style={{ color: c.background, fontFamily: fonts.regular, fontSize: 15, lineHeight: 20 }}>
              {toast.message}
            </Text>
          </PressTarget>
          {toast.action && (
            <PressTarget
              accessibilityRole="button"
              accessibilityLabel={toast.action.label}
              onPress={() => {
                const action = toast.action!;
                setToast(null);
                void action.onPress();
              }}
              style={({ pressed: on }) => ({
                minHeight: 44,
                minWidth: 64,
                paddingHorizontal: 14,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                opacity: on ? 0.6 : 1,
              })}
            >
              <Text key={fontScale} maxFontSizeMultiplier={2} style={{ color: c.background, fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 }}>
                {toast.action.label}
              </Text>
            </PressTarget>
          )}
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}
export function Loading({ label = "Opening your private space…" }: { label?: string }) {
  const c = useColors();
  return (
    <View style={{ padding: 30, gap: 20 }}>
      <ActivityIndicator accessibilityLabel={label} color={c.muted} />
      <Copy align="center" tone="muted">
        {label}
      </Copy>
    </View>
  );
}
