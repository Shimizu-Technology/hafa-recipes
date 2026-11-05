import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ calls: [] as string[], publicFails: true, unregisterFails: false }));
vi.mock("react-native", () => ({ Platform: { OS: "ios", Version: "18.5" } }));
vi.mock("expo-constants", () => ({ default: { expoConfig: {} } }));
vi.mock("expo-notifications", () => ({
  setAutoServerRegistrationEnabledAsync: vi.fn(async (enabled: boolean) => {
    native.calls.push(`public:${enabled}`);
    if (native.publicFails) throw Error("Argument at index 0 cannot be null"); // What iOS does with it in SDK 57.
  }),
  unregisterForNotificationsAsync: vi.fn(async () => {
    native.calls.push("unregister");
    if (native.unregisterFails) throw Error("native");
  }),
}));
vi.mock("expo-notifications/build/ServerRegistrationModule", () => ({
  default: { setRegistrationInfoAsync: vi.fn(async (info: string) => { native.calls.push(`info:${info}`); }) },
}));
import { stopPushDelivery } from "./push-native";

beforeEach(() => { native.calls = []; native.publicFails = true; native.unregisterFails = false; });

it("iOS's native setter takes only a string, which is why the public off switch can't be trusted", () => {
  const swift = readFileSync(new URL("../node_modules/expo-notifications/ios/ExpoNotifications/ServerRegistration/ServerRegistrationModule.swift", import.meta.url), "utf8");
  expect(swift).toContain('AsyncFunction("setRegistrationInfoAsync") { (registrationInfo: String) in');
});
it("turns off Expo's auto-registration even when the public switch fails, then stops delivery", async () => {
  await stopPushDelivery();
  expect(native.calls).toEqual(["public:false", 'info:{"isEnabled":false}', "unregister"]);
});
it("what it writes is what Expo reads as off", async () => {
  await stopPushDelivery();
  expect(JSON.parse(native.calls[1].slice(5)).isEnabled).toBe(false);
});
it("delivery stops even if the setting can't be written", async () => {
  const module = (await import("expo-notifications/build/ServerRegistrationModule")).default;
  vi.mocked(module.setRegistrationInfoAsync!).mockRejectedValueOnce(Error("keychain"));
  await stopPushDelivery();
  expect(native.calls.at(-1)).toBe("unregister");
});
