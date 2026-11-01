import { Tabs } from "expo-router";
import { BabyTabBar } from "@/components/tab-bar";
export const unstable_settings = { initialRouteName: "(today)" };
/** Our own bar instead of native tabs, so it looks the same on iOS 18, iOS 26 and Android. */
export default function TabLayout() {
  return <Tabs tabBar={(props) => <BabyTabBar {...props} />} screenOptions={{ headerShown: false }}>
    <Tabs.Screen name="(today)" options={{ title: "Today" }} />
    <Tabs.Screen name="library" options={{ title: "Saved" }} />
    <Tabs.Screen name="journal" options={{ title: "Journal" }} />
    <Tabs.Screen name="ask" options={{ title: "Ask" }} />
  </Tabs>;
}
