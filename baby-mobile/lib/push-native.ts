import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import type { BabyApi } from "./api";
import { createPushDevice } from "./push-device";
import { storageKey, type SecretStorage } from "./vault";

/** One per phone, kept through sign-outs: it's the phone the API is told about, not the person. */
const installationKey = "hb.push.installation";
const revocationKey = "hb.push.revocation";

/**
 * `getExpoPushTokenAsync` turns on Expo's auto-registration, which asks iOS for a token again on every launch and would
 * quietly undo this. So that goes first.
 */
export async function stopPushDelivery() {
  await Notifications.setAutoServerRegistrationEnabledAsync(false);
  await Notifications.unregisterForNotificationsAsync();
}

export const pushAvailable = Platform.OS === "ios" || Platform.OS === "android";

export function nativePushDevice(api: Pick<BabyApi, "registerPushDevice" | "unregisterPushDevice">, secret: SecretStorage, binding: string, online: () => boolean, uuid: () => string) {
  const key = storageKey("push:" + binding);
  return createPushDevice({
    platform: Platform.OS === "android" ? "android" : "ios",
    binding,
    online,
    granted: async () => pushAvailable && (await Notifications.getPermissionsAsync()).granted,
    token: async () => (await Notifications.getExpoPushTokenAsync({ projectId: Constants.expoConfig?.extra?.eas?.projectId })).data,
    installation: async () => {
      const held = await secret.getItemAsync(installationKey);
      if (held) return held;
      const made = uuid();
      await secret.setItemAsync(installationKey, made);
      return made;
    },
    read: () => secret.getItemAsync(key),
    write: (value) => secret.setItemAsync(key, value),
    erase: () => secret.deleteItemAsync(key),
    put: (installation, token, platform, generation) => api.registerPushDevice(installation, token, platform, generation),
    remove: (installation, registration) => api.unregisterPushDevice(installation, registration),
    stopDelivery: stopPushDelivery,
    readRevocation: () => secret.getItemAsync(revocationKey),
    writeRevocation: (value) => (value === null ? secret.deleteItemAsync(revocationKey) : secret.setItemAsync(revocationKey, value)),
    now: () => Date.now(),
  });
}
