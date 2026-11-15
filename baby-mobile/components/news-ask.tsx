import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { useBaby } from "@/lib/context";
import { newsAskFor } from "../lib/news-ask";
import { requestReminders } from "../lib/reminders";
import { Button, Card, Copy, useToast } from "./ui";

/**
 * On her partner's Today before the birth: the card is the reason, so "Turn on" goes straight to the phone's own
 * question. Shown until it's answered, once, and only while the phone can still ask.
 */
export function NewsAsk() {
  const b = useBaby(), toast = useToast(), due = newsAskFor(b.state, b.owner), [canAsk, setCanAsk] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!due || Platform.OS === "web") return;
    let alive = true;
    void Notifications.getPermissionsAsync().then((now) => { if (alive) setCanAsk(!now.granted && now.canAskAgain); }).catch(() => undefined);
    return () => { alive = false; };
  }, [!!due]);
  if (!due || !canAsk) return null;
  const answered = () => b.commit((state) => ({ ...state, newsAskSeen: true })).catch(() => undefined);
  async function turnOn() {
    setBusy(true);
    try {
      await requestReminders();
      void b.registerPush();
      toast(`Done. You’ll hear from ${due!.name} the moment there’s news.`);
    } catch {
      toast("Notifications are off. You can turn them on later in Settings, then Reminders.");
    } finally {
      await answered();
      setBusy(false);
    }
  }
  return <Card style={{ gap: 12 }}>
    <Copy kind="label">Know the moment labor starts</Copy>
    <Copy kind="small" tone="muted">{`${due.reason} You can change it later in Settings, then Reminders.`}</Copy>
    <Button title="Turn on notifications" icon="notifications-outline" busy={busy} onPress={() => void turnOn()} />
    <Button variant="ghost" title="Not now" disabled={busy} onPress={() => void answered()} />
  </Card>;
}
