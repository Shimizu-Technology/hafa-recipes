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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { inputTraits, type InputPurpose } from "@/lib/input-purpose";
import { BrandMark } from "./brand-mark";

/** Baby's warm light palette and neutral, true-black dark palette. */
const light = {
  background: "#FFFFFF", groupedBackground: "#F2F2F7", surface: "#FAF7F4",
  soft: "#F1E8E1", tile: "#F6EFE9", hero: "#F6EFE9",
  text: "#2D2420", muted: "#6E625B", action: "#5A4740", onAction: "#F8F3EE",
  border: "rgba(60,60,67,0.29)", outline: "rgba(60,60,67,0.29)",
  accent: "#C9907E", accentText: "#8C5443", error: "#B3261E", errorBg: "#FBE3DE",
  scrim: "rgba(45,36,32,0.42)",
};
const dark: typeof light = {
  background: "#000000", groupedBackground: "#000000", surface: "#1C1C1E",
  soft: "#2C2522", tile: "#2A2320", hero: "#2A2320",
  text: "#FFFFFF", muted: "rgba(235,235,245,0.60)", action: "#E3C9B8", onAction: "#2D2420",
  border: "rgba(84,84,88,0.65)", outline: "rgba(84,84,88,0.65)",
  accent: "#E3C9B8", accentText: "#E3C9B8", error: "#FF5148", errorBg: "#3A1F1C",
  scrim: "rgba(0,0,0,0.6)",
};
export function useColors() {
  return useColorScheme() === "dark" ? dark : light;
}
export const fonts = { regular: "System", rounded: Platform.OS === "ios" ? "ui-rounded" : "System" } as const;
export const typeScale = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "700" },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: "700" },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: "600" },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 17, lineHeight: 22 },
  callout: { fontSize: 16, lineHeight: 21 },
  subhead: { fontSize: 15, lineHeight: 20 },
  footnote: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 16 },
  caption2: { fontSize: 11, lineHeight: 13 },
  number: { fontSize: 44, lineHeight: 50, fontWeight: "700", fontFamily: fonts.rounded, fontVariant: ["tabular-nums"] },
} satisfies Record<string, TextStyle>;
const type = {
  title: typeScale.largeTitle, heading: typeScale.title3, body: typeScale.body,
  label: typeScale.headline, small: typeScale.footnote,
};
/** Tab roots supply their title and controls through a native stack. */
export const NativeHeaderContext = createContext(false);

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
        fontFamily: numeric ? fonts.rounded : fonts.regular,
        fontVariant: numeric ? ["tabular-nums"] : undefined,
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
          <Text maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.regular, fontWeight: "600", fontSize: 17, lineHeight: 22, color: c.action }}>
            Close
          </Text>
        ) : (
          <>
            <Icon name="chevron-back" size={24} />
            <Text maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.regular, fontSize: 17, lineHeight: 22, color: c.action }}>
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
}: {
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
    nativeHeader = nativeHeaderOverride ?? inheritedNativeHeader, insets = useSafeAreaInsets(),
    { fontScale } = useWindowDimensions();
  const c = useColors(),
    scroller = useRef<ScrollView>(null),
    [footerHeight, setFooterHeight] = useState(0),
    [keyboardVisible, setKeyboardVisible] = useState(false),
    [refreshing, setRefreshing] = useState(false);
  const hasFooter = !!footer;
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
  const content = (
    <View
      style={{
        paddingHorizontal: 16,
        paddingTop: back || close ? 2 : 14,
        paddingBottom: footer || nativeHeader ? 24 : Math.max(24, insets.bottom),
        gap: 20,
        width: "100%",
        maxWidth: 720,
        alignSelf: "center",
      }}
    >
      {brand && <BrandMark size={64} />}
      <View style={{ flexDirection: fontScale >= 1.5 ? "column" : "row", alignItems: fontScale >= 1.5 ? "stretch" : "flex-start", gap: 12 }}>
        <View style={{ flex: fontScale >= 1.5 ? undefined : 1, gap: 4 }}>
          {!nativeHeader && <Copy kind={titleKind}>{title}</Copy>}
          {!!subtitle && <Copy numeric={numericSubtitle} tone="muted">{subtitle}</Copy>}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
  return (
    <SafeAreaView collapsable={false} edges={nativeHeader ? ["left", "right"] : ["top", "left", "right"]} style={{ flex: 1, backgroundColor: c.background }}>
      <TopBar back={back && !close} close={close} />
      <KeyboardAvoidingView collapsable={false} behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View collapsable={false} style={{ flex: 1 }}>
        {scroll ? (
          <ScrollView
            style={{ flex: 1 }}
            ref={scroller}
            refreshControl={
              onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={() => void pull()} tintColor={c.muted} /> : undefined
            }
            onContentSizeChange={followEnd ? () => scroller.current?.scrollToEnd({ animated: true }) : undefined}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{ flexGrow: 1, paddingBottom: footer ? footerHeight : 0 }}
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
  const c = useColors();
  return (
    <View
      style={[
        {
          padding: 20,
          gap: 12,
          borderRadius: tone === "hero" ? 20 : 14,
          backgroundColor: tone === "hero" ? c.hero : tone === "soft" ? c.tile : c.surface,

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
  numeric = false,
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
  numeric?: boolean;
}) {
  const c = useColors(), { fontScale } = useWindowDimensions(),
    plain = variant === "ghost" || variant === "destructive",
    quiet = secondary || plain,
    ink = variant === "destructive" ? c.error : plain ? c.action : quiet ? c.text : c.onAction;
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
        style={{ fontFamily: numeric ? fonts.rounded : fonts.regular, fontVariant: numeric ? ["tabular-nums"] : undefined, fontWeight: "600", fontSize: 17, lineHeight: 22, color: ink, textAlign: "center", flexShrink: 1 }}
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
          <Text style={{ fontFamily: fonts.regular, fontWeight: "600", fontSize: 17, lineHeight: 22, color: c.action }}>Done</Text>
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
  const c = useColors(), { fontScale } = useWindowDimensions(),
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
          backgroundColor: c.surface,
          color: c.text,
          borderRadius: 10,
          padding: 16,
          fontFamily: numeric ? fonts.rounded : fonts.regular,
          fontVariant: numeric ? ["tabular-nums"] : undefined,
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
  scroll = false,
}: {
  options: { label: string; value: string }[];
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
              justifyContent: "center",
              alignItems: "center",
              backgroundColor: on ? c.tile : c.soft,

            })}
          >
            <Text
              key={fontScale}
              maxFontSizeMultiplier={0}
              style={{ fontFamily: fonts.regular, fontWeight: "600", fontSize: 15, lineHeight: 20, textAlign: "center", flexShrink: 1, color: on ? c.text : c.action }}
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
  numericTitle = false,
  numericDetail = false,
}: {
  title: string;
  detail?: string;
  icon?: IconName;
  onPress: () => void;
  trailing?: React.ReactNode;
  hint?: string;
  numericTitle?: boolean;
  numericDetail?: boolean;
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

        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 12,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 13,

      })}
    >
      {icon && <Icon name={icon} />}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Copy numeric={numericTitle} kind="label">{title}</Copy>
        {detail && (
          <Copy numeric={numericDetail} kind="small" tone="muted">
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
  const insets = useSafeAreaInsets();
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
            bottom: insets.bottom + 88,
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
            <Text maxFontSizeMultiplier={0} style={{ color: c.background, fontFamily: fonts.regular, fontSize: 15, lineHeight: 20 }}>
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
              <Text maxFontSizeMultiplier={0} style={{ color: c.background, fontFamily: fonts.regular, fontWeight: "700", fontSize: 15, lineHeight: 20 }}>
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
