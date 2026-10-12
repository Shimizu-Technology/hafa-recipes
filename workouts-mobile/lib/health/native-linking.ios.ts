import { Linking } from "react-native";

// Metro importAll enumerates React Native's lazy legacy getters, including
// removed native modules. Keep lazy Health loading to this narrow module.
export function openHealthSettings(): Promise<void> {
  return Linking.openSettings();
}
