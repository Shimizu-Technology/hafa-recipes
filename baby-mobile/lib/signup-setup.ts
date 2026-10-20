import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import type { SecretStorage } from "./vault";

/** Only a completed, explicitly chosen signup may create a shared Håfa owner. */
export function createSignupSetup(storage: SecretStorage, randomHex: () => Promise<string>) {
  const installationKey = "baby.signup.installation.v1";
  function intentKey(session: string, user: string) {
    if (![session, user].every((value) => /^[a-zA-Z0-9_-]{1,100}$/.test(value)))
      throw Error("The new account could not be securely verified.");
    return `baby.signup.intent.${session}.${user}`;
  }
  async function pending(session: string, user: string) {
    return (await storage.getItemAsync(intentKey(session, user))) === "create_account";
  }
  async function begin(session: string, user: string) {
    await storage.setItemAsync(intentKey(session, user), "create_account");
  }
  async function clear(session: string, user: string) {
    await storage.deleteItemAsync(intentKey(session, user));
  }
  async function complete(
    session: string,
    user: string,
    onboard: (installationId: string) => Promise<unknown>,
    current: () => boolean
  ) {
    const guard = () => { if (!current()) throw Error("Your account changed. Account setup was stopped."); };
    guard();
    const requested = await pending(session, user);
    guard();
    if (!requested) return;
    let installation = await storage.getItemAsync(installationKey);
    guard();
    if (!installation) {
      installation = "cmi_" + await randomHex();
      guard();
      if (!/^cmi_[a-f0-9]{64}$/.test(installation)) throw Error("Account setup could not be securely prepared.");
      await storage.setItemAsync(installationKey, installation);
      guard();
    }
    if (!/^cmi_[a-f0-9]{64}$/.test(installation)) throw Error("Account setup could not be securely prepared.");
    const result = await onboard(installation);
    guard();
    if (!result || typeof result !== "object" || !("status" in result) ||
      !["created", "existing"].includes(String(result.status)) || !("app_user_id" in result) ||
      typeof result.app_user_id !== "string" || !result.app_user_id.trim())
      throw Error("Account setup could not be verified. Please try again.");
    await clear(session, user);
    guard();
  }
  return { begin, pending, complete, clear };
}
const memory = new Map<string, string>();
const storage: SecretStorage = Platform.OS === "web" ? {
  getItemAsync: async (key) => memory.get(key) ?? null,
  setItemAsync: async (key, value) => { memory.set(key, value); },
  deleteItemAsync: async (key) => { memory.delete(key); },
} : {
  getItemAsync: SecureStore.getItemAsync,
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value,
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  deleteItemAsync: SecureStore.deleteItemAsync,
};
export const signupSetup = createSignupSetup(storage, async () =>
  Array.from(await Crypto.getRandomBytesAsync(32), (byte) => byte.toString(16).padStart(2, "0")).join(""));
