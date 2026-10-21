import { router } from "expo-router";
import { Row, Screen } from "@/components/ui";
export default function More() {
  return <Screen title="More">
    <Row title="Lists & routines" detail="Checklists, chosen plans and reminders" icon="checkmark-circle-outline"
      onPress={() => router.push("/(tabs)/routines")} />
    <Row title="Ask" detail="Find a detail in your saved posts and notes" icon="chatbubble-outline"
      onPress={() => router.push("/(tabs)/ask")} />
    <Row title="Doctor questions" detail="Keep questions for your next visit" icon="document-text-outline"
      onPress={() => router.push({ pathname: "/(tabs)/journal", params: { filter: "question" } })} />
    <Row title="Care history" detail="Feeding, sleep and diaper logs" icon="time-outline"
      onPress={() => router.push({ pathname: "/(tabs)/journal", params: { filter: "care" } })} />
    <Row title="Profiles & settings" detail="Your details, permissions and private data" icon="person-circle-outline"
      onPress={() => router.push("/settings")} />
  </Screen>;
}
