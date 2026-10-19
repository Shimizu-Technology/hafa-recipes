import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { AESEncryptionKey, AESSealedData, aesEncryptAsync, aesDecryptAsync } from "expo-crypto";
import { createVault, storageKey, type SecretStorage } from "./vault";
import { createPartitionVault } from "./partition-vault";
import type { BabyRecord } from "./models";
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
export function persistedCache(section: string, value: unknown) {
  if (section !== "records") return value;
  let fullSources = 0,
    recent = 0;
  // Reminder restoration must survive an offline restart, even behind a busy journal.
  return (value as BabyRecord[])
    .filter((record) => record.kind === "routine" || recent++ < 200)
    .map((record) => {
      if (record.kind !== "source") return record;
      if (
        fullSources++ < 20 &&
        (record.data.source_text?.length ?? 0) < 30000 &&
        JSON.stringify(record.data.evidence ?? []).length < 30000
      )
        return record;
      const { source_text: _, evidence: __, ...data } = record.data;
      return { ...record, data, cache_partial: true };
    });
}
export function createDeviceVault(secret: SecretStorage, namespace: string, uuid: () => string) {
  if (Platform.OS === "web") return createVault(secret, namespace, uuid);
  const base = `${FileSystem.documentDirectory}baby-vault/${storageKey(namespace)}/`,
    keyName = storageKey(namespace) + ".key";
  let cached: AESEncryptionKey | null = null;
  async function key(create = false) {
    if (cached) return cached;
    const saved = await secret.getItemAsync(keyName);
    if (saved) {
      cached = await AESEncryptionKey.import(saved, "base64");
      return cached;
    }
    if (!create) throw Error("Your private device key is unavailable. Saved files have not been replaced.");
    cached = await AESEncryptionKey.generate();
    await secret.setItemAsync(keyName, await cached.encoded("base64"));
    return cached;
  }
  return createPartitionVault(
    secret,
    namespace,
    uuid,
    {
      read: (name) => FileSystem.readAsStringAsync(base + name),
      write: async (name, value) => {
        await FileSystem.makeDirectoryAsync(base, { intermediates: true });
        await FileSystem.writeAsStringAsync(base + name, value);
      },
      remove: (name) => FileSystem.deleteAsync(base + name, { idempotent: true }),
      clear: async () => {
        cached = null;
        await secret.deleteItemAsync(keyName);
        await FileSystem.deleteAsync(base, { idempotent: true });
      },
      seal: async (value, section) => {
        const sealed = await aesEncryptAsync(encoder.encode(value), await key(true), {
          additionalData: encoder.encode(namespace + ":" + section),
        });
        return sealed.combined("base64");
      },
      open: async (value, section) => {
        const bytes = await aesDecryptAsync(AESSealedData.fromCombined(value), await key(), {
          additionalData: encoder.encode(namespace + ":" + section),
        });
        return decoder.decode(bytes);
      },
    },
    persistedCache
  );
}
