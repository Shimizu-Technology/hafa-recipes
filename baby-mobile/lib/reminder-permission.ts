import { Alert, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import type { ReminderKind } from "./models";
import type { PermissionAnswer } from "./reminder-prefs";
import { requestReminders } from "./reminders";

/** The only reason this app ever asks, said before the phone's own question. */
const reasons: Partial<Record<ReminderKind, string>> = {
  feed_interval: "So Håfa Baby can tell you when it’s been the hours you chose since the last feed, even with the app closed.",
  event: "So Håfa Baby can tell you about what’s on your calendar, even with the app closed.",
  running_timer: "So Håfa Baby can tell you when a feed or sleep timer is still running, even with the app closed.",
  pregnancy_week: "So Håfa Baby can tell you when a new week starts, even with the app closed.",
  visit_prep: "So Håfa Baby can tell you the evening before a visit you’ve saved questions for, even with the app closed.",
  import: "So Håfa Baby can tell you when a post you saved has finished, even with the app closed.",
};

export async function askToNotify(kind: ReminderKind): Promise<PermissionAnswer> {
  if (Platform.OS === "web") return "denied";
  const now = await Notifications.getPermissionsAsync();
  if (now.granted) return "granted";
  if (!now.canAskAgain) return "denied";
  const go = await new Promise<boolean>((answer) =>
    Alert.alert("Turn on notifications?", reasons[kind] ?? "So Håfa Baby can remind you, even with the app closed.", [
      { text: "Not now", style: "cancel", onPress: () => answer(false) },
      { text: "Continue", onPress: () => answer(true) },
    ], { cancelable: true, onDismiss: () => answer(false) })
  );
  if (!go) return "later";
  try {
    await requestReminders();
    return "granted";
  } catch {
    return "denied";
  }
}
