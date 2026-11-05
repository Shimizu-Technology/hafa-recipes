import { useState } from "react";
import { Alert } from "react-native";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { ApiError } from "@/lib/api";
import { friendlyDate } from "@/lib/care-format";
import { messageFor, pendingChanges, type BabyRecord, type Mutation } from "@/lib/models";
import { keepInPersonal, laterChangesNotice, queuedChain, retryMutation, waitingForEarlier, waitingForImport } from "@/lib/outbox";
import { exportFile } from "@/lib/files";
import { recordDay } from "@/lib/tracker";
import { trackerForKey } from "../lib/trackers";
import { Button, Card, Copy, Empty, Notice, Screen, Section, useToast } from "@/components/ui";
function rebase(row: Mutation, revision: number): Mutation {
  if (row.type !== "save" && row.type !== "delete") return row;
  if (row.type === "delete") return { ...retryMutation(row), record: { ...row.record, revision } };
  return { ...retryMutation(row), record: { ...row.record, revision } };
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
    // Once sent, the API may already have it, so this phone asks before forgetting it and showing the old copy again.
    const unread = Error("This change may already be saved. Reconnect to check it before discarding.");
    if ((m.type === "feed_action" || m.type === "session_action") && m.sent) {
      const row = await b.api.record(m.record_id).catch((e) => {
        if (e instanceof ApiError && !e.local && e.status === 404) return null;
        throw unread;
      });
      await b.discardQueued(m.id, row);
    } else if ((m.type === "child_birth" || m.type === "child_tracking") && m.sent) {
      const fresh = await b.api.bootstrap().catch(() => { throw unread; });
      await b.discardQueued(m.id, undefined, fresh.children.find((child) => child.id === m.child_id));
    } else await b.discardQueued(m.id, remote[m.id]);
    // Other offline revisions may share these private original files. Explicit device cleanup clears them safely.
  }
  /** One durable write takes these together, so she's told how many before it happens. */
  const alsoGone = (m: Mutation) => laterChangesNotice(queuedChain(b.state.outbox, m).length - 1);
  async function retry(m: Mutation) {
    await b.commit((s) => ({
      ...s,
      outbox: s.outbox.map((row) => (row.id === m.id ? retryMutation(row) : row)),
    }));
    await b.sync();
  }
  return (
    <Screen
      title="Sync & recovery"
      subtitle="Review what’s waiting, recover a conflict, or keep a text backup."
      back
    >
      {!!error && <Notice error>{error}</Notice>}
      {!!b.error && b.error !== error && <Notice error>{b.error}</Notice>}
      <Notice>
        {b.online
          ? "Changes sync independently. Failed changes wait for your review; later changes to the same entry wait too."
          : "You’re offline. Your entries and drafts are kept privately on this device."}
      </Notice>
      <Button
        title={b.syncing ? "Syncing…" : "Sync now"}
        icon="sync-outline"
        busy={b.syncing || busy}
        onPress={() => void run(b.sync)}
      />
      {b.state.outbox.length ? (
        <Section title={pendingChanges(b.state.outbox.length)}>
          {b.state.outbox.map((m) => (
            <Card key={m.id}>
              <Copy kind="heading">
                {m.type === "import"
                  ? "Source import"
                  : m.type === "feed_action"
                  ? "Feeding update"
                  : m.type === "session_action"
                  ? "Timer update"
                  : m.type === "child_birth"
                  ? "Birth date"
                  : m.type === "child_tracking"
                  ? "What shows"
                  : m.type === "event_split"
                  ? m.event.title
                  : m.type === "delete"
                    ? "Delete: " + m.record.title
                    : m.record.title}
              </Copy>
              <Copy kind="small" tone="muted">
                {m.left_space
                  ? "Not sent"
                  : m.localOnly
                  ? "Kept on this phone · not syncing"
                  : m.conflict
                  ? "Needs a conflict review"
                  : m.error
                    ? "Needs your attention"
                    : (waitingForEarlier(b.state.outbox, m) || waitingForImport(b.state.imports, m))
                      ? "Waiting for an earlier change to this entry"
                      : "Safely queued on this device"}
              </Copy>
              {m.type === "import" ? (
                <Copy>{m.url || m.text || "Attached source files"}</Copy>
              ) : m.type === "feed_action" || m.type === "session_action" ? (
                <Copy>{`Saved at ${new Date(m.action.at).toLocaleTimeString()}.`}</Copy>
              ) : m.type === "child_birth" ? (
                <Copy>{m.birth_date ? `Born ${friendlyDate(m.birth_date)}.` : "Taking the birth date back."}</Copy>
              ) : m.type === "child_tracking" ? (
                <Copy>{`${Object.entries(m.tracking).filter(([id]) => trackerForKey(id)).map(([id, on]) => `${trackerForKey(id)!.label} ${on ? "on" : "off"}`).join(", ") || "A suggestion answered"}.`}</Copy>
              ) : m.type === "event_split" ? (
                <Copy>{`Changes ${m.series.title} from ${friendlyDate(recordDay(m.from_start, m.series.data.timezone))} on. Discarding this keeps every date as it was.`}</Copy>
              ) : (
                <Copy>{m.record.body || "Care details and attachments are saved with this change."}</Copy>
              )}
              {m.error && <Notice error>{m.error}</Notice>}
              {!!m.left_space && queuedChain(b.state.outbox, m).some((row) => row.type === "save") && (
                <Button
                  secondary
                  title="Keep in my personal space"
                  disabled={b.syncing || busy}
                  onPress={() =>
                    void run(async () => {
                      await b.commit((s) => { const held = s.outbox.find((row) => row.id === m.id); return held ? keepInPersonal(s, held, Crypto.randomUUID) : s; });
                      toast("Kept in your personal space.");
                      await b.sync();
                    })
                  }
                />
              )}
              {m.conflict && (m.type === "save" || m.type === "delete") && (
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
                            `The reviewed server version will be kept. This removes the local change shown above. ${alsoGone(m)}`.trim(),
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
                                ...retryMutation(row),
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
              {!m.left_space && !m.localOnly && (m.error || m.conflict) && (
                <Button secondary title="Keep on this phone" disabled={b.syncing || busy}
                  onPress={() => void run(async () => {
                    await b.commit(s => ({ ...s, outbox: s.outbox.map(row => row.id === m.id ? { ...row, localOnly: true } : row) }));
                  })} />
              )}
              {!m.left_space && !m.conflict && (m.error || m.localOnly) && (
                <Button secondary title="Retry" busy={busy} onPress={() => void run(() => retry(m))} />
              )}
              <Button
                variant="destructive"
                disabled={b.syncing || busy}
                title="Discard this queued change"
                onPress={() =>
                  Alert.alert(
                    "Discard this change?",
                    `${alsoGone(m) || "This removes this unsynced change."} You can export a text backup first.`,
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
