import { router } from "expo-router";
import { Button, Copy, Screen } from "@/components/ui";
export default function InvalidLink() {
  return (
    <Screen title="This link could not be opened." subtitle="Your saved data is unchanged.">
      <Copy>
        The link is incomplete, malformed or does not point to a supported Håfa Workouts destination. Open the app or
        ask the sender for a fresh share link.
      </Copy>
      <Button title="Open Håfa Workouts" onPress={() => router.replace("/")} />
    </Screen>
  );
}
