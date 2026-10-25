import { useState } from "react";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { messageFor } from "@/lib/models";
import { Alert } from "react-native";
import { Button, Choice, Field, Notice, Screen } from "@/components/ui";
import { DateField } from "@/components/date-field";
export default function Onboarding() {
  const b = useBaby(),
    [name, setName] = useState(b.state.bootstrap!.profile.display_name),
    [child, setChild] = useState(""),
    [due, setDue] = useState(""),
    [birth, setBirth] = useState(""),
    [consent, setConsent] = useState(b.state.bootstrap!.profile.ai_consent),
    [automatic, setAutomatic] = useState(b.state.bootstrap!.profile.auto_process_shares === true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [id] = useState(Crypto.randomUUID);
  async function finish() {
    setBusy(true);
    setError("");
    try {
      await b.api.profile(
        {
          ...b.state.bootstrap!.profile,
          display_name: name.trim(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ai_consent: consent,
          auto_process_shares: consent && automatic,
        },
        b.state.bootstrap!.generation
      );
      if (child.trim())
        await b.api.child(
          { id, name: child.trim(), birth_date: birth || null, due_date: due || null },
          b.state.bootstrap!.generation
        );
      await b.refresh();
      router.replace("/(tabs)");
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen
      brand
      title="Make yourself at home."
      subtitle="Just a few details. Everything can be changed later."
      back
    >
      {!!error && <Notice error>{error}</Notice>}
      <Field label="What should we call you?" value={name} onChange={setName} placeholder="Your name" />
      <Field label="Baby’s name or nickname (optional)" value={child} onChange={setChild} placeholder="Their name or a nickname" />
      {!!child.trim() && (
        <>
          <DateField label="Due date (optional)" dateOnly optional value={due} onChange={setDue} />
          <DateField label="Birth date (optional)" dateOnly optional value={birth} onChange={setBirth} />
        </>
      )}
      <Notice>
        Save posts and write now. Baby details and notifications can wait until you need them.
      </Notice>
      <Choice label="Allow optional AI processing" selected={consent}
        detail="OpenAI processes only the Baby sources and context you choose. You can withdraw permission."
        onPress={() => consent ? (setConsent(false), setAutomatic(false)) : Alert.alert("Allow optional AI processing?",
          "OpenAI receives selected source text, images, audio or sampled video frames when you request processing, and relevant Baby context when you use Ask. Recipes and Workouts data are not included.",
          [{ text: "Keep off", style: "cancel" }, { text: "Allow processing", onPress: () => setConsent(true) }])} />
      <Choice disabled={!consent} label="Automatically organize posts I share" selected={automatic}
        detail="Save from another app and keep browsing. Processing is optional."
        onPress={() => automatic ? setAutomatic(false) : Alert.alert("Automatically process shared posts?",
          "OpenAI will process posts you share with Baby, including available text, images, audio and sampled video frames. Originals stay saved. You can turn this off in Settings. Recipes and Workouts data are not included.",
          [{ text: "Keep off", style: "cancel" }, { text: "Allow processing", onPress: () => setAutomatic(true) }])} />
      <Button title="Open my space" size="lg" busy={busy} onPress={() => void finish()} />
    </Screen>
  );
}
