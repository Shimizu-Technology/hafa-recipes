import { randomUUID, type webcrypto } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
const disk = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  makeDirectoryAsync: async () => undefined,
  readAsStringAsync: async (name: string) => { if (!disk.has(name)) throw Error("Missing section"); return disk.get(name)!; },
  writeAsStringAsync: async (name: string, value: string) => { disk.set(name, value); },
  deleteAsync: async (name: string) => { for (const key of disk.keys()) if (key.startsWith(name)) disk.delete(key); },
}));
// Real AES-GCM bytes, AAD and key export/import; only Expo's native bridge and disk are replaced.
vi.mock("expo-crypto", async () => {
  const { webcrypto } = await import("node:crypto"), subtle = webcrypto.subtle;
  const wrap = (key: webcrypto.CryptoKey) => ({ key, encoded: async () => Buffer.from(await subtle.exportKey("raw", key)).toString("base64") });
  return {
    AESEncryptionKey: {
      generate: async () => wrap(await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])),
      import: async (value: string) => wrap(await subtle.importKey("raw", Buffer.from(value, "base64"), "AES-GCM", true, ["encrypt", "decrypt"])),
    },
    AESSealedData: { fromCombined: (value: string) => value },
    aesEncryptAsync: async (value: Uint8Array, key: { key: webcrypto.CryptoKey }, options: { additionalData: Uint8Array }) => {
      const iv = webcrypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: new Uint8Array(options.additionalData) }, key.key, new Uint8Array(value));
      return { combined: () => Buffer.concat([iv, Buffer.from(ciphertext)]).toString("base64") };
    },
    aesDecryptAsync: async (value: string, key: { key: webcrypto.CryptoKey }, options: { additionalData: Uint8Array }) => {
      const bytes = Buffer.from(value, "base64");
      return subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12), ...options }, key.key, bytes.subarray(12));
    },
  };
});
import { createDeviceVault } from "./device-vault";
import { addMutation, fencedState, upgradedState } from "./outbox";
import { emptyState, type Bootstrap, type DeviceState } from "./models";
const boot: Bootstrap = { generation: 1, ai_available: false, profile: { display_name: "Parent", timezone: "UTC", ai_consent: false }, children: [], personal_space_id: "p", spaces: [{ id: "p", kind: "personal", role: "parent", generation: 1, access_version: 1 }, { id: "f", kind: "family", role: "parent", generation: 1, access_version: 1 }] };
beforeEach(() => disk.clear());
it.each(["fresh", "empty build40", "no-op upgrade", "personal fence", "family fence"])("cold reads two successive saves without held drafts: %s", async (path) => {
  const secrets = new Map<string, string>(); 
  const secret = { getItemAsync: async (k: string) => secrets.get(k) ?? null, setItemAsync: async (k: string, v: string) => { secrets.set(k, v); }, deleteItemAsync: async (k: string) => { secrets.delete(k); } };
  const vault = () => createDeviceVault(secret, "parent", randomUUID);
  let state: DeviceState = { ...emptyState(), bootstrap: boot };
  if (path === "empty build40") state.version = 2;
  await vault().write(state);
  state = upgradedState((await vault().read<DeviceState>())!);
  if (path === "personal fence") state = fencedState(state, { generation: 2, spaces: boot.spaces });
  if (path === "family fence") state = fencedState(state, { generation: 1, spaces: boot.spaces!.map((s) => ({ ...s, generation: 2 })) });
  for (const which of ["one", "two"]) {
    state = addMutation(state, { id: which, type: "save", generation: 1, space_id: "f", files: [], record: { id: which, kind: "diaper", title: "Pee", body: "", child_id: null, occurred_at: "2026-11-07T01:00:00Z", data: { type: "wet" } } });
    await vault().write(state);
    state = (await vault().read<DeviceState>())!;
    expect(Object.hasOwn(state, "heldDrafts")).toBe(false);
    expect(state.outbox.map((m) => m.id)).toEqual(which === "one" ? ["one"] : ["one", "two"]);
  }
  expect(secrets.size).toBeGreaterThan(0);
  expect([...disk.values()].some((value) => value.includes('"diaper"'))).toBe(false);
});
