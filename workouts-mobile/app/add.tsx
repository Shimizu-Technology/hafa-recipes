import { ScrollView } from "react-native";
import { router } from "expo-router";
import { Copy, ListGroup, ListRow, useColors } from "@/components/ui";
export default function Add() {
  const c = useColors();
  return <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.groupedBackground }} contentContainerStyle={{ padding: 16, gap: 24 }}>
    <ListGroup>
      <ListRow icon="link-outline" title="Paste a link" onPress={() => router.replace("/extract")} />
      <ListRow icon="camera-outline" title="Record/upload" detail="Photos, screenshots, documents or text" onPress={() => router.replace("/capture")} />
      <ListRow icon="barbell-outline" title="Build a workout" onPress={() => router.replace("/add-workout")} />
      <ListRow icon="download-outline" title="Import a plan" detail="Paste a program link or upload its instructions" onPress={() => router.replace("/extract")} />
      <ListRow icon="calendar-outline" title="Build a plan" onPress={() => router.replace("/build-plan")} />
    </ListGroup>
    <Copy kind="caption" tone="muted">Tip: share straight from Instagram, YouTube or Safari.</Copy>
  </ScrollView>;
}
