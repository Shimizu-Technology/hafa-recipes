import { useState, type PropsWithChildren, type Ref } from "react";
import { Text, ActivityIndicator, InputAccessoryView, Keyboard, Platform, Pressable, ScrollView, TextInput, useWindowDimensions, View, type TextInputProps } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { Image } from "expo-image";
import { useAccountIdentity } from "../account-identity";
import { inputTraits, type InputPurpose } from "@/lib/input-purpose";
import { radii, touch, typography, type ColorTokens } from "@/constants/theme";
import { Copy, haptics, useGroupedPage, useColors, useSurface, type Surface } from "./foundation";
import { animatedPressableComponent, usePressScale } from "./press";

export type IconName = keyof typeof Ionicons.glyphMap;
export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "accent";
export type ButtonSize = "sm" | "md" | "lg";

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
// Compact buttons stay visually light but keep the 44pt touch minimum;
// hitSlop cannot reach outside a parent Row, so the size itself must comply.
const heights: Record<ButtonSize, number> = { sm: touch.min, md: 50, lg: 50 };

/**
 * One clear action. `primary` is the screen's main action (use once per view);
 * `secondary` for supporting actions; `ghost` for low-emphasis text actions.
 */
export function Button({
  title,
  onPress,
  variant,
  secondary = false,
  size = "md",
  disabled = false,
  busy = false,
  icon,
  inline = false,
  haptic,
  accessibilityHint,
  disabledReason,
}: {
  title: string;
  onPress(): void;
  variant?: ButtonVariant;
  /** @deprecated use variant="secondary" */
  secondary?: boolean;
  size?: ButtonSize;
  disabled?: boolean;
  busy?: boolean;
  icon?: IconName;
  /** Size to content instead of stretching to the container width. */
  inline?: boolean;
  haptic?: "tick" | "success";
  accessibilityHint?: string;
  /** Explain a material blocked action, visibly and to assistive technology. */
  disabledReason?: string;
}) {
  const c = useColors();
  const surface = useSurface();
  const kind = variant ?? (secondary ? "secondary" : "primary");
  const colors = buttonColors(c, kind, surface);
  const { bg, fg, border } = disabled || busy
    ? { bg: c.sunken, fg: c.text, border: c.border } : colors;
  const inactive = disabled || busy;
  const press = usePressScale(inactive);
  const AnimatedPressable = animatedPressableComponent();
  return (
    <>
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={disabled && disabledReason ? disabledReason : accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      aria-disabled={inactive}
      aria-busy={busy}
      disabled={inactive}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={() => {
        if (haptic) haptics[haptic]();
        onPress();
      }}
      style={{
        minHeight: heights[size],
        paddingVertical: size === "sm" ? 8 : 12,
        paddingHorizontal: size === "sm" ? 16 : 22,
        borderRadius: radii.full,
        backgroundColor: bg,
        borderWidth: border ? 1 : 0,
        borderColor: border,
        opacity: press.opacity,
        transform: [{ scale: press.scale }],
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        alignSelf: inline ? "flex-start" : "stretch",
        gap: 8,
      }}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : icon ? (
        <Ionicons name={icon} color={fg} size={size === "sm" ? 18 : 21} />
      ) : null}
      <Copy
        kind="label"
        color={fg}
        style={{ textAlign: "center", flexShrink: 1 }}
      >
        {title}
      </Copy>
    </AnimatedPressable>
    {disabled && !!disabledReason && <Copy kind="small" tone="muted">{disabledReason}</Copy>}
    </>
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

/** Account entry in tab headers: the person's initial (or photo), like Håfa Recipes. */
export function AccountButton() {
  const c = useColors();
  const identity = useAccountIdentity();
  const press = usePressScale();
  const AnimatedPressable = animatedPressableComponent();
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const image = identity?.imageUrl && identity.imageUrl !== failedImage ? identity.imageUrl : undefined;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel="Open account and settings"
      hitSlop={7}
      onPress={() => router.push("/settings")}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={{
        width: 30,
        height: 30,
        borderRadius: radii.full,
        borderWidth: 0,
        borderColor: c.border,
        backgroundColor: identity?.initial ? c.actionSoft : c.sunken,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        opacity: press.opacity,
        transform: [{ scale: press.scale }],
      }}
    >
      {image ? (
        <Image source={{ uri: image }} onError={() => setFailedImage(image)} style={{ width: 30, height: 30 }} accessibilityIgnoresInvertColors />
      ) : identity?.initial ? (
        <Text allowFontScaling={false} style={{ ...typography.label, color: c.text }}>{identity.initial}</Text>
      ) : (
        <Ionicons name="person" size={19} color={c.onActionSoft} />
      )}
    </AnimatedPressable>
  );
}

/**
 * Compact pill. Pass `onPress` for a selectable filter / quick action; omit it for a static tag.
 */
export function Chip({
  label,
  icon,
  selected = false,
  onPress,
  tone = "default",
  disabled = false,
  role,
}: {
  label: string;
  icon?: IconName;
  selected?: boolean;
  onPress?: () => void;
  tone?: "default" | "accent";
  disabled?: boolean;
  role?: "radio" | "checkbox" | "button";
}) {
  const c = useColors();
  const surface = useSurface();
  const press = usePressScale(disabled);
  const onHero = surface === "hero";
  const bg = selected
    ? onHero
      ? c.onHero
      : c.action
    : tone === "accent"
      ? c.accentSoft
      : onHero
        ? c.onHeroSoft
        : c.surface;
  const fg = selected ? (onHero ? c.hero : c.onAction) : tone === "accent" ? c.accentText : onHero ? c.onHero : c.text;
  const border = selected || onHero || tone === "accent" ? "transparent" : c.borderStrong;
  const body = (
    <>
      {selected && onPress ? (
        <Ionicons name="checkmark" size={16} color={fg} />
      ) : icon ? (
        <Ionicons name={icon} size={16} color={fg} />
      ) : null}
      <Copy kind="cardTitle" color={fg} style={{ textAlign: "center" }}>
        {label}
      </Copy>
    </>
  );
  const style = {
    minHeight: onPress ? 40 : 32,
    paddingHorizontal: onPress ? 14 : 12,
    paddingVertical: 6,
    borderRadius: radii.full,
    borderWidth: 0,
    borderColor: border,
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
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={role === "button" ? undefined : selected}
      disabled={disabled}
      hitSlop={4}
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

/** A row of chips. Scrolls horizontally by default; `wrap` flows onto new lines instead. */
export function ChipRow({ children, wrap = false, label }: PropsWithChildren<{ wrap?: boolean; label?: string }>) {
  if (wrap)
    return (
      <View accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {children}
      </View>
    );
  return (
    <ScrollView
      horizontal
      accessibilityLabel={label}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
      style={{ flexGrow: 0 }}
    >
      {children}
    </ScrollView>
  );
}

/** Mutually exclusive options in one compact control (e.g. reps / time / distance). */
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
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ flexDirection: "row", backgroundColor: c.sunken, borderRadius: radii.full, padding: 4, gap: 4 }}
    >
      {options.map((option) => <SegmentOption key={option.value} label={option.label} selected={option.value === value}
        onPress={() => { if (option.value !== value) haptics.tick(); onChange(option.value); }} />)}
    </View>
  );
}

function SegmentOption({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) {
  const c = useColors();
  const press = usePressScale();
  const AnimatedPressable = animatedPressableComponent();
  return <AnimatedPressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: selected }}
    aria-checked={selected} onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut}
    style={{ flex: 1, minHeight: 44, borderRadius: radii.full, alignItems: "center", justifyContent: "center",
      backgroundColor: selected ? c.action : "transparent", borderWidth: 0, borderColor: c.border,
      opacity: press.opacity, transform: [{ scale: press.scale }] }}>
    <Copy kind="cardTitle" color={selected ? c.onAction : c.muted} align="center">{label}</Copy>
  </AnimatedPressable>;
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
            paddingVertical: large ? 8 : focused ? 13 : 14,
            minHeight: multiline ? compact ? 60 : 110 : large ? 64 : 54,
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
