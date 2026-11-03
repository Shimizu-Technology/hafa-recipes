import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFonts } from "expo-font";
import { configuration } from "@/lib/config";
import { getLook, LOOK_STORAGE_KEY, previewEnabled, restoredLook, type LookId } from "@/lib/looks";
import { LookContext } from "@/lib/look-context";

// Assets are bundled but only the selected preview's named weights are loaded.
function FontLoad({ id, ready, failed }: { id: LookId; ready(): void; failed(): void }) {
  const files = id === "current" ? {} : id === "coach" ? {
    BricolageGrotesque_700Bold: require("@expo-google-fonts/bricolage-grotesque/700Bold/BricolageGrotesque_700Bold.ttf"),
    Nunito_600SemiBold: require("@expo-google-fonts/nunito/600SemiBold/Nunito_600SemiBold.ttf"),
    Nunito_700Bold: require("@expo-google-fonts/nunito/700Bold/Nunito_700Bold.ttf"),
    Nunito_800ExtraBold: require("@expo-google-fonts/nunito/800ExtraBold/Nunito_800ExtraBold.ttf"),
  } : {
    Inter_400Regular: require("@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf"),
    Inter_600SemiBold: require("@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf"),
    Inter_700Bold: require("@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf"),
    ...(id === "athletic" ? { BarlowCondensed_700Bold: require("@expo-google-fonts/barlow-condensed/700Bold/BarlowCondensed_700Bold.ttf") } : {}),
  };
  const [loaded, error] = useFonts(files);
  useEffect(() => { if (loaded) ready(); else if (error) failed(); }, [loaded, error, ready, failed]);
  return null;
}
export function LookProvider({ children }: PropsWithChildren) {
  const enabled = previewEnabled(configuration.environment);
  const [id, apply] = useState<LookId>("current"), [requested, request] = useState<LookId>("current");
  const [error, setError] = useState("");
  const touched = useRef(false), saveChain = useRef(Promise.resolve());
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void AsyncStorage.getItem(LOOK_STORAGE_KEY).then(value => { if (live && !touched.current) request(restoredLook(value, enabled)); }).catch(() => setError("Could not restore the preview. Choose a look to try again."));
    return () => { live = false; };
  }, [enabled]);
  function setLook(next: LookId) {
    if (!enabled) return;
    touched.current = true; setError(""); request(restoredLook(next, true));
  }
  function ready() {
    if (id === requested) return;
    apply(requested);
    if (touched.current) saveChain.current = saveChain.current.then(() => AsyncStorage.setItem(LOOK_STORAGE_KEY, requested)).catch(() => setError("Preview applied, but it could not be saved. Choose it again to retry."));
  }
  return <LookContext.Provider value={{ ...getLook(enabled ? id : "current"), enabled, pending: id !== requested, error, setLook }}>
    {children}
    {enabled && <FontLoad key={requested} id={requested} ready={ready} failed={() => { setError("The preview font could not load. Your previous look is still active."); request(id); }} />}
  </LookContext.Provider>;
}
