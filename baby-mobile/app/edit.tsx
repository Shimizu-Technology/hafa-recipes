import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Image, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useBaby } from "@/lib/context";
import { kindName, messageFor, type EditorDraft, type Kind, type Mutation, type RecordData } from "@/lib/models";
import { addMutation, inheritedFiles } from "@/lib/outbox";
import { preserveFile, removeLocal } from "@/lib/files";
import { requestReminders } from "@/lib/reminders";
import { Button, Card, Chips, Choice, Copy, Field, Loading, Notice, Screen, Section, useToast } from "@/components/ui";
import { DateField } from "@/components/date-field";
import { careSummary, defaultChild, friendlyTime, isCare } from "@/lib/care-format";
import { nextFeed } from "@/lib/care-glance";
import { undoSaved } from "@/lib/quick-care";
import { CollectionSources } from "@/components/collection-sources";
function fresh(kind: Kind, child: string | null, prefill: RecordData = {}): EditorDraft {
  return {
    id: Crypto.randomUUID(),
    kind,
    title: "",
    body: "",
    child_id: child,
    occurred_at: new Date().toISOString(),
    files: [],
    data:
      kind === "feeding"
        ? { method: "breast", side: "both", ...prefill }
        : kind === "diaper"
          ? { type: "wet" }
          : kind === "routine"
            ? { routine_type: "checklist", items: [], enabled: false, repeat: "none" }
            : kind === "source"
              ? { topics: [], status: "saved" }
              : kind === "collection"
                ? { record_ids: [] }
                : {},
  };
}
export default function Edit() {
  const params = useLocalSearchParams<{ kind?: Kind; id?: string; draft?: string }>(),
    b = useBaby(),
    toast = useToast(),
    slot = params.draft ?? (params.id ? "record:" + params.id : "new:" + (params.kind ?? "journal"));
  const [draft, setDraft] = useState<EditorDraft | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [item, setItem] = useState(""),
    [showDetails, setShowDetails] = useState(!!params.id);
  const latest = useRef<EditorDraft | null>(null),
    loaded = useRef(false),
    retired = useRef(false),
    working = useRef(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        let d = b.state.drafts[slot];
        if (!d && params.id) {
          let row = b.records.find((r) => r.id === params.id);
          if (!row || row.cache_partial) row = await b.api.record(params.id);
          d = { ...row, files: inheritedFiles(b.state, row.id), existing: true };
        }
        const kind = params.kind ?? "journal",
          child = defaultChild(kind, b.state.selectedChild, b.state.bootstrap!.children),
          lastFeed = b.records
            .filter((r) => r.kind === "feeding" && r.child_id === child)
            .sort((x, y) => y.occurred_at.localeCompare(x.occurred_at))[0];
        d ??= fresh(kind, child, kind === "feeding" ? nextFeed(lastFeed) : {});
        if (active) {
          latest.current = d;
          setDraft(d);
          loaded.current = true;
        }
      } catch (e) {
        if (active) setError(messageFor(e));
      }
    })();
    return () => {
      active = false;
      if (!retired.current && latest.current) void b.saveDraft(slot, latest.current).catch(() => undefined);
    };
  }, [slot]);
  useEffect(() => {
    if (!draft || !loaded.current || retired.current) return;
    setSaved(false);
    const timer = setTimeout(() => {
      if (retired.current) return;
      void b
        .saveDraft(slot, draft)
        .then(() => setSaved(true))
        .catch((e) => setError(messageFor(e)));
    }, 400);
    return () => clearTimeout(timer);
  }, [draft]);
  useEffect(() => {
    const app = AppState.addEventListener("change", (s) => {
      if (s !== "active" && !retired.current && latest.current)
        void b.saveDraft(slot, latest.current).catch(() => undefined);
    });
    return () => app.remove();
  }, [slot]);
  function change(value: Partial<EditorDraft>) {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, ...value };
      latest.current = next;
      return next;
    });
  }
  function data(value: Partial<RecordData>) {
    change({ data: { ...latest.current!.data, ...value } });
  }
  async function run(fn: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function choose(type: "photo" | "camera" | "document") {
    await run(async () => {
      const files: EditorDraft["files"] = [];
      if (type === "document") {
        const result = await DocumentPicker.getDocumentAsync({
          type: ["image/*", "application/pdf", "video/*", "audio/*"],
          multiple: true,
          copyToCacheDirectory: true,
        });
        if (result.canceled) return;
        for (const asset of result.assets) files.push(await preserveFile(b.owner, asset));
      } else {
        if (type === "camera") {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted)
            throw Error("Camera access is off. You can enable it in Settings or choose an existing photo.");
        }
        const result =
          type === "camera"
            ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
            : await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images", "videos"],
                allowsMultipleSelection: true,
                quality: 0.8,
                selectionLimit: 4,
              });
        if (result.canceled) return;
        for (const asset of result.assets)
          files.push(
            await preserveFile(b.owner, {
              uri: asset.uri,
              name: asset.fileName ?? (asset.type === "video" ? "video.mp4" : "photo.jpg"),
              mimeType: asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg"),
              size: asset.fileSize,
            })
          );
      }
      if (!b.current()) return;
      change({ files: [...latest.current!.files, ...files] });
      await b.saveDraft(slot, latest.current!);
    });
  }
  function validate(d: EditorDraft) {
    if (
      !d.title.trim() &&
      !d.body.trim() &&
      !d.files.length &&
      !["feeding", "sleep", "diaper"].includes(d.kind) &&
      !d.data.url
    )
      throw Error("Add a title, a note, or a source to keep.");
    if (isCare(d.kind) && !d.existing && !d.child_id && b.state.bootstrap!.children.length)
      throw Error("Choose which baby this is for.");
    if (d.kind === "feeding" && d.data.amount != null && (!Number.isFinite(d.data.amount) || d.data.amount <= 0))
      throw Error("Enter an amount greater than zero, or leave it empty.");
    if (d.kind === "feeding" && d.data.duration_minutes != null &&
      (!Number.isFinite(d.data.duration_minutes) || d.data.duration_minutes <= 0))
      throw Error("Enter a duration greater than zero, or leave it empty.");
    if (d.kind === "sleep" && d.data.end_at && new Date(d.data.end_at) < new Date(d.occurred_at))
      throw Error("Sleep must end after it starts.");
    if (d.kind === "routine" && d.data.enabled && !d.data.reminder_at)
      throw Error("Choose a reminder date and time first.");
    if (d.kind === "source" && d.data.url) {
      const url = new URL(d.data.url);
      if (!["https:", "http:"].includes(url.protocol)) throw Error("Use a website link beginning with https://.");
    }
  }
  async function save(process = false) {
    if (!draft) return;
    await run(async () => {
      const d = latest.current!;
      validate(d);
      const generation = b.state.bootstrap!.generation;
      if (process && !b.state.bootstrap!.profile.ai_consent)
        throw Error(
          "Enable optional AI processing in Settings before organizing sources with AI. You can save the source without AI."
        );
      const { files, existing: _, revision, ...record } = d;
      const mutation: Mutation = process
        ? {
            id: d.id,
            generation,
            type: "import",
            url: d.data.url || undefined,
            text: [d.title, d.body, d.data.source_text].filter(Boolean).join("\n\n") || undefined,
            files,
            child_id: d.child_id,
            topics: d.data.topics,
          }
        : {
            id: Crypto.randomUUID(),
            generation,
            type: "save",
            record: { ...record, title: d.title.trim() || kindName[d.kind], ...(revision ? { revision } : {}) },
            files,
          };
      retired.current = true;
      try {
        await b.commit((s) => {
          const drafts = { ...s.drafts };
          delete drafts[slot];
          const prepared: Mutation =
            mutation.type === "save"
              ? {
                  ...mutation,
                  record: {
                    ...mutation.record,
                    revision:
                      mutation.record.revision ||
                      (d.existing ? s.records.find((r) => r.id === d.id)?.revision : undefined),
                  },
                  files: mutation.files.map((f) => ({ ...f, uploaded_id: f.uploaded_id ?? s.fileUploads?.[f.id] })),
                }
              : mutation;
          return { ...addMutation(s, prepared), drafts };
        });
      } catch (failure) {
        retired.current = false;
        throw failure;
      }
      latest.current = null;
      if (mutation.type === "save" && isCare(d.kind) && !d.existing) {
        // Quick logs return to Today; the new entry can be undone from there.
        const undo = undoSaved(b, mutation.record);
        toast(`${careSummary(d.kind, d.data, d.occurred_at)} · ${friendlyTime(d.occurred_at)}`, {
          label: "Undo",
          onPress: async () => {
            try {
              await undo();
              toast("Undone.");
            } catch (e) {
              toast(messageFor(e));
            }
          },
        });
        void b.sync();
        router.dismissTo("/(tabs)");
        return;
      }
      toast(
        process
          ? "Source saved. Processing can continue in the background."
          : b.online
            ? "Saved. Your changes are syncing."
            : "Saved privately on this device."
      );
      void b.sync();
      router.dismissTo(process ? "/(tabs)/library" : { pathname: "/record/[id]", params: { id: d.id } });
    });
  }
  if (!draft)
    return (
      <Screen title="Your draft" back>
        {error ? <Notice error>{error}</Notice> : <Loading />}
      </Screen>
    );
  return (
    <Screen
      title={
        draft.existing
          ? "Edit " + kindName[draft.kind].toLowerCase()
          : draft.kind === "source"
            ? "Something worth keeping"
            : draft.kind === "journal"
              ? "A moment to remember"
              : draft.kind === "question"
                ? "For your next visit"
                : kindName[draft.kind]
      }
      back
      subtitle={saved ? "Draft saved privately on this device." : "Your draft stays here while you write."}
    >
      {!!error && <Notice error>{error}</Notice>}
      {b.state.bootstrap!.children.length > 0 && (
        <Chips
          value={draft.child_id ?? ""}
          options={[
            // Care always belongs to a baby; older general care entries can still be reassigned.
            ...(isCare(draft.kind) && b.state.bootstrap!.children.some((c) => c.id === draft.child_id)
              ? []
              : [{ label: "For me / general", value: "" }]),
            ...b.state.bootstrap!.children.map((c) => ({ label: c.name, value: c.id })),
          ]}
          onChange={(id) => change({ child_id: id || null })}
        />
      )}
      {(!["feeding", "sleep", "diaper"].includes(draft.kind) || showDetails) && (
        <Field
          label={["feeding", "sleep", "diaper"].includes(draft.kind) ? "Label (optional)" : "Title"}
          value={draft.title}
          onChange={(title) => change({ title })}
          placeholder={
            draft.kind === "source"
              ? "Breastfeeding tips I want to remember"
              : draft.kind === "journal"
                ? "One little thing from today…"
                : draft.kind === "routine"
                  ? "Hospital bag, evening routine…"
                  : kindName[draft.kind]
          }
        />
      )}
      {draft.kind === "journal" && (
        <Card tone="soft">
          <Copy kind="small">Where does this information come from?</Copy>
          <Chips
            value={draft.data.provenance ?? "caregiver_observation"}
            options={[
              { label: "My observation", value: "caregiver_observation" },
              { label: "Clinician instruction", value: "clinician_instruction" },
            ]}
            onChange={(provenance) => data({ provenance: provenance as RecordData["provenance"] })}
          />
          <Copy kind="small" tone="muted">
            Choose clinician instruction only for information your clinician gave you. This label is entered by you, not
            verified by AI.
          </Copy>
        </Card>
      )}
      {draft.kind === "source" && (
        <>
          <Field
            label="Original link"
            purpose="url"
            value={draft.data.url ?? ""}
            onChange={(url) => data({ url })}
            placeholder="https://…"
          />
          <Field
            label="Topics (separate with commas)"
            value={(draft.data.topics ?? []).join(", ")}
            onChange={(topics) =>
              data({
                topics: topics
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
            placeholder="Breastfeeding, hospital bag, newborn care"
          />
        </>
      )}
      {draft.kind === "feeding" && (
        <>
          <Copy kind="small">Feeding method</Copy>
          <Chips
            value={draft.data.method ?? "breast"}
            options={[
              { label: "Breast", value: "breast" },
              { label: "Bottle", value: "bottle" },
              { label: "Other", value: "other" },
            ]}
            onChange={(method) => data({ method: method as RecordData["method"] })}
          />
          {draft.data.method === "breast" ? (
            <>
              <Copy kind="small">Side</Copy>
              <Chips
                value={draft.data.side ?? "both"}
                options={[
                  { label: "Left", value: "left" },
                  { label: "Right", value: "right" },
                  { label: "Both", value: "both" },
                ]}
                onChange={(side) => data({ side: side as RecordData["side"] })}
              />
              <Field
                label="Duration in minutes (optional)"
                numeric
                value={draft.data.duration_minutes?.toString() ?? ""}
                onChange={(v) => data({ duration_minutes: v ? Number(v) : undefined })}
              />
            </>
          ) : (
            <>
              <Field
                label="Amount (optional)"
                numeric
                value={draft.data.amount?.toString() ?? ""}
                onChange={(v) => data({ amount: v ? Number(v) : undefined })}
              />
              <Chips
                value={draft.data.unit ?? "ml"}
                options={[
                  { label: "mL", value: "ml" },
                  { label: "oz", value: "oz" },
                ]}
                onChange={(unit) => data({ unit: unit as "ml" | "oz" })}
              />
            </>
          )}
        </>
      )}
      {draft.kind === "diaper" && (
        <Chips
          value={draft.data.type ?? "wet"}
          options={["wet", "dirty", "both", "dry"].map((value) => ({
            value,
            label: value === "both" ? "Wet + dirty" : value[0].toUpperCase() + value.slice(1),
          }))}
          onChange={(type) => data({ type: type as RecordData["type"] })}
        />
      )}
      <DateField
        label={draft.kind === "sleep" ? "Sleep started" : "Date and time"}
        value={draft.occurred_at}
        onChange={(occurred_at) => change({ occurred_at })}
      />
      {draft.kind === "sleep" && (
        <>
          <Choice
            label="Sleep has ended"
            detail="Leave off to keep this sleep open. You can finish it from its entry."
            selected={!!draft.data.end_at}
            onPress={() => data({ end_at: draft.data.end_at ? undefined : new Date().toISOString() })}
          />
          {draft.data.end_at && (
            <DateField label="Sleep ended" value={draft.data.end_at} onChange={(end_at) => data({ end_at })} />
          )}
        </>
      )}
      {draft.kind === "routine" && (
        <>
          <Chips
            value={draft.data.routine_type ?? "checklist"}
            options={[
              { label: "Checklist", value: "checklist" },
              { label: "Schedule / routine", value: "schedule" },
            ]}
            onChange={(routine_type) => data({ routine_type: routine_type as RecordData["routine_type"] })}
          />
          <Section title="Steps to keep handy">
            {(draft.data.items ?? []).map((i) => (
              <Card key={i.id} tone="soft">
                <Field
                  label="Step"
                  value={i.label}
                  onChange={(label) =>
                    data({ items: draft.data.items?.map((row) => (row.id === i.id ? { ...row, label } : row)) })
                  }
                />
                <Button
                  variant="ghost"
                  title="Remove step"
                  onPress={() => data({ items: draft.data.items?.filter((row) => row.id !== i.id) })}
                />
              </Card>
            ))}
            <Field
              label="Add a step"
              value={item}
              onChange={setItem}
              placeholder="Something to pack, do, or remember"
            />
            <Button
              secondary
              title="Add step"
              disabled={!item.trim()}
              onPress={() => {
                data({
                  items: [...(draft.data.items ?? []), { id: Crypto.randomUUID(), label: item.trim(), done: false }],
                });
                setItem("");
              }}
            />
          </Section>
          <Card tone="soft">
            <Copy kind="heading">A reminder, only if you choose</Copy>
            <Copy tone="muted">
              This is your chosen routine. Saved advice does not activate reminders automatically.
            </Copy>
            <DateField
              label="Reminder date and time"
              optional
              value={draft.data.reminder_at}
              onChange={(reminder_at) =>
                data({
                  reminder_at: reminder_at || undefined,
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  ...(!reminder_at ? { enabled: false } : {}),
                })
              }
            />
            <Chips
              value={draft.data.repeat ?? "none"}
              options={[
                { label: "Once", value: "none" },
                { label: "Daily", value: "daily" },
                { label: "Weekly", value: "weekly" },
              ]}
              onChange={(repeat) => data({ repeat: repeat as RecordData["repeat"] })}
            />
            <Choice
              label="Activate this reminder"
              selected={draft.data.enabled === true}
              onPress={() => {
                if (draft.data.enabled) data({ enabled: false });
                else
                  void run(async () => {
                    if (!latest.current!.data.reminder_at) throw Error("Choose a reminder date and time first.");
                    await requestReminders();
                    data({ enabled: true, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
                  });
              }}
            />
            <Copy kind="small" tone="muted">
              Repeating reminders keep the timezone chosen here, even when you travel. Notifications use a private,
              general message.
            </Copy>
          </Card>
        </>
      )}
      {draft.kind === "collection" && (
        <CollectionSources
          collectionId={draft.existing && (draft.revision ?? 0) > 0 ? draft.id : undefined}
          selected={draft.data.record_ids ?? []}
          disabled={busy}
          onChange={(record_ids) => data({ record_ids })}
        />
      )}
      {["feeding", "sleep", "diaper"].includes(draft.kind) && (
        <Button
          secondary
          title={showDetails ? "Hide optional notes" : "Add a label or note"}
          onPress={() => setShowDetails(!showDetails)}
        />
      )}
      {(!["feeding", "sleep", "diaper"].includes(draft.kind) || showDetails) && (
        <Field
          label={
            draft.kind === "source"
              ? "Your notes or pasted source text"
              : draft.kind === "question"
                ? "What would you like to ask?"
                : "Notes"
          }
          multiline
          value={draft.body}
          onChange={(body) => change({ body })}
          placeholder={
            draft.kind === "journal"
              ? "How are you doing? What would you like to remember?"
              : "Write anything you want to keep with this entry."
          }
        />
      )}
      {["source", "journal", "question"].includes(draft.kind) && (
        <Section title="Photos & documents">
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Button secondary title="Photos" icon="images-outline" busy={busy} onPress={() => void choose("photo")} />
            <Button secondary title="Camera" icon="camera-outline" onPress={() => void choose("camera")} />
            <Button secondary title="Files" icon="document-outline" onPress={() => void choose("document")} />
          </View>
          {draft.files.map((f) => (
            <Card key={f.id} tone="soft">
              {f.mime_type.startsWith("image/") && (
                <Image source={{ uri: f.uri }} style={{ height: 150, borderRadius: 14 }} accessibilityLabel={f.name} />
              )}
              <Copy>{f.name}</Copy>
              <Button
                variant="ghost"
                title="Remove attachment"
                onPress={() =>
                  void run(async () => {
                    change({ files: latest.current!.files.filter((file) => file.id !== f.id) });
                    await b.saveDraft(slot, latest.current!);
                    // Retain private originals until device cleanup; another queued revision may still need this file.
                  })
                }
              />
            </Card>
          ))}
          {(draft.data.attachment_ids ?? []).map((id, index) => (
            <Button
              key={id}
              variant="ghost"
              title={`Remove saved attachment ${index + 1} from this entry`}
              onPress={() => data({ attachment_ids: draft.data.attachment_ids?.filter((value) => value !== id) })}
            />
          ))}
        </Section>
      )}
      <Button
        title={
          draft.kind === "source"
            ? "Save source"
            : draft.existing
              ? "Save changes"
              : "Save " + kindName[draft.kind].toLowerCase()
        }
        icon="checkmark"
        size="lg"
        busy={busy}
        onPress={() => void save()}
      />
      {draft.kind === "source" && !draft.existing && (
        <>
          <Button
            secondary
            title="Process & organize with AI"
            icon="sparkles-outline"
            busy={busy}
            onPress={() => void save(true)}
          />
          <Copy kind="small" tone="muted">
            Optional processing sends this source to our AI provider. Originals and your notes are kept even when
            information cannot be extracted. Manage permission in Settings.
          </Copy>
        </>
      )}
      <Button
        variant="ghost"
        title="Discard this draft"
        disabled={busy}
        onPress={() =>
          Alert.alert("Discard this draft?", "This removes the unfinished draft from this device.", [
            { text: "Keep writing", style: "cancel" },
            {
              text: "Discard draft",
              style: "destructive",
              onPress: () =>
                void run(async () => {
                  retired.current = true;
                  try {
                    await b.saveDraft(slot, null);
                  } catch (error) {
                    retired.current = false;
                    throw error;
                  }
                  latest.current = null;
                  router.back();
                }),
            },
          ])
        }
      />
    </Screen>
  );
}
