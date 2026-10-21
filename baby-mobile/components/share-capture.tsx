import { useEffect, useRef } from "react";
import { Alert, AppState, Platform } from "react-native";
import * as Crypto from "expo-crypto";
import { useShareIntentContext } from "expo-share-intent";
import { useBaby } from "@/lib/context";
import { preserveFile, removeLocal } from "@/lib/files";
import { addMutation } from "@/lib/outbox";
import type { LocalFile, Mutation, Profile } from "@/lib/models";
import { stockShareScope } from "../lib/stock-share-scope";
import { useShareSession } from "@/lib/use-share-session";
import { acknowledgeShare, nativeSharingAvailable, pendingShare } from "@/modules/hafa-baby-share/src";

// Match Python's strip/splitlines/code-point slicing at the idempotent wire
// boundary, including emoji and Unicode separators in shared captions.
export function sharedSourceTitle(text?: string) {
  const blank = "\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
  const stripped = (text ?? "").replace(new RegExp(`^[${blank}]+|[${blank}]+$`, "g"), "");
  return Array.from(stripped.split(/\r\n|[\n\v\f\r\x1c-\x1e\x85\u2028\u2029]/)[0]).slice(0, 100).join("") || "Saved source";
}

/** Ordinary captures go straight into the encrypted durable outbox. Native
 * originals remain until the exact capture, including every file, is committed. */
export function ShareCapture() {
  useShareSession();
  const b = useBaby(), stock = useShareIntentContext();
  const account = useRef(b);
  account.current = b;
  useEffect(() => {
    let alive = true, running = false;
    const drain = async () => {
      if (running) return;
      running = true;
      try {
        while (alive) {
          const baby = account.current, bootstrap = baby.state.bootstrap;
          if (!baby.ready || !baby.owner || !bootstrap || bootstrap.active === false || !baby.current()) return;
          const owner = baby.owner, generation = bootstrap.generation;
          const current = () => alive && baby.current() && account.current.owner === owner &&
            account.current.state.bootstrap?.generation === generation;
          const native = Platform.OS === "ios" && nativeSharingAvailable ? await pendingShare() : null;
          if (!current()) return;
          if (Platform.OS === "ios" && nativeSharingAvailable && !native) return;
          if (native && native.scope !== `${owner}:${generation}`) return;
          if (!native && !stock.hasShareIntent) return;
          if (!native && !stockShareScope.allow(stock.shareIntent, owner, generation)) return;
          if (native?.status) {
            // Persist progress discovery before retiring the native receipt.
            if (native.import_id || native.status === "deferred") {
              const job = { id: native.import_id || native.capture_id, record_id: native.record_id,
                status: native.status === "deferred" ? "deferred" : "queued" };
              await baby.commit(state => {
                if (!current() || state.bootstrap?.generation !== generation) throw Error("Account changed");
                return state.imports.some(existing => existing.id === job.id) ? state
                  : { ...state, imports: [job, ...state.imports] };
              });
            }
            if (!acknowledgeShare(native.token)) return;
            void baby.refresh();
            void baby.sync();
            continue;
          }
          const shared = native ?? stock.shareIntent;
          const text = shared.text || undefined;
          const url = native ? native.url : stock.shareIntent.webUrl || stock.shareIntent.meta?.url ||
            text?.match(/https?:\/\/[^\s]+/)?.[0];
          const id = native?.capture_id ?? Crypto.randomUUID();
          const saveId = `share-save:${id}`;
          if (baby.state.outbox.some(m => m.id === saveId) || baby.state.records.some(r => r.id === id)) {
            if (native) { if (!acknowledgeShare(native.token)) return; continue; }
            stock.resetShareIntent(); return;
          }
          const copied: LocalFile[] = [];
          let committed = false, copiesRetained = false;
          try {
            // Refuse the whole handoff if any attachment cannot be preserved.
            // No supported subset may silently acknowledge discarded originals.
            for (const file of shared.files ?? []) {
              copied.push(await preserveFile(owner, { uri: file.path,
                name: file.fileName ?? undefined, mimeType: file.mimeType }));
              if (!current()) return;
            }
            if (!url && !text?.trim() && !copied.length) return;
            const occurred_at = native?.occurred_at ?? new Date().toISOString();
            const profile = bootstrap.profile as Profile & { auto_process_shares?: boolean };
            const save: Mutation = { id: saveId, generation, type: "save", files: copied,
              record: { id, kind: "source", title: sharedSourceTitle(text),
                body: "", child_id: null, occurred_at,
                data: { url, source_text: text, status: "saved", topics: [] } } };
            const automatic: Mutation & { automatic: true } = { id, generation, type: "import",
              record_id: id, files: [], automatic: true, automatic_epoch: native?.automatic_epoch ?? profile.auto_process_epoch ?? 0 };
            await baby.commit(state => {
              if (!current() || state.bootstrap?.generation !== generation) throw Error("Account changed");
              // Retries after an interrupted acknowledgement reuse prior durable
              // file copies and creation bytes rather than replacing the save.
              if (state.outbox.some(m => m.id === save.id) || state.records.some(r => r.id === id)) return state;
              copiesRetained = true;
              let next = addMutation(state, save);
              if (profile.ai_consent && profile.auto_process_shares &&
                (automatic.automatic_epoch ?? 0) === (profile.auto_process_epoch ?? 0)) next = addMutation(next, automatic);
              return next;
            });
            committed = true;
            if (!current()) return;
            void baby.sync();
            if (native) { if (!acknowledgeShare(native.token)) return; }
            else { stock.resetShareIntent(); return; }
          } finally {
            // On failure the native namespace still owns the originals. Existing
            // outbox saves own prior copies when replaying an interrupted ack.
            if (!committed || !copiesRetained) await Promise.allSettled(copied.map(file => removeLocal(owner, file.uri)));
          }
        }
      } catch {
        if (alive) Alert.alert("Your shared source is still on this phone",
          "Håfa Baby could not finish saving every item. Your original capture is kept; reopen the app to try again.");
      } finally { running = false; }
    };
    void drain();
    const app = AppState.addEventListener("change", state => { if (state === "active") void drain(); });
    return () => { alive = false; app.remove(); };
  }, [b.ready, b.owner, b.state.bootstrap?.generation, stock.hasShareIntent, b.state.bootstrap?.active]);
  return null;
}
