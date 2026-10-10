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
  const { localDrafts, owner, enrollment } = useTraining();
  const handling = useRef(false);
  const fingerprint = JSON.stringify([shareIntent.webUrl, shareIntent.text, shareIntent.files?.map((f) => f.path)]);
  useEffect(() => {
    if (!hasShareIntent || !enrollment?.enrolled || !enrollment.generation || handling.current) return;
    handling.current = true;
    let mounted = true;
    void (async () => {
      const generation = enrollment.generation!;
      const scope = `capture:${generation}`;
      let draft: CaptureDraft = {
        request_id: Crypto.randomUUID(),
        generation,
        created_at: new Date().toISOString(),
        kind: shareIntent.webUrl ? "url" : "text",
        source_url: shareIntent.webUrl ?? "",
        text: shareIntent.text ?? "",
        files: [],
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
                name: file.fileName,
              }))
            ),
          };
        }
        const prior = await localDrafts.load<CaptureDraft>(owner, scope);
        const hasPrior = prior && !prior.job_id && (prior.text.trim() || prior.source_url.trim() || prior.files.length);
        const replace = hasPrior
          ? await new Promise<boolean>((resolve) =>
              Alert.alert(
                "Replace your unfinished source?",
                "Your current draft is saved on this device. Choose which source to keep.",
                [
                  { text: "Keep current draft", style: "cancel", onPress: () => resolve(false) },
                  { text: "Use shared source", onPress: () => resolve(true) },
                ],
                { cancelable: true, onDismiss: () => resolve(false) }
              )
            )
          : true;
        if (!replace) {
          await cleanupCaptureFiles(draft.files);
          resetShareIntent();
          return;
        }
        if (prior) await cleanupCaptureFiles(prior.files);
        await localDrafts.save(owner, scope, draft);
        resetShareIntent();
        if (mounted) router.push("/capture");
      } catch (e) {
        await cleanupCaptureFiles(draft.files);
        Alert.alert(
          "Could not save shared source",
          e instanceof Error ? e.message : "Open Capture to choose the source again."
        );
        resetShareIntent();
      } finally {
        handling.current = false;
      }
    })();
    return () => {
      mounted = false;
    };
  }, [hasShareIntent, fingerprint, owner, enrollment?.generation, enrollment?.enrolled]);
  return null;
}
