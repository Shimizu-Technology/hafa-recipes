import { useEffect } from "react";
import { View } from "react-native";
import { useSegments } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { AppTabBar } from "@/components/design/tab-bar";
import { AskCoachPill } from "@/components/ask-coach-pill";
import { useColors } from "@/components/ui";
import { resetAskScroll } from "@/lib/ask-pill";
import { OVERLAY_GAP, useTabScreenBottomInset } from "@/lib/bottom-overlay";

export const unstable_settings = { initialRouteName: "train" };
/** Tabs where the floating Ask Coach pill opens a general coach chat. */
export const askTabs = ["train", "library", "discover", "progress"];
/**
 * JS tabs with our own solid bar so iOS 18, iOS 26 and Android match (no Liquid Glass or
 * translucent material). Search lives in Library and Discover; its old route stays for links.
 */
export default function Layout() {
  const c = useColors();
  const route = useSegments()[1] ?? "train";
  const bar = useTabScreenBottomInset();
  useEffect(() => { resetAskScroll(); }, [route]);
  return <View style={{ flex: 1, backgroundColor: c.background }}>
    <Tabs tabBar={props => <AppTabBar {...props} />}
      screenOptions={{ headerShown: false, animation: "none", sceneStyle: { backgroundColor: c.background } }}>
      <Tabs.Screen name="train" />
      <Tabs.Screen name="library" />
      <Tabs.Screen name="discover" />
      <Tabs.Screen name="progress" />
      <Tabs.Screen name="search" options={{ href: null }} />
    </Tabs>
    {bar > 0 && askTabs.includes(route) && <AskCoachPill bottom={bar + OVERLAY_GAP} />}
  </View>;
}
