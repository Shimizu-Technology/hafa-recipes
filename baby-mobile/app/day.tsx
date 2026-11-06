import { router, useLocalSearchParams } from "expo-router";
import { Button, Notice, Screen } from "@/components/ui";
import { useBaby } from "@/lib/context";
import { TrackerContent } from "./(tabs)/tracker";
/**
 * Tracker opened on a day and a baby from an entry: on top of it, so Back returns there and the Tracker tab stays as she left it.
 * A link can outlive its baby, who may have been removed or left with a family. It never quietly becomes another baby's day.
 */
export default function Day() {
  const b = useBaby(), { child } = useLocalSearchParams<{ child?: string }>();
  if (child && !b.state.bootstrap!.children.some((known) => known.id === child)) return <Screen title="Tracker" back>
    <Notice>That baby’s profile isn’t on this account now, so this day can’t be shown. Nothing has changed.</Notice>
    <Button secondary title="Open Tracker" onPress={() => router.replace("/(tabs)/tracker")} />
  </Screen>;
  return <TrackerContent pushed />;
}
