import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Platform } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { useShareIntentContext } from "expo-share-intent";
import { useTraining } from "@/lib/context";
import { archiveCapturedImport, sharedWorkoutURL, updateImportReferences, type CaptureDraft } from "@/lib/capture";
import { createPrivateDraftSlot } from "@/lib/private-form";
import { normalizeImages, normalizeDocument, cleanupCaptureFiles } from "@/lib/capture-io";
import * as NativeShare from "@/modules/hafa-workouts-share/src";
import { useNativeShareSession } from "./native-share-session";
export function ShareCapture() {
  const stock = useShareIntentContext();
  const cache = useQueryClient();
  const { owner, enrollment, storage, localDrafts, isCurrentAccount } = useTraining();
  const [native, setNative] = useState<NativeShare.NativeCapture | null>(null);
  const [queueVersion, setQueueVersion] = useState(0);
  useNativeShareSession();
  useEffect(() => {
    if (Platform.OS !== "ios" || !NativeShare.nativeSharingAvailable || !enrollment?.generation) return;
    let active = true;
    const load = async () => {
      const pending = (await NativeShare.captures()).find(capture =>
        !capture.ownerId || (capture.ownerId === owner && capture.generation === enrollment.generation));
      if (!active || !pending) return;
      if (!pending.ownerId) {
        const assign = await new Promise<boolean>(resolve => Alert.alert("Import your saved source?",
          "This source was shared while no Workouts account was available. Save it to the account you are using now?",
          [{ text: "Later", style: "cancel", onPress: () => resolve(false) },
            { text: "Import to this account", onPress: () => resolve(true) }],
          { cancelable: true, onDismiss: () => resolve(false) }));
        if (!assign) return;
      }
      if (active) setNative(pending);
    };
    void load().catch(() => undefined);
    const listener = AppState.addEventListener("change", state => { if (state === "active") void load().catch(() => undefined); });
    return () => { active = false; listener.remove(); };
  }, [owner, enrollment?.generation, queueVersion]);
  const shareIntent = native ? { webUrl: native.url ?? null, text: native.text, files: native.files, meta: { url: native.url } } : stock.shareIntent;
  const hasShareIntent = native ? true : Platform.OS === "ios" && NativeShare.nativeSharingAvailable ? false : stock.hasShareIntent;
  const resetShareIntent = () => {
    if (native) { setNative(null); setQueueVersion(value => value + 1); }
    else stock.resetShareIntent();
  };
  const sourceURL = sharedWorkoutURL(shareIntent.webUrl, shareIntent.text, shareIntent.meta?.url);
  const fingerprint = JSON.stringify([native?.captureId, sourceURL, shareIntent.text, shareIntent.files?.map((f) => f.path)]);
  const live = useRef({ owner, generation: enrollment?.generation, storage, fingerprint, hasShareIntent, active: false });
  useLayoutEffect(() => {
    const committed = { owner, generation: enrollment?.generation, storage, fingerprint, hasShareIntent, active: true };
    live.current = committed;
    return () => { committed.active = false; };
  }, [owner, enrollment?.generation, storage, fingerprint, hasShareIntent]);
  const handling = useRef<string | null>(null);
  const scope = `capture:${enrollment?.generation ?? 0}`;
  const slot = useMemo(
    () => createPrivateDraftSlot<CaptureDraft>(storage, owner, scope, Crypto.randomUUID),
    [storage, owner, scope]
  );
  useEffect(() => {
    if (!hasShareIntent) {
      handling.current = null;
      return;
    }
    if (!enrollment?.enrolled || !enrollment.generation || handling.current === fingerprint) return;
    // A newer share retires the old effect. A started share never transfers accounts.
    handling.current = fingerprint;
    let mounted = true;
    void (async () => {
      const generation = enrollment.generation!;
      function guard() {
        if (
          !mounted || !live.current.active ||
          !storage.isCurrent() ||
          !isCurrentAccount() ||
          live.current.owner !== owner ||
          live.current.generation !== generation ||
          live.current.storage !== storage ||
          live.current.fingerprint !== fingerprint ||
          !live.current.hasShareIntent
        )
          throw Error("The shared source or account changed. Open Capture to choose the source again.");
      }
      let registered = false;
      let draft: CaptureDraft = {
        request_id: native?.captureId ?? Crypto.randomUUID(),
        generation,
        created_at: new Date().toISOString(),
        kind: sourceURL ? "url" : "text",
        source_url: sourceURL ?? "",
        text: shareIntent.text ?? "",
        files: [],
        ...(native ? { is_public: native.isPublic } : {})
      };
      try {
        if (native?.jobId) {
          guard();
          await localDrafts.save(owner, `import-source-visibility:${generation}:${native.jobId}`, native.isPublic); guard();
          await updateImportReferences(localDrafts, owner, generation, guard, prior => [
            { id: native.jobId!, generation, auto_save: true, label: sourceURL ?? "Shared workout", created_at: new Date().toISOString() },
            ...prior.filter(item => item.id !== native.jobId)]);
          guard();
          await cache.invalidateQueries({ queryKey: [owner, "imports", generation] }); guard();
          await cache.invalidateQueries({ queryKey: [owner, "library"] }); guard();
          if (!(await NativeShare.acknowledge(native.captureKey))) throw Error("Your import is saved. Reopen Workouts to reconnect this share.");
          guard(); resetShareIntent(); return;
        }
        if (shareIntent.files?.length) {
          if (shareIntent.files.some((f) => !f.mimeType.startsWith("image/"))) {
            if (shareIntent.files.length !== 1) throw Error("Share one PDF or text document, or up to four images together.");
            const file = shareIntent.files[0];
            draft = { ...draft, kind: "document", files: await normalizeDocument({ uri: file.path, mimeType: file.mimeType, name: file.fileName }, guard, owner) };
          } else {
          draft = {
            ...draft,
            kind: "images",
            files: await normalizeImages(
              shareIntent.files.map((file) => ({
                uri: file.path,
                width: file.width,
                height: file.height,
                name: file.fileName
              })),
              guard,
              owner
            )
          };
          }
        }
        guard();
        let saved = await slot.load(guard);
        const prior = saved.value;
        guard();
        if (prior?.pending_import && !prior.job_id)
          throw Error("Resolve the original pending import in Capture before replacing its source.");
        const hasPrior = prior && !prior.job_id && (prior.text.trim() || prior.source_url.trim() || prior.files.length);
        const replace = hasPrior
          ? await new Promise<boolean>((resolve) =>
              Alert.alert(
                "Replace your unfinished source?",
                "Your current draft is saved on this device. Choose which source to keep.",
                [
                  { text: "Keep current draft", style: "cancel", onPress: () => resolve(false) },
                  { text: "Use shared source", onPress: () => resolve(true) }
                ],
                { cancelable: true, onDismiss: () => resolve(false) }
              )
            )
          : true;
        if (!replace) {
          await cleanupCaptureFiles(draft.files);
          guard();
          if (native && !(await NativeShare.acknowledge(native.captureKey))) throw Error("Could not finish clearing this shared source. Reopen Workouts to retry.");
          guard();
          resetShareIntent();
          return;
        }
        guard();
        if (prior?.job_id) {
          saved = await archiveCapturedImport(storage, owner, generation, saved, guard, Crypto.randomUUID);
          guard();
        }
        const retained = prior?.job_id ? [] : [...(prior?.cleanup_files ?? []), ...(prior?.files ?? [])];
        const registeredDraft = await slot.save(saved.revision, { ...draft, cleanup_files: retained }, guard);
        registered = true;
        guard();
        await cleanupCaptureFiles(retained, true);
        await slot.save(registeredDraft.revision, draft, guard);
        guard();
        if (native && !(await NativeShare.acknowledge(native.captureKey))) throw Error("Your source is saved. Reopen Workouts to reconnect this share.");
        guard();
        resetShareIntent();
        if (mounted) router.push({ pathname: "/capture", params: { shared: "1", request_id: draft.request_id } });
      } catch (e) {
        if ((e as { captureRegistrationUncertain?: boolean }).captureRegistrationUncertain) registered = true;
        let current = true;
        try {
          guard();
        } catch {
          current = false;
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
            await cleanupCaptureFiles(draft.files, true);
          } catch (cleanup) {
            problem = cleanup;
          }
        }
        if (current && native) {
          let decided = false;
          const later = () => { try { guard(); if (!decided) { decided = true; setNative(null); } } catch {} };
          const discard = async () => {
            if (decided) return;
            try {
              guard(); decided = true;
              if (!(await NativeShare.acknowledge(native.captureKey))) throw Error("Your shared source is still saved. Reopen Workouts to try clearing it again.");
              guard(); resetShareIntent();
            } catch (failure) {
              try { guard(); } catch { return; }
              Alert.alert("Could not clear shared source", failure instanceof Error ? failure.message : "Your shared source is still saved. Reopen Workouts to retry.");
              setNative(null);
            }
          };
          Alert.alert("Could not save shared source", problem instanceof Error ? problem.message : "Open Capture to choose the source again.",
            [{ text: "Later", style: "cancel", onPress: later },
              { text: "Discard shared source", style: "destructive", onPress: () => { void discard(); } }],
            { cancelable: true, onDismiss: later });
        } else if (current) {
          Alert.alert(
            "Could not save shared source",
            problem instanceof Error ? problem.message : "Open Capture to choose the source again."
          );
          resetShareIntent();
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [hasShareIntent, fingerprint, owner, enrollment?.generation, enrollment?.enrolled, slot]);
  return null;
}
