import { lookFonts } from "./look-fonts";
import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFonts } from "expo-font";
import { configuration } from "@/lib/config";
import { getLook, LOOK_STORAGE_KEY, previewEnabled, restoredLook, type LookId } from "@/constants/looks";
import { LookContext } from "@/lib/look-context";

// Assets are bundled but only the selected preview's named weights are loaded.
function FontLoad({ id, ready, failed }: { id: LookId; ready(): void; failed(): void }) {
  const files = lookFonts(id);
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
    if (next === id) saveChain.current = saveChain.current.then(() => AsyncStorage.setItem(LOOK_STORAGE_KEY, next)).catch(() => setError("Preview applied, but it could not be saved. Choose it again to retry."));
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
