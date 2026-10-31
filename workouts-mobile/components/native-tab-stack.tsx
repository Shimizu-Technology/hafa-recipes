import { createContext, useContext } from "react";
import { Stack, router } from "expo-router";
import { View } from "react-native";
import { AccountButton, IconButton } from "./design/controls";
import { useColors } from "./design/foundation";

const NativeHeader = createContext(false);
export const useNativeHeader = () => useContext(NativeHeader);
/** Each tab owns a native stack so iOS can collapse its large title on scroll. */
export function NativeTabStack({ title, add = false }: { title: string; add?: boolean }) {
  const c = useColors();
  return <NativeHeader.Provider value>
    <Stack screenOptions={{ title, headerLargeTitleEnabled: true, headerShadowVisible: false,
      headerStyle: { backgroundColor: c.background }, headerTintColor: c.accent,
      headerTitleStyle: { color: c.text }, headerLargeTitleStyle: { color: c.text },
      contentStyle: { backgroundColor: c.background },
      headerRight: () => <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        {add && <IconButton icon="add" label="Add a workout or plan" variant="plain" onPress={() => router.push("/add")} />}
        <AccountButton />
      </View>,
    }} />
  </NativeHeader.Provider>;
}
