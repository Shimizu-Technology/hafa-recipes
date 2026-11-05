import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as SecureStore from "expo-secure-store";
import type { TokenCache } from "@clerk/expo";

const store = vi.hoisted(() => ({
  items: new Map<string, string>(),
  failNext: 0,
  reads: 0,
  deleted: [] as string[],
  options: [] as unknown[],
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: "after-first-unlock",
  getItemAsync: async (key: string, options: unknown) => {
    store.options.push(options);
    store.reads++;
    if (store.failNext > 0) {
      store.failNext--;
      throw Error("Keychain item unavailable");
    }
    return store.items.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string, options: unknown) => {
    store.options.push(options);
    store.items.set(key, value);
  },
  deleteItemAsync: async (key: string, options: unknown) => {
    store.options.push(options);
    store.deleted.push(key);
    store.items.delete(key);
  },
}));
import { createClerkTokenCache } from "./clerk-token-cache";

const key = "__clerk_client_jwt";
const always = 1000;
const noWait = async () => {};
const cache = () => createClerkTokenCache(noWait);

function run(file: string, modules: Record<string, unknown>, extra = "") {
  const source = readFileSync(new URL(`../node_modules/@clerk/expo/dist/${file}`, import.meta.url), "utf8");
  const exports: any = {};
  new Function("exports", "require", source + extra)(exports, (name: string) => modules[name]);
  return exports;
}
/** The package's own compiled cache, run on this test's fake keychain. Its imports need a real phone. */
const packageCache = (): TokenCache =>
  run("token-cache/index.js", { "../_virtual/_rolldown/runtime.js": { __toESM: (m: unknown) => m }, "../utils": { isNative: () => true }, "expo-secure-store": SecureStore }).tokenCache;

interface Hooks {
  before(request: { url: URL; headers: Headers }): Promise<void>;
  after(_: unknown, response: Response): Promise<void>;
}
/** Clerk 4.5.2's real before and after-request hooks, which are what read and save this credential. */
function clerkHooks(tokenCache: TokenCache): Hooks {
  const { createClerkInstance } = run("provider/singleton/createClerkInstance.js", {
    "../../_virtual/_rolldown/runtime.js": { __toESM: (module: unknown) => ({ default: module }) },
    "@clerk/shared/error": {}, "../../cache/MemoryTokenCache": {}, "../../utils/errors": { assertValidProxyUrl: () => undefined }, "../../cache": {},
    "react-native": { Platform: { OS: "ios" } }, "../../../package.json": { version: "4.5.2" },
    "../../utils/runtime": { isNative: () => true }, "../../constants": { CLERK_CLIENT_JWT_KEY: key }, "../../errorThrower": {},
  });
  class Client {
    before!: Hooks["before"];
    after!: Hooks["after"];
    __internal_onBeforeRequest(fn: Hooks["before"]) { this.before = fn; }
    __internal_onAfterResponse(fn: Hooks["after"]) { this.after = fn; }
  }
  const client = createClerkInstance(Client)({ publishableKey: `pk_test_${Math.random()}`, tokenCache });
  return { before: (request) => client.before(request), after: (_, response) => client.after(_, response) };
}
/** The real wrapper that also tells Clerk's native side about changes. */
function nativeSync(tokenCache: TokenCache, heard: (string | null)[]): TokenCache {
  return run("provider/nativeClientSync.js", {
    "../cache": {}, "react-native": { Platform: { OS: "ios" } }, react: { useMemo: (fn: () => unknown) => fn() },
    "../utils/native-module": {}, "../constants": { CLERK_CLIENT_JWT_KEY: key }, "../hooks/useNativeClientEvents": {}, "./nativeClientSyncCoordinator": {},
  }).useSyncableTokenCache({ tokenCache, suppressTokenCacheNotificationsRef: { current: 0 }, tokenCacheListenersRef: { current: new Set([(token: string | null) => heard.push(token)]) } });
}
const request = () => ({ url: new URL("https://clerk.example.test/v1/client"), headers: new Headers() });
const answer = (token?: string) => new Response(null, token ? { headers: { authorization: token } } : undefined);
async function sent(hooks: Hooks) {
  const made = request();
  await hooks.before(made);
  return made.headers.get("authorization");
}

beforeEach(() => {
  store.items = new Map([[key, "her-session"]]);
  store.failNext = 0;
  store.reads = 0;
  store.deleted = [];
  store.options = [];
});

describe("the package's own cache", () => {
  it("is why this exists: a failed read deletes her credential", async () => {
    store.failNext = always;
    expect(await packageCache().getToken(key)).toBeNull();
    expect(store.deleted).toEqual([key]);
  });
  it("a sign-in it saved is found here, and one saved here is found by it", async () => {
    await packageCache().saveToken(key, "saved-by-the-package");
    const ours = cache();
    expect(await ours.getToken(key)).toBe("saved-by-the-package");
    await ours.saveToken(key, "saved-by-ours");
    expect(await packageCache().getToken(key)).toBe("saved-by-ours");
  });
});

describe("through Clerk's real request hooks", () => {
  it("normal launch: the saved credential goes out", async () => {
    expect(await sent(clerkHooks(cache()))).toBe("her-session");
  });
  it("first sign-in on this phone: nothing to send, then what Clerk answers is kept", async () => {
    store.items.clear();
    const hooks = clerkHooks(cache());
    expect(await sent(hooks)).toBe("");
    await hooks.after(null, answer("signed-in"));
    expect(store.items.get(key)).toBe("signed-in");
    expect(await sent(hooks)).toBe("signed-in");
  });
  it("rotation: the newer credential replaces it", async () => {
    const hooks = clerkHooks(cache());
    await sent(hooks);
    await hooks.after(null, answer("rotated"));
    expect(await sent(hooks)).toBe("rotated");
  });
  it("a response with no credential changes nothing", async () => {
    const hooks = clerkHooks(cache());
    await hooks.after(null, answer());
    expect(store.items.get(key)).toBe("her-session");
  });
  it("sign-out: Clerk's clear goes through, and nothing is sent afterwards", async () => {
    const tokenCache = nativeSync(cache(), []), hooks = clerkHooks(tokenCache);
    await tokenCache.clearToken!(key);
    expect(store.items.has(key)).toBe(false);
    expect(await sent(hooks)).toBe("");
  });
  it("account switch: the new account's credential is what goes out, never the old one", async () => {
    const heard: (string | null)[] = [], tokenCache = nativeSync(cache(), heard), hooks = clerkHooks(tokenCache);
    await tokenCache.saveToken(key, "new-account");
    expect(heard).toEqual(["new-account"]);
    expect(await sent(hooks)).toBe("new-account");
  });
  it("account switch straight after a failed read still saves the new account", async () => {
    const heard: (string | null)[] = [], tokenCache = nativeSync(cache(), heard), hooks = clerkHooks(tokenCache);
    store.failNext = always;
    await sent(hooks);
    store.failNext = 0;
    await hooks.after(null, answer("new-account"));
    expect(store.items.get(key)).toBe("new-account");
    expect(await sent(hooks)).toBe("new-account");
  });
  it("sign-out straight after a failed read still clears", async () => {
    const tokenCache = nativeSync(cache(), []), hooks = clerkHooks(tokenCache);
    store.failNext = always;
    await sent(hooks);
    store.failNext = 0;
    await tokenCache.clearToken!(key);
    expect(store.items.has(key)).toBe(false);
    expect(await sent(hooks)).toBe("");
  });
});

describe("a read error", () => {
  it("that passes in a moment is never noticed: the credential still goes out", async () => {
    store.failNext = 2;
    expect(await sent(clerkHooks(cache()))).toBe("her-session");
    expect(store.reads).toBe(3);
  });
  it("is retried only briefly, inside the second Clerk's native sync allows a read", async () => {
    const waits: number[] = [];
    store.failNext = always;
    expect(await createClerkTokenCache(async (ms) => { waits.push(ms); }).getToken(key)).toBeNull();
    expect(store.reads).toBe(3);
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBeLessThan(1000);
  });
  it("that doesn't pass: nothing is deleted, Clerk gets no credential, and the next read finds it", async () => {
    const hooks = clerkHooks(cache());
    store.failNext = always;
    expect(await sent(hooks)).toBe("");
    expect(store.deleted).toEqual([]);
    expect(store.items.get(key)).toBe("her-session");
    store.failNext = 0;
    expect(await sent(hooks)).toBe("her-session");
  });
  it("accepted: an empty client answering that tokenless request replaces the credential, which means a sign-in prompt", async () => {
    const hooks = clerkHooks(cache());
    store.failNext = always;
    await sent(hooks);
    store.failNext = 0;
    await hooks.after(null, answer("a-new-empty-client"));
    expect(store.items.get(key)).toBe("a-new-empty-client");
  });
  it("a credential that can never be read heals on the next save rather than failing forever", async () => {
    const hooks = clerkHooks(cache());
    store.failNext = always;
    await sent(hooks);
    await hooks.after(null, answer("signed-in-again"));
    expect(store.items.get(key)).toBe("signed-in-again");
  });
});

describe("the keychain", () => {
  it("uses the package's access, so existing sign-ins are found", async () => {
    const ours = cache();
    await ours.getToken(key);
    await ours.saveToken(key, "next");
    await ours.clearToken!(key);
    expect(store.options.every((options) => (options as { keychainAccessible: string }).keychainAccessible === "after-first-unlock")).toBe(true);
  });
});
