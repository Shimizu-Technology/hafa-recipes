import { useState } from "react";
import { Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { messageFor } from "@/lib/models";
import { Button, Card, Copy, Field, Notice, Screen, useToast } from "@/components/ui";
import { DateField } from "@/components/date-field";
export default function ChildEditor() {
  const { id } = useLocalSearchParams<{ id?: string }>(),
    b = useBaby(),
    toast = useToast(),
    child = b.state.bootstrap!.children.find((c) => c.id === id),
    [name, setName] = useState(child?.name ?? ""),
    [birth, setBirth] = useState(child?.birth_date ?? ""),
    [due, setDue] = useState(child?.due_date ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [creationId] = useState(Crypto.randomUUID);
  async function save() {
    if (!name.trim()) {
      setError("Enter a name or nickname. You can change it later.");
      return;
    }
    setBusy(true);
    try {
      const result = await b.api.child(
        {
          id: child?.id ?? creationId,
          name: name.trim(),
          birth_date: birth || null,
          due_date: due || null,
          ...(child ? { revision: child.revision } : {}),
        },
        b.state.bootstrap!.generation
      );
      await b.commit((s) => ({
        ...s,
        bootstrap: { ...s.bootstrap!, children: [result, ...s.bootstrap!.children.filter((c) => c.id !== result.id)] },
      }));
      toast("Profile saved.");
      router.back();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen
      title={child ? "A little update" : "Someone new to love."}
      subtitle="A profile keeps the right memories and care together. No separate login needed."
      back
    >
      {!!error && <Notice error>{error}</Notice>}
      <Field label="Name or nickname" value={name} onChange={setName} placeholder="Baby Shimizu" />
      <DateField label="Due date (optional)" value={due} onChange={setDue} dateOnly optional />
      <DateField label="Birth date (optional)" value={birth} onChange={setBirth} dateOnly optional />
      <Button title="Save profile" busy={busy} onPress={() => void save()} />
      {child && (
        <Button
          variant="ghost"
          title="Remove this profile"
          onPress={() =>
            Alert.alert(
              "Remove this child profile?",
              "Saved entries remain in your personal history without this profile. Review or export anything you need first.",
              [
                { text: "Keep profile", style: "cancel" },
                {
                  text: "Remove profile",
                  style: "destructive",
                  onPress: () => {
                    setBusy(true);
                    void b.api
                      .deleteChild(child, b.state.bootstrap!.generation)
                      .then(() => b.refresh())
                      .then(() => router.back())
                      .catch((e) => setError(messageFor(e)))
                      .finally(() => setBusy(false));
                  },
                },
              ]
            )
          }
        />
      )}
    </Screen>
  );
}
