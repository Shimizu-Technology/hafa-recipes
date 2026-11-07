import { useRef, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useBaby } from "@/lib/context";
import { contactChanges, contactProblem, contactsOn, deliveryMatters, herDoctorMatters, shownContact, type ContactEdits } from "../lib/contacts";
import { messageFor } from "@/lib/models";
import { profileToday } from "@/lib/timing";
import { Button, Copy, Field, Notice, Screen, useToast } from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { familyOpen } from "../lib/spaces";

/** Who she is to the app, opened from the row at the top of Settings. */
export default function ProfileDetails() {
  const b = useBaby(), toast = useToast(), profile = b.state.bootstrap!.profile,
    // Help's quiet line opens the part it's talking about.
    { open } = useLocalSearchParams<{ open?: string }>(),
    saved = b.state.bootstrap!.contacts,
    // Nothing until she edits it, so what shows is the latest, and a save can't send an older value back.
    [edited, setEdited] = useState<string | null>(null),
    [edits, setEdits] = useState<ContactEdits>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    working = useRef(false);
  const on = contactsOn(b.state.bootstrap), today = profileToday(new Date(), profile.timezone),
    doctor = shownContact(saved?.doctor, edits.doctor), delivery = shownContact(saved?.delivery, edits.delivery),
    problem = (edits.doctor && contactProblem(doctor.name, doctor.phone)) || (edits.delivery && contactProblem(delivery.name, delivery.phone)) || "",
    type = (key: keyof ContactEdits, field: "name" | "phone") => (value: string) => {
      setError("");
      setEdits((current) => ({ ...current, [key]: { ...current[key], [field]: value } }));
    };
  const latestContacts = useRef(saved);
  latestContacts.current = saved;
  async function save() {
    if (working.current) return;
    if (problem) return setError(problem);
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await b.api.profile(
        { ...(edited !== null ? { display_name: edited.trim() } : {}), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        b.state.bootstrap!.generation
      );
      await b.commit((s) => ({ ...s, bootstrap: { ...s.bootstrap!, profile: result } }));
      if (on && Object.keys(edits).length) {
        const contacts = await b.api.contacts(contactChanges(latestContacts.current, edits), b.state.bootstrap!.generation);
        await b.commit((s) => ({ ...s, bootstrap: { ...s.bootstrap!, contacts } }));
      }
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
  // Docked, in reach of a thumb whichever parts are open. At large text it would take half the screen, so it goes at the end.
  return <Screen title="Your details" back footer={fontScale < 1.5 ? action : undefined}>
    <Field label="Your name" capitalize="words" value={edited ?? profile.display_name} onChange={setEdited} maxLength={120} autoFocus={!profile.display_name && !open}
      returnKeyType="done" onSubmit={() => void save()} />
    {familyOpen(b.state.bootstrap) && <Copy kind="small" tone="muted">Your family sees this on what you log.</Copy>}
    {on && (herDoctorMatters(b.state.bootstrap) || !!saved?.doctor) && <Disclosure title="Your doctor" detail="Adds a call button on Help" startOpen={open === "doctor" || !!saved?.doctor}>
      <Copy kind="small" tone="muted">Adds a call button on Help. It stays yours, and isn’t shared with family or sent to AI.</Copy>
      <Field label="Doctor’s name" value={doctor.name} maxLength={120} onChange={type("doctor", "name")} />
      <Field label="Doctor’s phone" purpose="phone" value={doctor.phone} maxLength={40} onChange={type("doctor", "phone")} />
    </Disclosure>}
    {on && (deliveryMatters(b.state.bootstrap, today) || !!saved?.delivery) && <Disclosure title="Where you plan to deliver" detail="Adds a call button on Help and the contraction timer" startOpen={open === "delivery" || !!saved?.delivery}>
      <Copy kind="small" tone="muted">Adds a call button on Help and the contraction timer. It stays yours, and isn’t shared with family or sent to AI.</Copy>
      <Field label="Place’s name" value={delivery.name} maxLength={120} onChange={type("delivery", "name")} />
      <Field label="Place’s phone" purpose="phone" value={delivery.phone} maxLength={40} onChange={type("delivery", "phone")} />
    </Disclosure>}
    <Copy kind="small" tone="muted">
      Time zone: {profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
    </Copy>
    {fontScale >= 1.5 && action}
  </Screen>;
}
