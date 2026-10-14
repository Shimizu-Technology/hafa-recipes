import { useCallback, useState, useEffect, useLayoutEffect, useRef } from "react";
import { ActivityIndicator, AppState } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Copy, Notice, Row } from "./ui";
import { importPresentation, importSourceLabel } from "@/lib/import-recovery";
import { useTraining } from "@/lib/context";
import { canSaveAutomatically, importIsTerminal, retireCapturedImport, updateImportReferences } from "@/lib/capture";
import { workoutErrors } from "@/lib/library";
import { cleanupCaptureFiles } from "@/lib/capture-io";
import * as Crypto from "expo-crypto";
export function ImportList() {
  const { api, localDrafts, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const [items, setItems] = useState<Array<{ id: string; label: string; auto_save?: boolean }>>([]);
  const scope = `${owner}:${enrollment?.generation}`;
  const [itemScope, setItemScope] = useState(scope);
  const [deviceError, setDeviceError] = useState("");
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(AppState.currentState === "active");
  const cache = useQueryClient();
  const reconciled = useRef(new Set<string>());
  const reads = useRef(0);
  const live = useRef({ scope, isCurrentAccount });
  useLayoutEffect(() => { live.current = { scope, isCurrentAccount }; }, [scope, isCurrentAccount]);
  const reloadDeviceImports = useCallback((alive: () => boolean) => {
    const read = ++reads.current;
    const current = () => alive() && read === reads.current && live.current.scope === scope && storage.isCurrent() && live.current.isCurrentAccount();
    void localDrafts.load<Array<{ id: string; label: string; auto_save?: boolean }>>(owner, `imports:${enrollment?.generation}`)
      .then(value => { if (current()) { setItems(value ?? []); setItemScope(scope); } })
      .catch(() => { if (current()) setDeviceError("Could not restore this device’s imports. Server imports are still available when connected."); });
  }, [localDrafts, owner, enrollment?.generation, scope, storage]);
  const capabilities = useQuery({ queryKey: [owner, "capabilities", enrollment?.generation], queryFn: api.capabilities,
    enabled: !!enrollment?.enrolled && visible, staleTime: 60000 });
  const server = useQuery({ queryKey: [owner, "imports", enrollment?.generation], queryFn: () => api.importJobs(),
    enabled: !!enrollment?.enrolled && visible && capabilities.data?.server_auto_save === true,
    refetchInterval: query => visible && active && query.state.data?.some(job => !importIsTerminal(job.status)) ? 4000 : false });
  useEffect(() => {
    let alive = true;
    const listener = AppState.addEventListener("change", state => {
      setActive(state === "active");
      if (state !== "active" || !alive || live.current.scope !== scope || !visible || !enrollment?.enrolled || !storage.isCurrent() || !live.current.isCurrentAccount()) return;
      reloadDeviceImports(() => alive);
      // An empty cached inbox has no polling timer. A source-app share can
      // create its first server import while this library remains focused.
      if (capabilities.data?.server_auto_save === true) void server.refetch();
    });
    return () => { alive = false; listener.remove(); };
  }, [visible, scope, enrollment?.enrolled, reloadDeviceImports, capabilities.data?.server_auto_save, server.refetch, storage]);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setVisible(true); setItems([]); setDeviceError("");
      reloadDeviceImports(() => active);
      return () => {
        active = false;
        setVisible(false);
      };
    }, [reloadDeviceImports])
  );
  useEffect(() => {
    const completed = (server.data ?? []).filter(job => job.generation === enrollment?.generation && job.accepted_workout_id && !reconciled.current.has(`${owner}:${job.generation}:${job.id}`));
    if (!completed.length) return;
    let alive = true;
    const guard = () => { if (!alive || !storage.isCurrent() || !isCurrentAccount()) throw Error("The import account changed."); };
    void (async () => {
      guard(); await cache.invalidateQueries({ queryKey: [owner, "library"] });
      for (const job of completed) {
        await retireCapturedImport(storage, owner, job.generation, job.id, guard, cleanupCaptureFiles, Crypto.randomUUID);
        await updateImportReferences(localDrafts, owner, job.generation, guard, prior => prior.filter(item => item.id !== job.id));
        guard(); reconciled.current.add(`${owner}:${job.generation}:${job.id}`);
      }
    })().catch(() => { if (alive) setDeviceError("Your workout is saved. Reopen its import to finish device cleanup."); });
    return () => { alive = false; };
  }, [server.data, owner, storage, localDrafts, cache]);
  const inbox = new Map((itemScope === scope ? items : []).map(item => [item.id, item]));
  for (const job of server.data ?? []) {
    if (job.generation !== enrollment?.generation) continue;
    if (job.accepted_workout_id || ["cancelled", "expired"].includes(job.status)) inbox.delete(job.id);
    else inbox.set(job.id, { id: job.id, label: job.result?.workout?.title ?? job.result?.source.title ?? "Shared workout", auto_save: false });
  }
  return (
    <>
      {!!deviceError && <Notice error>{deviceError}</Notice>}
      {server.error && <><Notice error>Could not check your imports. Your saved workouts are still in your library.</Notice>
        <Button title="Retry imports" secondary onPress={() => { void server.refetch(); }} /></>}
      {inbox.size > 0 && <Copy kind="subheading">Unfinished imports · {inbox.size}</Copy>}
      {[...inbox.values()].map((item) => (
          <ImportCard key={item.id} id={item.id} label={item.label} autoSave={item.auto_save}
            onRemoved={() => setItems(prior => prior.filter(value => value.id !== item.id))} />
      ))}
    </>
  );
}
function ImportCard({ id, label, autoSave, onRemoved }: { id: string; label: string; autoSave?: boolean; onRemoved(): void }) {
  const { api, owner, enrollment, localDrafts, storage, isCurrentAccount } = useTraining();
  const cache = useQueryClient();
  const attempted = useRef(false);
  const retiring = useRef(false);
  const [removing, setRemoving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(AppState.currentState === "active");
  useFocusEffect(
    useCallback(() => {
      setVisible(true);
      return () => setVisible(false);
    }, [])
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => sub.remove();
  }, []);
  const q = useQuery({
    queryKey: [owner, "import", id, enrollment?.generation],
    queryFn: () => api.importJob(id),
    enabled: !!enrollment?.enrolled && visible,
    refetchInterval: (query) =>
      visible && active && query.state.data && !importIsTerminal(query.state.data.status) ? 4000 : false,
  });
  const capabilities = useQuery({ queryKey: [owner, "capabilities", enrollment?.generation], queryFn: api.capabilities,
    enabled: !!enrollment?.enrolled && visible && !!autoSave, staleTime: 60000 });
  async function remove(cancel = false) {
    if (retiring.current || !enrollment?.generation) return;
    retiring.current = true; setRemoving(true); setSaveError("");
    const guard = () => { if (!storage.isCurrent() || !isCurrentAccount()) throw Error("This import account changed."); };
    try {
      guard();
      if (cancel) {
        try { await api.cancelImport(id, enrollment.generation); }
        catch (e) { if (![404, 410].includes((e as { status?: number }).status ?? 0)) throw e; }
        guard();
      }
      await retireCapturedImport(storage, owner, enrollment.generation, id, guard, cleanupCaptureFiles, Crypto.randomUUID);
      await localDrafts.remove(owner, `import-retry:${enrollment.generation}:${id}`); guard();
      await localDrafts.remove(owner, `import-retry-caption:${enrollment.generation}:${id}`); guard();
      await updateImportReferences(localDrafts, owner, enrollment.generation, guard, items => items.filter(item => item.id !== id));
      guard();
      cache.setQueryData<Array<{ id: string }>>([owner, "imports", enrollment.generation], jobs => jobs?.filter(job => job.id !== id));
      onRemoved();
    } catch (e) { if (storage.isCurrent() && isCurrentAccount()) setSaveError((e as Error).message); }
    finally { retiring.current = false; setRemoving(false); }
  }
  useEffect(() => {
    if ((q.data && ["cancelled", "expired"].includes(q.data.status)) || [404, 410].includes((q.error as { status?: number } | null)?.status ?? 0)) void remove();
  }, [q.data?.status, q.error]);
  useEffect(() => {
    const job = q.data;
    const alreadySaved = !!job?.accepted_workout_id;
    if ((!autoSave && !alreadySaved) || !visible || !active || !job || (!alreadySaved && job.result?.workout?.capture_kind !== "url") ||
      (!alreadySaved && (capabilities.data?.server_auto_save || !canSaveAutomatically(job) || !capabilities.data || workoutErrors(job.result!.workout!).length)) || attempted.current) return;
    attempted.current = true;
    let alive = true;
    let acceptStarted = false;
    const generation = job.generation;
    const guard = () => {
      if (!alive || !storage.isCurrent() || !isCurrentAccount()) throw Error("This account changed. Open your current imports.");
    };
    const accountGuard = () => {
      if (!storage.isCurrent() || !isCurrentAccount()) throw Error("This account changed. Open your current imports.");
    };
    void (async () => {
      if (!alreadySaved) {
        // Never accept the original over corrections the person has already started.
        const edits = await localDrafts.load(owner, `import-edit:${generation}:${id}`);
        guard();
        if (edits) return;
        const preference = await localDrafts.load<boolean>(owner, `import-visibility:${generation}:${id}`);
        guard();
        const sharing = capabilities.data!.discover === true && (preference ?? job.result!.workout!.capture_kind === "url");
        if (sharing) {
          const disclosure = await api.publishingDisclosure();
          guard();
          // A first publishing choice stays interactive; never open a surprise sheet from Library.
          if (disclosure.requires_acceptance) return;
        }
        acceptStarted = true;
        await api.acceptImport(id, job.result!.workout!, generation, sharing, false);
      }
      acceptStarted = true;
      accountGuard();
      await retireCapturedImport(storage, owner, generation, id, accountGuard, cleanupCaptureFiles, Crypto.randomUUID);
      await updateImportReferences(localDrafts, owner, generation, accountGuard, (items) => items.filter((item) => item.id !== id));
      await cache.invalidateQueries({ queryKey: [owner, "library"] });
      await q.refetch();
    })().catch(() => { if (alive && storage.isCurrent()) setSaveError("Could not finish saving. Open this import to retry."); });
    return () => { alive = false; if (!acceptStarted) attempted.current = false; };
  }, [autoSave, visible, active, q.data, capabilities.data, owner, id, storage]);
  if (q.data?.accepted_workout_id && !saveError) return null;
  const unavailable = [404, 410].includes((q.error as { status?: number } | null)?.status ?? 0);
  const presentation = unavailable ? { label: "Import no longer available", action: "View options" } : importPresentation(q.data);
  const terminal = unavailable || !!q.data && importIsTerminal(q.data.status);
  return (
    <Card compact>
      <Row gap={8}>
        {q.data && !terminal && <ActivityIndicator accessibilityLabel={presentation.label} />}
        <Copy kind="small" tone={q.data?.status === "failed" || q.data?.status === "incomplete" ? "warning" : "muted"}>{presentation.label}</Copy>
      </Row>
      <Copy kind="label" numberOfLines={2}>{q.data?.result?.workout?.title ?? q.data?.result?.source.title ?? importSourceLabel(label)}</Copy>
      {q.error && <Notice error>{q.error.message}</Notice>}
      {!!saveError && <Notice error>{saveError}</Notice>}
      <Button
        title={presentation.action}
        size="sm"
        secondary
        onPress={() =>
          router.push(
            q.data?.accepted_workout_id
              ? { pathname: "/workout/[id]", params: { id: q.data.accepted_workout_id } }
              : { pathname: "/import/[id]", params: { id, ...(autoSave ? { auto: "1" } : {}) } }
          )
        }
      />
      {terminal && <Button title="Dismiss import" size="sm" variant="ghost" busy={removing}
        accessibilityHint="Clears this import and its temporary source. Saved workouts stay in your library."
        onPress={() => { void remove(true); }} />}
    </Card>
  );
}
