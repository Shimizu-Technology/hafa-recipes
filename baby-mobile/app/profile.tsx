import { useRef, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import { messageFor } from "@/lib/models";
import { Button, Copy, Field, Notice, Screen, useToast } from "@/components/ui";
import { familyOpen } from "../lib/spaces";

/** Who she is to the app, opened from the row at the top of Settings. */
export default function ProfileDetails() {
  const b = useBaby(), toast = useToast(), profile = b.state.bootstrap!.profile,
    // Null until she edits it, so what shows is the latest and a save can't send an older name back.
    [edited, setEdited] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    working = useRef(false);
  async function save() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await b.api.profile(
        { ...(edited !== null ? { display_name: edited.trim() } : {}), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        b.state.bootstrap!.generation
      );
      await b.commit((s) => ({ ...s, bootstrap: { ...s.bootstrap!, profile: result } }));
      toast("Your details are saved.");
      router.back();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const { fontScale } = useWindowDimensions(), action = <View style={{ gap: 8 }}>
    {!!error && <Notice error>{error}</Notice>}
    <Button title="Save" size="lg" busy={busy} onPress={() => void save()} />
  </View>;
  // Docked, in reach of a thumb. At large text it would take half the screen, so it goes at the end.
  return <Screen title="Your details" back footer={fontScale < 1.5 ? action : undefined}>
    <Field label="Your name" value={edited ?? profile.display_name} onChange={setEdited} maxLength={120} autoFocus={!profile.display_name}
      returnKeyType="done" onSubmit={() => void save()} />
    {familyOpen(b.state.bootstrap) && <Copy kind="small" tone="muted">Your family sees this on what you log.</Copy>}
    <Copy kind="small" tone="muted">
      Time zone: {profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
    </Copy>
    {fontScale >= 1.5 && action}
  </Screen>;
}
