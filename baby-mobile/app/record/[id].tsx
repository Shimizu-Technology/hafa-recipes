import { sourceTitle } from "@/lib/source-title";
import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { Image } from "expo-image";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { careSummary, duration, friendlyTime, isCare, summaryHoldsTitle } from "@/lib/care-format";
import { feedProgress } from "@/lib/feed-reducer";
import { kindName, messageFor, type BabyRecord } from "@/lib/models";
import { moreKinds } from "../../lib/more-logs";
import { datedOnly } from "../../lib/well-visits";
import { keyDate, recordDay } from "@/lib/tracker";
import { inheritedFiles, mutationRecordId, replaceRecord } from "@/lib/outbox";
import { PrivateAttachment } from "@/components/private-attachment";
import { Button, Card, Chips, Choice, Copy, Grouped, Loading, Notice, Row, Screen, Section, useToast } from "@/components/ui";
import { RecordRow } from "@/components/record-row";
import { SourceHero } from "@/components/saved-post-row";
import { tipTopic } from "@/lib/timing";
import { SourceContent } from "@/components/source-content";
import { Disclosure } from "@/components/disclosure";
import { TimingEditor, TimingRow } from "@/components/timing-editor";
import { RecordVisit } from "@/components/visit-sections";
import { ShareToggle } from "@/components/share-toggle";
import { duplicateHint, duplicateOf, loggedByName } from "../../lib/logged-by";
import { ensureAiConsent } from "../../lib/ai-consent";
import { babyLabel, isCaregiver } from "../../lib/spaces";
export default function RecordDetail() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    b = useBaby(),
    toast = useToast(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [missing, setMissing] = useState(false),
    [editingTiming, setEditingTiming] = useState(false),
    record = b.records.find((r) => r.id === id),
    pending = b.state.outbox.some((m) => mutationRecordId(m) === id && m.type !== "import");
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
  if (record.kind === "event") return <Redirect href={{ pathname: "/event/[id]", params: { id: record.id } }} />;
  const child = b.state.bootstrap!.children.find((c) => c.id === record.child_id),
    title = record.kind === "source" ? sourceTitle(record) : record.title,
    data = record.data,
    // Care and the timers read on the family's clock, as they do in Tracker. Everything else keeps the phone's.
    clock = isCare(record.kind) || record.kind === "contraction" || record.kind === "kick_session" || moreKinds.includes(record.kind) ? b.state.bootstrap?.profile.timezone : undefined,
    dateOnly = datedOnly(record),
    summary = moreKinds.includes(record.kind) ? careSummary(record.kind, data, record.occurred_at) : "",
    localFiles = inheritedFiles(b.state, record.id).filter(
      (file) => !file.uploaded_id || !data.attachment_ids?.includes(file.uploaded_id)
    );
  return (
    <Screen
      title={data.label ?? kindName[record.kind]}
      back
      numericSubtitle
      subtitle={(dateOnly ? keyDate(recordDay(record.occurred_at, b.state.bootstrap?.profile.timezone)).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
        : friendlyTime(record.occurred_at, undefined, clock)) + (child ? " · " + babyLabel(child, b.state.bootstrap) : "")}
    >
      {record.kind === "source" ? <SourceHero record={record} title={title} topic={tipTopic(record, b.records.filter((row) => row.kind === "collection"))} />
        : !summaryHoldsTitle(record.kind, title, summary) && title !== (data.label ?? kindName[record.kind]) && <Copy kind="heading">{title}</Copy>}
      {!!error && <Notice error>{error}</Notice>}
      {record.data.provenance === "clinician_instruction" && (
        <Notice>Clinician instruction · labeled by you. Keep the original context and date with this note.</Notice>
      )}
      {record.cache_partial && (
        <Notice>This device has a partial offline copy. Reconnect to load the complete source before editing.</Notice>
      )}
      {pending && <Notice>Saved on this device. Your latest changes will sync when a connection is available.</Notice>}
      {record.kind === "source" && <SourceContent data={data} onError={setError} />}
      {record.kind === "feeding" && (
        <Card tone="hero">
          <Copy kind="heading">{careSummary("feeding", data, record.occurred_at)}</Copy>
          {feedProgress(record, b.records) === "running" && <Copy tone="muted">Feeding now</Copy>}
          {feedProgress(record, b.records) === "no_end" && <Copy tone="muted">No end time</Copy>}
        </Card>
      )}
      {record.kind === "sleep" && (
        <Card tone="hero">
          <Copy kind="heading">{data.end_at ? "Sleep recorded" : "Sleep in progress"}</Copy>
          <Copy numeric>Started {friendlyTime(record.occurred_at, undefined, clock)}</Copy>
          {data.end_at ? (
            <>
              <Copy numeric>Ended {friendlyTime(data.end_at, undefined, clock)}</Copy>
              <Copy numeric>
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
      {!!summary && <Card tone="hero"><Copy numeric kind="heading">{summary}</Copy></Card>}
      {record.kind === "diaper" && (
        <Card tone="hero">
          <Copy kind="heading">{careSummary("diaper", data, record.occurred_at)}</Copy>
        </Card>
      )}
      {!!record.body && !(record.kind === "source" && record.body === data.source_text && !data.summary) && (
        <Section
          title={
            record.kind === "source" ? "Your notes" : record.kind === "question" ? "Your question & notes" : "Notes"
          }
        >
          <Copy>{record.body}</Copy>
        </Section>
      )}
      {record.kind === "routine" && (
        <>
          <Section title={data.routine_type === "checklist" ? "Your checklist" : "Your chosen routine"}>
            <Grouped separatorInset={52}>{(data.items ?? []).map((item) => (
              <View key={item.id} style={{ paddingHorizontal: 16 }}>
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
              </View>
            ))}</Grouped>
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
      {(record.kind === "question" || !!data.event_id) && <RecordVisit record={record} />}
      {!!loggedByName(record, b.state.bootstrap, b.owner) && <Copy kind="small" tone="muted">{`Logged by ${loggedByName(record, b.state.bootstrap, b.owner)}`}</Copy>}
      {(() => { const other = duplicateOf(record, b.records, b.owner), name = other && loggedByName(other, b.state.bootstrap, b.owner);
        return !!other && !!name && name !== loggedByName(record, b.state.bootstrap, b.owner) && <Notice>{duplicateHint(other, b.state.bootstrap, b.owner)}</Notice>; })()}
      <ShareToggle record={record} />
      {record.kind === "source" && editingTiming && <TimingEditor relevance={data.relevance} onClose={() => setEditingTiming(false)}
        onSave={(relevance) => { setEditingTiming(false); void update({ ...data, relevance }); }} />}
      <Grouped>
      {record.kind === "source" && !record.cache_partial && !editingTiming && <TimingRow relevance={data.relevance} onPress={() => setEditingTiming(true)} />}
      <Row
        title="Edit this entry"
        icon="pencil-outline"
        onPress={() => router.push({ pathname: "/edit", params: { id: record.id, kind: record.kind } })}
      />
      {!isCaregiver(b.state.bootstrap) && <Row
        title="Ask about this entry"
        icon="sparkles-outline"
        onPress={() => router.push({ pathname: "/ask-entry", params: { record_id: record.id } })}
      />}
      </Grouped>
      {record.kind === "source" && <Disclosure title="Process this post again">
        <Button
          secondary
          title="Process original with AI"
          icon="sparkles-outline"
          onPress={() => {
            void ensureAiConsent(b).then((allowed) => !allowed ? undefined : b
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
              .then(() => toast("Original preserved. Processing is queued.")))
              .catch((e) => setError(messageFor(e)));
          }}
        />
      </Disclosure>}
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
