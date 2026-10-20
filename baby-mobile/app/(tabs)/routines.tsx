import { useState } from "react";
import { router } from "expo-router";
import { View } from "react-native";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import type { BabyRecord } from "@/lib/models";
import { messageFor } from "@/lib/models";
import { Button, Card, Choice, Copy, Empty, Notice, Screen, Section } from "@/components/ui";
import { ChildFilter } from "@/components/child-filter";
import { SyncStatus } from "@/components/sync-status";
export default function Routines() {
  const b = useBaby(),
    [error, setError] = useState(""),
    routines = b.records.filter(
      (r) => r.kind === "routine" && (!b.state.selectedChild || !r.child_id || r.child_id === b.state.selectedChild)
    );
  async function toggle(record: BabyRecord, id: string) {
    try {
      await b.queue({
        id: Crypto.randomUUID(),
        generation: b.state.bootstrap!.generation,
        type: "save",
        record: {
          ...record,
          data: {
            ...record.data,
            items: record.data.items?.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
          },
        },
        files: [],
      });
    } catch (e) {
      setError(messageFor(e));
    }
  }
  return (
    <Screen
      title="Find your rhythm."
      subtitle="Plans you choose. Reminders you control."
      action={
        <Button
          secondary
          title="Create"
          icon="add"
          onPress={() => router.push({ pathname: "/edit", params: { kind: "routine" } })}
        />
      }
    >
      <SyncStatus />
      <ChildFilter />
      {!!error && <Notice error>{error}</Notice>}
      <Card tone="soft">
        <Copy kind="heading">Have a schedule in a photo?</Copy>
        <Copy tone="muted">
          Save the image or document to your library. Ask about that source to draft a routine, then review the steps
          and choose whether to activate reminders.
        </Copy>
        <Button
          secondary
          title="Import a schedule"
          icon="document-outline"
          onPress={() => router.push({ pathname: "/edit", params: { kind: "source" } })}
        />
      </Card>
      {routines.length ? (
        <Section title="Your routines">
          {routines.map((r) => (
            <Card key={r.id}>
              <Copy kind="heading">{r.title}</Copy>
              {!!r.body && <Copy tone="muted">{r.body}</Copy>}
              {(r.data.items ?? []).map((i) => (
                <Choice key={i.id} label={i.label} selected={i.done} onPress={() => void toggle(r, i.id)} />
              ))}
              <Copy kind="small" tone="muted">
                {r.data.enabled && r.data.reminder_at
                  ? r.data.routine_type === "checklist" && r.data.items?.length && r.data.items.every((item) => item.done)
                    ? "Checklist complete. Reminders are paused."
                    : `Reminder ${new Date(r.data.reminder_at).toLocaleString()}${r.data.repeat === "daily" ? " · daily" : r.data.repeat === "weekly" ? " · weekly" : ""}`
                  : "No active reminders"}
              </Copy>
              <Button
                secondary
                title="Review or edit"
                onPress={() => router.push({ pathname: "/record/[id]", params: { id: r.id } })}
              />
            </Card>
          ))}
        </Section>
      ) : (
        <Empty
          icon="checkmark-circle-outline"
          title="Make room for what helps."
          body="Start with a hospital bag list, appointment prep, or a routine you have chosen. Nothing is activated for you."
          action={
            <Button
              secondary
              title="Create your first routine"
              onPress={() => router.push({ pathname: "/edit", params: { kind: "routine" } })}
            />
          }
        />
      )}
      <Button secondary title="Refresh routines" busy={b.syncing} onPress={() => void b.sync()} />
      <View style={{ height: 60 }} />
    </Screen>
  );
}
