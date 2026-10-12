import AsyncStorage from "@react-native-async-storage/async-storage";
import { erasePrivateDeviceData } from "./private-device";
import { createLogoutRecovery } from "./logout-recovery";

export const logoutRecovery = createLogoutRecovery({ storage: AsyncStorage, cleanup: erasePrivateDeviceData });
