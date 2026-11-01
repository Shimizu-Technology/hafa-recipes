import { useEffect } from "react";
import { LayoutAnimation, Platform, Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, type Href } from "expo-router";
import { useAskPill } from "@/lib/ask-pill";
import { haptics, useColors, useReducedMotion } from "./design/foundation";
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
  const reduced = useReducedMotion();
  const { collapsed, hidden } = useAskPill();
  const keyboard = useKeyboardShown();
  useEffect(() => {
    if (!reduced && Platform.OS === "ios") LayoutAnimation.configureNext(LayoutAnimation.create(180, "easeInEaseOut", "opacity"));
  }, [collapsed, reduced]);
  if (hidden || keyboard) return null;
  return <View pointerEvents="box-none" style={{ position: "absolute", right: 16, bottom }}>
    <Pressable testID="ask-coach" accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
      onPress={() => { haptics.light(); router.push(href); }}
      style={({ pressed }) => ({
        height: ASK_PILL_HEIGHT, minWidth: ASK_PILL_HEIGHT, borderRadius: ASK_PILL_HEIGHT / 2, paddingHorizontal: collapsed ? 0 : 18,
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: c.action,
        shadowColor: c.shadow, shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 4 }, elevation: 6,
        opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.96 : 1 }],
      })}>
      <Ionicons name="sparkles" size={20} color={c.onAction} />
      {!collapsed && <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ flexShrink: 0, fontSize: 16, lineHeight: 21, fontWeight: "600", color: c.onAction }}>{label}</Text>}
    </Pressable>
  </View>;
}
