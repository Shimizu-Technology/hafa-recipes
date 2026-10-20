/** Chunked Keychain/Keystore storage. Private content is never written to AsyncStorage.
 * A new manifest is committed only after every encrypted chunk is durable. An
 * interrupted write leaves the previous manifest readable. Web is memory-only. */
export interface SecretStorage {
  getItemAsync(k: string): Promise<string | null>;
  setItemAsync(k: string, v: string): Promise<void>;
  deleteItemAsync(k: string): Promise<void>;
}
export function storageKey(binding: string) {
  let a = 2166136261,
    b = 5381;
  for (const c of binding) {
    a = Math.imul(a ^ c.charCodeAt(0), 16777619);
    b = Math.imul(b, 33) ^ c.charCodeAt(0);
  }
  return `hb.${(a >>> 0).toString(16)}.${(b >>> 0).toString(16)}`;
}
export function createVault(storage: SecretStorage, namespace: string, uuid: () => string) {
  let pending: Promise<unknown> = Promise.resolve();
  let retired = false;
  const key = storageKey(namespace);
  const guard = () => {
    if (retired) throw Error("This private device session has ended.");
  };
  const ordered = <T>(fn: () => Promise<T>) => {
    const next = pending.catch(() => undefined).then(fn);
    pending = next;
    return next;
  };
  async function manifest() {
    const raw = await storage.getItemAsync(key);
    if (!raw) return null;
    const m = JSON.parse(raw) as { id: string; count: number };
    if (typeof m.id !== "string" || !Number.isInteger(m.count) || m.count < 1 || m.count > 5000)
      throw Error("Private device data needs recovery. It has not been overwritten.");
    return m;
  }
  return {
    retire() {
      retired = true;
    },
    read: <T>() =>
      ordered(async () => {
        guard();
        const m = await manifest();
        if (!m) return null;
        const parts: string[] = [];
        for (let i = 0; i < m.count; i++) {
          const value = await storage.getItemAsync(`${key}.${m.id}.${i}`);
          guard();
          if (value === null) throw Error("A private device save is incomplete. It has not been overwritten.");
          parts.push(value);
        }
        const payload = JSON.parse(parts.join("")) as { namespace: string; data: T };
        if (payload.namespace !== namespace) throw Error("This private device save belongs to another account.");
        return payload.data;
      }),
    write: (value: unknown) =>
      ordered(async () => {
        guard();
        const previous = await manifest(),
          content = Array.from(JSON.stringify({ namespace, data: value })),
          id = uuid().replace(/-/g, ""),
          count = Math.max(1, Math.ceil(content.length / 400));
        for (let i = 0; i < count; i++) {
          guard();
          await storage.setItemAsync(`${key}.${id}.${i}`, content.slice(i * 400, (i + 1) * 400).join(""));
        }
        guard();
        await storage.setItemAsync(key, JSON.stringify({ id, count }));
        if (previous)
          for (let i = 0; i < previous.count; i++)
            await storage.deleteItemAsync(`${key}.${previous.id}.${i}`).catch(() => undefined);
      }),
    clear: () =>
      ordered(async () => {
        const m = await manifest();
        await storage.deleteItemAsync(key);
        if (m) for (let i = 0; i < m.count; i++) await storage.deleteItemAsync(`${key}.${m.id}.${i}`);
        retired = true;
      }),
  };
}
