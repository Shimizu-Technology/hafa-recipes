import { ImportList } from "@/components/import-list";
import { updateNativeSharingConsent } from "@/lib/native-share-session";
import { SourceImage } from "@/components/source-image";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Image, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { useQuery } from "@tanstack/react-query";
import { AccountButton, Button, Card, Choice, Copy, Field, Grow, Notice, Row, Screen, SectionHeader } from "@/components/ui";
import { useTraining } from "@/lib/context";
import { archiveCapturedImport, captureErrors, updateImportReferences, type CaptureDraft, type CaptureKind, type CaptureFile } from "@/lib/capture";
import { createPrivateDraftSlot, type PrivateDraftSnapshot } from "@/lib/private-form";
import { pickImages, pickDocument, sourceFor, cleanupCaptureFiles } from "@/lib/capture-io";
import { ApiError } from "@/lib/api";
import { DECLINED, defaultShareToDiscover } from "@/lib/discover";
import { usePublishingDisclosure } from "@/components/publishing-disclosure";
import { setNativeShareVisibility } from "@/lib/native-share-session";
export default function Capture() {
  const { shared, request_id: sharedRequest } = useLocalSearchParams<{ shared?: string; request_id?: string }>();
  const { localDrafts, api, owner, enrollment, storage, isCurrentAccount } = useTraining();
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
  const [otherSources, setOtherSources] = useState(false);
  const [showImports, setShowImports] = useState(true);
  const [extraInstructions, setExtraInstructions] = useState(false);
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
    return () => { committed.active = false; };
  }, [owner, generation, storage]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
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
      .then((value) => {
        if (!active) return;
        saved.current = value;
        const next =
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
        draftRef.current = next;
        setDraft(next);
        readyRef.current = true;
        setReady(true);
        if (next.job_id) void startAnother().catch(() => undefined);
      })
      .catch(() => {
        if (active) setError("Could not restore your source. Retry loading it before editing.");
      });
    return () => {
      active = false;
    };
  }, [slot, generation]);
  function update(patch: Partial<Pick<CaptureDraft, "text" | "source_url">>) {
    if (guard.current || draftRef.current.pending_import || !readyRef.current || stale) return;
    try {
      current();
    } catch (e) {
      setStale(true);
      setError((e as Error).message);
      return;
    }
    if (patch.source_url !== undefined && draftRef.current.kind !== "url") return;
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
    await cleanupCaptureFiles(next.cleanup_files, true);
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
      const value = next.value ?? {
        request_id: Crypto.randomUUID(),
        generation,
        kind: "url" as const,
        text: "",
        source_url: "",
        files: [],
        created_at: new Date().toISOString()
      };
      view.current++;
      draftRef.current = value;
      setDraft(value);
      readyRef.current = true;
      setReady(true);
      setStale(false);
      setError("");
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
      setStale(false); setOtherSources(false); setExtraInstructions(false);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function choose(kind: CaptureKind) {
    if (guard.current || !readyRef.current || stale || draftRef.current.pending_import || kind === draft.kind) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      await replace({ ...draftRef.current, request_id: Crypto.randomUUID(), kind, files: [], job_id: undefined });
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
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
        kind === "images" ? await pickImages(camera, pickerCurrent, owner) : await pickDocument(pickerCurrent, owner);
      if (files.length) {
        current();
        const next = {
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
        await cleanupCaptureFiles(next.cleanup_files, true);
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
          setError("AI preferences changed. Review the disclosure before extracting.");
          return;
        }
        await updateNativeSharingConsent(() => api.setAiConsent(true, generation));
        current();
        await aiConsent.refetch();
        current();
      }
      const original = draftRef.current;
      const serverSave = original.pending_import ? original.server_auto_save === true : capabilities.data?.server_auto_save === true;
      let isPublic = original.is_public ?? defaultShareToDiscover(original.kind);
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
        auto_save: original.pending_import ? original.auto_save === true : serverSave || original.kind === "url" };
      // Persist original UUID/fields before any transport; retries stay frozen.
      const frozen = await persist(pending);
      const source = await sourceFor(frozen, current);
      const job = frozen.server_auto_save
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
      setStale(false); setOtherSources(false); setExtraInstructions(false);
      router.push({ pathname: "/import/[id]", params: { id: job.id, auto: "1" } });
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (shared !== "1" || !sharedRequest || automatic.current === sharedRequest || !ready || stale ||
      draft.request_id !== sharedRequest || draft.pending_import || draft.job_id || !capabilities.data?.imports ||
      !aiConsent.data?.accepted || aiConsent.data.disclosure_version !== 1) return;
    automatic.current = sharedRequest;
    void submit(true);
  }, [shared, sharedRequest, ready, stale, draft.request_id, draft.pending_import, draft.job_id,
    capabilities.data?.imports, aiConsent.data]);
  const locked = busy || stale || !ready || !!draft.pending_import;
  async function visibility(value: boolean) {
    if (locked || guard.current) return;
    guard.current = true; setBusy(true); setError("");
    try {
      await flush(); await setNativeShareVisibility(localDrafts, owner, value, current);
      await persist({ ...draftRef.current, is_public: value });
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { guard.current = false; if (mounted.current) setBusy(false); }
  }
  return (
    <Screen title="Extract a workout." subtitle="Paste a link, add a source, or pick up an unfinished import." action={<AccountButton />}>
      <Button title={showImports ? "Hide unfinished imports" : "View processing and unfinished imports"} secondary icon="time-outline" onPress={() => setShowImports(value => !value)} />
      {showImports && <ImportList showEmpty />}
      {(draft.job_id || submittedId) && <Card>
        <Copy kind="heading">Your previous import is saved.</Copy>
        <Copy>{draft.job_id ? "Start another source to unlock this form. Your original source stays saved for this import." : "Add another workout below, or resume this import to check its progress."}</Copy>
        <Button title="Resume existing import" secondary onPress={() => router.push({ pathname: "/import/[id]", params: { id: draft.job_id ?? submittedId! } })} />
        {!!draft.job_id && <Button title="Start another source draft" secondary busy={busy} onPress={() => { void startAnother(); }} />}
      </Card>}
      {!!error && <Notice error>{error}</Notice>}
      {stale && <Notice>A newer source is saved. Load it before changing this draft.</Notice>}
      {(stale || !ready) && (
        <Button
          title="Load saved source"
          secondary
          busy={busy}
          onPress={() => {
            void reloadSaved();
          }}
        />
      )}
      {!enrollment?.enrolled && <Button title="Set up my training" onPress={() => router.push("/onboarding")} />}
      {capabilities.error && <Notice error>{capabilities.error.message}</Notice>}
      {capabilities.data && !capabilities.data.imports && (
        <Notice>Automatic extraction is not enabled for this build. You can write a workout manually.</Notice>
      )}
      <Button title={otherSources ? "Hide other ways to add" : "Other ways to add a workout"} variant="ghost"
        disabled={locked} onPress={() => setOtherSources(!otherSources)} />
      {(otherSources || draft.kind !== "url") && (["url", "text", "images", "document"] as const).map((kind) => (
        <Choice
          key={kind}
          icon={({ url: "link-outline", text: "document-text-outline", images: "images-outline", document: "document-attach-outline" } as const)[kind]}
          label={
            {
              url: "A link",
              text: "Pasted workout text",
              images: "Photos or screenshots",
              document: "A PDF or text document"
            }[kind]
          }
          disabled={locked}
          selected={draft.kind === kind}
          onPress={() => {
            void choose(kind);
          }}
        />
      ))}
      {draft.kind === "url" && (
        <Field
          disabled={locked}
          label="Source link"
          value={draft.source_url}
          onChange={(source_url) => update({ source_url })}
          placeholder="https://…"
          purpose="url"
        />
      )}
      {draft.kind === "url" && <Copy kind="small" tone="muted">Instagram, TikTok, YouTube and workout websites</Copy>}
      {capabilities.data?.server_auto_save && capabilities.data.discover && <Choice
        label="Share to Discover" icon="globe-outline" selected={draft.is_public ?? defaultShareToDiscover(draft.kind)}
        detail="Complete workouts can be found and saved by others. Your training stays private. Missing-detail drafts stay private."
        disabled={locked} onPress={() => { void visibility(!(draft.is_public ?? defaultShareToDiscover(draft.kind))); }} />}
      {duplicateUrl === draft.source_url.trim() && !!duplicateHint.data?.matches.length && (
        <Card>
          <Copy kind="heading">You have saved this source before.</Copy>
          <Copy>
            These matches are suggestions, not automatic duplicates. You can open a saved workout or continue extracting
            a separate version.
          </Copy>
          {duplicateHint.data.matches.map((item) => (
            <Button
              key={item.id}
              title={`${item.title}${item.archived ? " · archived" : ""}`}
              secondary
              onPress={() => router.push({ pathname: "/workout/[id]", params: { id: item.id } })}
            />
          ))}
          {duplicateHint.data.has_more && <Copy>More saved matches may exist.</Copy>}
        </Card>
      )}
      {draft.kind !== "text" && <Button title={extraInstructions ? "Hide extra instructions" : "Add extra instructions"}
        variant="ghost" disabled={locked} onPress={() => setExtraInstructions(!extraInstructions)} />}
      {draft.kind !== "text" && (extraInstructions || !!draft.text.trim()) && (
        <Field
          disabled={locked}
          label="Caption or extra source instructions"
          optional
          multiline
          value={draft.text}
          onChange={(text) => update({ text })}
        />
      )}
      {draft.kind === "text" && (
        <Field
          disabled={locked}
          label="Workout text"
          multiline
          value={draft.text}
          onChange={(text) => update({ text })}
          placeholder="Paste the creator’s instructions, including rounds, reps and equipment."
        />
      )}
      {draft.kind === "images" && (
        <>
          <Row gap={10}>
            <Grow>
              <Button
                title="Choose up to four images"
                secondary
                icon="images-outline"
                busy={busy}
                disabled={locked}
                onPress={() => {
                  void pick("images");
                }}
              />
            </Grow>
            <Grow>
              <Button
                title="Take a photo"
                secondary
                icon="camera-outline"
                disabled={locked}
                onPress={() => {
                  void pick("images", true);
                }}
              />
            </Grow>
          </Row>
          {draft.files.map((file) => (
            <Card key={file.uri}>
              <SourceImage uri={file.uri} label={file.name} />
              <Copy>{file.name}</Copy>
            </Card>
          ))}
          <Notice>
            Choose clear images where exercise names and on-screen instructions are readable. You will review them
            whenever you want to check the extracted workout.
          </Notice>
        </>
      )}
      {draft.kind === "document" && (
        <>
          <Button
            title="Choose PDF or text document"
            secondary
            icon="document-attach-outline"
            busy={busy}
            disabled={locked}
            onPress={() => {
              void pick("document");
            }}
          />
          {draft.files.map((file) => (
            <Copy key={file.uri}>{file.name}</Copy>
          ))}
          <Notice>
            Small text PDFs are supported. For scanned or larger documents, use screenshots or paste the workout text.
          </Notice>
        </>
      )}
      {aiConsent.error && <Notice error>Could not check AI preferences. Try again before extracting.</Notice>}
      {!aiConsent.isPending && (!aiConsent.data?.accepted || aiConsent.data.disclosure_version !== 1) && <Notice>
        Agree and extract sends this source to OpenAI to read the workout. Your training profile is not included.
        Missing details stay marked. You can change AI preferences in Settings or write a workout manually.
      </Notice>}
      {capabilities.data?.limits && !capabilities.data.limits.imports_unlimited && (
        <Copy kind="small" tone="muted">
          Up to {capabilities.data.limits.successful_or_pending_imports_per_rolling_day} successful or
          pending imports in each rolling day.
        </Copy>
      )}
      {draft.pending_import && !draft.job_id && (
        <Notice>
          This source is saved on your device. Retry sends the same source to recover the earlier import. You can also
          enter the workout manually.
        </Notice>
      )}
      {draft.pending_import && !draft.job_id && (
        <Button title="Start another source" secondary disabled={busy} onPress={() => setAbandon(true)} />
      )}
      {abandon && (
        <Card>
          <Notice>
            This source may already be processing. Retry first to recover it. Starting another source discards this
            device draft and may create another import. An earlier import keeps processing.
          </Notice>
          <Button title="Keep this source" secondary disabled={busy} onPress={() => setAbandon(false)} />
          <Button
            title="Start a separate source and discard this draft"
            secondary
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
        </Card>
      )}
      <Button
        title={draft.pending_import ? "Retry extraction" : aiConsent.data?.accepted && aiConsent.data.disclosure_version === 1
          ? "Extract workout" : "Agree and extract"}
        icon="sparkles-outline"
        size="lg"
        busy={busy}
        disabled={stale || !ready || aiConsent.isPending || !!aiConsent.error || !capabilities.data?.imports || !enrollment?.enrolled || !!draft.job_id}
        onPress={() => {
          void submit(false, !aiConsent.data?.accepted || aiConsent.data.disclosure_version !== 1);
        }}
      />
      {capabilities.data?.server_auto_save && <Copy kind="small" tone="muted">Your workout saves to your library when it is ready. You can check or edit the details afterward.</Copy>}
      <Button
        title="Write a workout manually"
        variant="ghost"
        icon="create-outline"
        onPress={() => router.push("/add-workout")}
      />
      {disclosure.sheet}
    </Screen>
  );
}
