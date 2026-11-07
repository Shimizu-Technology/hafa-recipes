import { snapshotVisit, pregnancyForVisit } from "../lib/prenatal";
import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Image, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useBaby } from "@/lib/context";
import { kindWord, messageFor, type EditorDraft, type Kind, type Mutation, type RecordData } from "@/lib/models";
import { addMutation, baseOf, inheritedFiles, queueRemovedUploads, settledDraft } from "@/lib/outbox";
import { preserveFile, removeLocal } from "@/lib/files";
import { requestReminders } from "@/lib/reminders";
import { Button, Card, Chips, Choice, Copy, Field, Loading, Notice, Screen, Section, useToast } from "@/components/ui";
import { DateField } from "@/components/date-field";
import { EventFields } from "@/components/event-fields";
import { eventWrite, movesAwayFromDateChanges, newEvent, occurrenceAt, occurrenceDraft, onNewDay, seriesFull, splitEvent, startsBeforeSplit, dayName } from "@/lib/events";
import { nextVisitDraft, withFittingVisit } from "@/lib/visits";
import { dayKey, recordDay } from "@/lib/tracker";
import { profileToday } from "@/lib/timing";
import { sendsCareDetails, seriesLimitMessage } from "../lib/api";
import { careSummary, colorWords, contentWords, defaultChild, diaperWords, friendlyTime, isCare } from "@/lib/care-format";
import { nextFeed } from "@/lib/care-glance";
import { undoSaved } from "@/lib/quick-care";
import { CollectionSources } from "@/components/collection-sources";
import { keepDraft } from "../lib/draft-content";
import { sharedDetail, writingWhere } from "../lib/writing-places";
import { ensureAiConsent } from "../lib/ai-consent";
import { staysWithBaby } from "../lib/well-visits";
import { dataFrom, formFrom, logTitle, moreKinds, type LogForm } from "../lib/more-logs";
import { trackerFor, type Tracker } from "../lib/trackers";
import { LogFields } from "../components/log-fields";
import { ComposerOpening, JournalComposer } from "../components/journal-composer";
import { firstWords, noTitle, repeatsBody } from "../lib/journal-title";
import { tooLong, titleLimit } from "../lib/text-limits";
import { babiesFor, babyLabel, caregiverKeeps, choiceFor, fittingChild, stampedDraft, visibilityWord } from "../lib/spaces";
import { useOpenJournal } from "../lib/use-open-journal";
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
/** An untitled question is listed by its first words. A journal entry has no title stored, and a source's placeholder stays for a processed title. */
const firstLine = (d: EditorDraft) => (d.kind === "question" ? firstWords(d.body) : "");
export default function Edit() {
  const params = useLocalSearchParams<{ kind?: Kind; id?: string; draft?: string; day?: string; scope?: "one" | "future"; at?: string; from?: string; child?: string }>(),
    b = useBaby(),
    toast = useToast(),
    openJournal = useOpenJournal(),
    slot = params.draft ?? (params.from ? "book:" + params.from : params.scope ? `event:${params.id}:${params.scope}:${params.at}` : params.id ? "record:" + params.id : "new:" + (params.kind ?? "journal"));
  const [draft, setDraft] = useState<EditorDraft | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [item, setItem] = useState(""),
    [showDetails, setShowDetails] = useState(!!params.id);
  const latest = useRef<EditorDraft | null>(null),
    loaded = useRef(false),
    logFormProblem = useRef(""),
    // Which tracker this entry is stays as it opened, so typing someone else's label can't swap the fields mid-word.
    openedAs = useRef<{ id: string; tracker?: Tracker } | null>(null),
    retired = useRef(false),
    restored = useRef(false),
    hideTitle = useRef(false),
    working = useRef(false),
    changed = useRef(false);
  /** A journal entry opened and left as it was is no unfinished draft. */
  const keeps = (d: EditorDraft) => keepDraft(d, changed.current) && (d.kind !== "journal" || !d.existing || changed.current || restored.current);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        let d = b.state.drafts[slot] && settledDraft(b.state.drafts[slot], b.state);
        restored.current = !!d;
        if (!d && params.id) {
          let row = b.records.find((r) => r.id === params.id);
          if (!row || row.cache_partial) row = await b.api.record(params.id);
          d = { ...row, files: inheritedFiles(b.state, row.id), existing: true, base: baseOf(b.state, row.id),
            ...(params.scope && params.at ? occurrenceDraft(row, params.at, params.scope) : {}) };
        }
        // Add from a day means that day, even over a draft left from another.
        if (d && params.kind === "event" && params.day && !d.existing) d = onNewDay(d, params.day);
        // Add from a day that shows one baby means that baby, whichever is selected everywhere else.
        const linkedBaby = params.child && b.state.bootstrap!.children.some((known) => known.id === params.child) ? params.child : undefined;
        if (d && linkedBaby && !d.existing) d = { ...d, child_id: linkedBaby };
        const kind = params.kind ?? "journal",
          child = linkedBaby ?? defaultChild(kind, b.state.selectedChild, b.state.bootstrap!.children),
          lastFeed = b.records
            .filter((r) => r.kind === "feeding" && r.child_id === child)
            .sort((x, y) => y.occurred_at.localeCompare(x.occurred_at))[0];
        const timezone = b.state.bootstrap!.profile.timezone;
        if (!d && params.from) {
          const from = b.records.find((r) => r.id === params.from) ?? await b.api.record(params.from);
          d = nextVisitDraft(Crypto.randomUUID(), from, occurrenceAt(from, params.at));
          // The next visit of one she kept to herself stays with her.
          if (from.space_id && from.space_id === b.state.bootstrap!.personal_space_id) d = { ...d, shared: false };
        }
        d ??= kind === "event" ? newEvent(Crypto.randomUUID(), child, params.day ?? dayKey(profileToday(new Date(), timezone)), timezone)
          : fresh(kind, child, kind === "feeding" ? nextFeed(lastFeed) : {});
        // The page won't say the same words twice. That's all this does: what's stored stays, and goes back as it was unless she types a title.
        if (d.kind === "journal") {
          const row = b.records.find((r) => r.id === d!.id);
          hideTitle.current = (!!d.existing && d.title.trim() === noTitle) || repeatsBody(d.title, d.body) || (!!row && d.title === row.title && repeatsBody(row.title, row.body));
        }
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
      if (!retired.current && latest.current) void b.saveDraft(slot, keeps(latest.current) ? latest.current : null).catch(() => undefined);
    };
  }, [slot]);
  useEffect(() => {
    if (!draft || !loaded.current || retired.current) return;
    setSaved(false);
    const timer = setTimeout(() => {
      if (retired.current) return;
      void b
        .saveDraft(slot, keeps(draft) ? draft : null)
        .then(() => setSaved(keeps(draft)))
        .catch((e) => setError(messageFor(e)));
    }, 400);
    return () => clearTimeout(timer);
  }, [draft]);
  // An error above a long form can be off the top of the screen when she taps Save.
  useEffect(() => { if (error && draft?.kind === "event") toast(error); }, [error]);
  useEffect(() => {
    const app = AppState.addEventListener("change", (s) => {
      if (s !== "active" && !retired.current && latest.current)
        void b.saveDraft(slot, keeps(latest.current) ? latest.current : null).catch(() => undefined);
    });
    return () => app.remove();
  }, [slot]);
  // Only the revision moves while a change this draft was built on lands or goes away behind it. What she's typing stays.
  useEffect(() => {
    const open = latest.current;
    if (!open || retired.current) return;
    const settled = settledDraft(open, b.state);
    if (settled === open) return;
    latest.current = settled;
    setDraft(settled);
  }, [b.state.outbox, b.state.settled]);
  function change(value: Partial<EditorDraft>) {
    changed.current = true;
    // What she was told was about what's on the page, and she's just changed it.
    if (latest.current?.kind === "journal") setError("");
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
    const long = tooLong(d.kind === "event" ? "" : d.title, d.body);
    if (long) throw Error(long);
    if (d.kind === "event") {
      if (!d.title.trim()) throw Error("Give this event a name.");
      if (d.data.recurrence?.until && d.data.recurrence.until < recordDay(d.occurred_at, d.data.timezone)) throw Error("A repeat can’t end before the event starts.");
      if (startsBeforeSplit(d)) throw Error("These changes can’t start before the date you’re changing. To move only this date, edit just this one.");
      if (seriesFull(b.records, d)) throw Error(seriesLimitMessage);
      return;
    }
    if (
      !(d.kind === "journal" && d.existing && d.title.trim() === noTitle ? "" : d.title.trim()) &&
      !d.body.trim() &&
      !d.files.length &&
      !d.data.attachment_ids?.length &&
      !["feeding", "sleep", "diaper"].includes(d.kind) &&
      !d.data.url
    )
      throw Error(d.kind === "journal" ? "Write something or add a photo to keep." : "Add a title, a note, or a source to keep.");
    if (logFormProblem.current) throw Error(logFormProblem.current);
    if (trackerFor(d)?.opens === "panel" && new Date(d.occurred_at).getTime() > Date.now() + 60_000) throw Error("That time hasn’t happened yet. Choose an earlier one.");
    if (isCare(d.kind) && !d.existing && !d.child_id && b.state.bootstrap!.children.length)
      throw Error("Choose which baby this is for.");
    if (d.kind === "feeding" && d.data.amount != null && (!Number.isFinite(d.data.amount) || d.data.amount <= 0))
      throw Error("Enter an amount greater than zero, or leave it empty.");
    // A feed tapped Done at once really did take no time, and that can stay when she edits something else.
    if (d.kind === "feeding" && d.data.duration_minutes != null &&
      !(d.data.duration_minutes === 0 && b.records.find((r) => r.id === d.id)?.data.duration_minutes === 0) &&
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
    await run(() => persist(process));
  }
  /** Consent and the save share one busy guard, so another tap can't save first and drop the processing. */
  async function saveWithAi() {
    if (!draft) return;
    await run(async () => {
      if (!(await ensureAiConsent(b))) return;
      await persist(true, true);
    });
  }
  async function persist(process: boolean, consented = false) {
      const d = latest.current!;
      validate(d);
      const generation = b.state.bootstrap!.generation;
      if (process && !consented && !b.state.bootstrap!.profile.ai_consent)
        throw Error(
          "Enable optional AI processing in Settings before organizing sources with AI. You can save the source without AI."
        );
      const automatic = !d.existing && d.kind === "source" &&
        !!b.state.bootstrap!.profile.ai_consent && !!b.state.bootstrap!.profile.auto_process_shares;
      const shouldProcess = d.kind === "source" && (process || automatic);
      // Keep the original in the durable outbox before its optional import.
      const id = Crypto.randomUUID();
      const splitId = Crypto.randomUUID();
      // Everything saved from this draft, including the second half of a split, goes with the baby it shows.
      const fit = (given: EditorDraft) => ({ ...given, child_id: fittingChild(b.state.bootstrap!, given, b.records.find((row) => row.id === given.id)) });
      const build = (given: EditorDraft): Extract<Mutation, { type: "save" }> => {
        const scope = choiceFor(b.state.bootstrap, given)?.space_id ?? given.space_id,
          pregnancy = pregnancyForVisit(given, b.state.bootstrap!.children, scope),
          fitted = snapshotVisit(fit(given), pregnancy?.due_date, pregnancy?.birth_date),
          from = stampedDraft(b.state, b.state.drafts[slot], fitted.kind === "event" ? eventWrite(fitted) : withFittingVisit(fitted, b.records));
        const { files, existing: _, revision, base, event_edit: __, log_form: ___, shared: ____, ...record } = from,
          choice = choiceFor(b.state.bootstrap, from), data = choice?.just_me ? { ...from.data, just_me: true } : from.data;
        return {
          id, generation, type: "save", ...(from.space_id ? { space_id: from.space_id } : {}),
          // A title changes only when she changes it. What's stored goes back byte for byte, whatever the body now says.
          record: { ...record, title: from.title === (from.kind === "journal" ? b.records.find((row) => row.id === from.id)?.title : undefined) ? from.title
            : from.title.trim() || firstLine(from) || (from.kind === "source" ? "Saved source" : kindWord(from.kind)),
            data: from.kind === "source" ? { ...data, source_text: data.source_text || from.body || undefined } : data,
            ...(revision ? { revision } : {}) }, files,
          // A draft kept by an older build doesn't know what it saw, so it follows nothing.
          ...(base ?? from.existing ? { base: base ?? { after: [] } } : {}),
        };
      };
      const mutation = build(d);
      const importMutation: Mutation | undefined = shouldProcess ? {
        id: Crypto.randomUUID(), generation, type: "import", record_id: d.id,
        ...(automatic && !process ? { automatic: true, automatic_epoch: b.state.bootstrap!.profile.auto_process_epoch ?? 0 } : {}), files: [],
      } : undefined;
      retired.current = true;
      try {
        await b.commit((s) => {
          const drafts = { ...s.drafts };
          delete drafts[slot];
          // Built here, from what has landed by the time this write runs: the tap can land after she pressed Save.
          const settled = build(settledDraft(d, s));
          const prepared: Mutation = {
            ...settled,
            record: {
              ...settled.record,
              revision:
                settled.record.revision ||
                (d.existing && !d.base ? s.records.find((r) => r.id === d.id)?.revision : undefined),
            },
            files: settled.files.map((f) => ({ ...f, uploaded_id: f.uploaded_id ?? s.fileUploads?.[f.id] })),
          };
          const splitChild = pregnancyForVisit(d, b.state.bootstrap!.children, prepared.space_id);
          const split = d.kind === "event" ? splitEvent(snapshotVisit(fit(d), prepared.record.data.due_date_snapshot ?? splitChild?.due_date, splitChild?.birth_date), splitId) : undefined;
          // One change holding both parts: this series can't end unless the next one starts.
          const saved = addMutation(s, split ? { id: splitId, generation, type: "event_split", series: prepared.record, event: split, from_start: d.event_edit!.original_start, files: [], ...(prepared.base ? { base: prepared.base } : {}) } : prepared);
          return queueRemovedUploads(s, { ...(importMutation ? addMutation(saved, importMutation) : saved), drafts });
        });
      } catch (failure) {
        retired.current = false;
        throw failure;
      }
      latest.current = null;
      if (d.kind === "event") {
        const timezone = b.state.bootstrap!.profile.timezone, today = dayKey(profileToday(new Date(), timezone));
        toast(d.event_edit?.scope === "future" ? "Saved. This date and later ones changed."
          : `${d.title.trim()} saved for ${dayName(recordDay(d.occurred_at, d.data.all_day ? d.data.timezone : timezone), today)}.`);
        void b.sync();
        // A split leaves the screen behind this one showing a date its series no longer has.
        if (splitEvent(d, splitId)) router.dismissTo("/(tabs)/tracker");
        else router.back();
        return;
      }
      if (mutation.type === "save" && isCare(d.kind) && !d.existing) {
        // Quick logs return to Today; the new entry can be undone from there.
        const undo = undoSaved(b, mutation.record);
        toast(`${careSummary(d.kind, d.data, d.occurred_at)} · ${friendlyTime(d.occurred_at, undefined, b.state.bootstrap!.profile.timezone)}`, {
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
        router.dismissTo("/(tabs)/(today)");
        return;
      }
      toast(
        shouldProcess
          ? "Source saved. Processing can continue in the background."
          : b.online
            ? "Saved. Your changes are syncing."
            : "Saved privately on this device.",
        // Something new, written from Add, has no list behind it to go back to.
        !d.existing && (d.kind === "journal" || d.kind === "question") ? { label: "See journal", onPress: () => openJournal(d.kind) } : undefined
      );
      void b.sync();
      router.dismissTo(shouldProcess ? "/(tabs)/library" : { pathname: "/record/[id]", params: { id: d.id } });
  }
  function discard() {
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
    ]);
  }
  // Doctor questions and posts open on the writing area; other kinds keep notes after their details. A journal entry has its own page.
  const writing = !!draft && (draft.kind === "question" || draft.kind === "source");
  /** Its fields hold what she's typed, and the draft holds the last that made sense, so typing "37." doesn't lose the dot. */
  function logForm(form: LogForm, base: Record<string, unknown>) {
    try {
      const id = openedAs.current!.tracker!.id, made = dataFrom(id, form, base);
      logFormProblem.current = "";
      change({ data: made, title: logTitle(id, form), log_form: form });
    } catch (e) {
      // Kept with the draft, so a half-typed or cleared number comes back as she left it.
      logFormProblem.current = messageFor(e);
      change({ log_form: form });
    }
  }
  if (draft && openedAs.current?.id !== draft.id) {
    const opened = trackerFor(draft);
    openedAs.current = { id: draft.id, tracker: opened };
    // A form that couldn't be saved when it was left still can't.
    if (draft.log_form && opened) { try { dataFrom(opened.id, draft.log_form, draft.data); logFormProblem.current = ""; } catch (e) { logFormProblem.current = messageFor(e); } }
  }
  const log = draft ? openedAs.current?.tracker : undefined, isLog = log?.opens === "panel";
  const notesField = draft && ((!["feeding", "sleep", "diaper"].includes(draft.kind) || showDetails) && (
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
          placeholder="Write anything you want to keep with this entry."
        />
      ));
  if (!draft && !error && (params.kind ?? b.state.drafts[slot]?.kind ?? b.records.find((r) => r.id === params.id)?.kind) === "journal") return <ComposerOpening />;
  if (!draft)
    return (
      <Screen title="Your draft" back>
        {error ? <Notice error>{error}</Notice> : <Loading />}
      </Screen>
    );
  if (draft.kind === "event") return (
    <Screen title={draft.existing ? "Edit event" : params.from ? "Book the next visit" : "Add to the calendar"} back
      footer={<Button title={draft.existing ? "Save changes" : params.from ? "Save next visit" : "Save event"} icon="checkmark" size="lg" busy={busy} onPress={() => void save()} />}>
      {!!error && <Notice error>{error}</Notice>}
      <EventFields draft={draft} change={change} quick={!params.from} today={dayKey(profileToday(new Date(), b.state.bootstrap!.profile.timezone))} />
      {movesAwayFromDateChanges(draft) && <Notice>Changes you made to single dates won’t carry over to the new dates. If you don’t want that, leave the first date as it is.</Notice>}
      {/* Nothing typed yet is nothing to throw away, and back already leaves. */}
      {(draft.existing || !!params.from || !!draft.title.trim()) && <Button variant="ghost" title="Discard this draft" disabled={busy} onPress={discard} />}
    </Screen>
  );
  const whoFor = <Chips
    value={fittingChild(b.state.bootstrap!, draft, b.records.find((row) => row.id === draft.id)) ?? ""}
    label="Who is this for?"
    options={[
      // Care always belongs to a baby; older general care entries can still be reassigned.
      ...((isCare(draft.kind) || staysWithBaby(draft) || log?.about === "baby") && b.state.bootstrap!.children.some((c) => c.id === draft.child_id)
        ? []
        : [{ label: "For me / general", value: "" }]),
      ...babiesFor(b.state.bootstrap!, draft, b.records.find((row) => row.id === draft.id)).map((c) => ({ label: babyLabel(c, b.state.bootstrap), value: c.id })),
    ]}
    onChange={(id) => change({ child_id: id || null })}
  />;
  const sharing = (() => { const choice = choiceFor(b.state.bootstrap, draft);
    return choice && <>
      <Choice label="Shared with family" detail={sharedDetail(draft.kind)} selected={choice.shared} onPress={() => change({ shared: true })} />
      <Choice label="Just me" selected={!choice.shared} onPress={() => change({ shared: false })} />
    </>; })();
  if (draft.kind === "journal") {
    const clinician = <Choice
      label="My clinician told me this"
      detail="Marks it as a clinician instruction. It’s your label; AI does not verify it."
      selected={draft.data.provenance === "clinician_instruction"}
      onPress={() => data({ provenance: draft.data.provenance === "clinician_instruction" ? "caregiver_observation" : "clinician_instruction" })}
    />;
    const choice = choiceFor(b.state.bootstrap, draft), row = b.records.find((r) => r.id === draft.id), babies = b.state.bootstrap!.children,
      forBaby = babies.length > 1 ? babies.find((baby) => baby.id === fittingChild(b.state.bootstrap!, draft, row)) : undefined;
    return <JournalComposer draft={draft} change={change} titleHidden={hideTitle.current} saved={saved && changed.current} error={error} busy={busy}
      status={[forBaby && babyLabel(forBaby, b.state.bootstrap), choice ? (choice.shared ? "Shared" : "Just me") : visibilityWord(row ?? draft, b.state.bootstrap)].filter(Boolean).join(" · ") || undefined}
      canDiscard={keepDraft(draft, changed.current)}
      onAttach={(type) => void choose(type)}
      onRemoveFile={(id) => void run(async () => {
        // Private originals stay until device cleanup; another queued revision may still need this file.
        const file = latest.current!.files.find((held) => held.id === id), uploaded = file && (file.uploaded_id ?? b.state.fileUploads?.[file.id]);
        change({ files: latest.current!.files.filter((held) => held.id !== id),
          ...(uploaded ? { data: { ...latest.current!.data, attachment_ids: latest.current!.data.attachment_ids?.filter((value) => value !== uploaded) } } : {}) });
        await b.saveDraft(slot, latest.current!);
      })}
      onRemoveSaved={(id) => change({ data: { ...latest.current!.data, attachment_ids: latest.current!.data.attachment_ids?.filter((value) => value !== id) } })}
      onSave={() => void save()} onDiscard={discard}
      details={<>
        {babies.length > 0 && <View style={{ gap: 8 }}><Copy kind="small">Who is this for?</Copy>{whoFor}</View>}
        {choice && <View><Copy kind="small">Who can see this?</Copy>{sharing}</View>}
        {caregiverKeeps(b.state, draft) && <Copy kind="small" tone="muted">Only you can see this. It isn’t shared with the family.</Copy>}
        {!!writingWhere(b.state, draft) && <Copy kind="small" tone="muted">{writingWhere(b.state, draft)}</Copy>}
        {clinician}
        {!!draft.data.paste_origin && (!row?.created_by || row.created_by === b.owner) && <Button secondary title="Remove original words" disabled={busy} onPress={() => data({ paste_origin: null })} />}
      </>} />;
  }
  return (
    <Screen
      title={
        draft.existing
          ? "Edit " + kindWord(draft.kind).toLowerCase()
          : draft.kind === "source"
            ? "Save a post"
            : draft.kind === "question"
                ? "For your next visit"
                : kindWord(draft.kind)
      }
      back
      footer={<Button title={draft.existing ? "Save changes" : draft.kind === "collection" ? "Save category" : draft.kind === "source" ? "Save post" : "Save " + kindWord(draft.kind).toLowerCase()} icon="checkmark" size="lg" busy={busy} onPress={() => void save()} />}
      subtitle={saved ? "Draft saved privately on this device." : "Your draft stays here while you write."}
    >
      {!!error && <Notice error>{error}</Notice>}
      {log?.about !== "her" && (showDetails || !["question", "collection", "source"].includes(draft.kind)) && b.state.bootstrap!.children.length > 0 && whoFor}
      {!!writingWhere(b.state, draft) && <Copy kind="small" tone="muted">{writingWhere(b.state, draft)}</Copy>}
      {caregiverKeeps(b.state, draft) && <Copy kind="small" tone="muted">Only you can see this. It isn’t shared with the family.</Copy>}
      {draft.kind === "source" && <Field label="Original link" purpose="url" value={draft.data.url ?? ""}
        onChange={(url) => data({ url })} placeholder="https://…" />}
      {writing && notesField}
      {sharing}
      {writing && <Button variant="ghost" title={showDetails ? "Hide optional details" : "Add photo, title or details"} onPress={() => setShowDetails(!showDetails)} />}
      {isLog && log!.id !== "note" && <LogFields id={log!.id} start={draft.log_form ?? formFrom(log!.id, draft.data, draft.title)} onChange={(form) => logForm(form, draft.data)} />}
      {!isLog && ((!["feeding", "sleep", "diaper", "question", "source"].includes(draft.kind)) || showDetails) && (
        <Field
          label={["feeding", "sleep", "diaper"].includes(draft.kind) ? "Label (optional)" : writing ? "Title (optional)" : "Title"}
          maxLength={titleLimit}
          value={draft.title}
          onChange={(title) => change({ title })}
          placeholder={
            draft.kind === "source"
              ? "Breastfeeding tips I want to remember"
              : draft.kind === "routine"
                ? "Hospital bag, evening routine…"
                : kindWord(draft.kind)
          }
        />
      )}
      {draft.kind === "source" && showDetails && (
        <>
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
          label="Feeding method"
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
          label="Side"
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
          label="Unit"
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
          label="Diaper"
          options={["wet", "dirty", "both", "dry"].map((value) => ({
            value,
            label: value === "both" ? "Pee and poo" : diaperWords[value as "wet"],
          }))}
          onChange={(type) => data({ type: type as RecordData["type"] })}
        />
      )}
      {sendsCareDetails && draft.kind === "diaper" && (draft.data.type === "dirty" || draft.data.type === "both") && (
        <Chips
          value={draft.data.color ?? ""}
          label="Colour"
          options={[{ value: "", label: "Not set" }, ...Object.entries(colorWords)
            .map(([value, label]) => ({ value, label }))]}
          onChange={(color) => data({ color: (color || null) as RecordData["color"] })}
        />
      )}
      {sendsCareDetails && draft.kind === "feeding" && draft.data.method === "bottle" && (
        <Chips
          value={draft.data.contents ?? ""}
          label="What’s in it"
          options={[{ value: "", label: "Not set" }, ...Object.entries(contentWords).map(([value, label]) => ({ value, label }))]}
          onChange={(contents) => data({ contents: (contents || null) as RecordData["contents"] })}
        />
      )}
      {draft.kind !== "collection" && (!writing || showDetails) && <DateField
        label={draft.kind === "sleep" ? "Sleep started" : "Date and time"}
        value={draft.occurred_at}
        timeZone={isCare(draft.kind) || moreKinds.includes(draft.kind) ? b.state.bootstrap!.profile.timezone : undefined}
        onChange={(occurred_at) => change({ occurred_at })}
      />}
      {draft.kind === "sleep" && (
        <>
          <Choice
            label="Sleep has ended"
            detail="Leave off to keep this sleep open. You can finish it from its entry."
            selected={!!draft.data.end_at}
            onPress={() => data({ end_at: draft.data.end_at ? undefined : new Date().toISOString() })}
          />
          {draft.data.end_at && (
            <DateField label="Sleep ended" value={draft.data.end_at} timeZone={b.state.bootstrap!.profile.timezone} onChange={(end_at) => data({ end_at })} />
          )}
        </>
      )}
      {draft.kind === "routine" && (
        <>
          <Chips
            value={draft.data.routine_type ?? "checklist"}
          label="Routine type"
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
                  maxLength={500}
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
              maxLength={500}
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
          label="Repeat"
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
      {!writing && draft.kind !== "collection" && notesField}
      {(["source", "question"].includes(draft.kind)) && (!writing || showDetails) && (
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
      {draft.kind === "source" && !draft.existing && (
        <>
          <Button
            secondary
            title="Process & organize with AI"
            icon="sparkles-outline"
            busy={busy}
            onPress={() => void saveWithAi()}
          />
          <Copy kind="small" tone="muted">
            Optional processing sends this source to our AI provider. Originals and your notes are kept even when
            information cannot be extracted. Manage permission in Settings.
          </Copy>
        </>
      )}
      <Button variant="ghost" title="Discard this draft" disabled={busy} onPress={discard} />
    </Screen>
  );
}
