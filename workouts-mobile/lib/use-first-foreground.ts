import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
export function useFirstForeground() {
  const [foregrounded, setForegrounded] = useState(Platform.OS === "web" || AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", state => { if (state === "active") setForegrounded(true); });
    if (AppState.currentState === "active") setForegrounded(true);
    return () => sub.remove();
  }, []);
  return foregrounded;
}
