import { Children, createContext, isValidElement, useContext, useState, type PropsWithChildren, type ReactElement, type Ref } from "react";
import { Text, ActivityIndicator, InputAccessoryView, Keyboard, Platform, Pressable, ScrollView, TextInput, useWindowDimensions, View, type TextInputProps } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { Image } from "expo-image";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useAccountIdentity } from "../account-identity";
import { inputTraits, type InputPurpose } from "@/lib/input-purpose";
import { radii, touch, typography, fonts, type ColorTokens } from "@/constants/theme";
import { segmentLabelScale } from "@/lib/segment-scale";
import { Copy, haptics, useGroupedPage, useColors, useSurface, type Surface } from "./foundation";
import { animatedPressableComponent, usePressScale } from "./press";

export type IconName = keyof typeof Ionicons.glyphMap;
export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "accent";
/** Compact controls (chips, segmented control) share one height; the 44pt touch target comes from hitSlop. */
export const compactControl = 36;

function buttonColors(c: ColorTokens, variant: ButtonVariant, surface: Surface): { bg: string; fg: string; border?: string } {
  switch (variant) {
    case "primary":
      return { bg: c.action, fg: c.onAction };
    case "secondary":
      // Neutral, like Recipes: supporting actions shouldn't compete with the one primary.
      return { bg: c.sunken, fg: c.text };
    case "ghost":
      return { bg: "transparent", fg: c.onActionSoft };
    case "destructive":
      return { bg: c.errorSoft, fg: c.error };
    case "accent":
      return { bg: c.accent, fg: c.onAccent };
  }
}
/** Every button is one height, so pairs and stacks never disagree. Only a text button (ghost + inline) is lighter. */
const BUTTON_HEIGHT = touch.comfortable;
const BUTTON_PADDING = 12;
const BUTTON_ICON = 20;
const BUTTON_GAP = 8;
/** Set by ButtonRow: children fill their equal share of the row instead of sizing to content. */
const ButtonRowContext = createContext(false);

/**
 * One clear action. `primary` is the screen's main action (use once per view);
 * `secondary` for supporting actions; `ghost` for low-emphasis actions; `destructive` for removals.
 *
 * Buttons share one height (50pt), radius and type, with an optional leading icon. A button fills the width it
 * is given. Put two or three side by side in a `ButtonRow`. `inline` makes a text button (ghost only) that
 * sizes to its label, for a quiet action beside text. Keep the label short enough for one line and put detail
 * in a caption below.
 */
export function Button({
  title,
  onPress,
  variant,
  secondary = false,
  disabled = false,
  busy = false,
  icon,
  inline = false,
  haptic,
  accessibilityHint,
  accessibilityLabel,
  disabledReason,
  textLink = false,
  maxScale,
}: {
  textLink?: boolean;
  /** Caps the label's growth with the text-size setting; see Copy. */
  maxScale?: number;
  title: string;
  onPress(): void;
  variant?: ButtonVariant;
  /** @deprecated use variant="secondary" */
  secondary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  /** Leading icon. Use it on every button in a group or on none. */
  icon?: IconName;
  /** Text button: size to the label instead of filling the width. Only for `variant="ghost"`. */
  inline?: boolean;
  haptic?: "tick" | "success";
  accessibilityHint?: string;
  accessibilityLabel?: string;
  /** Explain a material blocked action, visibly and to assistive technology. */
  disabledReason?: string;
}) {
  const c = useColors();
  const surface = useSurface();
  const inRow = useContext(ButtonRowContext);
  const kind = variant ?? (secondary ? "secondary" : "primary");
  const text = inline && kind === "ghost";
  // Coral is reserved for starting or resuming a workout; those buttons carry the play icon. A setup call to
  // action such as "Start saving workouts" stays ink.
  const start = icon === "play";
  const colors = start && kind === "primary" ? { bg: c.accent, fg: c.onAccent, border: undefined } : buttonColors(c, kind, surface);
  const { bg, fg, border } = disabled || busy
    ? { bg: c.sunken, fg: c.text, border: c.border } : colors;
  const inactive = disabled || busy;
  const press = usePressScale(inactive);
  const AnimatedPressable = animatedPressableComponent();
  return (
    <>
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={disabled && disabledReason ? disabledReason : accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      aria-disabled={inactive}
      aria-busy={busy}
      disabled={inactive}
      hitSlop={text ? { left: 12, right: 12 } : undefined}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={() => {
        if (haptic) haptics[haptic]();
        onPress();
      }}
      style={{
        // A text button keeps a 44pt target; every other button is the full 50pt.
        minHeight: text ? touch.min : BUTTON_HEIGHT,
        paddingVertical: textLink ? 0 : text ? 8 : 12,
        // A text button has no fill to pad, so its label lines up with the text around it; hitSlop widens the target.
        paddingHorizontal: textLink || text ? 0 : BUTTON_PADDING,
        borderRadius: radii.md,
        backgroundColor: bg,
        borderWidth: border ? 1 : 0,
        borderColor: border,
        opacity: press.opacity,
        transform: [{ scale: press.scale }],
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        alignSelf: text && !inRow ? "flex-start" : "stretch",
        ...(inRow ? { flex: 1, minWidth: 0 } : null),
        gap: BUTTON_GAP,
      }}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : icon ? (
        <Ionicons name={icon} color={fg} size={BUTTON_ICON} />
      ) : null}
      <Copy
        kind={textLink ? "small" : "label"}
        color={fg}
        maxScale={maxScale}
        style={{ textAlign: "center", flexShrink: 1 }}
      >
        {title}
      </Copy>
    </AnimatedPressable>
    {disabled && !!disabledReason && <Copy kind="small" tone="muted">{disabledReason}</Copy>}
    </>
  );
}

/** Rough width of a one-line button label at the current text size, for deciding whether a row has room. */
const LABEL_EM = 0.57;
function labelFits(title: unknown, icon: unknown, cell: number, fontScale: number) {
  if (typeof title !== "string") return true;
  const need = title.length * 17 * LABEL_EM * fontScale + (icon ? BUTTON_ICON + BUTTON_GAP : 0) + BUTTON_PADDING * 2;
  return need <= cell;
}
/**
 * Two or three buttons side by side: equal width, equal height. If a label would not fit on one line
 * (long label, narrow screen or larger text) the buttons stack at full width instead of squeezing or truncating.
 */
export function ButtonRow({ children, gap = 8 }: PropsWithChildren<{ gap?: number }>) {
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const buttons = Children.toArray(children).filter(isValidElement) as ReactElement<{ title?: unknown; icon?: unknown }>[];
  const cell = (width - gap * (buttons.length - 1)) / Math.max(buttons.length, 1);
  const stacked = buttons.length < 2 || (width > 0 && !buttons.every(b => labelFits(b.props.title, b.props.icon, cell, fontScale)));
  return (
    // Keyed by text size so a Dynamic Type change re-measures instead of keeping a stale layout.
    <View key={fontScale} onLayout={event => setWidth(event.nativeEvent.layout.width)}
      style={{ flexDirection: stacked ? "column" : "row", alignItems: "stretch", gap }}>
      <ButtonRowContext.Provider value={!stacked}>{buttons}</ButtonRowContext.Provider>
    </View>
  );
}

/** Icon-only button. `label` is required so screen readers can announce it. */
export function IconButton({
  icon,
  label,
  onPress,
  variant = "soft",
  size = touch.min,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  onPress(): void;
  variant?: "soft" | "plain" | "primary";
  size?: number;
  disabled?: boolean;
}) {
  const c = useColors();
  const surface = useSurface();
  const press = usePressScale(disabled);
  const AnimatedPressable = animatedPressableComponent();
  const bg =
    variant === "primary"
      ? c.action
      : variant === "plain"
        ? "transparent"
        : surface === "hero"
          ? c.onHeroSoft
          : c.sunken;
  const fg = variant === "primary" ? c.onAction : surface === "hero" ? c.onHero : c.text;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      hitSlop={Math.max(0, (touch.min - size) / 2)}
      style={{
        width: size,
        height: size,
        borderRadius: radii.full,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.5 : press.opacity,
        transform: [{ scale: press.scale }],
      }}
    >
      <Ionicons name={icon} size={Math.round(size * 0.48)} color={fg} />
    </AnimatedPressable>
  );
}

/** Header circle size (spec v2 §1.2): 36pt tonal circle inside a 44pt touch target. */
const HEADER_BUTTON = 36;
/**
 * The one header action style: +, ···, share, close. Tonal fill, label-colour icon,
 * so iOS 18, iOS 26 and Android draw the same thing. `primary` tints the icon for the one main action.
 */
export function HeaderButton({ icon, label, onPress, primary = false, disabled = false }: {
  icon: IconName; label: string; onPress(): void; primary?: boolean; disabled?: boolean;
}) {
  const c = useColors();
  const press = usePressScale(disabled);
  const AnimatedPressable = animatedPressableComponent();
  return (
    // A padded 44pt pressable: hitSlop can't reach past a 36pt header row, so the target itself is full size.
    <AnimatedPressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
      onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut}
      style={{ width: touch.min, height: touch.min, alignItems: "center", justifyContent: "center",
        opacity: disabled ? 0.5 : press.opacity, transform: [{ scale: press.scale }] }}>
      <View style={{ width: HEADER_BUTTON, height: HEADER_BUTTON, borderRadius: radii.full, backgroundColor: c.sunken, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={20} color={primary ? c.accentText : c.text} />
      </View>
    </AnimatedPressable>
  );
}

/** Account entry in tab headers: the person's initial (or photo) in the same tonal circle as the header buttons. */
export function AccountButton() {
  const c = useColors();
  const identity = useAccountIdentity();
  const press = usePressScale();
  const AnimatedPressable = animatedPressableComponent();
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const image = identity?.imageUrl && identity.imageUrl !== failedImage ? identity.imageUrl : undefined;
  const size = 32;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel="Open account and settings"
      onPress={() => router.push("/settings")}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      // 44pt target around the 32pt avatar, like the header buttons.
      style={{ width: touch.min, height: touch.min, alignItems: "center", justifyContent: "center", opacity: press.opacity, transform: [{ scale: press.scale }] }}
    >
      <View style={{ width: size, height: size, borderRadius: radii.full, backgroundColor: c.sunken, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {image ? (
        <Image source={{ uri: image }} onError={() => setFailedImage(image)} style={{ width: size, height: size }} accessibilityIgnoresInvertColors />
      ) : identity?.initial ? (
        <Copy allowFontScaling={false} style={{ fontSize: 15, lineHeight: 20, fontWeight: "600", color: c.text }}>{identity.initial}</Copy>
      ) : (
        <Ionicons name="person" size={18} color={c.text} />
      )}
      </View>
    </AnimatedPressable>
  );
}

/** Interactive chips use the compact control height; this slop on every side makes them 44pt targets. */
const CHIP_REACH = (touch.min - compactControl) / 2;
/**
 * Compact pill (spec v2 §1.4). Pass `onPress` for a selectable filter / quick action; omit it for a static tag.
 * Unselected chips sit on a tonal fill; selected chips fill with the accent.
 */
export function Chip({
  label,
  icon,
  trailingIcon,
  selected = false,
  onPress,
  tone = "default",
  disabled = false,
  role,
  accessibilityLabel,
}: {
  label: string;
  icon?: IconName;
  /** e.g. a close mark on a removable filter chip. */
  trailingIcon?: IconName;
  selected?: boolean;
  onPress?: () => void;
  tone?: "default" | "accent";
  disabled?: boolean;
  role?: "radio" | "checkbox" | "button";
  accessibilityLabel?: string;
}) {
  const c = useColors();
  const surface = useSurface();
  const press = usePressScale(disabled);
  const onHero = surface === "hero";
  const bg = selected ? (onHero ? c.onHero : c.text) : tone === "accent" ? c.accentTint : c.sunken;
  const fg = selected ? (onHero ? c.hero : c.background) : tone === "accent" ? c.accentText : c.text;
  const body = (
    <>
      {selected && onPress && role !== "button" ? (
        <Ionicons name="checkmark" size={16} color={fg} />
      ) : icon ? (
        <Ionicons name={icon} size={16} color={fg} />
      ) : null}
      {/* Copy sizes and remounts on every text-size change; a bare Text kept its first native multiplier and clipped on the second. */}
      <Copy kind="cardTitle" color={fg} align="center" style={{ fontWeight: "500" }}>{label}</Copy>
      {!!trailingIcon && <Ionicons name={trailingIcon} size={15} color={fg} />}
    </>
  );
  const style = {
    minHeight: onPress ? compactControl : 28,
    paddingHorizontal: onPress ? 14 : 10,
    paddingVertical: onPress ? 6 : 4,
    borderRadius: radii.full,
    backgroundColor: bg,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
  };
  if (!onPress)
    return (
      <View accessible accessibilityLabel={label} style={style}>
        {body}
      </View>
    );
  const AnimatedPressable = animatedPressableComponent();
  return (
    <AnimatedPressable
      accessibilityRole={role ?? "checkbox"}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={role === "button" ? { disabled } : { checked: selected, disabled }}
      aria-checked={role === "button" ? undefined : selected}
      disabled={disabled}
      hitSlop={CHIP_REACH}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={() => {
        haptics.tick();
        onPress();
      }}
      style={[style, { opacity: disabled ? 0.5 : press.opacity, transform: [{ scale: press.scale }] }]}
    >
      {body}
    </AnimatedPressable>
  );
}

/**
 * A row of chips. Scrolls horizontally by default and fades at the trailing edge instead of
 * clipping a label mid-word; `wrap` flows onto new lines instead.
 */
export function ChipRow({ children, wrap = false, center = false, label, fadeColor }: PropsWithChildren<{ wrap?: boolean; /** With `wrap`, centre each line. */ center?: boolean; label?: string; fadeColor?: string }>) {
  const c = useColors();
  // Remounted on every text-size change so chips and the scroller re-measure instead of clipping.
  const { fontScale } = useWindowDimensions();
  // The fade only says "more to the right": it shows while chips overflow past the right edge and
  // disappears at the end, so the last chip is never left under it.
  const [extent, setExtent] = useState({ width: 0, content: 0, x: 0 });
  const moreToTheRight = extent.content - (extent.x + extent.width) > 1;
  if (wrap)
    return (
      // Padding (cancelled by the margin) keeps the first and last rows' 44pt reach inside the row.
      <View key={fontScale} accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: center ? "center" : undefined, gap: 8, paddingVertical: CHIP_REACH, marginVertical: -CHIP_REACH }}>
        {children}
      </View>
    );
  const fade = fadeColor ?? c.background;
  return (
    <View key={fontScale} style={{ marginHorizontal: -16 }}>
      <ScrollView
        horizontal
        accessibilityLabel={label}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingVertical: CHIP_REACH, paddingHorizontal: 16 }}
        style={{ flexGrow: 0 }}
        scrollEventThrottle={32}
        onLayout={event => { const width = event.nativeEvent.layout.width; setExtent(e => ({ ...e, width })); }}
        onContentSizeChange={content => setExtent(e => ({ ...e, content }))}
        onScroll={event => { const x = event.nativeEvent.contentOffset.x; setExtent(e => ({ ...e, x })); }}
      >
        {children}
      </ScrollView>
      {moreToTheRight && <Svg pointerEvents="none" width={24} height="100%" style={{ position: "absolute", right: 0, top: 0, bottom: 0 }}>
        <Defs><LinearGradient id="chip-fade" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={fade} stopOpacity={0} /><Stop offset="1" stopColor={fade} stopOpacity={1} />
        </LinearGradient></Defs>
        <Rect x="0" y="0" width="24" height="100%" fill="url(#chip-fade)" />
      </Svg>}
    </View>
  );
}

/** Filter entry beside a search field: a 40pt tonal circle with an accent count badge when filters are on. */
export function FilterButton({ count, onPress, label = "Filter" }: { count: number; onPress(): void; label?: string }) {
  const c = useColors();
  const press = usePressScale();
  const AnimatedPressable = animatedPressableComponent();
  return (
    // A padded 44pt target (the row is only as tall as the 40pt search field); margins keep the circle where it was.
    <AnimatedPressable accessibilityRole="button" accessibilityLabel={count ? `${label}, ${count} on` : label} onPress={onPress}
      onPressIn={press.onPressIn} onPressOut={press.onPressOut}
      style={{ width: touch.min, height: touch.min, marginHorizontal: -2, alignItems: "center", justifyContent: "center",
        opacity: press.opacity, transform: [{ scale: press.scale }] }}>
      <View style={{ width: 40, height: 40, borderRadius: radii.full, backgroundColor: c.sunken, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="options-outline" size={20} color={count ? c.accentText : c.text} />
        {!!count && <View style={{ position: "absolute", top: -3, right: -3, minWidth: 18, minHeight: 18, borderRadius: 9, paddingHorizontal: 4,
          backgroundColor: c.text, alignItems: "center", justifyContent: "center" }}>
          <Copy style={{ fontSize: 11, lineHeight: 13, fontWeight: "700", color: c.background }}>{count}</Copy>
        </View>}
      </View>
    </AnimatedPressable>
  );
}

/** Segments are 32pt to look like the spec's 36pt control; this much vertical slop makes each one a 44pt target. */
const SEGMENT_REACH = (touch.min - 32) / 2;
/** Mutually exclusive options in one compact control (spec v2 §1.4): tonal track, raised selected segment. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: NoInfer<T>; label: string }[];
  value: T;
  onChange(value: T): void;
  label: string;
}) {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  const [trackWidth, setTrackWidth] = useState(0);
  const [natural, setNatural] = useState<Record<string, number>>({});
  // Re-measure when the labels or the system text size change; stale widths would pick the wrong size.
  const measureKey = `${fontScale}:${options.map(option => option.label).join("|")}`;
  const [measuredFor, setMeasuredFor] = useState(measureKey);
  if (measuredFor !== measureKey) { setMeasuredFor(measureKey); setNatural({}); }
  // Every label shares one size: the largest at which the longest label fits its segment.
  const labelScale = segmentLabelScale(trackWidth, options.map(option => natural[option.value]));
  return (
    // The outer padding (cancelled by the margin) holds each segment's 44pt reach inside a parent.
    <View style={{ paddingVertical: SEGMENT_REACH - 2, marginVertical: -(SEGMENT_REACH - 2) }}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        onLayout={event => setTrackWidth(event.nativeEvent.layout.width)}
        style={{ flexDirection: "row", backgroundColor: c.sunken, borderRadius: 10, padding: 2, gap: 2 }}
      >
        {options.map((option) => <SegmentOption key={option.value} label={option.label} selected={option.value === value} labelScale={labelScale}
          onPress={() => { if (option.value !== value) haptics.tick(); onChange(option.value); }} />)}
        {/* Invisible, unconstrained copies of the labels at full size: their widths decide the shared scale. */}
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={{ position: "absolute", left: 0, top: 0, width: 1500, flexDirection: "row", opacity: 0 }}>
          {options.map(option => <Text key={`${option.value}:${fontScale}`} numberOfLines={1} allowFontScaling={false}
            onLayout={event => { const width = Math.ceil(event.nativeEvent.layout.width); setNatural(known => known[option.value] === width ? known : { ...known, [option.value]: width }); }}
            style={{ fontFamily: typography.cardTitle.fontFamily, fontWeight: typography.cardTitle.fontWeight, textTransform: "uppercase", letterSpacing: 0.25,
              fontSize: typography.cardTitle.fontSize * fontScale, lineHeight: typography.cardTitle.lineHeight * fontScale }}>{option.label}</Text>)}
        </View>
      </View>
    </View>
  );
}

function SegmentOption({ label, selected, labelScale, onPress }: { label: string; selected: boolean; labelScale: number; onPress(): void }) {
  const c = useColors();
  const press = usePressScale();
  const AnimatedPressable = animatedPressableComponent();
  return <AnimatedPressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: selected }}
    aria-checked={selected} onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} hitSlop={{ top: SEGMENT_REACH, bottom: SEGMENT_REACH }}
    style={{ flex: 1, minHeight: 32, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 8, alignItems: "center", justifyContent: "center",
      backgroundColor: selected ? c.segment : "transparent",
      shadowColor: c.shadow, shadowOpacity: selected ? 0.12 : 0, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: selected ? 1 : 0,
      opacity: press.opacity, transform: [{ scale: press.scale }] }}>
    {/* One line at every text size, and one size for the whole control, so a selected "All" never outgrows "Programs".
        `fit` stays as a safety net for a first frame before the labels are measured. */}
    <Copy kind="cardTitle" color={c.text} align="center" fit
      style={labelScale < 1 ? { fontSize: typography.cardTitle.fontSize * labelScale, lineHeight: typography.cardTitle.lineHeight * labelScale } : undefined}>{label}</Copy>
  </AnimatedPressable>;
}

/** Search at the top of a list (spec v2 §1.4): 40pt tonal field with a magnifier and a clear button. */
export function SearchField({ value, onChange, placeholder, label, onSubmit }: {
  value: string; onChange(value: string): void; placeholder: string; label: string; onSubmit?(): void;
}) {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  const height = Math.max(40, Math.ceil(22 * fontScale) + 14);
  return (
    // Keyed by the text size: two quick Dynamic Type changes must not reuse a stale native layout of the field.
    <View key={fontScale} style={{ flex: 1, minHeight: height, borderRadius: 12, backgroundColor: c.sunken, flexDirection: "row", alignItems: "center", paddingLeft: 10, gap: 6 }}>
      <Ionicons name="search" size={18} color={c.muted} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={c.muted}
        accessibilityLabel={label} accessibilityRole="search" returnKeyType="search" autoCapitalize="none" autoCorrect={false}
        clearButtonMode="never" onSubmitEditing={onSubmit ? () => onSubmit() : undefined}
        allowFontScaling={false}
        style={{ flex: 1, minHeight: height, fontFamily: fonts.regular, lineHeight: 22 * fontScale, fontSize: 17 * fontScale, color: c.text, paddingVertical: 0, textAlignVertical: "center" }} />
      {!!value && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} onPress={() => onChange("")}
        style={{ width: 36, height: height, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="close-circle" size={18} color={c.muted} />
      </Pressable>}
    </View>
  );
}

let accessoryCount = 0;
export function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  numeric = false,
  secret = false,
  optional = false,
  disabled = false,
  purpose,
  large = false,
  compact = false,
  returnKeyType,
  onSubmit,
  inputRef,
  hideLabel = false,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  multiline?: boolean;
  numeric?: boolean;
  secret?: boolean;
  optional?: boolean;
  disabled?: boolean;
  purpose?: InputPurpose;
  /** Big tabular numerals for quick logging mid-workout. */
  large?: boolean;
  /** Keep a multiline composer usable above the keyboard; its text scrolls. */
  compact?: boolean;
  returnKeyType?: TextInputProps["returnKeyType"];
  /** Called from the keyboard's return key. "next" keeps the keyboard up so focus can move on. */
  onSubmit?: () => void;
  inputRef?: Ref<TextInput>;
  /** Keep the accessible name when search is identified by its placeholder. */
  hideLabel?: boolean;
}) {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  const fieldType = large ? typography.numeric : typography.body;
  const [focused, setFocused] = useState(false);
  const traits = inputTraits(purpose, Platform.OS, numeric);
  // iOS number pads have no return key; without a Done bar the keyboard hides
  // the button below the field (Verify, Save set).
  const pad = Platform.OS === "ios" && (traits.keyboardType === "number-pad" || traits.keyboardType === "decimal-pad");
  const [accessory] = useState(() => `field-done-${++accessoryCount}`);
  return (
    <View style={{ gap: 8, flexGrow: 1 }}>
      {!hideLabel && <Copy kind="label">
        {label}
        {optional ? <Copy kind="small" tone="muted"> · optional</Copy> : null}
      </Copy>}
      <TextInput
        allowFontScaling={false}
        key={`${purpose ?? "general"}:${fontScale}`}
        ref={inputRef}
        {...traits}
        inputAccessoryViewID={pad ? accessory : undefined}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmit ? () => onSubmit() : undefined}
        submitBehavior={onSubmit && returnKeyType === "next" ? "submit" : undefined}
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        aria-disabled={disabled}
        editable={!disabled}
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        multiline={multiline}
        secureTextEntry={secret}
        autoCapitalize="none"
        style={[
          { ...fieldType, fontSize: fieldType.fontSize * fontScale, lineHeight: fieldType.lineHeight * fontScale },
          {
            color: c.text,
            borderColor: focused ? c.focus : c.borderStrong,
            borderWidth: focused ? 2 : 1,
            backgroundColor: disabled ? c.sunken : c.elevated,
            borderRadius: radii.sm,
            paddingHorizontal: focused ? 15 : 16,
            // One-line fields match a button's 50pt height, so a field and its button line up.
            paddingVertical: large ? 8 : multiline ? (focused ? 13 : 14) : focused ? 11 : 12,
            minHeight: multiline ? compact ? 60 : 110 : large ? 64 : touch.comfortable,
            maxHeight: multiline && compact ? 120 : undefined,
            textAlignVertical: multiline ? "top" : "center",
            opacity: disabled ? 0.7 : 1,
          },
        ]}
      />
      {pad && (
        <InputAccessoryView nativeID={accessory}>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", backgroundColor: c.surface,
            borderTopWidth: 1, borderColor: c.border, paddingHorizontal: 12 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={() => Keyboard.dismiss()}
              style={{ minHeight: touch.min, paddingHorizontal: 12, justifyContent: "center" }}>
              <Copy kind="label" color={c.action}>Done</Copy>
            </Pressable>
          </View>
        </InputAccessoryView>
      )}
    </View>
  );
}

export function Choice({
  label,
  detail,
  selected,
  onPress,
  disabled = false,
  busy = false,
  icon,
  role = "checkbox",
}: {
  role?: "radio" | "checkbox";
  label: string;
  detail?: string;
  selected: boolean;
  onPress(): void;
  disabled?: boolean;
  busy?: boolean;
  /** Optional leading icon (e.g. source type). */
  icon?: IconName;
}) {
  const c = useColors();
  const grouped = useGroupedPage();
  const press = usePressScale(disabled || busy);
  const AnimatedPressable = animatedPressableComponent();
  return (
    <AnimatedPressable
      onPress={() => {
        haptics.tick();
        onPress();
      }}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled: disabled || busy, busy }}
      aria-checked={selected}
      aria-disabled={disabled || busy}
      aria-busy={busy}
      disabled={disabled || busy}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={{
        minHeight: 56,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: grouped ? 10 : radii.lg,
        borderWidth: grouped ? 0 : selected ? 2 : 1,
        borderColor: selected ? c.onActionSoft : c.border,
        backgroundColor: grouped ? c.elevated : selected ? c.actionSoft : c.surface,
        opacity: press.opacity,
        transform: [{ scale: press.scale }],
        flexDirection: "row",
        gap: 12,
        alignItems: "center",
      }}
    >
      {!!icon && <Ionicons name={icon} size={22} color={selected ? c.onActionSoft : c.muted} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Copy kind="label">{label}</Copy>
        {!!detail && (
          <Copy kind="small" tone="muted">
            {detail}
          </Copy>
        )}
      </View>
      {busy ? (
        <ActivityIndicator color={c.action} />
      ) : (
        <Ionicons
          name={selected ? "checkmark-circle" : "ellipse-outline"}
          size={24}
          color={selected ? c.onActionSoft : c.borderStrong}
        />
      )}
    </AnimatedPressable>
  );
}
