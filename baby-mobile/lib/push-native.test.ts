import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ calls: [] as string[], publicFails: true, unregisterFails: false, unregister: null as null | (() => Promise<void>) }));
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
    await native.unregister?.();
  }),
  getPermissionsAsync: vi.fn(async () => ({ granted: true })),
  getExpoPushTokenAsync: vi.fn(async () => ({ data: "ExponentPushToken[one]" })),
}));
vi.mock("expo-notifications/build/ServerRegistrationModule", () => ({
  default: { setRegistrationInfoAsync: vi.fn(async (info: string) => { native.calls.push(`info:${info}`); }) },
}));
import * as Notifications from "expo-notifications";
import { nativePushDevice, stopPushDelivery } from "./push-native";

beforeEach(() => { native.calls = []; native.publicFails = true; native.unregisterFails = false; native.unregister = null; vi.clearAllMocks(); });

it("iOS's native setter takes only a string, which is why the public off switch can't be trusted", () => {
  const swift = readFileSync(new URL("../node_modules/expo-notifications/ios/ExpoNotifications/ServerRegistration/ServerRegistrationModule.swift", import.meta.url), "utf8");
  expect(swift).toContain('AsyncFunction("setRegistrationInfoAsync") { (registrationInfo: String) in');
});
it("turns off Expo's auto-registration even when the public switch fails, then stops delivery", async () => {
  await stopPushDelivery();
  expect(native.calls).toEqual(["public:false", 'info:{"isEnabled":false}', "unregister"]);
});
describe("Expo's own persisted-state reader, on the next launch", () => {
  /** Expo's shipped file, with its imports swapped for fakes. It reads the saved state as it loads. */
  async function launchWith(saved: string) {
    const path = fileURLToPath(new URL("../node_modules/expo-notifications/build/DevicePushTokenAutoRegistration.fx.js", import.meta.url));
    const source = readFileSync(path, "utf8").replace(/^import .*$/gm, "").replace(/^export /gm, "");
    expect(source).toContain("__handlePersistedRegistrationInfoAsync");
    const fetched = vi.fn(async () => ({ type: "ios", data: "device-token" }));
    const updated = vi.fn(async () => undefined);
    const module = { getRegistrationInfoAsync: vi.fn(async () => saved), setRegistrationInfoAsync: vi.fn(async () => undefined) };
    const load = new Function(
      "isRunningInExpoGo", "Platform", "UnavailabilityError", "ServerRegistrationModule", "addPushTokenListener",
      "getDevicePushTokenAsync", "updateDevicePushTokenAsyncWithSignal", "hasDeviceTokenChangedAsync", "console",
      source + "\nreturn __handlePersistedRegistrationInfoAsync;"
    );
    const handle = load(
      () => false, { OS: "ios" }, Error, module, () => undefined,
      fetched, updated, async () => true, { warn: () => undefined }
    );
    await vi.waitFor(() => expect(module.getRegistrationInfoAsync).toHaveBeenCalled());
    await handle(saved);
    await new Promise((resolve) => setTimeout(resolve));
    return { fetched, updated };
  }
  it("the value this writes means no token is fetched and nothing is updated", async () => {
    await stopPushDelivery();
    const saved = native.calls.find((call) => call.startsWith("info:"))!.slice(5);
    const { fetched, updated } = await launchWith(saved);
    expect(fetched).not.toHaveBeenCalled();
    expect(updated).not.toHaveBeenCalled();
  });
  it("and the reader really is live: left on, it fetches and updates", async () => {
    const { fetched, updated } = await launchWith(JSON.stringify({ isEnabled: true }));
    expect(fetched).toHaveBeenCalled();
    expect(updated).toHaveBeenCalled();
  });
});
describe("a native stop that stalls", () => {
  const device = (binding: string, store = new Map<string, string>()) => {
    const secret = {
      getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
      setItemAsync: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
      deleteItemAsync: vi.fn(async (key: string) => { store.delete(key); }),
    };
    const api = { registerPushDevice: vi.fn(async () => ({ registration: "1" })), unregisterPushDevice: vi.fn(async () => undefined) };
    return { api, store, device: nativePushDevice(api as never, secret as never, binding, () => false, () => "install") };
  };
  it("holds up a new account's registration on this phone until it's done, so it can't undo it", async () => {
    let release = () => {};
    native.unregister = () => new Promise<void>((resolve) => { release = resolve; });
    void stopPushDelivery();
    await new Promise((resolve) => setTimeout(resolve));
    const next = device("account-b");
    await expect(next.device.ensure(1)).resolves.toBe(false);
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    release();
    await new Promise((resolve) => setTimeout(resolve));
    await expect(next.device.ensure(1)).resolves.toBe(true);
    expect(next.api.registerPushDevice).toHaveBeenCalled();
  });
  it("two stops share one native call", async () => {
    let release = () => {};
    native.unregister = () => new Promise<void>((resolve) => { release = resolve; });
    const stops = [stopPushDelivery(), stopPushDelivery()];
    await new Promise((resolve) => setTimeout(resolve));
    expect(native.calls.filter((call) => call === "unregister")).toHaveLength(1);
    release();
    await Promise.all(stops);
  });
});
it("delivery stops even if the setting can't be written", async () => {
  const module = (await import("expo-notifications/build/ServerRegistrationModule")).default;
  vi.mocked(module.setRegistrationInfoAsync!).mockRejectedValueOnce(Error("keychain"));
  await stopPushDelivery();
  expect(native.calls.at(-1)).toBe("unregister");
});
