import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { createPushDevice, type PushDeviceEnvironment } from "./push-device";

const fixture = (overrides: Partial<PushDeviceEnvironment> = {}) => {
  const store = { value: null as string | null };
  const env: PushDeviceEnvironment = {
    platform: "ios",
    online: () => true,
    granted: vi.fn(async () => true),
    token: vi.fn(async () => "ExponentPushToken[one]"),
    installation: vi.fn(async () => "install-1"),
    read: vi.fn(async () => store.value),
    write: vi.fn(async (value: string) => { store.value = value; }),
    erase: vi.fn(async () => { store.value = null; }),
    put: vi.fn(async () => ({ registration: "111" })),
    remove: vi.fn(async () => undefined),
    stopDelivery: vi.fn(async () => undefined),
    now: () => 0,
    ...overrides,
  };
  return { env, store, device: createPushDevice(env) };
};

describe("registering this phone", () => {
  it("never asks for permission: without it, there's no token and no call", async () => {
    const { env, device } = fixture({ granted: vi.fn(async () => false) });
    await device.ensure(1);
    expect(env.token).not.toHaveBeenCalled();
    expect(env.put).not.toHaveBeenCalled();
  });
  it("registers with the personal generation and keeps the registration it gets back", async () => {
    const { env, device, store } = fixture();
    await device.ensure(7);
    expect(env.put).toHaveBeenCalledWith("install-1", "ExponentPushToken[one]", "ios", 7);
    expect(JSON.parse(store.value!)).toEqual({ installation: "install-1", registration: "111", token: "ExponentPushToken[one]" });
  });
  it("doesn't ask again for the same token and generation, only when one changes", async () => {
    let token = "ExponentPushToken[one]";
    const { env, device } = fixture({ token: vi.fn(async () => token) });
    await device.ensure(7);
    await device.ensure(7);
    expect(env.put).toHaveBeenCalledTimes(1);
    token = "ExponentPushToken[two]";
    await device.ensure(7);
    expect(env.put).toHaveBeenCalledTimes(2);
    await device.ensure(8);
    expect(env.put).toHaveBeenCalledTimes(3);
  });
  it.each([[new ApiError("off", 404)], [new ApiError("offline", 0)], [new ApiError("busy", 429)], [Error("no token here")]])(
    "a failure stays quiet and leaves what it held: %s", async (failure) => {
      const { device, store } = fixture({ put: vi.fn(async () => { throw failure; }) });
      store.value = JSON.stringify({ installation: "install-1", registration: "older", token: "t" });
      await expect(device.ensure(1)).resolves.toBe(false);
      expect(JSON.parse(store.value!).registration).toBe("older");
    });
  it("waits a while after a failure instead of asking every pass, and a new token doesn't wait", async () => {
    let at = 0, token = "ExponentPushToken[one]";
    const { env, device } = fixture({ now: () => at, token: vi.fn(async () => token), put: vi.fn(async () => { throw new ApiError("busy", 500); }) });
    await device.ensure(1);
    at = 60_000;
    await device.ensure(1);
    expect(env.put).toHaveBeenCalledTimes(1);
    at = 6 * 60_000;
    await device.ensure(1);
    expect(env.put).toHaveBeenCalledTimes(2);
    token = "ExponentPushToken[two]";
    await device.ensure(1);
    expect(env.put).toHaveBeenCalledTimes(3);
  });
  it("two passes at once ask once", async () => {
    const { env, device } = fixture();
    await Promise.all([device.ensure(1), device.ensure(1)]);
    expect(env.put).toHaveBeenCalledTimes(1);
  });
  it("a new sign-in's registration replaces the last, and a late sign-out names only what it held", async () => {
    let registration = "111";
    const { env, device } = fixture({ put: vi.fn(async () => ({ registration })) });
    await device.ensure(1);
    registration = "222";
    await device.ensure(2);
    await device.end();
    expect(env.remove).toHaveBeenCalledWith("install-1", "222");
  });
});

describe("signing out", () => {
  const holding = (overrides: Partial<PushDeviceEnvironment> = {}) => {
    const made = fixture(overrides);
    made.store.value = JSON.stringify({ installation: "install-1", registration: "111", token: "t" });
    return made;
  };
  it("sends back the registration it holds and forgets it", async () => {
    const { env, device, store } = holding();
    await device.end();
    expect(env.remove).toHaveBeenCalledWith("install-1", "111");
    expect(env.stopDelivery).not.toHaveBeenCalled();
    expect(store.value).toBeNull();
  });
  it("makes no call when this phone never registered, as with the flag off", async () => {
    const { env, device } = fixture();
    await device.end();
    expect(env.remove).not.toHaveBeenCalled();
    expect(env.stopDelivery).not.toHaveBeenCalled();
  });
  it("offline, it doesn't wait: the phone stops taking pushes itself, and it forgets", async () => {
    const { env, device, store } = holding({ online: () => false });
    await device.end();
    expect(env.remove).not.toHaveBeenCalled();
    expect(env.stopDelivery).toHaveBeenCalled();
    expect(store.value).toBeNull();
  });
  it.each([[new ApiError("offline", 0)], [new ApiError("broken", 503)]])("a request that didn't land stops delivery on the phone: %s", async (failure) => {
    const { env, device, store } = holding({ remove: vi.fn(async () => { throw failure; }) });
    await device.end();
    expect(env.stopDelivery).toHaveBeenCalled();
    expect(store.value).toBeNull();
  });
  it.each([[new ApiError("off", 404)], [new ApiError("gone", 401)]])("an answer means the API has nothing more for this phone: %s", async (failure) => {
    const { env, device } = holding({ remove: vi.fn(async () => { throw failure; }) });
    await device.end();
    expect(env.stopDelivery).not.toHaveBeenCalled();
  });
  it("a request that hangs can't hold up signing out", async () => {
    vi.useFakeTimers();
    try {
      const { env, device } = holding({ remove: vi.fn(() => new Promise<void>(() => {})) });
      const ending = device.end(5000);
      await vi.advanceTimersByTimeAsync(5001);
      await ending;
      expect(env.stopDelivery).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("nothing it does can fail signing out", async () => {
    const { device } = holding({ stopDelivery: vi.fn(async () => { throw Error("native"); }), erase: vi.fn(async () => { throw Error("keychain"); }), remove: vi.fn(async () => { throw new ApiError("x", 0); }) });
    await expect(device.end()).resolves.toBeUndefined();
  });
  it("after signing out, the next sign-in registers again", async () => {
    const { env, device } = fixture();
    await device.ensure(1);
    await device.end();
    await device.ensure(1);
    expect(env.put).toHaveBeenCalledTimes(2);
  });
});
