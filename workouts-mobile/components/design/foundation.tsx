import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import * as Haptics from "expo-haptics";
import { dark, light, typography, type ColorTokens, type TypeKind } from "@/constants/theme";

export function useColors(): ColorTokens {
  return useColorScheme() === "dark" ? dark : light;
}

/** True when the user asked the OS to reduce motion. Animations must settle instantly then. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => live && setReduced(value))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduced);
    return () => {
      live = false;
      sub?.remove();
    };
  }, []);
  return reduced;
}

/**
 * Haptic feedback. Fire-and-forget: never blocks or throws, and is silent on web.
 * The OS applies the user's system haptics setting.
 */
export const haptics = {
  tick() {
    if (Platform.OS !== "web") void Haptics.selectionAsync().catch(() => undefined);
  },
  light() {
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  },
  success() {
    if (Platform.OS !== "web")
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  },
  warning() {
    if (Platform.OS !== "web")
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
  },
};

/** Which surface children sit on, so text and controls pick readable colours automatically. */
export const GroupedPage = createContext(false);
export const useGroupedPage = () => useContext(GroupedPage);

export type Surface = "default" | "hero";
const SurfaceContext = createContext<Surface>("default");
export const SurfaceProvider = SurfaceContext.Provider;
export function useSurface() {
  return useContext(SurfaceContext);
}

export type Tone = "default" | "muted" | "accent" | "action" | "error" | "success" | "warning";
export function toneColor(c: ColorTokens, tone: Tone, surface: Surface) {
  if (surface === "hero") {
    if (tone === "muted") return c.heroMuted;
    if (tone === "accent") return c.heroAccent;
    return c.onHero;
  }
  return {
    default: c.text,
    muted: c.muted,
    accent: c.accentText,
    action: c.onActionSoft,
    error: c.error,
    success: c.success,
    warning: c.warning,
  }[tone];
}

const headerKinds = new Set<TypeKind>(["display", "title", "navTitle", "heading"]);
export function Copy({
  children,
  kind = "body",
  tone = "default",
  color,
  style,
  numberOfLines,
  align,
  accessibilityLabel,
  selectable,
  allowFontScaling,
  maxScale,
}: PropsWithChildren<{
  kind?: TypeKind;
  tone?: Tone;
  /** Prefer `tone`; a token colour is still accepted for existing screens. */
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  align?: TextStyle["textAlign"];
  accessibilityLabel?: string;
  selectable?: boolean;
  allowFontScaling?: boolean;
  /** Caps growth with the text-size setting, for controls that must leave room for content (like a session footer). */
  maxScale?: number;
}>) {
  const c = useColors();
  const surface = useSurface();
  const { fontScale } = useWindowDimensions();
  const textStyle = StyleSheet.flatten([typography[kind], { color: color ?? toneColor(c, tone, surface) }, align ? { textAlign: align } : null, style]);
  const scale = allowFontScaling === false ? 1 : Math.min(fontScale, maxScale ?? Infinity);
  // Explicit sizes keep Fabric layout and glyph metrics together on a live Dynamic Type change.
  const scaled = { ...textStyle, fontSize: (textStyle.fontSize ?? typography[kind].fontSize) * scale,
    lineHeight: (textStyle.lineHeight ?? typography[kind].lineHeight) * scale };
  return (
    <Text
      accessibilityRole={headerKinds.has(kind) ? "header" : undefined}
      accessibilityLabel={accessibilityLabel}
      selectable={selectable}
      allowFontScaling={false}
      numberOfLines={numberOfLines}
      style={scaled}
    >
      {children}
    </Text>
  );
}

type StackProps = PropsWithChildren<{
  gap?: number;
  align?: ViewStyle["alignItems"];
  justify?: ViewStyle["justifyContent"];
  style?: StyleProp<ViewStyle>;
}>;
export function Stack({ children, gap = 12, align, justify, style }: StackProps) {
  return <View style={[{ gap, alignItems: align, justifyContent: justify }, style]}>{children}</View>;
}
export function Row({ children, gap = 12, align = "center", justify, wrap = false, style }: StackProps & { wrap?: boolean }) {
  return (
    <View
      style={[
        { flexDirection: "row", gap, alignItems: align, justifyContent: justify, flexWrap: wrap ? "wrap" : "nowrap" },
        style,
      ]}
    >
      {children}
    </View>
  );
}
/** Flexible child for Row layouts. */
export function Grow({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[{ flex: 1, minWidth: 0 }, style]}>{children}</View>;
}

export const hairline = StyleSheet.hairlineWidth;
