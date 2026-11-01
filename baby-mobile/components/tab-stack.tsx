import { Stack, router } from "expo-router";
import { Icon, NativeHeaderContext, PressTarget, TabScreenContext, fonts, typeScale, useColors, type IconName } from "./ui";
import { Platform, Text, View, type ViewProps } from "react-native";
import type { NativeStackNavigationOptions } from "expo-router/native-stack";
import { useBaby } from "@/lib/context";

/**
 * Header actions as one custom item. On iOS 26 this hides the shared Liquid Glass capsule, so
 * our own tonal circles look the same as on iOS 18 and Android.
 */
export function headerActions(actions: React.ReactElement): NativeStackNavigationOptions {
  return Platform.OS === "ios"
    ? { unstable_headerRightItems: () => [{ type: "custom", element: actions, hidesSharedBackground: true }] }
    : { headerRight: () => actions };
}

export function TabStack({ title }: { title: string }) {
  const c = useColors();
  return <NativeHeaderContext.Provider value={true}><TabScreenContext.Provider value={true}>
    <Stack screenOptions={{
      title, headerLargeTitle: true, headerBackTitle: "Back", headerTintColor: c.action,
      // Opaque on every OS: no blur or glass, and nothing scrolls visibly under the title.
      headerTransparent: false, headerStyle: { backgroundColor: c.background }, headerLargeStyle: { backgroundColor: c.background },
      headerShadowVisible: true, headerLargeTitleShadowVisible: false,
      headerTitleStyle: { color: c.text },
      // UIKit's rounded-system alias; ui-rounded is resolved only by RN text.
      headerLargeTitleStyle: { color: c.text, fontFamily: title === "Today" && Platform.OS === "ios" ? ".AppleSystemUIFontRounded-Bold" : fonts.regular,
        fontSize: 34, fontWeight: "700" },
      contentStyle: { backgroundColor: c.background },
      ...headerActions(<TabActions />),
    }} />
  </TabScreenContext.Provider></NativeHeaderContext.Provider>;
}

/** The one header button shape: a 36pt tonal circle inside a 44pt target. */
export function HeaderIconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const c = useColors();
  return <PressTarget accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.headerFill, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} size={20} color={c.text} />
    </View>
  </PressTarget>;
}

/** A text action (Select, History) in the same tonal fill, so it never reads as bare text. */
export function HeaderPill({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  const c = useColors();
  return <PressTarget accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 44, justifyContent: "center" }}>
    <View style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: c.headerFill, justifyContent: "center" }}>
      <Text maxFontSizeMultiplier={1.3} style={{ ...typeScale.subhead, fontWeight: "600", color: c.text }}>{title}</Text>
    </View>
  </PressTarget>;
}

/** Up to two initials from the profile name; empty when it has no letters to show. */
export function initials(name: string | undefined) {
  const words = (name ?? "").trim().split(/\s+/).map((word) => Array.from(word.replace(/[^\p{L}\p{N}]/gu, ""))[0]).filter(Boolean);
  return (words.length > 1 ? words[0]! + words[words.length - 1]! : words[0] ?? "").toLocaleUpperCase();
}

/** Settings and profiles as a 32pt initials circle, like Recipes and Workouts. */
export function AccountButton() {
  const c = useColors(), text = initials(useBaby().state.bootstrap?.profile.display_name);
  return <PressTarget accessibilityRole="button" accessibilityLabel="Settings and profiles" onPress={() => router.push("/settings")}
    style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
    <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.headerFill, alignItems: "center", justifyContent: "center" }}>
      {text ? <Text allowFontScaling={false} style={{ fontFamily: fonts.rounded, fontSize: 13, fontWeight: "700", color: c.text }}>{text}</Text>
        : <Icon name="person" size={17} color={c.text} />}
    </View>
  </PressTarget>;
}

/** A screen's contextual action, then the account circle; Add lives in the tab bar. */
export function TabActions({ action }: { action?: ViewProps["children"] }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
    {action}
    <AccountButton />
  </View>;
}
