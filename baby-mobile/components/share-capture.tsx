import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Platform } from "react-native";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { useShareIntentContext } from "expo-share-intent";
import { useBaby } from "@/lib/context";
import { preserveFile, removeLocal } from "@/lib/files";
import type { EditorDraft, LocalFile } from "@/lib/models";
import {
  acknowledgeShare,
  nativeSharingAvailable,
  pendingShare,
  type NativeShare,
} from "@/modules/hafa-baby-share/src";
export function ShareCapture() {
  const stock = useShareIntentContext(),
    b = useBaby(),
    handling = useRef(""),
    mounted = useRef(false),
    [retry, setRetry] = useState(0),
    [native, setNative] = useState<NativeShare | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    let request = 0;
    const load = async () => {
      const ticket = ++request;
      if (Platform.OS === "ios" && nativeSharingAvailable) {
        try {
          const p = await pendingShare();
          if (!active || ticket !== request) return;
          setNative(p);
        } catch {
          return;
        }
      }
      if (active && ticket === request) setRetry((value) => value + 1);
    };
    void load();
    const app = AppState.addEventListener("change", (s) => {
      if (s === "active") void load();
    });
    return () => {
      active = false;
      app.remove();
    };
  }, [b.owner]);
  const shared = native
    ? {
        webUrl: native.url,
        text: native.text,
        files: native.files.map((f) => ({ ...f, path: f.path })),
        meta: { url: native.url },
      }
    : stock.shareIntent;
  const has = Platform.OS === "ios" && nativeSharingAvailable ? !!native : stock.hasShareIntent;
  const fingerprint = native?.token ?? JSON.stringify([shared.webUrl, shared.text, shared.files?.map((f) => f.path)]);
  useEffect(() => {
    if (!has || !b.ready || !b.owner || b.state.bootstrap?.active === false || handling.current === fingerprint) return;
    handling.current = fingerprint;
    const captured = b.owner,
      current = () => mounted.current && b.current(),
      key = "share:" + fingerprint;
    const discard = () => {
      void (async () => {
        if (!current()) return;
        try {
          if (native) {
            if (!acknowledgeShare(native.token)) throw Error("Share changed");
            const next = await pendingShare();
            if (!current()) return;
            setNative(next);
          } else stock.resetShareIntent();
          // Saved drafts own their copies; discarding only retires the incoming share.
          handling.current = "";
        } catch {
          if (current()) Alert.alert("Share could not be discarded", "Try discarding it again when you return to Håfa Baby.");
          handling.current = "";
        }
      })();
    };
    Alert.alert(
      "Save this shared source?",
      "Save it privately to the Håfa Baby account you are using now. Nothing is sent to AI until you choose to process it.",
      [
        {
          text: "Later",
          style: "cancel",
          onPress: () => {
            handling.current = "";
          },
        },
        { text: "Discard share", style: "destructive", onPress: discard },
        {
          text: "Review source",
          onPress: () => {
            void (async () => {
              const copied: LocalFile[] = [];
              let committed = false;
              try {
                if (!current()) return;
                let draft = b.state.drafts[key];
                if (!draft) {
                  const id = Crypto.randomUUID(),
                    url = shared.webUrl ?? shared.meta?.url ?? shared.text?.match(/https?:\/\/[^\s]+/)?.[0] ?? "";
                  draft = {
                    id,
                    kind: "source",
                    title: "",
                    body: shared.text ?? "",
                    child_id: b.state.selectedChild,
                    occurred_at: new Date().toISOString(),
                    data: { url, topics: [] },
                    files: [],
                  };
                  let skipped = 0;
                  for (const f of shared.files ?? []) {
                    try {
                      const file = await preserveFile(captured, {
                        uri: f.path, name: f.fileName ?? undefined, mimeType: f.mimeType,
                      });
                      copied.push(file);
                      draft.files.push(file);
                    } catch (error) {
                      const code = (error as { code?: string }).code;
                      if (code !== "unsupported_file" && code !== "file_too_large") throw error;
                      skipped++;
                    }
                  }
                  if (!current()) return;
                  if (!draft.files.length && !draft.body.trim() && !url)
                    throw Error("Share an image, PDF, audio or video smaller than 25 MB, or a website link.");
                  await b.saveDraft(key, draft);
                  committed = true;
                  if (skipped && current()) Alert.alert("Some attachments were left out",
                    "Your supported files, link and notes were kept. Attachments must be an image, PDF, audio or video smaller than 25 MB.");
                }
                if (!current()) return;
                if (native) {
                  const acknowledged = acknowledgeShare(native.token);
                  setNative(await pendingShare());
                  if (!acknowledged) handling.current = "";
                } else stock.resetShareIntent();
                router.push({ pathname: "/edit", params: { draft: key, kind: "source" } });
              } catch (error) {
                if (current())
                  Alert.alert(
                    "Your share needs another try",
                    error instanceof Error && error.message.startsWith("Share an image")
                      ? error.message
                      : "Your source is still available. Try again, or reopen Håfa Baby to continue.",
                    [{ text: "Later", style: "cancel" }, { text: "Discard share", style: "destructive", onPress: discard },
                      { text: "Try again", onPress: () => {
                      if (current()) setRetry((value) => value + 1);
                    } }]
                  );
                handling.current = "";
              } finally {
                if (!committed) await Promise.allSettled(copied.map((file) => removeLocal(captured, file.uri)));
              }
            })();
          },
        },
      ]
    );
  }, [has, fingerprint, b.ready, b.owner, b.state.bootstrap?.active, retry]);
  return null;
}
