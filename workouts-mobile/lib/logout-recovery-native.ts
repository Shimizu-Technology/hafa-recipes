import AsyncStorage from "@react-native-async-storage/async-storage";
import { erasePrivateDeviceData } from "./private-device";
import { createLogoutRecovery } from "./logout-recovery";
import { createVerifiedIdentityCache } from "./enrollment-bootstrap";
import { revokeNativeSharing } from "./native-share-session";
import { discardCaptures } from "@/modules/hafa-workouts-share/src";

const identities = createVerifiedIdentityCache(AsyncStorage);
export const logoutRecovery = createLogoutRecovery({
  storage: AsyncStorage,
  cleanup: async (owner, binding) => { await revokeNativeSharing(); await discardCaptures(owner); await erasePrivateDeviceData(owner, binding); },
  owner: async (binding) => (await identities.load(binding))?.id ?? null,
});
