import { Platform, Linking } from "react-native";
import type { LocalNotifications, NotificationIntent } from "./reminders";
let activeScope: string | null = null;
export function notificationOwner(scope: string | null) {
  activeScope = scope;
}
const unavailable: LocalNotifications = {
  permission: async () => "unavailable",
  list: async () => [],
  schedule: async () => {
    throw Error("Local alerts need an installed native build. Your in-app timer still works.");
  },
  cancel: async () => {},
  openSettings: () => Linking.openSettings(),
};
export async function nativeNotifications(): Promise<LocalNotifications> {
  if (Platform.OS === "web") return unavailable;
  try {
    const notifications = await import("expo-notifications");
    const channelId = "hafa-workouts-reminders";
    notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const allowed =
          notification.request.content.data?.owner_scope === activeScope &&
          notification.request.identifier.startsWith("hafa-workouts:v1:");
        return { shouldShowBanner: allowed, shouldShowList: allowed, shouldPlaySound: allowed, shouldSetBadge: false };
      },
    });
    return {
      async permission(request) {
        if (Platform.OS === "android")
          await notifications.setNotificationChannelAsync(channelId, {
            name: "Workout reminders",
            importance: notifications.AndroidImportance.DEFAULT,
            // Android's channel default already uses the system sound. SDK57
            // validates explicit strings as bundled custom sound filenames.
          });
        const status = request
          ? await notifications.requestPermissionsAsync({
              ios: { allowAlert: true, allowSound: true, allowBadge: false },
            })
          : await notifications.getPermissionsAsync();
        return status.granted || status.ios?.status === notifications.IosAuthorizationStatus.PROVISIONAL
          ? "granted"
          : status.status === "undetermined"
            ? "unknown"
            : "denied";
      },
      async list() {
        return (await notifications.getAllScheduledNotificationsAsync()).flatMap((item) => {
          const data = item.content.data;
          if (
            !item.identifier.startsWith("hafa-workouts:v1:") ||
            typeof data?.owner_scope !== "string" ||
            typeof data.fingerprint !== "string" ||
            !["rest", "routine"].includes(String(data.kind))
          )
            return [];
          return [{ ...data, id: item.identifier } as unknown as NotificationIntent];
        });
      },
      async schedule(intent) {
        await notifications.scheduleNotificationAsync({
          identifier: intent.id,
          content: {
            title: intent.kind === "rest" ? "Your rest timer finished" : "Time for your Håfa routine",
            body: "Open Håfa Workouts when you are ready.",
            sound: "default",
            data: { ...intent },
          },
          trigger:
            intent.kind === "rest"
              ? { type: notifications.SchedulableTriggerInputTypes.DATE, date: new Date(intent.until!), channelId }
              : {
                  type: notifications.SchedulableTriggerInputTypes.WEEKLY,
                  weekday: intent.weekday!,
                  hour: intent.hour!,
                  minute: intent.minute!,
                  channelId,
                },
        });
      },
      cancel: notifications.cancelScheduledNotificationAsync,
      openSettings: () => Linking.openSettings(),
    };
  } catch {
    return unavailable;
  }
}
export async function observeNotificationResponses(scope: string, onResponse: (intent: NotificationIntent) => void) {
  if (Platform.OS === "web") return () => {};
  try {
    const notifications = await import("expo-notifications");
    const handle = (response: Awaited<ReturnType<typeof notifications.getLastNotificationResponseAsync>>) => {
      const request = response?.notification.request;
      const data = request?.content.data;
      if (
        request?.identifier.startsWith("hafa-workouts:v1:") &&
        data?.owner_scope === scope &&
        activeScope === scope &&
        typeof data.kind === "string"
      ) {
        onResponse({ ...data, id: request.identifier } as unknown as NotificationIntent);
        void notifications.clearLastNotificationResponseAsync();
      }
    };
    handle(await notifications.getLastNotificationResponseAsync());
    const subscription = notifications.addNotificationResponseReceivedListener(handle);
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}
