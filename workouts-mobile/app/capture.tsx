import { SourceImage } from "@/components/source-image";
import { useEffect, useRef, useState } from "react";
import { Image, View } from "react-native";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Choice, Copy, Field, Notice, Screen } from "@/components/ui";
import { useTraining } from "@/lib/context";
import { captureErrors, type CaptureDraft, type CaptureKind, type CaptureFile } from "@/lib/capture";
import { pickImages, pickDocument, sourceFor, cleanupCaptureFiles } from "@/lib/capture-io";
export default function Capture() {
  const { localDrafts, api, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const scope = `capture:${generation}`;
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
  function current() {
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
  const capabilities = useQuery({
    queryKey: [owner, "capabilities", generation],
    queryFn: api.capabilities,
    enabled: !!enrollment?.enrolled
  });
  useEffect(() => {
    let active = true;
    void localDrafts
      .load<CaptureDraft>(owner, scope)
      .then((value) => {
        if (active) {
          if (value?.generation === generation) setDraft(value);
          else
            setDraft((old) =>
              old.generation === 0
                ? { ...old, generation, request_id: Crypto.randomUUID() }
                : {
                    request_id: Crypto.randomUUID(),
                    generation,
                    kind: "url",
                    text: "",
                    source_url: "",
                    files: [],
                    created_at: new Date().toISOString()
                  }
            );
          setReady(true);
        }
      })
      .catch(() => {
        if (active) {
          setReady(true);
          setError("Could not restore your source draft. You can choose the source again.");
        }
      });
    return () => {
      active = false;
    };
  }, [owner, scope, generation]);
  function update(value: CaptureDraft) {
    if (guard.current || draftRef.current.pending_import) return;
    try {
      current();
    } catch {
      return;
    }
    setDraft(value);
    void localDrafts
      .save(owner, scope, value)
      .catch(() => setError("Could not keep this source draft locally. Stay here until it is saved."));
  }
  async function persist(value: CaptureDraft) {
    current();
    await localDrafts.save(owner, scope, value);
    current();
    setDraft(value);
  }
  async function replace(value: CaptureDraft) {
    // Keep old exact assets discoverable by erasure until their cleanup succeeds.
    const next = { ...value, cleanup_files: [...(draft.cleanup_files ?? []), ...draft.files] };
    await persist(next);
    await cleanupCaptureFiles(next.cleanup_files, true);
    await persist({ ...next, cleanup_files: [] });
  }
  async function choose(kind: CaptureKind) {
    if (guard.current || draftRef.current.pending_import || kind === draft.kind) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      await replace({ ...draft, request_id: Crypto.randomUUID(), kind, files: [], job_id: undefined });
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function pick(kind: "images" | "document", camera = false) {
    if (guard.current || draftRef.current.pending_import) return;
    guard.current = true;
    setBusy(true);
    setError("");
    let files: CaptureFile[] = [];
    let registered = false;
    try {
      files = kind === "images" ? await pickImages(camera, current, owner) : await pickDocument(current, owner);
      if (files.length) {
        current();
        const next = {
          ...draft,
          request_id: Crypto.randomUUID(),
          kind,
          files,
          job_id: undefined,
          cleanup_files: [...(draft.cleanup_files ?? []), ...draft.files]
        };
        await persist(next);
        registered = true;
        await cleanupCaptureFiles(next.cleanup_files, true);
        await persist({ ...next, cleanup_files: [] });
      }
    } catch (e) {
      let active = true;
      try {
        current();
      } catch {
        active = false;
      }
      let problem = e;
      if (!registered || !active) {
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
    if (guard.current) return;
    const errors = captureErrors(draft);
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
      const pending = { ...draft, pending_import: true };
      // Persist original UUID/fields before any transport; retries stay frozen.
      await persist(pending);
      const source = await sourceFor(pending, current);
      await api.setAiConsent(true, generation);
      current();
      const job = await api.startImport(draft.request_id, source, draft.generation);
      await persist({ ...pending, job_id: job.id });
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
  const locked = busy || !!draft.pending_import;
  return (
    <Screen back title="Keep the inspiration." subtitle="Share a source, review the workout, then make it yours.">
      <Button
        title="Write a workout manually"
        secondary
        icon="create-outline"
        onPress={() => router.push("/add-workout")}
      />
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
          onChange={(source_url) =>
            update({ ...draft, source_url, request_id: Crypto.randomUUID(), job_id: undefined })
          }
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
          onChange={(text) => update({ ...draft, text, request_id: Crypto.randomUUID(), job_id: undefined })}
        />
      )}
      {draft.kind === "text" && (
        <Field
          disabled={locked}
          label="Workout text"
          multiline
          value={draft.text}
          onChange={(text) => update({ ...draft, text, request_id: Crypto.randomUUID(), job_id: undefined })}
          placeholder="Paste the creator’s instructions, including rounds, reps and equipment."
        />
      )}
      {draft.kind === "images" && (
        <>
          <Button
            title="Choose up to four images"
            secondary
            busy={busy}
            disabled={!!draft.pending_import}
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
            disabled={!!draft.pending_import}
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
        disabled={!ready || !capabilities.data?.imports || !enrollment?.enrolled || !!draft.job_id}
        onPress={() => {
          void submit();
        }}
      />
    </Screen>
  );
}
