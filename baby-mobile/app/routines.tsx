import { useState } from "react";
import { router } from "expo-router";
import { View } from "react-native";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import type { BabyRecord } from "@/lib/models";
import { messageFor } from "@/lib/models";
import { Button, HeaderAction, Card, Choice, Copy, Empty, Notice, Row, Screen, Section } from "@/components/ui";
import { friendlyTime } from "@/lib/care-format";
import { ChildFilter } from "@/components/child-filter";
import { SyncStatus } from "@/components/sync-status";
import { findBag, isBag, packedLine } from "../lib/hospital-bag";
export default function Routines() {
  const b = useBaby(),
    [error, setError] = useState(""),
    // The hospital bag has its own screen, grouped the way it's packed; here it's one row.
    bag = findBag(b.records),
    routines = b.records.filter(
      (r) => r.kind === "routine" && !isBag(r) && (!b.state.selectedChild || !r.child_id || r.child_id === b.state.selectedChild)
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
      title="Lists & routines"
      back
      onRefresh={() => b.sync()}
      subtitle="Plans you choose. Reminders you control."
      action={
        routines.length > 0 && <HeaderAction
          title="Create"
          onPress={() => router.push({ pathname: "/edit", params: { kind: "routine" } })}
        />
      }
    >
      <SyncStatus />
      <ChildFilter />
      {!!error && <Notice error>{error}</Notice>}
      <Row title="Hospital bag" numericDetail detail={bag ? packedLine(bag) : "A starter list to pack from"} icon="bag-handle-outline"
        onPress={() => router.push("/hospital-bag")} />
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
                    : `Reminder ${friendlyTime(r.data.reminder_at)}${r.data.repeat === "daily" ? " · daily" : r.data.repeat === "weekly" ? " · weekly" : ""}`
                  : "No active reminders"}
              </Copy>
              <Button
                variant="ghost"
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
          body="Appointment prep, an evening routine, or any list you have chosen. Nothing is activated for you."
          action={
            <Button
              secondary
              title="Create your first routine"
              onPress={() => router.push({ pathname: "/edit", params: { kind: "routine" } })}
            />
          }
        />
      )}

      <Row
        title="Have a schedule in a photo?"
        detail="Save it to your library to keep it with your records."
        icon="document-outline"
        onPress={() => router.push({ pathname: "/edit", params: { kind: "source" } })}
      />
    </Screen>
  );
}
