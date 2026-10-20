import { useEffect, useState } from "react";
import { Alert, Linking, View } from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { careSummary, duration, friendlyTime } from "@/lib/care-format";
import { kindName, messageFor, sourceProcessingNotes, sourceEvidenceItems, type BabyRecord } from "@/lib/models";
import { inheritedFiles, replaceRecord } from "@/lib/outbox";
import { PrivateAttachment } from "@/components/private-attachment";
import { Button, Card, Chips, Choice, Copy, Loading, Notice, Row, Screen, Section, useToast } from "@/components/ui";
import { RecordRow } from "@/components/record-row";
export default function RecordDetail() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    b = useBaby(),
    toast = useToast(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [missing, setMissing] = useState(false),
    record = b.records.find((r) => r.id === id),
    pending = b.state.outbox.some((m) => m.type !== "import" && m.record.id === id);
  useEffect(() => {
    if (record && !record.cache_partial) return;
    let active = true;
    void b.api
      .record(id)
      .then((row) => {
        if (active) void b.commit((s) => ({ ...s, records: replaceRecord(s.records, row) }));
      })
      .catch((e) => {
        if (active) {
          setError(messageFor(e));
          setMissing(true);
        }
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function update(data: BabyRecord["data"]) {
    if (!record) return;
    setError("");
    try {
      await b.queue({
        id: Crypto.randomUUID(),
        generation: b.state.bootstrap!.generation,
        type: "save",
        record: { ...record, data },
        files: [],
      });
      toast("Saved.");
    } catch (e) {
      setError(messageFor(e));
    }
  }
  if (!record)
    return (
      <Screen title={missing ? "Entry unavailable" : "Opening your entry"} back>
        {error ? <Notice error>{error}</Notice> : <Loading />}
        <Button
          secondary
          title="Try again"
          onPress={() => {
            setMissing(false);
            setError("");
            void b.api
              .record(id)
              .then((row) => b.commit((s) => ({ ...s, records: replaceRecord(s.records, row) })))
              .catch((e) => setError(messageFor(e)));
          }}
        />
      </Screen>
    );
  const child = b.state.bootstrap!.children.find((c) => c.id === record.child_id),
    data = record.data,
    processingNotes = sourceProcessingNotes(data.coverage_notes),
    evidence = sourceEvidenceItems(data.evidence),
    localFiles = inheritedFiles(b.state, record.id).filter(
      (file) => !file.uploaded_id || !data.attachment_ids?.includes(file.uploaded_id)
    );
  return (
    <Screen
      title={record.title}
      back
      subtitle={friendlyTime(record.occurred_at) + (child ? " · " + child.name : "")}
    >
      {!!error && <Notice error>{error}</Notice>}
      {record.data.provenance === "clinician_instruction" && (
        <Notice>Clinician instruction · labeled by you. Keep the original context and date with this note.</Notice>
      )}
      {record.cache_partial && (
        <Notice>This device has a partial offline copy. Reconnect to load the complete source before editing.</Notice>
      )}
      {pending && <Notice>Saved on this device. Your latest changes will sync when a connection is available.</Notice>}
      {record.kind === "source" && (
        <>
          <Card tone="hero">
            <Copy kind="heading">Your saved source</Copy>
            <Copy tone="muted">
              Ideas from this source are its creator’s claims. Keep the original context close and choose what is useful
              to you.
            </Copy>
            {data.url && (
              <Button
                secondary
                title="Open original source"
                icon="open-outline"
                onPress={() => {
                  try {
                    const url = new URL(data.url!);
                    if (!["http:", "https:"].includes(url.protocol)) throw Error();
                    void Linking.openURL(url.toString()).catch(() => setError("Could not open the original link."));
                  } catch {
                    setError("This source has an invalid website link. Edit it to correct the address.");
                  }
                }}
              />
            )}
            {data.status && (
              <Copy kind="small" tone="muted">
                Status: {data.status}
              </Copy>
            )}
          </Card>
          {processingNotes.length > 0 && (
            <Section title="Processing notes">
              <Card tone="soft">
                {processingNotes.map((note, i) => (
                  <Copy key={i}>{note}</Copy>
                ))}
              </Card>
            </Section>
          )}
          {(data.topics ?? []).length > 0 && (
            <Copy kind="small" tone="muted">
              {data.topics!.join(" · ")}
            </Copy>
          )}
          {data.summary && (
            <Section title="Source summary">
              <Card>
                <Copy>{data.summary}</Copy>
              </Card>
            </Section>
          )}
          {evidence.length > 0 && (
            <Section title="What was found">
              {evidence.map((e, i) => (
                <Card key={i} tone="soft">
                  <Copy>{e.text}</Copy>
                  {e.location && (
                    <Copy kind="small" tone="muted">
                      {e.location}
                    </Copy>
                  )}
                  {e.timestamp && (
                    <Copy kind="small" tone="muted">
                      At {e.timestamp}
                    </Copy>
                  )}
                  {e.source && (
                    <Copy kind="small" tone="muted">
                      {e.source}
                    </Copy>
                  )}
                </Card>
              ))}
            </Section>
          )}
          {data.source_text && (
            <Section title="Extracted source text">
              <Card>
                <Copy>{data.source_text}</Copy>
              </Card>
            </Section>
          )}
          {!data.summary && !data.source_text && !evidence.length && (
            <Notice>
              No extracted summary or transcript is available. Your original link, attachments, and notes are still
              kept.
            </Notice>
          )}
        </>
      )}
      {record.kind === "feeding" && (
        <Card tone="hero">
          <Copy kind="heading">{careSummary("feeding", data, record.occurred_at)}</Copy>
        </Card>
      )}
      {record.kind === "sleep" && (
        <Card tone="hero">
          <Copy kind="heading">{data.end_at ? "Sleep recorded" : "Sleep in progress"}</Copy>
          <Copy>Started {friendlyTime(record.occurred_at)}</Copy>
          {data.end_at ? (
            <>
              <Copy>Ended {friendlyTime(data.end_at)}</Copy>
              <Copy>
                {duration((new Date(data.end_at).getTime() - new Date(record.occurred_at).getTime()) / 60000)}
              </Copy>
            </>
          ) : (
            <Button
              title="Finish this sleep now"
              icon="checkmark"
              onPress={() => void update({ ...data, end_at: new Date().toISOString() })}
            />
          )}
        </Card>
      )}
      {record.kind === "diaper" && (
        <Card tone="hero">
          <Copy kind="heading">{careSummary("diaper", data, record.occurred_at)}</Copy>
        </Card>
      )}
      {!!record.body && (
        <Section
          title={
            record.kind === "source" ? "Your notes" : record.kind === "question" ? "Your question & notes" : "Notes"
          }
        >
          <Card>
            <Copy>{record.body}</Copy>
          </Card>
        </Section>
      )}
      {record.kind === "routine" && (
        <>
          <Section title={data.routine_type === "checklist" ? "Your checklist" : "Your chosen routine"}>
            {(data.items ?? []).map((item) => (
              <Card key={item.id} tone="soft">
                <Choice
                  label={item.label}
                  selected={item.done}
                  onPress={() =>
                    void update({
                      ...data,
                      items: data.items?.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)),
                    })
                  }
                />
              </Card>
            ))}
          </Section>
          <Notice>
            {data.enabled && data.reminder_at
              ? data.routine_type === "checklist" && data.items?.length && data.items.every((item) => item.done)
                ? "Checklist complete. Reminders are paused."
                : `Reminder enabled for ${friendlyTime(data.reminder_at)}${data.repeat === "daily" ? " · daily" : data.repeat === "weekly" ? " · weekly" : ""}. Repeating reminders use ${data.timezone ?? "the chosen timezone"}.`
              : "Reminders are off. Edit this routine to choose a time and activate a reminder."}
          </Notice>
        </>
      )}
      {record.kind === "collection" && (
        <Section title="In this collection">
          {(data.record_ids ?? []).map((id) => {
            const row = b.records.find((r) => r.id === id);
            return row ? (
              <RecordRow key={id} record={row} />
            ) : (
              <Row
                key={id}
                title="Open saved source"
                icon="bookmark-outline"
                onPress={() => router.push({ pathname: "/record/[id]", params: { id } })}
              />
            );
          })}
        </Section>
      )}
      {((data.attachment_ids ?? []).length > 0 || localFiles.length > 0) && (
        <Section title="Private attachments">
          {localFiles.map((file) => (
            <Card key={file.id}>
              {file.mime_type.startsWith("image/") && (
                <Image
                  source={{ uri: file.uri }}
                  accessibilityLabel={file.name}
                  cachePolicy="none"
                  contentFit="contain"
                  style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 14 }}
                />
              )}
              <Copy kind="small">{file.name}</Copy>
              <Copy kind="small" tone="muted">
                Saved on this device. The original will upload when syncing resumes.
              </Copy>
            </Card>
          ))}
          {(data.attachment_ids ?? []).map((attachmentId) => (
            <PrivateAttachment key={attachmentId} id={attachmentId} />
          ))}
        </Section>
      )}
      <Button
        secondary
        title="Edit this entry"
        icon="pencil-outline"
        onPress={() => router.push({ pathname: "/edit", params: { id: record.id, kind: record.kind } })}
      />
      {record.kind === "source" && (
        <Button
          secondary
          title="Process original with AI"
          icon="sparkles-outline"
          onPress={() => {
            if (!b.state.bootstrap!.profile.ai_consent) {
              setError("Enable optional AI processing in Settings first.");
              return;
            }
            void b
              .queue({
                id: Crypto.randomUUID(),
                type: "import",
                record_id: record.id,
                attachment_ids: data.attachment_ids,
                generation: b.state.bootstrap!.generation,
                url: data.url,
                text: [record.body, data.source_text].filter(Boolean).join("\n\n") || undefined,
                files: [],
                child_id: record.child_id,
                topics: data.topics,
              })
              .then(() => toast("Original preserved. Processing is queued."))
              .catch((e) => setError(messageFor(e)));
          }}
        />
      )}
      <Button
        secondary
        title="Ask about this entry"
        icon="sparkles-outline"
        onPress={() => router.push({ pathname: "/(tabs)/ask", params: { record_id: record.id } })}
      />
      <Button
        variant="destructive"
        title="Delete this entry"
        onPress={() =>
          Alert.alert(
            "Delete this entry?",
            "This removes the saved entry from your Baby history. This action cannot be undone after syncing.",
            [
              { text: "Keep entry", style: "cancel" },
              {
                text: "Delete entry",
                style: "destructive",
                onPress: () => {
                  void b
                    .queue({
                      id: Crypto.randomUUID(),
                      generation: b.state.bootstrap!.generation,
                      type: "delete",
                      record,
                    })
                    .then(() => {
                      toast("Entry removed.");
                      router.back();
                    })
                    .catch((e) => setError(messageFor(e)));
                },
              },
            ]
          )
        }
      />
      <View style={{ height: 20 }} />
    </Screen>
  );
}
