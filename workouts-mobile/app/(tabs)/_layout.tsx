import { Tabs } from "expo-router/js-tabs";
import { AppTabBar } from "@/components/design/tab-bar";
import { useColors } from "@/components/ui";

export const unstable_settings = { initialRouteName: "train" };
/**
 * JS tabs with our own solid bar so iOS 18, iOS 26 and Android match (no Liquid Glass or
 * translucent material). Search lives in Library and Discover; its old route stays for links.
 */
export default function Layout() {
  const c = useColors();
  return <Tabs tabBar={props => <AppTabBar {...props} />}
    screenOptions={{ headerShown: false, animation: "none", sceneStyle: { backgroundColor: c.background } }}>
    <Tabs.Screen name="train" />
    <Tabs.Screen name="library" />
    <Tabs.Screen name="discover" />
    <Tabs.Screen name="progress" />
    <Tabs.Screen name="search" options={{ href: null }} />
  </Tabs>;
}
