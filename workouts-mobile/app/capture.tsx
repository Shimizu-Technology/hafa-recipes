import { SourceImage } from "@/components/source-image";
import { useEffect, useRef, useState } from "react";
import { Image, View } from "react-native";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Choice, Copy, Field, Notice, Screen } from "@/components/ui";
import { useTraining } from "@/lib/context";
import { captureErrors, type CaptureDraft, type CaptureKind } from "@/lib/capture";
import { pickImages, pickDocument, sourceFor, cleanupCaptureFiles } from "@/lib/capture-io";
export default function Capture() {
  const { localDrafts, api, owner, enrollment } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const scope = `capture:${generation}`;
  const [draft, setDraft] = useState<CaptureDraft>(() => ({
    request_id: Crypto.randomUUID(),
    generation,
    kind: "url",
    text: "",
    source_url: "",
    files: [],
    created_at: new Date().toISOString(),
  }));
  const [ready, setReady] = useState(false);
  const [duplicateUrl, setDuplicateUrl] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDuplicateUrl(draft.kind === "url" ? draft.source_url.trim() : ""), 500);
    return () => clearTimeout(timer);
  }, [draft.kind, draft.source_url]);
  const duplicateHint = useQuery({
    queryKey: [owner, "duplicate-sources", generation, duplicateUrl],
    queryFn: () => api.duplicateSources(duplicateUrl, undefined, generation),
    enabled: !!enrollment?.enrolled && /^https?:\/\//i.test(duplicateUrl) && duplicateUrl.length <= 2000,
  });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const capabilities = useQuery({
    queryKey: [owner, "capabilities", generation],
    queryFn: api.capabilities,
    enabled: !!enrollment?.enrolled,
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
                    created_at: new Date().toISOString(),
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
    setDraft(value);
    void localDrafts
      .save(owner, scope, value)
      .catch(() => setError("Could not keep this source draft locally. Stay here until it is saved."));
  }
  async function choose(kind: CaptureKind) {
    setError("");
    if (kind !== draft.kind) {
      await cleanupCaptureFiles(draft.files);
      update({ ...draft, request_id: Crypto.randomUUID(), kind, files: [], job_id: undefined });
    }
  }
  async function pick(kind: "images" | "document", camera = false) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      const files = kind === "images" ? await pickImages(camera) : await pickDocument();
      if (files.length) {
        await cleanupCaptureFiles(draft.files);
        update({ ...draft, request_id: Crypto.randomUUID(), kind, files, job_id: undefined });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
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
      const source = await sourceFor(draft);
      await localDrafts.save(owner, scope, draft);
      await api.setAiConsent(true, generation);
      const job = await api.startImport(draft.request_id, source, draft.generation);
      update({ ...draft, job_id: job.id });
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
          created_at: new Date().toISOString(),
        },
        ...prior.filter((item) => item.id !== job.id),
      ]);
      router.push({ pathname: "/import/[id]", params: { id: job.id } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
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
              document: "A PDF or text document",
            }[kind]
          }
          selected={draft.kind === kind}
          onPress={() => {
            void choose(kind);
          }}
        />
      ))}
      {draft.kind === "url" && (
        <Field
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
          label="Caption or extra source instructions"
          optional
          multiline
          value={draft.text}
          onChange={(text) => update({ ...draft, text, request_id: Crypto.randomUUID(), job_id: undefined })}
        />
      )}
      {draft.kind === "text" && (
        <Field
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
            onPress={() => {
              void pick("images");
            }}
          />
          <Button
            title="Take a photo"
            secondary
            disabled={busy}
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
      <Button
        title="Extract workout"
        busy={busy}
        disabled={!ready || !capabilities.data?.imports || !enrollment?.enrolled}
        onPress={() => {
          void submit();
        }}
      />
    </Screen>
  );
}
