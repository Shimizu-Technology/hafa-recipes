import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Copy, Empty, Notice, Screen, Sheet } from "@/components/ui";
import { SourceImage } from "@/components/source-image";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import { createPrivateForm } from "@/lib/private-form";
import { cleanupCaptureFiles, coverImageForm, pickImages, sourceFor } from "@/lib/capture-io";
import { discoverKeys } from "@/lib/discover";
import type { CaptureFile } from "@/lib/capture";
import type { Workout } from "@/lib/models";

type Target = Pick<Workout, "id" | "generation" | "revision">;
type CoverInput = { image: string; target: Target };
type CoverCommand = { operation: "upload"; input: CoverInput; key: string } |
  { operation: "remove"; workout: Workout };
export default function WorkoutCoverRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { owner, enrollment } = useTraining();
  return <WorkoutCover key={`${owner}:${enrollment?.generation}:${id}`} id={id} />;
}
function WorkoutCover({ id }: { id: string }) {
  const { api, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const generation = enrollment?.generation;
  const cache = useQueryClient();
  const form = useMemo(() => createPrivateForm<CoverInput | null, CoverCommand>(storage, owner,
    `workout-cover:${generation}:${id}`), [storage, owner, generation, id]);
  const scope = useMemo(() => ({ lock: null as object | null }), [form]);
  const live = useRef<typeof scope | null>(null);
  useLayoutEffect(() => {
    live.current = scope;
    setLoaded(false); setBusy(false); setInput(null); setCommand(null); setTerminal(false); setError(""); setRemoving(false);
    return () => { if (live.current === scope) live.current = null; };
  }, [scope]);
  const active = () => live.current === scope && !!enrollment?.enrolled && storage.isCurrent() && isCurrentAccount();
  const current = () => {
    if (!active()) throw Error("Your account changed. This photo action was stopped.");
  };
  const checked = (record: Workout) => {
    current();
    if (record.id !== id || record.generation !== generation) throw Error("Your training setup changed. Reload Workouts before changing this cover.");
    return record;
  };
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const [input, setInput] = useState<CoverInput | null>(null), [command, setCommand] = useState<CoverCommand | null>(null);
  const [terminal, setTerminal] = useState(false), [error, setError] = useState(""), [removing, setRemoving] = useState(false);
  const key = [owner, "workout", id, generation];
  const q = useQuery({ queryKey: key, queryFn: async () => checked(await api.workout(id)), enabled: !!enrollment?.enrolled });
  const capabilities = useQuery({ queryKey: [owner, "capabilities", generation], queryFn: api.capabilities, staleTime: 60000 });
  const supported = capabilities.data?.cover_upload === true;
  useEffect(() => {
    let cancelled = false;
    void form.load().then(async box => {
      current(); if (cancelled) return;
      if (box.removed) throw Error("This workout was removed.");
      const target = box.command?.operation === "upload" ? box.command.input.target : box.input?.target;
      if (target && (target.id !== id || target.generation !== generation)) throw Error("This photo draft belongs to a different workout or training setup.");
      if (box.command?.operation === "remove" && (box.command.workout.id !== id || box.command.workout.generation !== generation))
        throw Error("This removal draft belongs to a different workout or training setup.");
      if (box.terminal) {
        const fresh = checked(await api.workout(id)); if (cancelled) return;
        cache.setQueryData<Workout>(key, old => old && old.revision > fresh.revision ? old : fresh);
        await form.reopen(null); current();
      } else { setInput(box.input); setCommand(box.command); }
      if (!cancelled) setLoaded(true);
    }).catch(e => { if (!cancelled && active()) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [form]);
  async function choose() {
    if (!active() || !loaded || !supported || !q.data || scope.lock || command) return;
    const token = {}; scope.lock = token; setBusy(true); setError("");
    let files: CaptureFile[] = [];
    const target = { id, generation: q.data.generation, revision: q.data.revision };
    try {
      current(); if (target.generation !== generation) throw Error("Reload your workout before choosing a photo.");
      files = await pickImages(false, current, owner, 1); current();
      if (!files.length) return;
      if (files.length !== 1) throw Error("Choose one cover photo.");
      const source = await sourceFor({ request_id: Crypto.randomUUID(), generation: target.generation,
        kind: "images", text: "", source_url: "", files, created_at: new Date().toISOString() }, current);
      current();
      const image = source.images?.[0]?.base64_data;
      if (!image) throw Error("This photo could not be read. Choose it again.");
      const next = { image, target };
      if (terminal) await form.reopen(next); else if (!await form.save(next)) throw Error("Resolve your saved photo request first.");
      current(); setInput(next); setTerminal(false);
    } catch (e) { if (active()) setError((e as Error).message); }
    finally { await cleanupCaptureFiles(files).catch(() => undefined); if (scope.lock === token) { scope.lock = null; if (active()) setBusy(false); } }
  }
  async function save(remove = false) {
    if (!active() || !loaded || !supported || !q.data || scope.lock || (!remove && !input && !command)) return;
    const token = {}; scope.lock = token; setBusy(true); setError("");
    let cleanup: (() => Promise<void>) | undefined;
    try {
      current();
      if (q.data.generation !== generation || q.data.id !== id) throw Error("Reload your workout before changing its cover.");
      const next: CoverCommand = command ?? (remove ? { operation: "remove", workout: q.data } :
        { operation: "upload", input: input!, key: Crypto.randomUUID() });
      if (terminal) await form.reopen(null);
      const frozen = await form.begin(input, next); current(); setCommand(frozen); setTerminal(false);
      let saved: Workout;
      if (frozen.operation === "upload") {
        const image = await coverImageForm(frozen.input.image, current, owner); cleanup = image.cleanup; current();
        saved = checked(await api.uploadWorkoutCover(frozen.input.target, image.body, frozen.key));
      } else {
        const fresh = checked(await api.workout(id));
        if (!fresh.source_thumbnail_url) saved = fresh;
        else {
          if (fresh.revision !== frozen.workout.revision) throw Error("This workout changed. Discard the photo draft and reload before removing its cover.");
          saved = checked(await api.updateWorkout({ ...frozen.workout, source_thumbnail_url: null, cover_origin: null }));
        }
      }
      await form.complete(frozen, saved.id); current();
      cache.setQueryData<Workout>(key, old => old && old.revision > saved.revision ? old : saved);
      await Promise.all([cache.invalidateQueries({ queryKey: [owner, "library"] }),
        cache.invalidateQueries({ queryKey: discoverKeys.all(owner) })]); current();
      setInput(null); setCommand(null); setTerminal(true); setRemoving(false);
    } catch (e) { if (active()) setError((e as Error).message); }
    finally { await cleanup?.().catch(() => undefined); if (scope.lock === token) { scope.lock = null; if (active()) setBusy(false); } }
  }
  async function reload() {
    if (!active() || scope.lock) return;
    const token = {}; scope.lock = token; setBusy(true); setError("");
    try {
      current(); const fresh = checked(await api.workout(id));
      await form.reset(); current();
      cache.setQueryData<Workout>(key, old => old && old.revision > fresh.revision ? old : fresh);
      setInput(null); setCommand(null); setTerminal(false); setLoaded(true); setRemoving(false);
    } catch (e) { if (active()) setError((e as Error).message); }
    finally { if (scope.lock === token) { scope.lock = null; if (active()) setBusy(false); } }
  }
  const preview = input?.image ? `data:image/jpeg;base64,${input.image}` : q.data?.source_thumbnail_url;
  return <Screen back title="Workout cover photo">
    {!!error && <Notice error>{error}</Notice>}
    <QueryState hasData={q.data !== undefined && capabilities.data !== undefined} loading={q.isPending || capabilities.isPending} error={q.error ?? capabilities.error}
      retry={() => { if (active()) { void q.refetch(); void capabilities.refetch(); } }}>
      {!supported ? <Empty icon="image-outline" title="Cover photos are getting ready" description="Your saved workout remains available. Try again after cover uploads are enabled." /> : <>
        {preview && <SourceImage uri={preview} label={input ? "Selected cover photo" : "Workout cover photo"} />}
        <Copy kind="small" tone="muted">Your workout instructions and original source credit stay with the workout.</Copy>
        {command && <Notice>Your photo request is saved on this device. Retry the same request or discard the draft and reload.</Notice>}
        <Button title={preview ? "Choose a different photo" : "Choose a photo"} secondary busy={busy && !input && !command} disabled={!loaded || busy || !!command} onPress={choose} />
        {(input || command) && <Button title={command ? "Retry saved photo request" : "Save cover photo"} busy={busy} disabled={!loaded || busy} onPress={() => save()} />}
        {!!q.data?.source_thumbnail_url && !input && !command && <Button title="Remove cover photo" variant="ghost" disabled={!loaded || busy} onPress={() => { if (active() && !scope.lock) setRemoving(true); }} />}
        {(input || command || !loaded) && <Button title="Discard photo draft and reload" variant="ghost" disabled={busy} onPress={reload} />}
      </>}
    </QueryState>
    <Sheet visible={removing && supported} title="Remove this cover photo?" onClose={() => { if (active() && !scope.lock) setRemoving(false); }}>
      <Copy>Earlier workout versions keep their original photo.</Copy>
      <Button title="Remove photo" busy={busy} disabled={busy} onPress={() => save(true)} />
      <Button title="Keep photo" secondary disabled={busy} onPress={() => { if (active() && !scope.lock) setRemoving(false); }} />
    </Sheet>
  </Screen>;
}
