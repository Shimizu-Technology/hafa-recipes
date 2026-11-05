import { useState } from "react";
import { View } from "react-native";
import { Button, Card, Copy, PressTarget, useToast } from "./ui";
import { useBaby } from "@/lib/context";
import { messageFor, type DueReminder } from "@/lib/models";
import { reminderDestination } from "@/lib/notification-route";
import { dismissReminder, shownDue } from "@/lib/reminder-due";
import { openPlace, placeReminder } from "@/lib/reminder-open";
import { usePathname } from "expo-router";

const shownAtOnce = 3;

/** Push is never the only record of a reminder: what's due is here until it's dismissed or its reason goes. */
export function DueReminders() {
  const b = useBaby(), toast = useToast(), pathname = usePathname(), [all, setAll] = useState(false);
  const items = shownDue(b.state), shown = all ? items : items.slice(0, shownAtOnce);
  if (!items.length) return null;
  async function open(item: DueReminder) {
    const place = reminderDestination(item);
    if (!place || !(await placeReminder(() => b, item, place))) return toast("That reminder isn’t here any more.");
    openPlace(place, pathname);
  }
  return <View accessibilityLabel="Reminders" style={{ gap: 8 }}>
    {shown.map((item) => <Card key={item.id} tone="soft" style={{ gap: 4 }}>
      <PressTarget accessibilityRole="button" accessibilityLabel={item.text} accessibilityHint="Opens it" onPress={() => void open(item).catch((e) => toast(messageFor(e)))} style={{ minHeight: 44, justifyContent: "center" }}>
        <Copy kind="label">{item.text}</Copy>
      </PressTarget>
      <Button variant="ghost" title="Dismiss" accessibilityLabel={`Dismiss: ${item.text}`} onPress={() => void dismissReminder(b, item.id).catch((e) => toast(messageFor(e)))} />
    </Card>)}
    {items.length > shownAtOnce && <PressTarget accessibilityRole="button" onPress={() => setAll(!all)} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 4 }}>
      <Copy kind="small" tone="muted" numeric>{all ? "Show fewer reminders" : `${items.length - shownAtOnce} more reminder${items.length - shownAtOnce === 1 ? "" : "s"}`}</Copy>
    </PressTarget>}
  </View>;
}
