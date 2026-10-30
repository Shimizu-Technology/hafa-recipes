import { useEffect, useState } from "react";
import { Keyboard, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
// Expo Router vendors React Navigation's tab bar. Reusing its renderer keeps tab
// press, long-press, accessibility and safe-area behavior unchanged (as in Håfa Recipes).
import { BottomTabBar, type BottomTabBarProps } from "expo-router/build/react-navigation/bottom-tabs";
import { radii, spacing } from "@/constants/theme";
import { Copy, useColors } from "./design/foundation";
import { animatedPressableComponent, usePressScale } from "./design/press";
import { useOfflineTraining } from "@/lib/context";
import { setTabOverlayHeight } from "./tab-chrome";

/** Keeps active training reachable above the tabs. */
export function WorkoutsTabBar(props: BottomTabBarProps) {
  const c = useColors();
  const offline = useOfflineTraining();
  const [keyboard, setKeyboard] = useState(() => Keyboard.isVisible?.() ?? false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboard(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const route = props.state.routes[props.state.index]?.name;
  // Train shows its own Resume action at the top, so the floating bar would repeat it.
  const active = route === "train" ? null : offline.state.active;
  const floating = !keyboard && !!active;
  useEffect(() => {
    if (!floating) setTabOverlayHeight(0);
  }, [floating]);
  useEffect(() => () => setTabOverlayHeight(0), []);
  return (
    <View style={{ backgroundColor: c.surface, overflow: "visible" }}>
      {floating && (
        <View
          pointerEvents="box-none"
          onLayout={event => setTabOverlayHeight(event.nativeEvent.layout.height + spacing.sm)}
          style={{ position: "absolute", bottom: "100%", left: spacing.md, right: spacing.md, marginBottom: spacing.sm, gap: spacing.sm, alignItems: "flex-end" }}
        >
          {active && <ResumeBar title={active.workout.title} />}
        </View>
      )}
      <BottomTabBar {...props} />
    </View>
  );
}

function ResumeBar({ title }: { title: string }) {
  const c = useColors();
  const press = usePressScale();
  const AnimatedPressable = animatedPressableComponent();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`Resume workout, ${title}`}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={() => router.push("/training")}
      style={{
        alignSelf: "stretch",
        minHeight: 52,
        borderRadius: radii.lg,
        paddingHorizontal: spacing.md,
        paddingVertical: 10,
        backgroundColor: c.hero,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        shadowColor: c.shadow,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.16,
        shadowRadius: 14,
        elevation: 6,
        opacity: press.opacity,
        transform: [{ scale: press.scale }],
      }}
    >
      <Ionicons name="play-circle" size={26} color={c.onHero} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Copy kind="label" color={c.onHero}>Resume workout</Copy>
        <Copy kind="small" color={c.heroMuted} numberOfLines={1}>{title}</Copy>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.heroMuted} />
    </AnimatedPressable>
  );
}
