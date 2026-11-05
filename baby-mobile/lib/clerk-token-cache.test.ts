import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as SecureStore from "expo-secure-store";
import type { TokenCache } from "@clerk/expo";

const store = vi.hoisted(() => ({
  items: new Map<string, string>(),
  failReads: false,
  deleted: [] as string[],
  options: [] as unknown[],
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: "after-first-unlock",
  getItemAsync: async (key: string, options: unknown) => {
    store.options.push(options);
    if (store.failReads) throw Error("Keychain item unavailable");
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
beforeEach(() => {
  store.items = new Map([[key, "her-session"]]);
  store.failReads = false;
  store.deleted = [];
  store.options = [];
});

/** The compiled file from the package itself, run with this test's fake keychain, since its imports need a real phone. */
function packageCache() {
  const source = readFileSync(new URL("../node_modules/@clerk/expo/dist/token-cache/index.js", import.meta.url), "utf8");
  const modules: Record<string, unknown> = {
    "../_virtual/_rolldown/runtime.js": { __toESM: (module: unknown) => module },
    "../utils": { isNative: () => true },
    "expo-secure-store": SecureStore,
  };
  const exports: { tokenCache?: TokenCache } = {};
  new Function("exports", "require", source)(exports, (name: string) => modules[name]);
  return exports.tokenCache!;
}

describe("the package's own cache", () => {
  it("is why this exists: a failed read deletes her credential", async () => {
    store.failReads = true;
    expect(await packageCache().getToken(key)).toBeNull();
    expect(store.deleted).toEqual([key]);
  });
  it("a sign-in it saved is found here, and one saved here is found by it", async () => {
    await packageCache().saveToken(key, "saved-by-the-package");
    const ours = createClerkTokenCache();
    expect(await ours.getToken(key)).toBe("saved-by-the-package");
    await ours.saveToken(key, "saved-by-ours");
    expect(await packageCache().getToken(key)).toBe("saved-by-ours");
  });
});

describe("a read error", () => {
  it("keeps her credential and answers null for now", async () => {
    const cache = createClerkTokenCache();
    store.failReads = true;
    expect(await cache.getToken(key)).toBeNull();
    expect(store.deleted).toEqual([]);
    expect(store.items.get(key)).toBe("her-session");
  });
  it("the next read finds it", async () => {
    const cache = createClerkTokenCache();
    store.failReads = true;
    await cache.getToken(key);
    store.failReads = false;
    expect(await cache.getToken(key)).toBe("her-session");
  });
  it("what Clerk hands a tokenless request can't overwrite her credential", async () => {
    const cache = createClerkTokenCache();
    store.failReads = true;
    await cache.getToken(key);
    store.failReads = false;
    await cache.saveToken(key, "a-new-empty-client");
    expect(store.items.get(key)).toBe("her-session");
  });
  it("nor can a clear from Clerk's sync, which thinks there's nothing there", async () => {
    const cache = createClerkTokenCache();
    store.failReads = true;
    await cache.getToken(key);
    await cache.clearToken!(key);
    expect(store.deleted).toEqual([]);
    expect(store.items.get(key)).toBe("her-session");
  });
  it("a write while it still can't be read goes nowhere and can't throw", async () => {
    const cache = createClerkTokenCache();
    store.failReads = true;
    await cache.getToken(key);
    await expect(cache.saveToken(key, "x")).resolves.toBeUndefined();
    expect(store.items.get(key)).toBe("her-session");
  });
  it("with nothing stored after all, a new sign-in is kept", async () => {
    store.items.clear();
    const cache = createClerkTokenCache();
    store.failReads = true;
    await cache.getToken(key);
    store.failReads = false;
    await cache.saveToken(key, "signed-in-now");
    expect(store.items.get(key)).toBe("signed-in-now");
  });
  it("once a read has worked, everything works as usual again", async () => {
    const cache = createClerkTokenCache();
    store.failReads = true;
    await cache.getToken(key);
    store.failReads = false;
    await cache.getToken(key);
    await cache.saveToken(key, "refreshed");
    expect(store.items.get(key)).toBe("refreshed");
    await cache.clearToken!(key);
    expect(store.deleted).toEqual([key]);
  });
  it("one key's failure doesn't hold up another", async () => {
    const cache = createClerkTokenCache();
    store.failReads = true;
    await cache.getToken(key);
    store.failReads = false;
    await cache.saveToken("__clerk_db_jwt", "other");
    expect(store.items.get("__clerk_db_jwt")).toBe("other");
  });
});

describe("with no read error", () => {
  it("does what the package does, with the same keychain access, so existing sign-ins are found", async () => {
    const cache = createClerkTokenCache();
    expect(await cache.getToken(key)).toBe("her-session");
    await cache.saveToken(key, "next");
    expect(store.items.get(key)).toBe("next");
    await cache.clearToken!(key);
    expect(store.items.has(key)).toBe(false);
    expect(store.options.every((options) => (options as { keychainAccessible: string }).keychainAccessible === "after-first-unlock")).toBe(true);
  });
});
