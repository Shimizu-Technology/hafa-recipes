import { useRef, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useBaby } from "@/lib/context";
import { contactFrom, contactsOn, deliveryMatters, herDoctorMatters, phoneProblem, sameContact } from "../lib/contacts";
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
    [name, setName] = useState(profile.display_name),
    [doctor, setDoctor] = useState({ name: saved?.doctor?.name ?? "", phone: saved?.doctor?.phone ?? "" }),
    [delivery, setDelivery] = useState({ name: saved?.delivery?.name ?? "", phone: saved?.delivery?.phone ?? "" }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    working = useRef(false);
  const on = contactsOn(b.state.bootstrap), today = profileToday(new Date(), profile.timezone),
    wrongNumber = phoneProblem(doctor.phone) || phoneProblem(delivery.phone);
  async function save() {
    if (working.current) return;
    if (wrongNumber) return setError(wrongNumber);
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await b.api.profile(
        { ...profile, display_name: name.trim(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        b.state.bootstrap!.generation
      );
      await b.commit((s) => ({ ...s, bootstrap: { ...s.bootstrap!, profile: result } }));
      // Only what changed, so a save from here can't undo what another phone just saved.
      const nextDoctor = contactFrom(doctor.name, doctor.phone), nextDelivery = contactFrom(delivery.name, delivery.phone), changes = {
        ...(sameContact(saved?.doctor, nextDoctor) ? {} : { doctor: nextDoctor }),
        ...(sameContact(saved?.delivery, nextDelivery) ? {} : { delivery: nextDelivery }),
      };
      if (on && Object.keys(changes).length) {
        const contacts = await b.api.contacts(changes, b.state.bootstrap!.generation);
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
    <Field label="Your name" value={name} onChange={setName} maxLength={120} autoFocus={!profile.display_name && !open}
      returnKeyType="done" onSubmit={() => void save()} />
    {familyOpen(b.state.bootstrap) && <Copy kind="small" tone="muted">Your family sees this on what you log.</Copy>}
    {on && (herDoctorMatters(b.state.bootstrap) || !!saved?.doctor) && <Disclosure title="Your doctor" detail="Adds a call button on Help" startOpen={open === "doctor" || !!saved?.doctor}>
      <Copy kind="small" tone="muted">Adds a call button on Help. It stays yours, and isn’t shared with family or sent to AI.</Copy>
      <Field label="Doctor’s name" value={doctor.name} maxLength={120} onChange={(value) => { setError(""); setDoctor((current) => ({ ...current, name: value })); }} />
      <Field label="Doctor’s phone" purpose="phone" value={doctor.phone} maxLength={40} onChange={(value) => { setError(""); setDoctor((current) => ({ ...current, phone: value })); }} />
    </Disclosure>}
    {on && (deliveryMatters(b.state.bootstrap, today) || !!saved?.delivery) && <Disclosure title="Where you plan to deliver" detail="Adds a call button on Help and the contraction timer" startOpen={open === "delivery" || !!saved?.delivery}>
      <Copy kind="small" tone="muted">Adds a call button on Help and the contraction timer. It stays yours, and isn’t shared with family or sent to AI.</Copy>
      <Field label="Place’s name" value={delivery.name} maxLength={120} onChange={(value) => { setError(""); setDelivery((current) => ({ ...current, name: value })); }} />
      <Field label="Place’s phone" purpose="phone" value={delivery.phone} maxLength={40} onChange={(value) => { setError(""); setDelivery((current) => ({ ...current, phone: value })); }} />
    </Disclosure>}
    <Copy kind="small" tone="muted">
      Time zone: {profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
    </Copy>
    {fontScale >= 1.5 && action}
  </Screen>;
}
