import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { TokenCache } from "@clerk/expo";

/** The same keychain access as the package's own cache, so a sign-in it saved is found here. */
const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
/** Well inside the second Clerk's native sync gives a read. */
const retries = [100, 300];
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `@clerk/expo`'s cache deletes the credential when a read fails. This one tries again briefly and then answers null,
 * leaving it there. It doesn't throw instead: Clerk's load treats that as fatal, and she'd be left on a spinner. Saves and
 * clears go straight through, so a new empty client answering a tokenless request does replace the credential. That means
 * a sign-in prompt, and it takes a keychain failure in the foreground that lasts through the retries.
 */
export function createClerkTokenCache(wait = pause): TokenCache {
  return {
    getToken: async (key) => {
      for (const delay of retries) {
        try {
          return await SecureStore.getItemAsync(key, options);
        } catch {
          await wait(delay);
        }
      }
      return SecureStore.getItemAsync(key, options).catch(() => null);
    },
    saveToken: (key, token) => SecureStore.setItemAsync(key, token, options),
    clearToken: (key) => SecureStore.deleteItemAsync(key, options),
  };
}
/** Undefined on web, as with the package's: Clerk keeps it in memory there. */
export const clerkTokenCache = Platform.OS === "web" ? undefined : createClerkTokenCache();
