import { SourceImage } from "@/components/source-image";
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, View } from "react-native";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Choice, Copy, Field, Notice, Screen } from "@/components/ui";
import { useTraining } from "@/lib/context";
import { captureErrors, type CaptureDraft, type CaptureKind, type CaptureFile } from "@/lib/capture";
import { createPrivateDraftSlot, type PrivateDraftSnapshot } from "@/lib/private-form";
import { pickImages, pickDocument, sourceFor, cleanupCaptureFiles } from "@/lib/capture-io";
export default function Capture() {
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
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [abandon, setAbandon] = useState(false);
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const mounted = useRef(true);
  const live = useRef({ owner, generation, storage });
  live.current = { owner, generation, storage };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function currentScope() {
    if (
      !mounted.current ||
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
  function changed() {
    if (!readyRef.current || pendingWrites.current) return;
    try {
      currentScope();
      slot.assertCurrent(saved.current.revision);
    } catch {
      if (mounted.current) setStale(true);
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
  useEffect(() => {
    let active = true;
    readyRef.current = false;
    setReady(false);
    setStale(false);
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
  async function submit() {
    if (guard.current || !readyRef.current || stale) return;
    const errors = captureErrors(draftRef.current);
    if (!consent) errors.push("Choose AI extraction consent, or use manual entry.");
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
      const original = draftRef.current;
      const pending = { ...original, pending_import: true };
      // Persist original UUID/fields before any transport; retries stay frozen.
      const frozen = await persist(pending);
      const source = await sourceFor(frozen, current);
      await api.setAiConsent(true, generation);
      current();
      const job = await api.startImport(frozen.request_id, source, frozen.generation);
      await persist({ ...frozen, job_id: job.id });
      const prior =
        (await localDrafts.load<Array<{ id: string; generation: number; label: string; created_at: string }>>(
          owner,
          `imports:${draft.generation}`
        )) ?? [];
      await localDrafts.save(owner, `imports:${draft.generation}`, [
        {
          id: job.id,
          generation: draft.generation,
          label:
            draft.kind === "url"
              ? draft.source_url
              : draft.kind === "text"
                ? "Pasted workout"
                : draft.files.map((f) => f.name).join(", "),
          created_at: new Date().toISOString()
        },
        ...prior.filter((item) => item.id !== job.id)
      ]);
      current();
      router.push({ pathname: "/import/[id]", params: { id: job.id } });
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const locked = busy || stale || !ready || !!draft.pending_import;
  return (
    <Screen back title="Keep the inspiration." subtitle="Share a source, review the workout, then make it yours.">
      <Button
        title="Write a workout manually"
        secondary
        icon="create-outline"
        onPress={() => router.push("/add-workout")}
      />
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
      <Copy kind="heading">Choose your source</Copy>
      {(["url", "text", "images", "document"] as const).map((kind) => (
        <Choice
          key={kind}
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
        />
      )}
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
      {draft.kind !== "text" && (
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
          <Button
            title="Choose up to four images"
            secondary
            busy={busy}
            disabled={locked}
            onPress={() => {
              void pick("images");
            }}
          />
          <Button
            title="Take a photo"
            secondary
            disabled={locked}
            onPress={() => {
              void pick("images", true);
            }}
          />
          {draft.files.map((file) => (
            <Card key={file.uri}>
              <SourceImage uri={file.uri} label={file.name} />
              <Copy>{file.name}</Copy>
            </Card>
          ))}
          <Notice>
            Choose clear images where exercise names and on-screen instructions are readable. You will review them
            before saving the extraction.
          </Notice>
        </>
      )}
      {draft.kind === "document" && (
        <>
          <Button
            title="Choose PDF or text document"
            secondary
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
      <Notice>
        AI extraction sends the source you choose to OpenAI to identify workout details. Review the results; missing
        information stays missing. Your training profile is not included in this source import. Health-data coaching
        needs separate permission.
      </Notice>
      <Choice
        disabled={busy}
        label="Use AI to extract this source"
        detail="You can use manual entry if you prefer not to send the source."
        selected={consent}
        onPress={() => setConsent(!consent)}
      />
      {capabilities.data && (
        <Copy kind="small">
          Free beta · up to {capabilities.data.limits.successful_or_pending_imports_per_rolling_day} successful or
          pending imports in each rolling day.
        </Copy>
      )}
      {!!error && <Notice error>{error}</Notice>}
      {!!draft.job_id && (
        <Button
          title="Resume existing import"
          secondary
          onPress={() => router.push({ pathname: "/import/[id]", params: { id: draft.job_id! } })}
        />
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
      {draft.job_id && (
        <Button
          title="Start another source draft"
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
              .catch((e) => {
                if (mounted.current) setError(e.message);
              })
              .finally(() => {
                guard.current = false;
                if (mounted.current) setBusy(false);
              });
          }}
        />
      )}
      <Button
        title={draft.pending_import ? "Retry extracting this source" : "Extract workout"}
        busy={busy}
        disabled={stale || !ready || !capabilities.data?.imports || !enrollment?.enrolled || !!draft.job_id}
        onPress={() => {
          void submit();
        }}
      />
    </Screen>
  );
}
