import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { createPushDevice, type PushDeviceEnvironment } from "./push-device";

const fixture = (overrides: Partial<PushDeviceEnvironment> = {}) => {
  const store = { value: null as string | null, revocation: null as string | null };
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
    readRevocation: vi.fn(async () => store.revocation),
    writeRevocation: vi.fn(async (value: string | null) => { store.revocation = value; }),
    binding: "account-a",
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
  const pending = (store: { revocation: string | null }) => JSON.parse(store.revocation!);
  it("sends back the registration it holds and forgets it", async () => {
    const { env, device, store } = holding();
    await device.end();
    expect(env.remove).toHaveBeenCalledWith("install-1", "111");
    expect(env.stopDelivery).not.toHaveBeenCalled();
    expect(store.value).toBeNull();
    expect(store.revocation).toBeNull();
  });
  it("makes no call when this phone never registered, as with the flag off", async () => {
    const { env, device } = fixture();
    await device.end();
    expect(env.remove).not.toHaveBeenCalled();
    expect(env.stopDelivery).not.toHaveBeenCalled();
  });
  it("offline, it doesn't wait: the phone stops taking pushes, and remembers what's left to revoke", async () => {
    const { env, device, store } = holding({ online: () => false });
    await device.end();
    expect(env.remove).not.toHaveBeenCalled();
    expect(env.stopDelivery).toHaveBeenCalled();
    expect(store.value).toBeNull();
    expect(pending(store)).toEqual({ installation: "install-1", registration: "111", binding: "account-a" });
  });
  it.each([[new ApiError("offline", 0)], [new ApiError("broken", 503)], [new ApiError("gone", 401)], [new ApiError("flag off", 404)]])(
    "only a confirmed removal counts: %s stops delivery on the phone and keeps it pending", async (failure) => {
      const { env, device, store } = holding({ remove: vi.fn(async () => { throw failure; }) });
      await device.end();
      expect(env.stopDelivery).toHaveBeenCalled();
      expect(store.value).toBeNull();
      expect(pending(store).registration).toBe("111");
    });
  it("a request that hangs can't hold up signing out", async () => {
    vi.useFakeTimers();
    try {
      const { env, device, store } = holding({ remove: vi.fn(() => new Promise<void>(() => {})) });
      const ending = device.end(5000);
      await vi.advanceTimersByTimeAsync(5001);
      await ending;
      expect(env.stopDelivery).toHaveBeenCalled();
      expect(pending(store).registration).toBe("111");
    } finally { vi.useRealTimers(); }
  });
  it("nothing it does can fail signing out", async () => {
    const { device } = holding({ stopDelivery: vi.fn(async () => { throw Error("native"); }), erase: vi.fn(async () => { throw Error("keychain"); }), writeRevocation: vi.fn(async () => { throw Error("keychain"); }), remove: vi.fn(async () => { throw new ApiError("x", 0); }) });
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

describe("a registration under way when sign-out starts", () => {
  const blocked = (overrides: Partial<PushDeviceEnvironment> = {}) => {
    let finish!: (value: { registration: string }) => void, fail!: (error: unknown) => void;
    const made = fixture({ put: vi.fn(() => new Promise<{ registration: string }>((resolve, reject) => { finish = resolve; fail = reject; })), ...overrides });
    return { ...made, finish: (registration: string) => finish({ registration }), fail: (error: unknown) => fail(error) };
  };
  const started = async (device: { ensure(generation: number): Promise<boolean> }, env: PushDeviceEnvironment) => {
    const work = device.ensure(1);
    await vi.waitFor(() => expect(env.put).toHaveBeenCalled());
    return work;
  };
  it("sign-out waits for it, and revokes what it got", async () => {
    const { env, device, store, finish } = blocked();
    const work = started(device, env);
    await vi.waitFor(() => expect(env.put).toHaveBeenCalled());
    const ending = device.end();
    finish("222");
    await work;
    await ending;
    expect(env.remove).toHaveBeenCalledWith("install-1", "222");
    expect(store.value).toBeNull();
  });
  it("a new registration can't start while sign-out runs", async () => {
    const { env, device, store } = fixture({ remove: vi.fn(() => new Promise<void>(() => {})) });
    store.value = JSON.stringify({ installation: "install-1", registration: "111", token: "t" });
    vi.useFakeTimers();
    try {
      const ending = device.end(5000);
      await vi.advanceTimersByTimeAsync(10);
      await expect(device.ensure(1)).resolves.toBe(false);
      expect(env.put).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5001);
      await ending;
    } finally { vi.useRealTimers(); }
  });
  it("one that outlasts sign-out's limit: the phone stops, and when it lands it's revoked, not kept", async () => {
    vi.useFakeTimers();
    try {
      const { env, device, store, finish } = blocked();
      const work = device.ensure(1);
      await vi.advanceTimersByTimeAsync(10);
      const ending = device.end(1000);
      await vi.advanceTimersByTimeAsync(1001);
      await ending;
      expect(env.stopDelivery).toHaveBeenCalled();
      finish("333");
      await vi.advanceTimersByTimeAsync(10);
      await work;
      expect(env.remove).toHaveBeenCalledWith("install-1", "333");
      expect(store.value).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("one that lands late and can't be revoked is left pending, not held", async () => {
    vi.useFakeTimers();
    try {
      const { device, store, finish } = blocked({ remove: vi.fn(async () => { throw new ApiError("offline", 0); }) });
      const work = device.ensure(1);
      await vi.advanceTimersByTimeAsync(10);
      const ending = device.end(1000);
      await vi.advanceTimersByTimeAsync(1001);
      await ending;
      finish("444");
      await vi.advanceTimersByTimeAsync(10);
      await work;
      expect(store.value).toBeNull();
      expect(JSON.parse(store.revocation!).registration).toBe("444");
    } finally { vi.useRealTimers(); }
  });
  it("one that fails while sign-out waits ends quietly", async () => {
    const { env, device, store, fail } = blocked();
    const work = started(device, env);
    await vi.waitFor(() => expect(env.put).toHaveBeenCalled());
    const ending = device.end();
    fail(new ApiError("offline", 0));
    await work;
    await ending;
    expect(store.value).toBeNull();
  });
});

describe("a revocation left over from an earlier sign-out", () => {
  const left = (binding = "account-a") => JSON.stringify({ installation: "install-1", registration: "old", binding });
  it("a new registration settles it: the token is one row, and it just moved", async () => {
    const { env, device, store } = fixture();
    store.revocation = left("account-b");
    await device.ensure(1);
    expect(env.put).toHaveBeenCalledOnce();
    expect(store.revocation).toBeNull();
  });
  it("same account, no permission now: it's sent again, and goes once confirmed", async () => {
    const { env, device, store } = fixture({ granted: vi.fn(async () => false) });
    store.revocation = left();
    await device.ensure(1);
    expect(env.remove).toHaveBeenCalledWith("install-1", "old");
    expect(store.revocation).toBeNull();
    expect(env.put).not.toHaveBeenCalled();
  });
  it("same account, still can't be confirmed: it stays", async () => {
    const { device, store } = fixture({ granted: vi.fn(async () => false), remove: vi.fn(async () => { throw new ApiError("offline", 0); }) });
    store.revocation = left();
    await device.ensure(1);
    expect(store.revocation).toBe(left());
  });
  it("another account can't confirm it, because a removal only answers for its own phones", async () => {
    const { env, device, store } = fixture({ granted: vi.fn(async () => false) });
    store.revocation = left("account-b");
    await device.ensure(1);
    expect(env.remove).not.toHaveBeenCalled();
    expect(store.revocation).toBe(left("account-b"));
  });
  it("a failed registration leaves it in place", async () => {
    const { device, store } = fixture({ put: vi.fn(async () => { throw new ApiError("offline", 0); }) });
    store.revocation = left();
    await device.ensure(1);
    expect(store.revocation).toBe(left());
  });
  it("signing out again replaces it with the newest", async () => {
    const { device, store } = fixture({ online: () => false });
    store.revocation = left();
    store.value = JSON.stringify({ installation: "install-1", registration: "new", token: "t" });
    await device.end();
    expect(JSON.parse(store.revocation!).registration).toBe("new");
  });
});

describe("sign-out's one deadline", () => {
  const holding = (overrides: Partial<PushDeviceEnvironment> = {}) => {
    const made = fixture(overrides);
    made.store.value = JSON.stringify({ installation: "install-1", registration: "111", token: "t" });
    return made;
  };
  const never = () => new Promise<never>(() => {});
  /** How long end() takes, on fake timers. */
  async function timed(device: ReturnType<typeof fixture>["device"], limit = 5000) {
    let finished = -1, clock = 0;
    const ending = device.end(limit).then(() => { finished = clock; });
    for (; clock <= limit * 2 && finished < 0; clock += 100) await vi.advanceTimersByTimeAsync(100);
    await ending;
    return finished;
  }
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it("a registration under way and a hung removal share it, with nothing added on top", async () => {
    const { device, store } = fixture({ put: vi.fn(never), remove: vi.fn(never) });
    store.value = JSON.stringify({ installation: "install-1", registration: "111", token: "t" });
    void device.ensure(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(await timed(device)).toBeLessThanOrEqual(5000);
  });
  it("a native unregister that stalls can't hold it past the deadline, as Android's token delete can with no network", async () => {
    const { device } = holding({ online: () => false, stopDelivery: vi.fn(never) });
    expect(await timed(device)).toBeLessThanOrEqual(5000);
  });
  it("a hung removal and a stalled unregister together still finish in time", async () => {
    const { device, env } = holding({ remove: vi.fn(never), stopDelivery: vi.fn(never) });
    expect(await timed(device)).toBeLessThanOrEqual(5000);
    expect(env.stopDelivery).toHaveBeenCalled();
  });
  it("the revocation is saved before native cleanup starts, so a stall can't lose it", async () => {
    let savedWhenStopped: string | null = "not called";
    const made = holding({ online: () => false, stopDelivery: vi.fn(async () => { savedWhenStopped = made.store.revocation; return never(); }) });
    await timed(made.device);
    expect(JSON.parse(savedWhenStopped!).registration).toBe("111");
  });
  it("the held registration is forgotten before native cleanup too", async () => {
    let heldWhenStopped: string | null = "not called";
    const made = holding({ online: () => false, stopDelivery: vi.fn(async () => { heldWhenStopped = made.store.value; return never(); }) });
    await timed(made.device);
    expect(heldWhenStopped).toBeNull();
  });
  it("a hung removal leaves time to save the revocation inside the deadline", async () => {
    let at = -1, clock = 0;
    const made = holding({ remove: vi.fn(never), writeRevocation: vi.fn(async (value: string | null) => { made.store.revocation = value; at = clock; }) });
    const ending = made.device.end(5000);
    for (; clock <= 5000; clock += 100) await vi.advanceTimersByTimeAsync(100);
    await ending;
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(5000);
    expect(JSON.parse(made.store.revocation!).registration).toBe("111");
  });
  it("a keychain that stalls can't hold it either", async () => {
    const { device } = holding({ read: vi.fn(never) });
    expect(await timed(device)).toBeLessThanOrEqual(5000);
  });
  it("a keychain that fails still stops delivery, since it can't say this phone isn't registered", async () => {
    const { device, env } = holding({ read: vi.fn(async () => { throw Error("keychain"); }) });
    await timed(device);
    expect(env.stopDelivery).toHaveBeenCalled();
  });
  it("after a stall, this phone doesn't register until the native stop is done, which then can't undo it", async () => {
    let release = () => {};
    const { device, env } = holding({ online: () => false, stopDelivery: vi.fn(() => new Promise<void>((resolve) => { release = resolve; })) });
    await timed(device);
    env.online = () => true;
    await expect(device.ensure(1)).resolves.toBe(false);
    expect(env.put).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(0);
    await expect(device.ensure(1)).resolves.toBe(true);
    expect(env.put).toHaveBeenCalled();
  });
  it("a second sign-out while one is stalled doesn't start another or wait any longer", async () => {
    const { device, env } = holding({ online: () => false, stopDelivery: vi.fn(never) });
    await timed(device);
    expect(await timed(device)).toBeLessThanOrEqual(5000);
    expect(env.stopDelivery).toHaveBeenCalledTimes(1);
  });
  it("a registration still under way stops delivery even when the older one's removal is confirmed", async () => {
    const { device, env } = holding({ put: vi.fn(never) });
    void device.ensure(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(await timed(device)).toBeLessThanOrEqual(5000);
    expect(env.remove).toHaveBeenCalled();
    expect(env.stopDelivery).toHaveBeenCalled();
  });
  it("a confirmed removal touches nothing native", async () => {
    const { device, env, store } = holding();
    expect(await timed(device)).toBeLessThan(5000);
    expect(env.stopDelivery).not.toHaveBeenCalled();
    expect(store.revocation).toBeNull();
    expect(store.value).toBeNull();
  });
});
