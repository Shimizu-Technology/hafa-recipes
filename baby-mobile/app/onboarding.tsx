import { useState } from "react";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { messageFor } from "@/lib/models";
import { Button, Card, Copy, Field, Notice, Screen } from "@/components/ui";
import { DateField } from "@/components/date-field";
export default function Onboarding() {
  const b = useBaby(),
    [name, setName] = useState(b.state.bootstrap!.profile.display_name),
    [child, setChild] = useState(""),
    [due, setDue] = useState(""),
    [birth, setBirth] = useState(""),
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
    <Screen title="Make yourself at home." subtitle="Just a few details. Everything can be changed later." back>
      <Card tone="hero">
        <Copy kind="heading">Created for the moments that matter.</Copy>
        <Copy>Your sources, your thoughts, your baby’s care. One private space, at your pace.</Copy>
      </Card>
      {!!error && <Notice error>{error}</Notice>}
      <Field label="What should we call you?" value={name} onChange={setName} placeholder="Kami" />
      <Field label="Baby’s name or nickname (optional)" value={child} onChange={setChild} placeholder="Baby Shimizu" />
      {!!child.trim() && (
        <>
          <DateField label="Due date (optional)" dateOnly optional value={due} onChange={setDue} />
          <DateField label="Birth date (optional)" dateOnly optional value={birth} onChange={setBirth} />
        </>
      )}
      <Notice>
        You can start saving and writing now. AI processing and notifications stay off until you choose them.
      </Notice>
      <Button title="Open my space" size="lg" busy={busy} onPress={() => void finish()} />
    </Screen>
  );
}
