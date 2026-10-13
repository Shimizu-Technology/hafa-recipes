import { useState, type PropsWithChildren } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { inputTraits, type InputPurpose } from "@/lib/input-purpose";
import { motion, radii, touch, typography, type ColorTokens } from "@/constants/theme";
import { Copy, haptics, useColors, useReducedMotion, useSurface, type Surface } from "./foundation";

export type IconName = keyof typeof Ionicons.glyphMap;
export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "accent";
export type ButtonSize = "sm" | "md" | "lg";

function buttonColors(c: ColorTokens, variant: ButtonVariant, surface: Surface) {
  if (surface === "hero") {
    if (variant === "primary" || variant === "accent") return { bg: c.onHero, fg: c.hero };
    return { bg: c.onHeroSoft, fg: c.onHero };
  }
  switch (variant) {
    case "primary":
      return { bg: c.action, fg: c.onAction };
    case "secondary":
      return { bg: c.actionSoft, fg: c.onActionSoft };
    case "ghost":
      return { bg: "transparent", fg: c.onActionSoft };
    case "destructive":
      return { bg: c.errorSoft, fg: c.error };
    case "accent":
      return { bg: c.accent, fg: c.onAccent };
  }
}
const heights: Record<ButtonSize, number> = { sm: 44, md: 52, lg: 60 };

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
}) {
  const c = useColors();
  const surface = useSurface();
  const reduced = useReducedMotion();
  const kind = variant ?? (secondary ? "secondary" : "primary");
  const { bg, fg } = buttonColors(c, kind, surface);
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      aria-disabled={inactive}
      aria-busy={busy}
      disabled={inactive}
      hitSlop={size === "sm" ? 4 : 0}
      onPress={() => {
        if (haptic) haptics[haptic]();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: heights[size],
        paddingVertical: size === "sm" ? 8 : 12,
        paddingHorizontal: size === "sm" ? 16 : 22,
        borderRadius: radii.full,
        backgroundColor: bg,
        opacity: inactive ? 0.55 : pressed && reduced ? 0.8 : 1,
        transform: [{ scale: pressed && !reduced ? motion.pressScale : 1 }],
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        alignSelf: inline ? "flex-start" : "stretch",
        gap: 8,
      })}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : icon ? (
        <Ionicons name={icon} color={fg} size={size === "sm" ? 18 : 21} />
      ) : null}
      <Copy
        kind={size === "lg" ? "subheading" : "label"}
        color={fg}
        style={{ textAlign: "center", flexShrink: 1 }}
      >
        {title}
      </Copy>
    </Pressable>
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
  const reduced = useReducedMotion();
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={Math.max(0, (touch.min - size) / 2)}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: radii.full,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.5 : pressed && reduced ? 0.75 : 1,
        transform: [{ scale: pressed && !reduced ? 0.92 : 1 }],
      })}
    >
      <Ionicons name={icon} size={Math.round(size * 0.48)} color={fg} />
    </Pressable>
  );
}

export function AccountButton() {
  return (
    <IconButton icon="person-outline" label="Open account and settings" onPress={() => router.push("/settings")} />
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
}: {
  label: string;
  icon?: IconName;
  selected?: boolean;
  onPress?: () => void;
  tone?: "default" | "accent";
  disabled?: boolean;
}) {
  const c = useColors();
  const surface = useSurface();
  const reduced = useReducedMotion();
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
      <Copy kind="label" color={fg} style={{ fontSize: 15 }}>
        {label}
      </Copy>
    </>
  );
  const style = {
    minHeight: onPress ? 40 : 32,
    paddingHorizontal: onPress ? 14 : 12,
    paddingVertical: 6,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: border,
    backgroundColor: bg,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  };
  if (!onPress)
    return (
      <View accessible accessibilityLabel={label} style={style}>
        {body}
      </View>
    );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      aria-selected={selected}
      disabled={disabled}
      hitSlop={4}
      onPress={() => {
        haptics.tick();
        onPress();
      }}
      style={({ pressed }) => [
        style,
        { opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed && !reduced ? motion.pressScale : 1 }] },
      ]}
    >
      {body}
    </Pressable>
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
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            onPress={() => {
              if (!selected) haptics.tick();
              onChange(option.value);
            }}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: radii.full,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: selected ? c.elevated : "transparent",
              borderWidth: selected ? 1 : 0,
              borderColor: c.border,
            }}
          >
            <Copy kind="label" color={selected ? c.text : c.muted} style={{ fontSize: 15 }}>
              {option.label}
            </Copy>
          </Pressable>
        );
      })}
    </View>
  );
}

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
}) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 8, flexGrow: 1 }}>
      <Copy kind="label">
        {label}
        {optional ? <Copy kind="small" tone="muted"> · optional</Copy> : null}
      </Copy>
      <TextInput
        key={purpose ?? "general"}
        {...inputTraits(purpose, Platform.OS, numeric)}
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
          large ? typography.numeric : typography.body,
          {
            color: c.text,
            borderColor: focused ? c.focus : c.borderStrong,
            borderWidth: focused ? 2 : 1,
            backgroundColor: disabled ? c.sunken : c.elevated,
            borderRadius: radii.md,
            paddingHorizontal: focused ? 15 : 16,
            paddingVertical: large ? 8 : focused ? 13 : 14,
            minHeight: multiline ? 110 : large ? 64 : 54,
            textAlignVertical: multiline ? "top" : "center",
            opacity: disabled ? 0.7 : 1,
          },
        ]}
      />
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
}: {
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
  const reduced = useReducedMotion();
  return (
    <Pressable
      onPress={() => {
        haptics.tick();
        onPress();
      }}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled: disabled || busy, busy }}
      aria-checked={selected}
      aria-disabled={disabled || busy}
      aria-busy={busy}
      disabled={disabled || busy}
      style={({ pressed }) => ({
        minHeight: 56,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: radii.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? c.action : c.border,
        backgroundColor: selected ? c.actionSoft : c.surface,
        opacity: disabled || busy ? 0.55 : 1,
        transform: [{ scale: pressed && !reduced ? 0.985 : 1 }],
        flexDirection: "row",
        gap: 12,
        alignItems: "center",
      })}
    >
      {!!icon && <Ionicons name={icon} size={22} color={selected ? c.action : c.muted} />}
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
          color={selected ? c.action : c.borderStrong}
        />
      )}
    </Pressable>
  );
}
