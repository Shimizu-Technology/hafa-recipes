import { fonts } from "@/constants/theme";
import { animatedPressableComponent, usePressScale } from "./design/press";
import { Text, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, type Href } from "expo-router";
import { useAskPill } from "@/lib/ask-pill";
import { haptics, useColors } from "./design/foundation";
import { useKeyboardShown } from "./design/tab-bar";

/** Height of the pill; lists add this plus a gap so it never covers the last card. */
export const ASK_PILL_HEIGHT = 48;

/**
 * Floating entry to the coach (spec v2 §1.6): bottom-right, accent fill, sparkle + label.
 * General coach chat from the tabs; "Ask about this" with the item's context on a detail screen.
 */
export function AskCoachPill({ bottom, href = "/coach", label = "Ask Coach", hint = "Opens a chat with your AI coach" }: {
  bottom: number; href?: Href; label?: string; hint?: string;
}) {
  const c = useColors();
  const press = usePressScale();
  const Target = animatedPressableComponent();
  const { collapsed, hidden } = useAskPill();
  const keyboard = useKeyboardShown();
  const { fontScale } = useWindowDimensions();
  const compact = collapsed || fontScale >= 1.5;
  if (hidden || keyboard) return null;
  return <View pointerEvents="box-none" style={{ position: "absolute", right: 16, bottom }}>
    <Target testID="ask-coach" accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
      onPress={() => { haptics.light(); router.push(href); }}
      onPressIn={press.onPressIn} onPressOut={press.onPressOut}
      style={{
        height: ASK_PILL_HEIGHT, minWidth: ASK_PILL_HEIGHT, borderRadius: ASK_PILL_HEIGHT / 2, paddingHorizontal: compact ? 0 : 18,
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: c.action,
        shadowColor: c.shadow, shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 4 }, elevation: 6,
        opacity: press.opacity, transform: [{ scale: press.scale }],
      }}>
      <Ionicons name="sparkles" size={20} color={c.onAction} />
      {!compact && <Text allowFontScaling={false} numberOfLines={1} style={{ flexShrink: 0, fontSize: 16, lineHeight: 21, fontFamily: fonts.semibold, fontWeight: "400", color: c.onAction }}>{label}</Text>}
    </Target>
  </View>;
}
