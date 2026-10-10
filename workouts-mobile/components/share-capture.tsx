import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { useShareIntentContext } from "expo-share-intent";
import { useTraining } from "@/lib/context";
import type { CaptureDraft } from "@/lib/capture";
import { normalizeImages, cleanupCaptureFiles } from "@/lib/capture-io";
export function ShareCapture() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const { localDrafts, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const live = useRef({ owner, generation: enrollment?.generation, storage });
  live.current = { owner, generation: enrollment?.generation, storage };
  const handling = useRef<string | null>(null);
  const fingerprint = JSON.stringify([shareIntent.webUrl, shareIntent.text, shareIntent.files?.map((f) => f.path)]);
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
          !mounted ||
          !storage.isCurrent() ||
          !isCurrentAccount() ||
          live.current.owner !== owner ||
          live.current.generation !== generation ||
          live.current.storage !== storage
        )
          throw Error("The original capture account or enrollment changed. The shared source was stopped.");
      }
      const scope = `capture:${generation}`;
      let registered = false;
      let draft: CaptureDraft = {
        request_id: Crypto.randomUUID(),
        generation,
        created_at: new Date().toISOString(),
        kind: shareIntent.webUrl ? "url" : "text",
        source_url: shareIntent.webUrl ?? "",
        text: shareIntent.text ?? "",
        files: []
      };
      try {
        if (shareIntent.files?.length) {
          if (shareIntent.files.some((f) => !f.mimeType.startsWith("image/")))
            throw Error(
              "This shared file is not an image. Choose its PDF or text file from the Capture screen instead."
            );
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
        guard();
        const prior = await localDrafts.load<CaptureDraft>(owner, scope);
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
          resetShareIntent();
          return;
        }
        guard();
        const retained = [...(prior?.cleanup_files ?? []), ...(prior?.files ?? [])];
        await localDrafts.save(owner, scope, { ...draft, cleanup_files: retained });
        registered = true;
        guard();
        await cleanupCaptureFiles(retained, true);
        await localDrafts.save(owner, scope, draft);
        guard();
        resetShareIntent();
        if (mounted) router.push("/capture");
      } catch (e) {
        let current = true;
        try {
          guard();
        } catch {
          current = false;
        }
        let problem = e;
        if (!registered || !current) {
          try {
            await cleanupCaptureFiles(draft.files, true);
          } catch (cleanup) {
            problem = cleanup;
          }
        }
        if (current)
          Alert.alert(
            "Could not save shared source",
            problem instanceof Error ? problem.message : "Open Capture to choose the source again."
          );
        if (current) resetShareIntent();
      }
    })();
    return () => {
      mounted = false;
    };
  }, [hasShareIntent, fingerprint, owner, enrollment?.generation, enrollment?.enrolled]);
  return null;
}
