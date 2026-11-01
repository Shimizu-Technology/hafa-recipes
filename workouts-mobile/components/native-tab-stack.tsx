import { HeaderMenu, type HeaderMenuItem } from "./header-menu";
import { createContext, useContext, useEffect } from "react";
import { Stack, router } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { reportTabScreenBottomInset } from "@/lib/bottom-overlay";
import { AccountButton, IconButton } from "./design/controls";
import { useColors } from "./design/foundation";

const NativeHeader = createContext(false);
export const useNativeHeader = () => useContext(NativeHeader);
/** A tab screen's safe area includes the native tab bar; share it with app-wide toasts. */
function TabBarInsetReporter() {
  const { bottom } = useSafeAreaInsets();
  const focused = useIsFocused();
  useEffect(() => { if (focused) reportTabScreenBottomInset(bottom); }, [focused, bottom]);
  return null;
}

/** Each tab owns a native stack so iOS can collapse its large title on scroll. */
export function NativeTabStack({ title, add = false }: { title: string; add?: boolean }) {
  const c = useColors();
  return <NativeHeader.Provider value>
    <TabBarInsetReporter />
    <Stack screenOptions={{ title, headerLargeTitleEnabled: true, headerShadowVisible: false, headerBackTitle: "Back",
      headerStyle: { backgroundColor: c.background }, headerTintColor: c.accent,
      headerTitleStyle: { color: c.text }, headerLargeTitleStyle: { color: c.text },
      contentStyle: { backgroundColor: c.background },
      headerRight: () => <BrowseHeader add={add} />,
    }} />
  </NativeHeader.Provider>;
}

export function BrowseHeader({ add = false, onMenu, menuItems = [] }: { add?: boolean; onMenu?(): void; menuItems?: HeaderMenuItem[] }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
    {onMenu && <HeaderMenu items={menuItems} onFallback={onMenu} />}
    {add && <IconButton icon="add" label="Add a workout or plan" variant="plain" onPress={() => router.push("/add")} />}
    <AccountButton />
  </View>;
}
