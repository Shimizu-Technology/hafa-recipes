import { useEffect, useRef } from "react";
import { Alert, AppState, Platform } from "react-native";
import * as Crypto from "expo-crypto";
import { useShareIntentContext } from "expo-share-intent";
import { useBaby } from "@/lib/context";
import { preserveFile, removeLocal } from "@/lib/files";
import { addMutation } from "@/lib/outbox";
import type { LocalFile, Mutation, Profile } from "@/lib/models";
import { stockShareScope } from "../lib/stock-share-scope";
import { captureBelongs, captureDestination, captureStale } from "../lib/share-scope";
import { notSentMessage } from "../lib/outbox";
import { ApiError } from "../lib/api";
import { useShareSession } from "@/lib/use-share-session";
import { claimSettled, onSharesChanged, type ClaimOutcome } from "../lib/share-session-state";
import { acknowledgeShare, nativeSharingAvailable, pendingShare } from "@/modules/hafa-baby-share/src";

import { sharedSourceTitle } from "../lib/source-title";
export { sharedSourceTitle } from "../lib/source-title";

/** Ordinary captures go straight into the encrypted durable outbox. Native
 * originals remain until the exact capture, including every file, is committed. */
export function ShareCapture() {
  useShareSession();
  const b = useBaby(), stock = useShareIntentContext();
  const account = useRef(b);
  account.current = b;
  useEffect(() => {
    let alive = true, running = false, again = false;
    const drain = async () => {
      if (running) { again = true; return; }
      running = true;
      again = false;
      let retry = false, claimed: string | undefined;
      const settle = (outcome: ClaimOutcome) => { if (claimed) claimSettled(claimed, outcome); claimed = undefined; };
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
          claimed = native?.claimed ? native.token : undefined;
          if (native && captureStale(native.scope, owner, bootstrap)) {
            if (!acknowledgeShare(native.token)) return;
            settle("gone");
            continue;
          }
          // Any capture of this account's, whatever its destination was then. Its tag says where it goes now.
          if (native && !captureBelongs(native.scope, owner, bootstrap)) return;
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
            if (native) { if (!acknowledgeShare(native.token)) return; settle("saved"); continue; }
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
              // Read here, from this write's own state: bootstrap can list the family after this drain began, and a capture made before it must not go there.
              const place = native ? captureDestination(native.scope, state.bootstrap) : {};
              let next = addMutation(state, { ...save, ...place, ...(place.left_space ? { error: notSentMessage } : {}) });
              if (place.left_space) return next;
              // A share added from the waiting card was never covered by permission for AI, whatever's on now.
              if (!native?.claimed && profile.ai_consent && profile.auto_process_shares &&
                (automatic.automatic_epoch ?? 0) === (profile.auto_process_epoch ?? 0)) next = addMutation(next, automatic);
              return next;
            });
            committed = true;
            // In the outbox, durably: only now is it true to say it's been added.
            settle("saved");
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
      } catch (failure) {
        // The first bootstrap ending a lease mid-write isn't a failure to tell her about: it goes again as soon as this one's done.
        if (failure instanceof ApiError && failure.local) { retry = true; return; }
        settle("failed");
        if (alive) Alert.alert("Your shared source is still on this phone",
          "Håfa Baby could not finish saving every item. Your original capture is kept; reopen the app to try again.");
      } finally {
        running = false;
        if ((retry || again) && alive) setTimeout(() => void drain(), retry ? 500 : 0);
      }
    };
    void drain();
    const app = AppState.addEventListener("change", state => { if (state === "active") void drain(); });
    const stop = onSharesChanged(() => void drain());
    return () => { alive = false; app.remove(); stop(); };
  }, [b.ready, b.owner, b.state.bootstrap?.generation, stock.hasShareIntent, b.state.bootstrap?.active]);
  return null;
}
