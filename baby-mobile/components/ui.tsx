import { forwardRef, createContext, useContext, useEffect, useRef, useState, type PropsWithChildren, type RefObject } from "react";
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
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { inputTraits, type InputPurpose } from "@/lib/input-purpose";
import { BrandMark } from "./brand-mark";

/**
 * Håfa Baby tokens: "Sand & Cocoa", a warm neutral palette Kami chose. Sand and nude grounds,
 * cocoa ink and actions, and a soft clay accent used for the baby summary's icons. DM Sans and
 * the latte-stone mark keep Baby recognisably part of the Håfa family.
 */
const light = {
  background: "#F8F3EE",
  surface: "#FFFCF9",
  /** Quiet filled panels (for example the sign-in hint and Google button). */
  soft: "#EDE3DA",
  /** Quick-log tiles and grouped panels: a tone step from the ground. */
  tile: "#EFE6DD",
  /** The baby summary. */
  hero: "#F1E3DA",
  text: "#2D2420",
  muted: "#6A5A51",
  action: "#5A4740",
  onAction: "#F8F3EE",
  border: "#E6D8CC",
  /** Outline of secondary buttons, so they stay visible on sand cards. */
  outline: "#D6C3B4",
  /** Decorative clay (the mark's moon); never used for text. */
  accent: "#C9907E",
  /** Clay for icons and short text (≥4.5:1 on the summary and the ground). */
  accentText: "#8C5443",
  error: "#B3261E",
  errorBg: "#FBE3DE",
  scrim: "rgba(45, 36, 32, 0.42)",
};
const dark: typeof light = {
  background: "#14110F",
  surface: "#1E1A17",
  soft: "#2E2621",
  tile: "#231E1A",
  hero: "#33251F",
  text: "#F5EDE6",
  muted: "#BBAEA4",
  action: "#E7D5C8",
  onAction: "#2D2420",
  border: "#382F29",
  outline: "#4A3E36",
  accent: "#E7B7A5",
  accentText: "#E7B7A5",
  error: "#F07167",
  errorBg: "#3A1F1C",
  scrim: "rgba(0, 0, 0, 0.6)",
};
export function useColors() {
  return useColorScheme() === "dark" ? dark : light;
}

/** DM Sans, shared with Recipes and Workouts; loaded in app/_layout.tsx. */
export const fonts = { regular: "DMSans_400Regular", semibold: "DMSans_600SemiBold", bold: "DMSans_700Bold" } as const;
const type = {
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8, maxFontSizeMultiplier: 1.4 },
  heading: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, letterSpacing: -0.3, maxFontSizeMultiplier: 1.6 },
  body: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 25, letterSpacing: 0, maxFontSizeMultiplier: 2 },
  label: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, letterSpacing: 0, maxFontSizeMultiplier: 1.8 },
  small: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, letterSpacing: 0, maxFontSizeMultiplier: 1.8 },
} satisfies Record<string, TextStyle & { maxFontSizeMultiplier: number }>;

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
      Animated.timing(scale, { toValue: down && !reduced ? 0.97 : 1,
        duration: down ? 120 : 160, easing: Easing.bezier(0.23, 1, 0.32, 1), useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(opacity, { toValue: disabled ? 0.5 : down ? 0.82 : 1,
        duration: down ? 120 : 160, easing: Easing.bezier(0.23, 1, 0.32, 1), useNativeDriver: Platform.OS !== "web" }),
    ]).start();
  }
  return <AnimatedPressable {...props} ref={ref} disabled={disabled}
    onPressIn={event => { if (!disabled) { setPressed(true); respond(true); } onPressIn?.(event); }}
    onPressOut={event => { setPressed(false); respond(false); onPressOut?.(event); }}
    onHoverIn={event => { setHovered(true); onHoverIn?.(event); }}
    onHoverOut={event => { setHovered(false); onHoverOut?.(event); }}
    style={[typeof style === "function" ? style({ pressed, hovered }) : style, { opacity, transform: [{ scale }] }]} />;
});

type CareGlyph = "baby-bottle-outline" | "human-baby-changing-table";
/** Ionicons throughout, plus two baby-care glyphs Ionicons lacks (prefixed "care:"). */
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
}: {
  children: React.ReactNode;
  kind?: "body" | "small" | "heading" | "title" | "label";
  tone?: "muted" | "error" | "accent";
  align?: "left" | "center";
  lines?: number;
}) {
  const c = useColors(),
    { fontScale } = useWindowDimensions(),
    { maxFontSizeMultiplier: _, lineHeight, ...style } = type[kind];
  return (
    <Text
      key={`${kind}:${fontScale}`}
      numberOfLines={lines}
      maxFontSizeMultiplier={0}
      accessibilityRole={kind === "title" || kind === "heading" ? "header" : undefined}
      style={{
        ...style,
        lineHeight: fontScale >= 1.3 ? undefined : lineHeight,
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
  const c = useColors(),
    leave = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)"));
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
          <Text maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.semibold, fontSize: 17, color: c.action }}>
            Close
          </Text>
        ) : (
          <>
            <Icon name="chevron-back" size={24} />
            <Text maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.regular, fontSize: 17, color: c.action }}>
              Back
            </Text>
          </>
        )}
      </PressTarget>
    </View>
  );
}
export function Screen({
  children,
  title,
  subtitle,
  back = false,
  close = false,
  action,
  scroll = true,
  brand = false,
  footer,
  followEnd = false,
  onRefresh,
}: {
  children: React.ReactNode;
  title: string;
  /** Show the Håfa Baby mark above the title (welcome and first-run screens). */
  brand?: boolean;
  /** Docked below the scrolling content and above the keyboard, for example a message composer. */
  footer?: React.ReactNode;
  /** Keep the newest content in view as it grows (a conversation). */
  followEnd?: boolean;
  /** Pull to refresh. */
  onRefresh?: () => Promise<unknown> | void;
  subtitle?: string;
  back?: boolean;
  /** For screens presented as a sheet: a Close button replaces Back. */
  close?: boolean;
  action?: React.ReactNode;
  scroll?: boolean;
}) {
  const c = useColors(),
    scroller = useRef<ScrollView>(null),
    [refreshing, setRefreshing] = useState(false);
  async function pull() {
    setRefreshing(true);
    try {
      await onRefresh?.();
    } finally {
      setRefreshing(false);
    }
  }
  const content = (
    <View
      style={{
        paddingHorizontal: 22,
        paddingTop: back || close ? 2 : 14,
        paddingBottom: footer ? 24 : 110,
        gap: 20,
        width: "100%",
        maxWidth: 720,
        alignSelf: "center",
      }}
    >
      {brand && <BrandMark size={64} />}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Copy kind="title">{title}</Copy>
          {subtitle && <Copy tone="muted">{subtitle}</Copy>}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: c.background }}>
      <TopBar back={back && !close} close={close} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        {scroll ? (
          <ScrollView
            ref={scroller}
            refreshControl={
              onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={() => void pull()} tintColor={c.muted} /> : undefined
            }
            onContentSizeChange={followEnd ? () => scroller.current?.scrollToEnd({ animated: true }) : undefined}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{ flexGrow: 1 }}
          >
            {content}
          </ScrollView>
        ) : (
          content
        )}
        {footer && (
          <View
            style={{
              borderTopWidth: 1,
              borderColor: c.border,
              backgroundColor: c.background,
              paddingHorizontal: 16,
              paddingVertical: 10,
              width: "100%",
              maxWidth: 720,
              alignSelf: "center",
            }}
          >
            {footer}
          </View>
        )}
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
  const c = useColors();
  return (
    <View
      style={[
        {
          padding: 20,
          gap: 12,
          borderRadius: 24,
          backgroundColor: tone === "hero" ? c.hero : tone === "soft" ? c.tile : c.surface,
          borderWidth: tone === "normal" ? 1 : 0,
          borderColor: c.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
export function Button({
  title,
  onPress,
  busy = false,
  disabled = false,
  secondary = false,
  variant,
  icon,
  size,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  secondary?: boolean;
  /** ghost: text-only; destructive: text-only in the error colour for permanent actions. */
  variant?: "ghost" | "destructive";
  icon?: IconName;
  size?: "lg";
}) {
  const c = useColors(),
    plain = variant === "ghost" || variant === "destructive",
    quiet = secondary || plain,
    ink = variant === "destructive" ? c.error : quiet ? c.action : c.onAction;
  return (
    <PressTarget
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed: on }) => ({
        minHeight: size === "lg" ? 56 : 50,
        paddingHorizontal: 20,
        paddingVertical: 13,
        borderRadius: 26,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 9,
        backgroundColor: plain ? "transparent" : quiet ? c.surface : c.action,
        borderWidth: quiet && !plain ? 1.5 : 0,
        borderColor: c.outline,

      })}
    >
      {busy ? <ActivityIndicator color={ink} /> : icon && <Icon name={icon} size={19} color={ink} />}
      <Text
        maxFontSizeMultiplier={0}
        style={{ fontFamily: fonts.semibold, fontSize: 16, color: ink, textAlign: "center", flexShrink: 1 }}
      >
        {title}
      </Text>
    </PressTarget>
  );
}
let accessoryCount = 0;
/** Number pads have no return key on iOS; a Done bar keeps Save reachable. */
function KeyboardDone({ id }: { id: string }) {
  const c = useColors();
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
          <Text style={{ fontFamily: fonts.semibold, fontSize: 17, color: c.action }}>Done</Text>
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
  const c = useColors(),
    traits = inputTraits(purpose, Platform.OS, numeric),
    pad = traits.keyboardType === "number-pad" || traits.keyboardType === "decimal-pad" || traits.keyboardType === "numeric",
    [accessory] = useState(() => `field-done-${++accessoryCount}`);
  return (
    <View style={{ gap: 7 }}>
      <Copy kind="small">{label}</Copy>
      <TextInput
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
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface,
          color: c.text,
          borderRadius: 16,
          padding: 15,
          fontFamily: fonts.regular,
          fontSize: 17,
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
      style={{ padding: 15, borderRadius: 16, backgroundColor: error ? c.errorBg : c.tile }}
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
        alignItems: "center",
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
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
  /** Read before each option by VoiceOver, for example "Feeding method". */
  label?: string;
}) {
  const c = useColors();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
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
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: 23,
              justifyContent: "center",
              maxWidth: "100%",
              flexShrink: 1,
              // Unselected chips are outlined like secondary buttons so they read on sand cards too.
              backgroundColor: on ? c.tile : c.surface,
              borderWidth: 1.5,
              borderColor: on ? c.tile : c.outline,

            })}
          >
            <Text
              maxFontSizeMultiplier={0}
              style={{ fontFamily: fonts.semibold, fontSize: 15, flexShrink: 1, color: on ? c.text : c.action }}
            >
              {o.label}
            </Text>
          </PressTarget>
        );
      })}
    </View>
  );
}
export function Empty({
  icon = "leaf-outline",
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
    <Card tone="soft">
      <Icon name={icon} size={30} />
      <Copy kind="heading">{title}</Copy>
      <Copy tone="muted">{body}</Copy>
      {action}
    </Card>
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
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <Copy kind="heading">{title}</Copy>
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}
export function Row({
  title,
  detail,
  icon,
  onPress,
  trailing,
  hint,
}: {
  title: string;
  detail?: string;
  icon?: IconName;
  onPress: () => void;
  trailing?: React.ReactNode;
  hint?: string;
}) {
  const c = useColors();
  return (
    <PressTarget
      accessibilityRole="button"
      accessibilityLabel={[title, detail].filter(Boolean).join(". ")}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed: on }) => ({
        minHeight: 68,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 19,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 13,

      })}
    >
      {icon && <Icon name={icon} />}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Copy kind="label">{title}</Copy>
        {detail && (
          <Copy kind="small" tone="muted">
            {detail}
          </Copy>
        )}
      </View>
      {trailing ?? <Icon name="chevron-forward" size={17} color={c.muted} />}
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
            Animated.timing(enter, { toValue: 0, duration: 150, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(
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
            bottom: 105,
            left: 22,
            right: 22,
            backgroundColor: c.text,
            paddingVertical: 8,
            paddingLeft: 17,
            paddingRight: 8,
            borderRadius: 18,
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
            <Text maxFontSizeMultiplier={0} style={{ color: c.background, fontFamily: fonts.regular, fontSize: 15 }}>
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
              <Text maxFontSizeMultiplier={0} style={{ color: c.background, fontFamily: fonts.bold, fontSize: 15 }}>
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
  return (
    <View style={{ padding: 30, gap: 20 }}>
      <ActivityIndicator accessibilityLabel={label} />
      <Copy align="center" tone="muted">
        {label}
      </Copy>
    </View>
  );
}
