import { useCallback, useState, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Copy, Notice } from "./ui";
import { useTraining } from "@/lib/context";
import { canSaveAutomatically, importIsTerminal, updateImportReferences } from "@/lib/capture";
import { workoutErrors } from "@/lib/library";
import { createPrivateDraftSlot } from "@/lib/private-form";
import type { CaptureDraft } from "@/lib/capture";
import * as Crypto from "expo-crypto";
export function ImportList() {
  const { localDrafts, owner, enrollment } = useTraining();
  const [items, setItems] = useState<Array<{ id: string; label: string; auto_save?: boolean }>>([]);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void localDrafts
        .load<Array<{ id: string; label: string; auto_save?: boolean }>>(owner, `imports:${enrollment?.generation}`)
        .then((value) => {
          if (active) setItems(value ?? []);
        })
        .catch(() => {
          if (active) setItems([]);
        });
      return () => {
        active = false;
      };
    }, [owner, enrollment?.generation])
  );
  return (
    <>
      {items.length > 0 && <Copy kind="heading">Source imports</Copy>}
      {items.map((item) => (
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
    if (!autoSave || !visible || !active || !job || job.result?.workout?.capture_kind !== "url" || !canSaveAutomatically(job) ||
      !capabilities.data || attempted.current || workoutErrors(job.result!.workout!).length) return;
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
      accountGuard();
      const slot = createPrivateDraftSlot<CaptureDraft>(storage, owner, `capture:${generation}`, Crypto.randomUUID);
      const captured = await slot.load(accountGuard);
      accountGuard();
      if (captured.value?.job_id === id && captured.value.generation === generation &&
        !captured.value.files.length && !captured.value.cleanup_files?.length) {
        try {
          await slot.save(captured.revision, { request_id: Crypto.randomUUID(), generation, kind: "url",
            source_url: "", text: "", files: [], created_at: new Date().toISOString() }, accountGuard);
        } catch (error) {
          if (!(error as { captureDraftConflict?: boolean }).captureDraftConflict) throw error;
        }
      }
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
