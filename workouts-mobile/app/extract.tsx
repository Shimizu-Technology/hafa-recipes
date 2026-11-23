import { ImportList } from "@/components/import-list";
import { updateNativeSharingConsent } from "@/lib/native-share-session";
import { SourceImage } from "@/components/source-image";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, View, type ScrollView } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import * as Crypto from "expo-crypto";
import { usePreventRemove } from "expo-router/react-navigation";
import { classDate, classText } from "@/lib/class-import";
import { CalendarDate } from "@/components/calendar-date";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AccountButton, Button, ButtonRow, Card, Choice, Copy, Field, Grow, ListGroup, ListRow, Notice, Row, Screen, SectionHeader, Sheet, Stack, useColors, useReducedMotion } from "@/components/ui";
import { RecentImports } from "@/components/recent-imports";
import { importSettingsSummary, linkLooksComplete } from "@/lib/add-composer";
import { useTraining } from "@/lib/context";
import { archiveCapturedImport, captureErrors, sharedWorkoutURL, updateImportReferences, type CaptureDraft, type CaptureKind, type CaptureFile } from "@/lib/capture";
import { createPrivateDraftSlot, type PrivateDraftSnapshot } from "@/lib/private-form";
import { pickImages, pickDocument, sourceFor, cleanupCaptureFiles } from "@/lib/capture-io";
import { ApiError } from "@/lib/api";
import { DECLINED, defaultShareToDiscover } from "@/lib/discover";
import { usePublishingDisclosure } from "@/components/publishing-disclosure";
import { setNativeShareVisibility } from "@/lib/native-share-session";
export default function Capture() {
  const { shared, request_id: sharedRequest, class: classRoute } = useLocalSearchParams<{ shared?: string; request_id?: string; class?: string }>();
  const { localDrafts, api, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const navigation = useNavigation();
  const cache = useQueryClient();
  async function classDefaults() {
    const profile = await cache.fetchQuery({ queryKey: [owner, "profile", generation], queryFn: api.profile, staleTime: 60000 })
      .catch(() => { throw Object.assign(Error("Could not load your training profile timezone. Retry loading the class form."), { classProfileError: true }); });
    currentScope();
    if (!profile) throw Object.assign(Error("Set up your training profile timezone before importing a class."), { classProfileError: true });
    return classDate(profile.timezone);
  }
  async function applyClassDefaults(value: CaptureDraft, hasSavedSource: boolean) {
    if (classRoute !== "1" || hasSavedSource) return value;
    const date = await classDefaults();
    const preferences = await localDrafts.load<CaptureDraft["programming"]>(owner, `class-preferences:${generation}`);
    currentScope();
    return { ...value, kind: "text" as const, class_parts: true, is_public: false,
      programming: { source_kind: "gym" as const, gym_name: preferences?.gym_name ?? "Unified", track: preferences?.track ?? "BUILD | BRIK", date } };
  }
  const [leaving, setLeaving] = useState(false);
  const afterSave = useRef<(() => void) | null>(null);
  const leavingBusy = useRef(false);
  const generation = enrollment?.generation ?? 0;
  const scope = `capture:${generation}`;
  const slot = useMemo(
    () => createPrivateDraftSlot<CaptureDraft>(storage, owner, scope, Crypto.randomUUID),
    [storage, owner, scope]
  );
  const saved = useRef<PrivateDraftSnapshot<CaptureDraft>>({ value: null, revision: null });
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const pendingWrites = useRef(0);
  const readyRef = useRef(false);
  const view = useRef(0);
  const renderedView = view.current;
  const [stale, setStale] = useState(false);
  const [draft, setDraft] = useState<CaptureDraft>(() => ({
    request_id: Crypto.randomUUID(),
    generation,
    kind: "url",
    text: "",
    source_url: "",
    files: [],
    created_at: new Date().toISOString()
  }));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [ready, setReady] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [duplicateUrl, setDuplicateUrl] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDuplicateUrl(draft.kind === "url" ? draft.source_url.trim() : ""), 500);
    return () => clearTimeout(timer);
  }, [draft.kind, draft.source_url]);
  const duplicateHint = useQuery({
    queryKey: [owner, "duplicate-sources", generation, duplicateUrl],
    queryFn: () => api.duplicateSources(duplicateUrl, undefined, generation),
    enabled: !!enrollment?.enrolled && /^https?:\/\//i.test(duplicateUrl) && duplicateUrl.length <= 2000
  });
  const [panel, setPanel] = useState<"settings" | "help" | null>(null);
  const [pasteNote, setPasteNote] = useState("");
  const colors = useColors();
  const reduced = useReducedMotion();
  const scrollRef = useRef<ScrollView>(null);
  const automatic = useRef<string | null>(null);
  const [error, setError] = useState("");
  const [abandon, setAbandon] = useState(false);
  const [busy, setBusy] = useState(false);
  const disclosure = usePublishingDisclosure();
  const guard = useRef(false);
  const mounted = useRef(true);
  const live = useRef({ owner, generation, storage, active: false });
  useLayoutEffect(() => {
    const committed = { owner, generation, storage, active: true };
    live.current = committed;
    setLeaving(false); afterSave.current = null; leavingBusy.current = false;
    return () => { committed.active = false; };
  }, [owner, generation, storage]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Extract is now a pushed screen: wait for durable local edits before a pop,
  // including native swipe/back. Never dispatch an old account's navigation.
  usePreventRemove(ready && !stale && !leaving && storage.isCurrent() && isCurrentAccount(), ({ data }) => {
    if (leavingBusy.current) return;
    leavingBusy.current = true;
    const scope = live.current;
    void (async () => {
      // Edits can enqueue another write while Back awaits storage. Drain every
      // observed tail before unmount invalidates the draft's storage guard.
      let tail: Promise<unknown>;
      do {
        tail = writes.current;
        await tail.catch(() => flush());
      } while (tail !== writes.current);
    })().then(() => {
      if (scope !== live.current || !scope.active) return;
      afterSave.current = () => {
        if (scope === live.current && scope.active && storage.isCurrent() && isCurrentAccount()) navigation.dispatch(data.action);
      };
      setLeaving(true);
    }).catch(e => {
      if (scope === live.current && scope.active) setError(e instanceof Error ? e.message : "Could not save this source. Try leaving again.");
    }).finally(() => { if (scope === live.current) leavingBusy.current = false; });
  });
  useEffect(() => {
    if (!leaving) return;
    const dispatch = afterSave.current; afterSave.current = null; dispatch?.();
  }, [leaving]);
  function currentScope() {
    if (
      !mounted.current ||
      !live.current.active ||
      !isCurrentAccount() ||
      !storage.isCurrent() ||
      live.current.owner !== owner ||
      live.current.generation !== generation ||
      live.current.storage !== storage
    )
      throw Error("The account, enrollment or capture screen changed. This source was not moved to another draft.");
  }
  function current() {
    currentScope();
    if (view.current !== renderedView) throw Error("This source view changed. Use the loaded source before editing.");
    slot.assertCurrent(saved.current.revision);
  }
  async function restoreClearedSource() {
    const prior = saved.current, priorView = view.current;
    // Only a submitted source can be retired behind this still-mounted screen.
    // An existing replacement always requires an explicit load.
    if (!prior.value?.job_id || pendingWrites.current) return;
    const next = await slot.load(currentScope);
    currentScope();
    if (saved.current !== prior || view.current !== priorView || pendingWrites.current || next.value) return;
    slot.assertCurrent(next.revision);
    saved.current = next;
    setStale(false);
    setError("");
  }
  function changed() {
    if (!readyRef.current || pendingWrites.current) return;
    try {
      currentScope();
      slot.assertCurrent(saved.current.revision);
    } catch {
      if (mounted.current) {
        setStale(true);
        void restoreClearedSource().catch(() => undefined);
      }
    }
  }
  useEffect(() => slot.subscribe(changed), [slot]);
  function enqueue<R>(work: () => Promise<R>) {
    pendingWrites.current++;
    const next = writes.current.catch(() => undefined).then(work);
    writes.current = next;
    void next
      .finally(() => {
        pendingWrites.current--;
        changed();
      })
      .catch(() => undefined);
    return next;
  }
  const capabilities = useQuery({
    queryKey: [owner, "capabilities", generation],
    queryFn: api.capabilities,
    enabled: !!enrollment?.enrolled
  });
  const aiConsent = useQuery({ queryKey: [owner, "ai-consent", generation], queryFn: api.aiConsent,
    enabled: !!enrollment?.enrolled });
  useEffect(() => {
    let active = true;
    readyRef.current = false;
    setReady(false);
    setStale(false);
    setSubmittedId(null);
    void slot
      .load(currentScope)
      .then(async (value) => {
        if (!active) return;
        saved.current = value;
        let next: CaptureDraft =
          value.value?.generation === generation
            ? value.value
            : {
                request_id: Crypto.randomUUID(),
                generation,
                kind: "url" as const,
                text: "",
                source_url: "",
                files: [],
                created_at: new Date().toISOString()
              };
        next = await applyClassDefaults(next, !!value.value);
        if (!active) return;
        draftRef.current = next;
        setDraft(next);
        readyRef.current = true;
        setReady(true);
        if (next.job_id) void startAnother().catch(() => undefined);
      })
      .catch((e) => {
        if (active) setError(e.classProfileError ? e.message : "Could not restore your source. Retry loading it before editing.");
      });
    return () => {
      active = false;
    };
  }, [slot, generation]);
  useEffect(() => {
    if (!ready || busy || shared !== "1" || !sharedRequest || draftRef.current.request_id === sharedRequest) return;
    let active = true;
    void (async () => {
      // A persistent tab can receive a share after its initial load. Let its
      // own saves settle before reading the replacement committed by sharing.
      await writes.current.catch(() => undefined);
      if (!active) return;
      currentScope();
      if (guard.current || pendingWrites.current) return;
      const prior = saved.current, priorDraft = draftRef.current, priorView = view.current;
      const next = await slot.load(currentScope);
      if (!active) return;
      currentScope();
      if (guard.current || pendingWrites.current || saved.current !== prior ||
        draftRef.current !== priorDraft || view.current !== priorView ||
        next.value?.request_id !== sharedRequest || next.value.generation !== generation) return;
      slot.assertCurrent(next.revision);
      saved.current = next;
      view.current++;
      draftRef.current = next.value;
      setDraft(next.value);
      setSubmittedId(null);
      setStale(false);
      setError("");
      setPanel(null); setPasteNote("");
    })().catch(() => {
      // Keep the existing draft and conflict state if the account or slot moved.
    });
    return () => { active = false; };
  }, [slot, generation, shared, sharedRequest, ready, busy]);
  function update(patch: Partial<Pick<CaptureDraft, "text" | "source_url" | "class_parts" | "programming" | "kind" | "is_public">>) {
    // Once the stable queue is saved, reject late native input events during
    // the render that releases usePreventRemove and dispatches the departure.
    if (leaving || afterSave.current || guard.current || draftRef.current.pending_import || !readyRef.current || stale) return;
    try {
      current();
    } catch (e) {
      setStale(true);
      setError((e as Error).message);
      return;
    }
    if (patch.source_url !== undefined && patch.class_parts !== true && draftRef.current.kind !== "url") return;
    const value = { ...draftRef.current, ...patch, request_id: Crypto.randomUUID(), job_id: undefined };
    draftRef.current = value;
    setDraft(value);
    void enqueue(async () => {
      const next = await slot.save(saved.current.revision, value, currentScope);
      saved.current = next;
      current();
    }).catch((e) => {
      if (mounted.current) setError(e.message);
    });
  }
  async function persist(value: CaptureDraft, registered?: () => void) {
    return enqueue(async () => {
      currentScope();
      let next: PrivateDraftSnapshot<CaptureDraft>;
      try {
        next = await slot.save(saved.current.revision, value, currentScope);
      } catch (error) {
        if ((error as { captureRegistrationUncertain?: boolean }).captureRegistrationUncertain) registered?.();
        throw error;
      }
      registered?.();
      saved.current = next;
      current();
      draftRef.current = next.value!;
      setDraft(next.value!);
      return next.value!;
    });
  }
  async function flush() {
    try {
      await writes.current;
    } catch {
      current();
      await persist(draftRef.current);
    }
    current();
  }
  async function replace(value: CaptureDraft) {
    await writes.current.catch(() => undefined);
    await restoreClearedSource();
    await flush();
    const prior = saved.current.value;
    const next = { ...value, cleanup_files: [...(prior?.cleanup_files ?? []), ...(prior?.files ?? [])] };
    const registered = await persist(next);
    await cleanupCaptureFiles(next.cleanup_files ?? [], true);
    await persist({ ...registered, cleanup_files: [] });
  }
  async function reloadSaved() {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    try {
      await writes.current.catch(() => undefined);
      currentScope();
      const next = await slot.load(currentScope);
      saved.current = next;
      current();
      const value = await applyClassDefaults(next.value ?? {
        request_id: Crypto.randomUUID(),
        generation,
        kind: "url" as const,
        text: "",
        source_url: "",
        files: [],
        created_at: new Date().toISOString()
      }, !!next.value);
      view.current++;
      draftRef.current = value;
      setDraft(value);
      readyRef.current = true;
      setReady(true);
      setStale(false);
      setError("");
      setPanel(null); setPasteNote("");
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function startAnother() {
    if (guard.current || !readyRef.current) return;
    guard.current = true; setBusy(true); setError("");
    const original = draftRef.current;
    try {
      await writes.current.catch(() => undefined);
      currentScope();
      if (!original.job_id) return;
      if (view.current !== renderedView) throw Error("This source view changed. Use the loaded source before editing.");
      const captureGuard = () => {
        currentScope();
        if (view.current !== renderedView) throw Error("This source view changed. Use the loaded source before editing.");
      };
      const next = await enqueue(() => archiveCapturedImport(storage, owner, generation, saved.current, captureGuard, Crypto.randomUUID));
      currentScope(); slot.assertCurrent(next.revision);
      saved.current = next;
      const blank: CaptureDraft = { request_id: Crypto.randomUUID(), generation, kind: "url", source_url: "", text: "", files: [], created_at: new Date().toISOString() };
      draftRef.current = blank; setDraft(blank); setSubmittedId(original.job_id);
      setStale(false); setPanel(null); setPasteNote("");
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function chooseClass() {
    if (guard.current || !readyRef.current || stale || draftRef.current.pending_import) return;
    guard.current = true; setBusy(true); setError("");
    try {
      await flush();
      const preferences = await localDrafts.load<CaptureDraft["programming"]>(owner, `class-preferences:${generation}`); current();
      await persist({ ...draftRef.current, request_id: Crypto.randomUUID(), class_parts: true,
        kind: draftRef.current.kind === "url" ? "text" : draftRef.current.kind, source_url: "", is_public: false,
        programming: { source_kind: "gym", gym_name: preferences?.gym_name ?? "Unified", track: preferences?.track ?? "BUILD | BRIK", date: await classDefaults() } });
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { guard.current = false; if (mounted.current) setBusy(false); }
  }
  async function choose(kind: CaptureKind) {
    if (guard.current || !readyRef.current || stale || draftRef.current.pending_import) return false;
    if (kind === draftRef.current.kind) return true;
    guard.current = true;
    setBusy(true);
    setError("");
    setPasteNote("");
    try {
      if (kind === "text" && draftRef.current.files.length) {
        const confirmed = await new Promise<boolean>(resolve => Alert.alert("Replace your selected files?",
          "Switching to pasted text removes the selected screenshots or document from this draft.",
          [{ text: "Keep selected files", style: "cancel", onPress: () => resolve(false) },
            { text: "Use pasted text", onPress: () => resolve(true) }], { cancelable: true, onDismiss: () => resolve(false) }));
        if (!confirmed) return false;
        current();
      }
      await replace({ ...draftRef.current, request_id: Crypto.randomUUID(), kind, files: [], job_id: undefined });
      return true;
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
      return false;
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function pick(kind: "images" | "document", camera = false) {
    if (guard.current || !readyRef.current || stale || draftRef.current.pending_import) return;
    guard.current = true;
    setBusy(true);
    setError("");
    let files: CaptureFile[] = [];
    let registered = false;
    try {
      await flush();
      const original = saved.current;
      const pickerCurrent = () => {
        currentScope();
        slot.assertCurrent(original.revision);
      };
      files =
        kind === "images" ? await pickImages(camera, pickerCurrent, owner, draftRef.current.class_parts ? 8 : 4) : await pickDocument(pickerCurrent, owner, draftRef.current.class_parts);
      if (files.length) {
        current();
        let next: CaptureDraft = {
          ...draftRef.current,
          request_id: Crypto.randomUUID(),
          kind,
          files,
          job_id: undefined,
          cleanup_files: [...(saved.current.value?.cleanup_files ?? []), ...(saved.current.value?.files ?? [])]
        };
        const registeredDraft = await persist(next, () => {
          registered = true;
        });
        await cleanupCaptureFiles(next.cleanup_files ?? [], true);
        await persist({ ...registeredDraft, cleanup_files: [] });
      }
    } catch (e) {
      let active = true;
      try {
        current();
      } catch {
        active = false;
      }
      let problem = e;
      if (
        !registered ||
        !storage.isCurrent() ||
        !isCurrentAccount() ||
        live.current.owner !== owner ||
        live.current.generation !== generation
      ) {
        try {
          await cleanupCaptureFiles(files, true);
        } catch (cleanup) {
          problem = cleanup;
        }
      }
      if (active) setError((problem as Error).message);
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function submit(fromShare = false, agree = false) {
    if (guard.current || !readyRef.current || stale) return;
    const errors = captureErrors(draftRef.current);
    if (!enrollment?.enrolled || generation < 1) errors.push("Set up your Workouts account first.");
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      await flush();
      const consent = await api.aiConsent();
      current();
      if (!consent.accepted || consent.disclosure_version !== 1) {
        if (fromShare || !agree) {
          await aiConsent.refetch();
          current();
          setError("AI preferences changed. Review the disclosure before importing.");
          return;
        }
        await updateNativeSharingConsent(() => api.setAiConsent(true, generation));
        current();
        await aiConsent.refetch();
        current();
      }
      const original = draftRef.current;
      const serverSave = !original.class_parts && (original.pending_import ? original.server_auto_save === true : capabilities.data?.server_auto_save === true);
      let isPublic = !original.class_parts && (original.is_public ?? defaultShareToDiscover(original.kind));
      isPublic = isPublic && capabilities.data?.discover === true;
      if (serverSave && isPublic) {
        const allowed = await disclosure.run(async () => {
          current(); const status = await api.publishingDisclosure(); current();
          if (status.requires_acceptance) throw new ApiError("Review sharing before importing.", 409, false, "Publishing disclosure required");
          return true;
        });
        current();
        if (allowed === DECLINED) {
          if (original.pending_import) throw Error("Retry the original sharing choice to recover this import, or start a separate private source.");
          isPublic = false;
        }
      }
      if (original.pending_import && original.is_public !== undefined) isPublic = original.is_public;
      else if (serverSave && !fromShare) await setNativeShareVisibility(localDrafts, owner, isPublic, current);
      current();
      const pending = { ...original, pending_import: true,
        server_auto_save: serverSave, is_public: isPublic,
        // A pending import from an older build was sent without typed formats; its retry must send the same body.
        typed_formats: original.pending_import ? original.typed_formats === true : true,
        multipart_runner: original.pending_import ? original.multipart_runner === true : true,
        auto_save: original.pending_import ? original.auto_save === true : serverSave || original.kind === "url" };
      // Persist original UUID/fields before any transport; retries stay frozen.
      const frozen = await persist(pending);
      const source = await sourceFor(frozen, current);
      if (frozen.class_parts) {
        await localDrafts.save(owner, `class-preferences:${generation}`, frozen.programming); current();
      }
      const job = frozen.server_auto_save || frozen.class_parts
        ? await api.startImport(frozen.request_id, source, frozen.generation, { auto_save: frozen.auto_save === true, is_public: frozen.is_public === true })
        : await api.startImport(frozen.request_id, source, frozen.generation);
      await persist({ ...frozen, job_id: job.id });
      await localDrafts.save(owner, `import-visibility:${frozen.generation}:${job.id}`, frozen.is_public === true);
      current();
      await updateImportReferences(localDrafts, owner, frozen.generation, current, (prior) => [
        {
          id: job.id,
          generation: frozen.generation,
          auto_save: frozen.auto_save === true,
          label:
            frozen.kind === "url"
              ? frozen.source_url
              : frozen.kind === "text"
                ? "Pasted workout"
                : frozen.files.map((f) => f.name).join(", "),
          created_at: new Date().toISOString()
        },
        ...prior.filter((item) => item.id !== job.id)
      ]);
      current();
      const submitted = saved.current;
      const next = await enqueue(() => archiveCapturedImport(storage, owner, generation, submitted, currentScope, Crypto.randomUUID));
      currentScope(); slot.assertCurrent(next.revision);
      saved.current = next;
      const blank: CaptureDraft = { request_id: Crypto.randomUUID(), generation, kind: "url", source_url: "", text: "", files: [], created_at: new Date().toISOString() };
      draftRef.current = blank; setDraft(blank); setSubmittedId(job.id);
      setStale(false); setPanel(null); setPasteNote("");
      router.push({ pathname: "/import/[id]", params: { id: job.id, auto: frozen.class_parts ? "0" : "1" } });
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (draft.class_parts || shared !== "1" || !sharedRequest || automatic.current === sharedRequest || !ready || stale ||
      draft.request_id !== sharedRequest || draft.pending_import || draft.job_id || !capabilities.data?.imports ||
      !aiConsent.data?.accepted || aiConsent.data.disclosure_version !== 1) return;
    automatic.current = sharedRequest;
    void submit(true);
  }, [draft.class_parts, shared, sharedRequest, ready, stale, draft.request_id, draft.pending_import, draft.job_id,
    capabilities.data?.imports, aiConsent.data]);
  const locked = busy || stale || !ready || !!draft.pending_import;
  async function paste() {
    if (locked || guard.current || (!draftRef.current.class_parts && draftRef.current.kind !== "url")) return;
    const before = draftRef.current;
    setPasteNote("");
    try {
      const text = await Clipboard.getStringAsync();
      if (!mounted.current || draftRef.current !== before) return;
      if (draftRef.current.class_parts) {
        const instructions = classText(text);
        if (!instructions) {
          setPasteNote(text.trim() ? "Paste the class instructions, not just its WodUp link." : "Your clipboard is empty. Copy the class instructions first.");
          return;
        }
        if (await choose("text")) update({ text: instructions });
        return;
      }
      const link = sharedWorkoutURL(null, text);
      if (link) update({ source_url: link });
      else setPasteNote(text.trim() ? "No link found on your clipboard. To import text, choose Paste workout text below." : "Nothing to paste. Copy a workout link first, and allow pasting if your phone asks.");
    } catch {
      if (mounted.current) setPasteNote(draftRef.current.class_parts ? "Could not read your clipboard. Try pasting into the workout text field." : "Could not read your clipboard. Try pasting into the link field.");
    }
  }
  async function visibility(value: boolean) {
    if (locked || guard.current) return;
    guard.current = true; setBusy(true); setError("");
    try {
      await flush(); await setNativeShareVisibility(localDrafts, owner, value, current);
      await persist({ ...draftRef.current, is_public: value });
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { guard.current = false; if (mounted.current) setBusy(false); }
  }
  const discoverOn = !draft.class_parts && capabilities.data?.server_auto_save === true && capabilities.data.discover === true;
  const isPublic = draft.is_public ?? defaultShareToDiscover(draft.kind);
  const notesApply = draft.kind !== "text";
  const consentOk = !!aiConsent.data?.accepted && aiConsent.data.disclosure_version === 1;
  const submittable = draft.kind === "url" ? linkLooksComplete(draft.source_url) : !captureErrors(draft).length;
  const limits = capabilities.data?.limits;
  return (
    <Screen back title={draft.class_parts ? "Today’s class" : "Add workout"} subtitle={draft.class_parts ? "Paste the class, add screenshots or a Safari Full Page PDF. Review each part before saving." : "Save a workout from a link, text, photos or a PDF."} action={<AccountButton />} scrollRef={scrollRef}>
      {(draft.job_id || submittedId) && <Card compact>
        <Row gap={10} align="flex-start">
          <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          <Grow><Copy kind="small">{draft.job_id ? "Your previous import is saved. Start another source to use this form again." : "Your previous import is saved."}</Copy></Grow>
        </Row>
        <Stack gap={8}>
          <Button title="Open previous import" variant="secondary" onPress={() => router.push({ pathname: "/import/[id]", params: { id: draft.job_id ?? submittedId! } })} />
          {!!draft.job_id && <Button title="Start another source draft" variant="ghost" busy={busy} onPress={() => { void startAnother(); }} />}
        </Stack>
      </Card>}
      {!!error && <Notice error>{error}</Notice>}
      {stale && <Notice>A newer source is saved. Load it before changing this draft.</Notice>}
      {(stale || !ready) && <Button title="Load saved source" secondary busy={busy} onPress={() => { void reloadSaved(); }} />}
      {!enrollment?.enrolled && <Button title="Start saving workouts" onPress={() => router.push("/onboarding")} />}
      {capabilities.error && <Notice error>{capabilities.error.message}</Notice>}
      {capabilities.data && !capabilities.data.imports && (
        <Notice>Automatic importing is not on for this build. You can still write a workout yourself.</Notice>
      )}
      <Card>
        {ready && classRoute === "1" && !draft.class_parts && <Notice>Your other source draft is still here. Switch it to Today’s class, or finish that import first.</Notice>}
        {!draft.class_parts && <Button title="Today’s class" secondary disabled={locked} onPress={() => { void chooseClass(); }} />}
        {draft.class_parts && <>
          <Button title="Start a different import" variant="ghost" inline disabled={locked} onPress={() => setAbandon(true)} />
          <Notice>Gym programming stays private. Crop screenshots to leave out the leaderboard and comments.</Notice>
          {/* Each one acts at once (reads the clipboard, opens a picker), so they are buttons, not a mode switch.
              Three labelled buttons don't fit one line at phone width, so they stack. */}
          <Stack gap={8}>
            <Button title="Paste" icon="clipboard-outline" variant="secondary" disabled={locked} onPress={() => { void paste(); }} />
            <Button title="Screenshots" icon="images-outline" variant="secondary" disabled={locked} onPress={() => { void pick("images"); }} />
            <Button title="PDF" icon="document-attach-outline" variant="secondary" disabled={locked} onPress={() => { void pick("document"); }} />
          </Stack>
          {!!pasteNote && <Copy kind="small" tone="warning">{pasteNote}</Copy>}
          <Field label="Gym" optional disabled={locked} value={draft.programming?.gym_name ?? ""} onChange={gym_name => update({ programming: { ...draft.programming, source_kind: "gym", gym_name } })} />
          <Field label="Track" optional disabled={locked} value={draft.programming?.track ?? ""} onChange={track => update({ programming: { ...draft.programming, source_kind: "gym", track } })} />
          <CalendarDate label="Class date" optional disabled={locked} value={draft.programming?.date ?? null} onChange={date => update({ programming: { ...draft.programming, source_kind: "gym", date } })} />
          <Copy kind="small" tone="muted">In Safari, use Share → Håfa Workouts on the open class page. Or save a Full Page screenshot as a PDF and choose it here.</Copy>
        </>}
        {draft.kind === "url" ? (
          <>
            <Row gap={8} align="flex-end">
              <Grow>
                <Field disabled={locked} label="Workout link" value={draft.source_url} placeholder="Paste a link" purpose="url"
                  onChange={(source_url) => { setPasteNote(""); update({ source_url }); }} />
              </Grow>
              <View>
                <Button title="Paste" icon="clipboard-outline" variant="secondary" disabled={locked}
                  accessibilityHint="Pastes a workout link from your clipboard" onPress={() => { void paste(); }} />
              </View>
            </Row>
            {pasteNote ? <Copy kind="small" tone="warning">{pasteNote}</Copy>
              : draft.source_url.trim() && !submittable ? <Copy kind="small" tone="warning">Use the full link, starting with https://</Copy>
              : <Copy kind="small" tone="muted">YouTube, Instagram, TikTok and workout websites</Copy>}
          </>
        ) : (
          <Row gap={8}>
            <Grow><Copy kind="label">{modeTitles[draft.kind]}</Copy></Grow>
            {!draft.class_parts && <Button title="Use a link instead" variant="ghost" inline disabled={locked} onPress={() => { void choose("url"); }} />}
          </Row>
        )}
        {draft.kind === "url" && duplicateUrl === draft.source_url.trim() && !!duplicateHint.data?.matches.length && (
          <>
            <Copy kind="small" tone="muted">You saved this link before. Open it, or import a separate copy.</Copy>
            {duplicateHint.data.matches.map((item) => (
              <ListRow key={item.id} icon="barbell-outline" title={item.title} value={item.archived ? "Archived" : undefined}
                onPress={() => router.push({ pathname: "/workout/[id]", params: { id: item.id } })} />
            ))}
            {duplicateHint.data.has_more && <Copy kind="small" tone="muted">More saved matches may exist.</Copy>}
          </>
        )}
        {draft.kind === "text" && (
          <Field disabled={locked} label="Workout text" multiline value={draft.text} onChange={(text) => update({ text })}
            placeholder="Paste the creator’s instructions, including rounds, reps and equipment." />
        )}
        {draft.kind === "images" && (
          <>
            <ButtonRow>
              <Button title={draft.class_parts ? "Choose screenshots" : "Choose images"} variant="secondary" icon="images-outline" busy={busy} disabled={locked}
                onPress={() => { void pick("images"); }} />
              <Button title="Take a photo" variant="secondary" icon="camera-outline" disabled={locked}
                onPress={() => { void pick("images", true); }} />
            </ButtonRow>
            <Copy kind="small" tone="muted">{draft.class_parts ? "Up to 8 screenshots." : "Up to 4 images."}</Copy>
            {draft.files.map((file) => <SourceImage key={file.uri} uri={file.uri} label={file.name} />)}
            <Copy kind="small" tone="muted">Clear images where exercise names are easy to read work best.</Copy>
          </>
        )}
        {draft.kind === "document" && (
          <>
            <Button title="Choose PDF or text document" variant="secondary" icon="document-attach-outline" busy={busy} disabled={locked}
              onPress={() => { void pick("document"); }} />
            {draft.files.map((file) => <Copy key={file.uri} kind="label">{file.name}</Copy>)}
            <Copy kind="small" tone="muted">Small text PDFs work best. For scans, use screenshots or paste the text.</Copy>
          </>
        )}
        {(discoverOn || notesApply) && (
          <ListRow icon={discoverOn ? isPublic ? "globe-outline" : "lock-closed-outline" : "options-outline"} disabled={locked}
            title={importSettingsSummary({ discover: discoverOn, isPublic, notes: draft.text, notesApply })}
            detail={discoverOn ? isPublic ? "Complete workouts appear in Discover" : "Only you can see it" : "Add a caption or instructions"}
            onPress={() => setPanel("settings")} />
        )}
        {draft.pending_import && !draft.job_id && (
          <Row gap={8} wrap>
            <Grow><Copy kind="small" tone="muted">This source is saved on your device. Retry to pick up the earlier import.</Copy></Grow>
            <Button title="Start another source" variant="ghost" inline disabled={busy} onPress={() => setAbandon(true)} />
          </Row>
        )}
        {aiConsent.error && <Copy kind="small" tone="error">Could not check AI preferences. Try again before importing.</Copy>}
        {!aiConsent.isPending && !consentOk && <Copy kind="small" tone="muted">
          Importing sends this source to OpenAI to read the workout. Your training profile isn’t included.
        </Copy>}
        <Button
          title={draft.pending_import ? "Retry import" : consentOk ? "Import workout" : "Agree and import"}
          icon="sparkles-outline"
          busy={busy}
          disabled={stale || !ready || aiConsent.isPending || !!aiConsent.error || !capabilities.data?.imports || !enrollment?.enrolled ||
            !!draft.job_id || (!draft.pending_import && !submittable)}
          onPress={() => { void submit(false, !consentOk); }}
        />
      </Card>
      <ImportList />
      <RecentImports />
      <SectionHeader title="Other ways to add" />
      <ListGroup>
        {otherWays.map(way => (
          <ListRow key={way.kind} icon={way.icon} title={way.title} disabled={locked} value={draft.kind === way.kind ? "Selected" : undefined}
            onPress={() => { void choose(way.kind).then(() => scrollRef.current?.scrollTo({ y: 0, animated: !reduced })); }} />
        ))}
        <ListRow icon="create-outline" title="Write your own" onPress={() => router.push("/add-workout")} />
      </ListGroup>
      <ListGroup>
        <ListRow icon="help-circle-outline" title="How importing works" onPress={() => setPanel("help")} />
        <ListRow icon="chatbubble-ellipses-outline" title="Ask the coach" detail="Get help planning or changing a workout" onPress={() => router.push("/coach")} />
      </ListGroup>
      {limits && !limits.imports_unlimited && (
        <Copy kind="small" tone="muted">Up to {limits.successful_or_pending_imports_per_rolling_day} imports in any 24 hours.</Copy>
      )}
      <Sheet visible={panel === "settings"} onClose={() => setPanel(null)} title="Import settings">
        <View style={{ gap: 12 }}>
          {discoverOn && <>
            <Choice role="radio" label="Public in Discover" icon="globe-outline" selected={isPublic} disabled={locked}
              detail="Others can find and save complete workouts. Your training and incomplete drafts stay private."
              onPress={() => { if (!isPublic) void visibility(true); }} />
            <Choice role="radio" label="Private" icon="lock-closed-outline" selected={!isPublic} disabled={locked}
              detail="Only you can see this workout."
              onPress={() => { if (isPublic) void visibility(false); }} />
          </>}
          {notesApply && <Field disabled={locked} label="Extra instructions" optional multiline compact value={draft.text}
            onChange={(text) => update({ text })} placeholder="Paste the caption, or say which workout to save" />}
          <Button title="Done" onPress={() => setPanel(null)} />
        </View>
      </Sheet>
      <Sheet visible={panel === "help"} onClose={() => setPanel(null)} title="How importing works">
        <Copy>Copy a link from YouTube, Instagram, TikTok or a workout website, then tap Paste and Import workout. You can also share straight to Håfa Workouts from those apps.</Copy>
        <Copy>Håfa reads the video or page and writes out the exercises, sets and reps. {capabilities.data?.server_auto_save
          ? "Your workout saves to your library when it is ready. You can check or edit the details afterward."
          : "You check the details before it saves to your library."}</Copy>
        <Copy>Importing sends the source to OpenAI to read the workout. Your training profile isn’t included.</Copy>
        {discoverOn && <Copy>Public link imports appear in Discover once they are complete. Photos, PDFs and pasted text stay private unless you choose Public.</Copy>}
        <Copy>If an import can’t finish, open it from In progress to retry or add the caption.</Copy>
      </Sheet>
      <Sheet visible={abandon} onClose={() => setAbandon(false)} title="Start a separate source?">
        <Copy>{draft.pending_import ? "This source may still be processing. Starting over discards this draft and may create a second import." : "Starting over discards this class draft and opens a regular import."}</Copy>
        <Button title="Keep this source" secondary disabled={busy} onPress={() => setAbandon(false)} />
        <Button
          title="Start a separate source and discard this draft"
          variant="destructive"
          disabled={busy}
          onPress={() => {
            if (guard.current) return;
            guard.current = true;
            setBusy(true);
            void replace({
              request_id: Crypto.randomUUID(),
              generation,
              kind: "url",
              text: "",
              source_url: "",
              files: [],
              created_at: new Date().toISOString()
            })
              .then(() => {
                current();
                setAbandon(false);
                setError("");
              })
              .catch((e) => {
                if (mounted.current) setError(e.message);
              })
              .finally(() => {
                guard.current = false;
                if (mounted.current) setBusy(false);
              });
          }}
        />
      </Sheet>
      {disclosure.sheet}
    </Screen>
  );
}
const modeTitles = { text: "Pasted workout text", images: "Photos or screenshots", document: "PDF or text document" } as const;
const otherWays = [
  { kind: "text", title: "Paste workout text", icon: "document-text-outline" },
  { kind: "images", title: "Photos or screenshots", icon: "images-outline" },
  { kind: "document", title: "PDF or text document", icon: "document-attach-outline" },
] as const;
