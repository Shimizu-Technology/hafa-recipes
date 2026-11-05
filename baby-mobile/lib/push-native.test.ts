import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("react-native", () => ({ Platform: { OS: "ios", Version: "18.5" } }));
vi.mock("expo-constants", () => ({ default: { expoConfig: {} } }));
vi.mock("expo-notifications", () => ({
  setAutoServerRegistrationEnabledAsync: vi.fn(async (enabled: boolean) => { native.calls.push(`auto:${enabled}`); }),
  unregisterForNotificationsAsync: vi.fn(async () => { native.calls.push("unregister"); }),
}));
import { stopPushDelivery } from "./push-native";

beforeEach(() => { native.calls = []; });
it("turns off Expo's auto-registration first, which would otherwise ask iOS for a token again next launch", async () => {
  await stopPushDelivery();
  expect(native.calls).toEqual(["auto:false", "unregister"]);
});
