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
  version: 1;
  parts: Record<string, string>;
}
/** Immutable encrypted section files + one atomic Keychain manifest. Only changed
 * sections are encrypted. A care entry never rewrites the saved source library. */
export function createPartitionVault(
  secret: SecretStorage,
  namespace: string,
  uuid: () => string,
  files: EncryptedFiles,
  project: (section: string, value: unknown) => unknown = (_, v) => v
) {
  const key = storageKey(namespace) + ".manifest";
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
  async function manifest() {
    const raw = await secret.getItemAsync(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Manifest;
    if (
      parsed.version !== 1 ||
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
        const saved = await manifest();
        if (!saved) return null;
        const output: Record<string, unknown> = {};
        for (const [section, id] of Object.entries(saved.parts)) {
          const plaintext = await files.open(await files.read(id), section);
          guard();
          output[section] = JSON.parse(plaintext);
        }
        references = output;
        return output as T;
      }),
    write: (value: unknown) =>
      ordered(async () => {
        guard();
        if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid private device state.");
        const state = value as Record<string, unknown>,
          old = await manifest(),
          parts = { ...old?.parts };
        let changed = false;
        for (const [section, content] of Object.entries(state)) {
          if (!/^\w+$/.test(section)) throw Error("Invalid private device section.");
          if (old && references[section] === content) continue;
          const id = uuid();
          await files.write(id, await files.seal(JSON.stringify(project(section, content)), section));
          guard();
          parts[section] = id;
          changed = true;
        }
        for (const section of Object.keys(parts))
          if (!(section in state)) {
            delete parts[section];
            changed = true;
          }
        if (!changed) return;
        guard();
        await secret.setItemAsync(key, JSON.stringify({ version: 1, parts }));
        references = state;
        for (const [section, id] of Object.entries(old?.parts ?? {}))
          if (parts[section] !== id) await files.remove(id).catch(() => undefined);
      }),
    clear: () =>
      ordered(async () => {
        await secret.deleteItemAsync(key);
        references = {};
        await files.clear();
        retired = true;
      }),
  };
}
