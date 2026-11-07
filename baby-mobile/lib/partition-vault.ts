import { storageKey, type SecretStorage } from "./vault";
export interface EncryptedFiles {
  read(name: string): Promise<string>;
  write(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
  clear(): Promise<void>;
  seal(value: string, section: string): Promise<string>;
  open(value: string, section: string): Promise<string>;
}
interface Manifest {
  version: 1 | 2;
  parts: Record<string, string>;
  /** This build moved family work out of its own store, so what's left there is stale even if a crash left it. */
  retired_family?: boolean;
}
/** Immutable encrypted section files + one atomic Keychain manifest. Only changed
 * sections are encrypted. A care entry never rewrites the saved source library. */
export function createPartitionVault(
  secret: SecretStorage,
  namespace: string,
  uuid: () => string,
  files: EncryptedFiles,
  project: (section: string, value: unknown) => unknown = (_, v) => v,
  /**
   * 2 fences this save from a build that only knows 1. The save and its key go in a store that build doesn't know
   * about, and only a marker is left where it looks: it refuses the vault, and its sign-out can't reach the save.
   */
  version: (state: Record<string, unknown>) => 1 | 2 = () => 1,
  family: EncryptedFiles = files,
  /** An older build cleaned up around the saved family work: what it was, and anything that build has saved since. */
  recovered: (saved: Record<string, unknown>, older: Record<string, unknown> | null) => Record<string, unknown> = (saved) => saved
) {
  const key = storageKey(namespace) + ".manifest", familyKey = storageKey(namespace) + ".family";
  let retired = false,
    pending: Promise<unknown> = Promise.resolve(),
    references: Record<string, unknown> = {};
  const guard = () => {
    if (retired) throw Error("This private device session has ended.");
  };
  const ordered = <T>(fn: () => Promise<T>) => {
    const next = pending.catch(() => undefined).then(fn);
    pending = next;
    return next;
  };
  async function manifest(at = key) {
    const raw = await secret.getItemAsync(at);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Manifest;
    if (
      (parsed.version !== 1 && parsed.version !== 2) ||
      !parsed.parts ||
      Object.entries(parsed.parts).some(
        ([section, id]) => !/^\w+$/.test(section) || typeof id !== "string" || !/^[\w-]+$/.test(id)
      )
    )
      throw Error("Private device data needs recovery. It has not been overwritten.");
    return parsed;
  }
  return {
    retire() {
      retired = true;
    },
    read: <T>() =>
      ordered(async () => {
        guard();
        const marker = await manifest(), saved = await manifest(familyKey);
        const sections = async (parts: Record<string, string>, store: EncryptedFiles) => {
          const output: Record<string, unknown> = {};
          for (const [section, id] of Object.entries(parts)) {
            const plaintext = await store.open(await store.read(id), section);
            guard();
            output[section] = JSON.parse(plaintext);
          }
          return output;
        };
        if (!saved || marker?.retired_family) {
          if (!marker || (marker.version === 2 && !Object.keys(marker.parts).length)) return null;
          references = await sections(marker.parts, files);
          return references as T;
        }
        const output = await sections(saved.parts, family);
        if (marker?.version === 2) {
          references = output;
          return output as T;
        }
        // No marker: an older build signed out. The next save writes everything and fences it again.
        references = {};
        return recovered(output, marker ? await sections(marker.parts, files) : null) as T;
      }),
    write: (value: unknown) =>
      ordered(async () => {
        guard();
        if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid private device state.");
        const state = value as Record<string, unknown>,
          stamp = version(state),
          marker = await manifest(),
          saved = await manifest(familyKey),
          store = stamp === 2 ? family : files,
          old = stamp === 2 ? saved : marker?.version === 1 ? marker : null,
          fenced = marker?.version === 2 && !Object.keys(marker.parts).length,
          parts = { ...old?.parts }, present = new Set<string>();
        let changed = false;
        for (const [section, content] of Object.entries(state)) {
          // JSON.stringify(undefined) has no JSON value. Optional own keys must behave like absent keys.
          if (content === undefined) continue;
          if (!/^\w+$/.test(section)) throw Error("Invalid private device section.");
          if (old && references[section] === content && section in parts) { present.add(section); continue; }
          const serialized = JSON.stringify(project(section, content));
          if (serialized === undefined) continue;
          present.add(section);
          const id = uuid();
          await store.write(id, await store.seal(serialized, section));
          guard();
          parts[section] = id;
          changed = true;
        }
        for (const section of Object.keys(parts))
          if (!present.has(section)) {
            delete parts[section];
            changed = true;
          }
        if (!changed && old?.version === stamp && (stamp === 2 ? fenced : !saved)) return;
        guard();
        if (stamp === 2) {
          // The save is durable before the marker goes up, so a crash between them loses nothing.
          await secret.setItemAsync(familyKey, JSON.stringify({ version: 2, parts }));
          if (!fenced) await secret.setItemAsync(key, JSON.stringify({ version: 2, parts: {} }));
        } else {
          await secret.setItemAsync(key, JSON.stringify({ version: 1, parts, ...(saved ? { retired_family: true } : {}) }));
          if (saved) {
            await secret.deleteItemAsync(familyKey);
            if (family !== files) await family.clear().catch(() => undefined);
          }
        }
        references = state;
        for (const [section, id] of Object.entries(old?.parts ?? {}))
          if (parts[section] !== id) await store.remove(id).catch(() => undefined);
        if (stamp === 2 && marker) for (const id of Object.values(marker.parts)) await files.remove(id).catch(() => undefined);
      }),
    clear: () =>
      ordered(async () => {
        await secret.deleteItemAsync(key);
        await secret.deleteItemAsync(familyKey);
        references = {};
        await files.clear();
        if (family !== files) await family.clear();
        retired = true;
      }),
  };
}
