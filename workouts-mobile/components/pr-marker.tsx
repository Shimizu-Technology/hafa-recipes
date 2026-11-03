import { useEffect, useRef } from "react";
import { Animated, Platform } from "react-native";
import { Copy, haptics, useColors, useReducedMotion } from "./ui";
import { EASE, SPRING } from "./design/look-motion";
/** Drop only when a saved record changes; historical records stay still on first load. */
export function PRMarker({ value }: { value: string }) {
  const c = useColors(), reduced = useReducedMotion();
  const previous = useRef(value), y = useRef(new Animated.Value(0)).current, opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    haptics.success();
    y.setValue(reduced ? 0 : -8); opacity.setValue(0.6);
    const a = Animated.parallel([
      Animated.spring(y, { toValue: 0, ...SPRING.snappy, useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(opacity, { toValue: 1, duration: 180, easing: EASE.out, useNativeDriver: Platform.OS !== "web" }),
    ]);
    a.start(); return () => a.stop();
  }, [value, reduced, y, opacity]);
  return <Animated.View style={{ transform: [{ translateY: y }], opacity, alignItems: "flex-end", gap: 4 }}>
    <Copy kind="caption2" color={c.accent}>PR</Copy><Copy kind="numericSmall" style={{ fontSize: 17, lineHeight: 24 }}>{value}</Copy>
  </Animated.View>;
}
