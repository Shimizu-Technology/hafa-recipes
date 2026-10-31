import { useRef } from "react";
import { ScrollView, Platform } from "react-native";
import { router, type Href } from "expo-router";
import { Copy, IconButton, ListGroup, ListRow, Row, useColors } from "@/components/ui";
export default function Add() {
  const c = useColors();
  const choosing = useRef(false);
  function open(href: Href) {
    if (choosing.current) return;
    choosing.current = true;
    if (Platform.OS === "web" || !router.canGoBack()) { router.replace(href); return; }
    // Commit the dismissal before mounting a full-screen flow. A replace reuses
    // the native form sheet's measured height on iOS.
    router.back();
    requestAnimationFrame(() => router.push(href));
  }
  return <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.groupedBackground }} contentContainerStyle={{ padding: 16, gap: 24 }}>
    {Platform.OS === "android" && <Row justify="space-between"><Copy kind="heading">Add a workout</Copy><IconButton icon="close" label="Close Add" variant="plain" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/train")} /></Row>}
    <ListGroup grouped>
      <ListRow icon="link-outline" title="Paste a link" onPress={() => open("/extract")} />
      <ListRow icon="camera-outline" title="Record/upload" detail="Photos, screenshots, documents or text" onPress={() => open("/capture")} />
      <ListRow icon="barbell-outline" title="Build a workout" onPress={() => open("/add-workout")} />
      <ListRow icon="download-outline" title="Import a plan" detail="Paste a program link or upload its instructions" onPress={() => open("/extract")} />
      <ListRow icon="calendar-outline" title="Build a plan" onPress={() => open("/build-plan")} />
    </ListGroup>
    <Copy kind="caption" tone="muted">Tip: share straight from Instagram, YouTube or Safari.</Copy>
  </ScrollView>;
}
