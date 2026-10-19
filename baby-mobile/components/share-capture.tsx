import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Platform } from "react-native";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { useShareIntentContext } from "expo-share-intent";
import { useBaby } from "@/lib/context";
import { preserveFile } from "@/lib/files";
import type { EditorDraft } from "@/lib/models";
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
    [native, setNative] = useState<NativeShare | null>(null);
  useEffect(() => {
    if (Platform.OS !== "ios" || !nativeSharingAvailable) return;
    let active = true;
    const load = () =>
      void pendingShare().then((p) => {
        if (active) setNative(p);
      });
    load();
    const app = AppState.addEventListener("change", (s) => {
      if (s === "active") load();
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
      current = b.current,
      key = "share:" + fingerprint;
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
        {
          text: "Review source",
          onPress: () => {
            void (async () => {
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
                  for (const f of shared.files ?? [])
                    draft.files.push(
                      await preserveFile(captured, { uri: f.path, name: f.fileName ?? undefined, mimeType: f.mimeType })
                    );
                  if (!current()) return;
                  await b.saveDraft(key, draft);
                }
                if (!current()) return;
                if (native) {
                  const acknowledged = acknowledgeShare(native.token);
                  setNative(await pendingShare());
                  if (!acknowledged) handling.current = "";
                } else stock.resetShareIntent();
                router.push({ pathname: "/edit", params: { draft: key, kind: "source" } });
              } catch {
                if (current())
                  Alert.alert(
                    "Your share needs another try",
                    "The original share has not been discarded. Reopen Håfa Baby and try again."
                  );
                handling.current = "";
              }
            })();
          },
        },
      ]
    );
  }, [has, fingerprint, b.ready, b.owner, b.state.bootstrap?.active]);
  return null;
}
