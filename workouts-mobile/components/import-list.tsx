import { useCallback, useState, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Copy, Notice } from "./ui";
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
  const capabilities = useQuery({ queryKey: [owner, "capabilities", enrollment?.generation], queryFn: api.capabilities,
    enabled: !!enrollment?.enrolled && visible, staleTime: 60000 });
  const server = useQuery({ queryKey: [owner, "imports", enrollment?.generation], queryFn: () => api.importJobs(),
    enabled: !!enrollment?.enrolled && visible && capabilities.data?.server_auto_save === true,
    refetchInterval: query => visible && active && query.state.data?.some(job => !importIsTerminal(job.status)) ? 4000 : false });
  useEffect(() => {
    const listener = AppState.addEventListener("change", state => setActive(state === "active"));
    return () => listener.remove();
  }, []);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setVisible(true); setItems([]); setDeviceError("");
      void localDrafts
        .load<Array<{ id: string; label: string; auto_save?: boolean }>>(owner, `imports:${enrollment?.generation}`)
        .then((value) => {
          if (active) { setItems(value ?? []); setItemScope(scope); }
        })
        .catch(() => {
          if (active) setDeviceError("Could not restore this device’s imports. Server imports are still available when connected.");
        });
      return () => {
        active = false;
        setVisible(false);
      };
    }, [owner, enrollment?.generation])
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
      {inbox.size > 0 && <Copy kind="heading">Source imports</Copy>}
      {[...inbox.values()].map((item) => (
          <ImportCard key={item.id} id={item.id} label={item.label} autoSave={item.auto_save} />
      ))}
    </>
  );
}
function ImportCard({ id, label, autoSave }: { id: string; label: string; autoSave?: boolean }) {
  const { api, owner, enrollment, localDrafts, storage, isCurrentAccount } = useTraining();
  const cache = useQueryClient();
  const attempted = useRef(false);
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
  if (q.data?.accepted_workout_id) return null;
  return (
    <Card>
      <Copy kind="small">{q.data?.status ?? "Saved import reference"}</Copy>
      <Copy>{q.data?.result?.workout?.title ?? label}</Copy>
      {q.error && <Notice error>{q.error.message}</Notice>}
      {!!saveError && <Notice error>{saveError}</Notice>}
      <Button
        title={q.data?.accepted_workout_id ? "Open saved workout" : "Open import"}
        secondary
        onPress={() =>
          router.push(
            q.data?.accepted_workout_id
              ? { pathname: "/workout/[id]", params: { id: q.data.accepted_workout_id } }
              : { pathname: "/import/[id]", params: { id, ...(autoSave ? { auto: "1" } : {}) } }
          )
        }
      />
    </Card>
  );
}
