import { Stack, router, type Href } from "expo-router";
import { Icon, NativeHeaderContext, PressTarget, fonts, useColors } from "./ui";
import { Platform, View } from "react-native";

export function TabStack({ title, add }: { title: string; add?: Href }) {
  const c = useColors();
  return <NativeHeaderContext.Provider value={true}>
    <Stack screenOptions={{
      title, headerLargeTitle: true, headerShadowVisible: false,
      headerStyle: { backgroundColor: c.background }, headerTintColor: c.action,
      headerTitleStyle: { color: c.text },
      // Native stack titles use UIKit font names; RN text uses the ui-rounded alias.
      headerLargeTitleStyle: { color: c.text, fontFamily: title === "Today" && Platform.OS === "ios" ? ".SFUIRounded-Bold" : fonts.regular,
        fontSize: 34, fontWeight: "700" },
      contentStyle: { backgroundColor: c.background },
      headerRight: () => <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {add && <PressTarget accessibilityRole="button" accessibilityLabel={title === "Saved" ? "Add a source" : title === "Journal" ? "Write a journal entry" : "Add a source, note, or care log"}
          onPress={() => router.push(add)} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
          <Icon name="add" size={22} />
        </PressTarget>}
        <PressTarget accessibilityRole="button" accessibilityLabel="Settings and profiles"
          onPress={() => router.push("/settings")} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
          <Icon name="person-circle-outline" size={30} />
        </PressTarget>
      </View>,
    }} />
  </NativeHeaderContext.Provider>;
}
