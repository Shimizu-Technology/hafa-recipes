import { HeaderMenu, type HeaderMenuItem } from "./header-menu";
import { createContext, useContext, type ReactElement } from "react";
import { Stack, router } from "expo-router";
import { View } from "react-native";
import { AccountButton, HeaderButton } from "./design/controls";
import { useColors } from "./design/foundation";

const NativeHeader = createContext(false);
export const useNativeHeader = () => useContext(NativeHeader);

/**
 * Header actions as stack options. iOS 26 would wrap a plain `headerRight` in a shared
 * Liquid Glass capsule; a custom item with its shared background hidden draws exactly our
 * buttons, the same as iOS 18 and Android.
 */
export function headerActions(element: ReactElement | undefined) {
  if (!element) return { headerRight: undefined, unstable_headerRightItems: undefined };
  return {
    headerRight: () => element,
    unstable_headerRightItems: () => [{ type: "custom" as const, element, hidesSharedBackground: true }],
  };
}

/** The back control as stack options: our header button instead of the system one (which iOS 26 draws as glass). Swipe-back still works. */
export function headerBack(element: ReactElement | undefined) {
  if (!element) return {};
  return {
    headerBackVisible: false,
    headerLeft: () => element,
    unstable_headerLeftItems: () => [{ type: "custom" as const, element, hidesSharedBackground: true }],
  };
}

/** Each tab owns a native stack so iOS can collapse its large title on scroll. The header is always opaque. */
export function NativeTabStack({ title }: { title: string }) {
  const c = useColors();
  return <NativeHeader.Provider value>
    <Stack screenOptions={{ title, headerLargeTitleEnabled: true, headerShadowVisible: false, headerBackTitle: "Back",
      headerTransparent: false, headerStyle: { backgroundColor: c.background }, headerLargeStyle: { backgroundColor: c.background },
      scrollEdgeEffects: { top: "hidden" }, headerTintColor: c.accent,
      headerTitleStyle: { color: c.text }, headerLargeTitleStyle: { color: c.text },
      contentStyle: { backgroundColor: c.background },
      ...headerActions(<BrowseHeader />),
    }} />
  </NativeHeader.Provider>;
}

/** Tab header actions: one button style for ···, + and the avatar so their colours never disagree. */
export function BrowseHeader({ add = false, onMenu, menuItems = [] }: { add?: boolean; onMenu?(): void; menuItems?: HeaderMenuItem[] }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
    {onMenu && <HeaderMenu items={menuItems} onFallback={onMenu} />}
    {add && <HeaderButton icon="add" label="Add a workout or plan" onPress={() => router.push("/add")} />}
    <AccountButton />
  </View>;
}
