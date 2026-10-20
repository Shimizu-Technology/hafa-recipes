import { useState } from "react";
import { Alert } from "react-native";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { messageFor, type BabyRecord, type Mutation } from "@/lib/models";
import { replaceRecord } from "@/lib/outbox";
import { exportFile, removeLocal } from "@/lib/files";
import { Button, Card, Copy, Empty, Notice, Screen, Section, useToast } from "@/components/ui";
function rebase(row: Mutation, revision: number): Mutation {
  if (row.type === "import") return row;
  if (row.type === "delete") return { ...row, record: { ...row.record, revision }, error: undefined, conflict: false };
  return { ...row, record: { ...row.record, revision }, error: undefined, conflict: false };
}
export default function Sync() {
  const b = useBaby(),
    toast = useToast(),
    [error, setError] = useState(""),
    [remote, setRemote] = useState<Record<string, BabyRecord>>({}),
    [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }
  async function discard(m: Mutation) {
    if (b.syncing) throw Error("Wait for the current sync to finish before discarding a queued change.");
    await b.discardQueued(m.id, remote[m.id]);
    // Other offline revisions may share these private original files. Explicit device cleanup clears them safely.
  }
  async function retry(m: Mutation) {
    await b.commit((s) => ({
      ...s,
      outbox: s.outbox.map((row) => (row.id === m.id ? { ...row, error: undefined, conflict: false } : row)),
    }));
    await b.sync();
  }
  return (
    <Screen
      title="Saved, even offline."
      subtitle="Review what’s waiting, recover a conflict, or keep a text backup."
      back
    >
      {!!error && <Notice error>{error}</Notice>}
      {!!b.error && b.error !== error && <Notice error>{b.error}</Notice>}
      <Notice>
        {b.online
          ? "Your device is online. Pending changes retry when you return to the app."
          : "You’re offline. Your entries and drafts are kept privately on this device."}
      </Notice>
      <Button
        title={b.syncing ? "Syncing…" : "Sync now"}
        icon="sync-outline"
        busy={b.syncing || busy}
        onPress={() => void run(b.sync)}
      />
      {b.state.outbox.length ? (
        <Section title={`${b.state.outbox.length} pending changes`}>
          {b.state.outbox.map((m) => (
            <Card key={m.id}>
              <Copy kind="heading">
                {m.type === "import"
                  ? "Source import"
                  : m.type === "delete"
                    ? "Delete: " + m.record.title
                    : m.record.title}
              </Copy>
              <Copy kind="small" tone="muted">
                {m.conflict
                  ? "Needs a conflict review"
                  : m.error
                    ? "Needs your attention"
                    : "Safely queued on this device"}
              </Copy>
              {m.type === "import" ? (
                <Copy>{m.url || m.text || "Attached source files"}</Copy>
              ) : (
                <Copy>{m.record.body || "Care details and attachments are saved with this change."}</Copy>
              )}
              {m.error && <Notice error>{m.error}</Notice>}
              {m.conflict && m.type !== "import" && (
                <>
                  <Button
                    secondary
                    title="Load saved version to compare"
                    busy={busy}
                    onPress={() =>
                      void run(async () => {
                        const saved = await b.api.record(m.record.id);
                        setRemote((prior) => ({ ...prior, [m.id]: saved }));
                      })
                    }
                  />
                  {remote[m.id] && (
                    <Card tone="soft">
                      <Copy kind="label" tone="muted">
                        Current saved version
                      </Copy>
                      <Copy kind="heading">{remote[m.id].title}</Copy>
                      <Copy>{remote[m.id].body || "No written notes."}</Copy>
                      <Copy kind="small" tone="muted">
                        Updated {new Date(remote[m.id].updated_at).toLocaleString()}
                      </Copy>
                      <Button
                        secondary
                        title={m.type === "delete" ? "Delete this reviewed version" : "Save my version after review"}
                        onPress={() =>
                          Alert.alert(
                            m.type === "delete"
                              ? "Delete the reviewed server version?"
                              : "Replace the reviewed server version?",
                            "Your local change will be applied to the version shown here. If it changes again, another review is required.",
                            [
                              { text: "Keep reviewing", style: "cancel" },
                              {
                                text: m.type === "delete" ? "Delete version" : "Save my version",
                                style: m.type === "delete" ? "destructive" : "default",
                                onPress: () =>
                                  void run(async () => {
                                    await b.commit((s) => ({
                                      ...s,
                                      outbox: s.outbox.map((row) =>
                                        row.id === m.id ? rebase(row, remote[m.id].revision) : row
                                      ),
                                    }));
                                    await b.sync();
                                  }),
                              },
                            ]
                          )
                        }
                      />
                      <Button
                        variant="ghost"
                        disabled={b.syncing || busy}
                        title="Keep the server version"
                        onPress={() =>
                          Alert.alert(
                            "Discard this local change?",
                            "The reviewed server version will be kept. This removes the local change shown above.",
                            [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Discard local change",
                                style: "destructive",
                                onPress: () => void run(() => discard(m)),
                              },
                            ]
                          )
                        }
                      />
                    </Card>
                  )}
                </>
              )}
              {m.conflict && m.type === "save" && (
                <Button
                  secondary
                  title="Keep my version as a new entry"
                  onPress={() =>
                    void run(async () => {
                      await b.commit((s) => ({
                        ...s,
                        outbox: s.outbox.map((row) =>
                          row.id === m.id && row.type === "save"
                            ? {
                                ...row,
                                record: {
                                  ...row.record,
                                  id: Crypto.randomUUID(),
                                  revision: undefined,
                                  data: {
                                    ...row.record.data,
                                    ...(row.record.kind === "routine" ? { enabled: false } : {}),
                                  },
                                },
                                error: undefined,
                                conflict: false,
                              }
                            : row
                        ),
                      }));
                      await b.sync();
                    })
                  }
                />
              )}
              {!m.conflict && m.error && (
                <Button secondary title="Retry this change" busy={busy} onPress={() => void run(() => retry(m))} />
              )}
              <Button
                variant="destructive"
                disabled={b.syncing || busy}
                title="Discard this queued change"
                onPress={() =>
                  Alert.alert(
                    "Discard this change?",
                    "This removes this unsynced change and its local files. It cannot be recovered here. You can export a text backup first.",
                    [
                      { text: "Keep change", style: "cancel" },
                      { text: "Discard change", style: "destructive", onPress: () => void run(() => discard(m)) },
                    ]
                  )
                }
              />
            </Card>
          ))}
        </Section>
      ) : (
        <Empty
          icon="cloud-done-outline"
          title="Everything is caught up."
          body="There are no pending changes on this device. Your unfinished drafts stay here until you save or discard them."
        />
      )}
      <Button
        secondary
        title="Export a private device text backup"
        icon="download-outline"
        busy={busy}
        onPress={() =>
          void run(async () => {
            await exportFile(
              {
                created_at: new Date().toISOString(),
                note: "Device text backup. Local file references are not embedded attachments.",
                data: b.state,
              },
              b.owner
            );
            toast("Device text backup shared.");
          })
        }
      />
    </Screen>
  );
}
