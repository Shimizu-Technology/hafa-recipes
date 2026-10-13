import AsyncStorage from "@react-native-async-storage/async-storage";
import { erasePrivateDeviceData } from "./private-device";
import { createLogoutRecovery } from "./logout-recovery";
import { createVerifiedIdentityCache } from "./enrollment-bootstrap";

const identities = createVerifiedIdentityCache(AsyncStorage);
export const logoutRecovery = createLogoutRecovery({
  storage: AsyncStorage,
  cleanup: erasePrivateDeviceData,
  owner: async (binding) => (await identities.load(binding))?.id ?? null,
});
