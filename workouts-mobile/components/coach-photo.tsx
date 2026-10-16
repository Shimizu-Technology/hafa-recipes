import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Image } from "expo-image";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import { useFocusEffect } from "expo-router";
import { Button, Copy, Notice, Row } from "./ui";
import { useTraining } from "@/lib/context";
import { cleanupCaptureFiles, pickImages } from "@/lib/capture-io";
import { createCoachPhotoStore, type CoachPhoto } from "@/lib/coach-photos";

type Activation = { scope: object; controller?: AbortController };
/** Hidden mounted routes cannot retain authority; each return gets a new token. */
function usePhotoActivation(scope: object) {
  const live = useRef<Activation | null>(null), [token, setToken] = useState<Activation | null>(null);
  useFocusEffect(useCallback(() => {
    function retire() { live.current?.controller?.abort(); live.current = null; setToken(null); }
    function activate() { if (!live.current) { live.current = { scope }; setToken(live.current); } }
    if (AppState.currentState === "active") activate();
    const sub = AppState.addEventListener("change", state => { if (state === "active") activate(); else retire(); });
    return () => { retire(); sub.remove(); };
  }, [scope]));
  return { token, current: () => !!token && token.scope === scope && live.current === token && AppState.currentState === "active" };
}

export function useCoachPhoto(focus: string, epoch: string, disabled: boolean) {
  const { api, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const store = useMemo(() => createCoachPhotoStore(storage, owner || "signed-out", generation, focus, api,
    files => cleanupCaptureFiles(files, true)), [storage, owner, generation, focus, api]);
  const base = useMemo(() => ({}), [store, epoch]), activation = usePhotoActivation(base);
  const scope = useMemo(() => ({ lock: false, removing: false, cancelled: false, controller: null as AbortController | null }), [store, epoch, activation.token]);
  const live = useRef<typeof scope | null>(null), pickAllowed = useRef(false);
  const [photo, setPhoto] = useState<CoachPhoto | null>(null), [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const current = () => { if (!owner || !generation || live.current !== scope || !activation.current() || !storage.isCurrent() || !isCurrentAccount()) throw Error("This photo view was retired."); };
  const picking = () => { current(); if (!pickAllowed.current || scope.cancelled) throw Error("Finish the current message before choosing a photo."); };
  useLayoutEffect(() => { pickAllowed.current = !disabled; }, [disabled]);
  useLayoutEffect(() => {
    live.current = scope; setPhoto(null); setLoaded(false); setBusy(false); setRemoving(false); setError("");
    if (!owner || !generation || !activation.current()) return () => { if (live.current === scope) live.current = null; };
    void store.load().then(value => { current(); setPhoto(value); setLoaded(true); }).catch(() => {
      if (live.current === scope && activation.current()) setError("Could not restore the photo. Retry before sending your message.");
    });
    return () => { if (live.current === scope) live.current = null; scope.controller?.abort(); };
  }, [scope]);
  async function run(work: () => Promise<void>) {
    try { current(); } catch { return; }
    if (scope.lock) return;
    scope.lock = true; setBusy(true); setError("");
    try { await work(); current(); }
    catch (error) {
      if (live.current === scope && activation.current()) {
        if (!scope.cancelled) setError(error instanceof Error ? error.message : "Could not update this photo. Try again.");
        try { const stored = await store.load(); current(); setPhoto(stored); } catch { /* Keep restoration blocked. */ }
      }
    } finally { scope.lock = false; if (live.current === scope) setBusy(false); }
  }
  async function upload(value: CoachPhoto) {
    picking();
    if (!value.file) throw Error("Choose the photo again after removing this upload.");
    const root = FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}hafa-workouts-capture/` : null;
    if (!root || !value.file.owned || !value.file.uri.startsWith(root)) throw Error("This photo is no longer available on this device.");
    const controller = new AbortController(); scope.controller = controller; if (activation.token) activation.token.controller = controller;
    const info = await FileSystem.getInfoAsync(value.file.uri); picking();
    if (!info.exists || info.isDirectory || info.size > 2 * 1024 * 1024) throw Error("Choose an available photo up to 2 MiB.");
    const base64_data = await FileSystem.readAsStringAsync(value.file.uri, { encoding: FileSystem.EncodingType.Base64 }); picking();
    if (base64_data.length > 2796204) throw Error("Choose a smaller photo.");
    const saved = await store.upload(value, { base64_data, content_type: value.file.mime_type }, picking, controller.signal);
    current(); setPhoto(saved ?? await store.load());
  }
  const choose = () => run(async () => {
    scope.cancelled = false; picking(); if (photo) return;
    const files = await pickImages(false, picking, owner, 1);
    if (!files.length) return;
    const value = { upload_id: Crypto.randomUUID(), file: files[0] };
    try { picking(); await store.select(value, picking); } catch (error) { await cleanupCaptureFiles(files, true); throw error; }
    current(); setPhoto(value); await upload(value);
  });
  return { photo, loaded, busy, removing, error, generation,
    choose, retry: () => run(async () => {
      if (!loaded) { const value = await store.load(); current(); setPhoto(value); setLoaded(true); return; }
      if (photo?.discard) { await store.discard(photo, current); current(); setPhoto(null); }
      else if (photo) { scope.cancelled = false; await upload(photo); }
    }),
    async remove() {
      try { current(); } catch { return; }
      if (!photo || scope.removing) return;
      scope.removing = true; setRemoving(true); scope.cancelled = true; scope.controller?.abort(); setPhoto({ ...photo, discard: true }); setError("");
      try { await store.discard(photo, current); current(); setPhoto(null); }
      catch { if (live.current === scope && activation.current()) setError("Could not confirm photo removal. Retry removing it; it will not be sent."); }
      finally { scope.removing = false; if (live.current === scope) setRemoving(false); }
    },
    async handoff(id: string | undefined) { await store.handoff(id, current); current(); setPhoto(await store.load()); },
    async clearAll() { scope.cancelled = true; scope.controller?.abort(); setPhoto(value => value ? { ...value, discard: true } : null); await store.clearAll(current); current(); setPhoto(null); },
  };
}

export function CoachPhotoControl({ state, allowed, disabled }: { state: ReturnType<typeof useCoachPhoto>; allowed: boolean; disabled: boolean }) {
  const expired = !!state.photo?.expires_at && Date.parse(state.photo.expires_at) <= Date.now();
  return <>
    {state.photo ? <>
      <Copy kind="small">{state.photo.discard ? "Photo removal needs confirmation" : expired ? "Photo expired · remove it before choosing another" : state.photo.attachment_id ? "Photo ready · shared with AI when you send" : "Uploading photo…"}</Copy>
      {!state.photo.discard && !expired && (state.photo.file
        ? <Image cachePolicy="none" source={{ uri: state.photo.file.uri }} style={{ width: 100, height: 100, borderRadius: 12 }} accessibilityLabel="Selected coach photo" />
        : state.photo.attachment_id && <CoachMessagePhoto id={state.photo.attachment_id} generation={state.generation} expires={state.photo.expires_at} removable={false} />)}
      <Row wrap>
        <Button title={state.photo.discard ? "Retry removing photo" : "Remove photo"} secondary size="sm" inline busy={state.removing}
          onPress={() => void state.remove()} />
        {!state.photo.attachment_id && !state.photo.discard && !state.busy && <Button title="Retry photo upload" secondary size="sm" inline disabled={disabled || !allowed} onPress={() => void state.retry()} />}
      </Row>
    </> : allowed && <Button title="Attach a photo" icon="image-outline" secondary size="sm" inline disabled={disabled || !state.loaded} busy={state.busy || !state.loaded} onPress={() => void state.choose()} />}
    {!state.loaded && !!state.error && <Button title="Retry restoring photo" secondary size="sm" inline busy={state.busy} onPress={() => void state.retry()} />}
    {!!state.error && <Notice error>{state.error}</Notice>}
  </>;
}

export function CoachMessagePhoto({ id, generation, expires, removable = true }: { id: string; generation: number; expires?: string; removable?: boolean }) {
  const { api, storage, owner, isCurrentAccount } = useTraining();
  const base = useMemo(() => ({}), [id, generation, storage, owner]), activation = usePhotoActivation(base);
  const scope = useMemo(() => ({ busy: false }), [base, activation.token]), live = useRef<object | null>(null);
  const [ttl, setTtl] = useState(0), [removed, setRemoved] = useState(false), [confirm, setConfirm] = useState(false);
  const [url, setUrl] = useState<string | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useLayoutEffect(() => { live.current = scope; setUrl(null); setError(""); setBusy(false); setRemoved(false); setConfirm(false); return () => { if (live.current === scope) live.current = null; }; }, [scope]);
  useLayoutEffect(() => { if (!url) return; const timer = setTimeout(() => {
    if (live.current === scope && activation.current()) setUrl(value => value === url ? null : value);
  }, ttl); return () => clearTimeout(timer); }, [url, ttl, scope]);
  async function show() {
    if (scope.busy || live.current !== scope || !activation.current() || !storage.isCurrent() || !isCurrentAccount()) return;
    scope.busy = true; setBusy(true); setError("");
    try {
      const signed = await api.coachImage(id, generation);
      if (live.current !== scope || !activation.current() || !storage.isCurrent() || !isCurrentAccount()) return;
      if (!signed.url.startsWith("https://") || signed.expires_in < 1 || signed.expires_in > 60) throw Error("Photo unavailable.");
      setTtl(Math.max(1, signed.expires_in - 1) * 1000); setUrl(signed.url);
    } catch { if (live.current === scope && activation.current()) setError("Photo expired, was removed, or could not be loaded."); }
    finally { scope.busy = false; if (live.current === scope) setBusy(false); }
  }
  async function remove() {
    if (scope.busy || live.current !== scope || !activation.current() || !storage.isCurrent() || !isCurrentAccount()) return;
    scope.busy = true; setBusy(true); setUrl(null); setError("");
    try {
      await api.removeCoachImage(id, generation);
      if (live.current === scope && activation.current() && storage.isCurrent() && isCurrentAccount()) { setRemoved(true); setConfirm(false); }
    } catch { if (live.current === scope && activation.current()) setError("Could not confirm photo removal. Try again."); }
    finally { scope.busy = false; if (live.current === scope) setBusy(false); }
  }
  const expired = removed || !!expires && Date.parse(expires) <= Date.now();
  return <>{url ? <Image cachePolicy="none" source={{ uri: url }} style={{ width: 180, height: 180, borderRadius: 12 }} accessibilityLabel="Private coach photo" />
    : <Button title={expired ? "Photo expired" : "View private photo"} secondary size="sm" inline disabled={expired} busy={busy} onPress={() => void show()} />}
    {removable && !expired && (confirm ? <>
      <Copy kind="small">Remove this photo from the chat? Its message and training history stay available.</Copy>
      <Button title="Confirm photo removal" variant="destructive" busy={busy} onPress={() => void remove()} />
      <Button title="Keep photo" secondary disabled={busy} onPress={() => setConfirm(false)} />
    </> : <Button title="Remove photo from chat" variant="ghost" size="sm" inline onPress={() => setConfirm(true)} />)}
    {!!error && <Copy kind="small">{error}</Copy>}</>;
}
