import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { TokenCache } from "@clerk/expo";

/** The same keychain access as the package's own cache, so a sign-in it saved is found here. */
const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

/**
 * `@clerk/expo`'s cache deletes the credential when a read fails, and a read can fail for reasons that pass, so that would
 * sign her out for good. This one answers null for now and leaves it there. Until a read has worked again, nothing can
 * replace it either: Clerk answers a request with no credential by handing out a new empty client, and its native sync
 * clears what it thinks is gone. She may see sign-in on that one launch, and the next one finds her session.
 */
export function createClerkTokenCache(): TokenCache {
  const unread = new Set<string>();
  return {
    getToken: async (key) => {
      try {
        const token = await SecureStore.getItemAsync(key, options);
        unread.delete(key);
        return token;
      } catch {
        unread.add(key);
        return null;
      }
    },
    saveToken: async (key, token) => {
      if (unread.has(key)) {
        let held: string | null;
        try {
          held = await SecureStore.getItemAsync(key, options);
        } catch {
          return;
        }
        if (held) return;
        unread.delete(key);
      }
      await SecureStore.setItemAsync(key, token, options);
    },
    clearToken: async (key) => {
      if (unread.has(key)) return;
      await SecureStore.deleteItemAsync(key, options);
    },
  };
}
/** Undefined on web, as with the package's: Clerk keeps it in memory there. */
export const clerkTokenCache = Platform.OS === "web" ? undefined : createClerkTokenCache();
