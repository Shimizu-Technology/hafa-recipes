import { useCallback, useState, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Copy, Notice } from "./ui";
import { useTraining } from "@/lib/context";
import { canSaveAutomatically, importIsTerminal } from "@/lib/capture";
import { workoutErrors } from "@/lib/library";
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
    const generation = job.generation;
    const guard = () => {
      if (!alive || !storage.isCurrent() || !isCurrentAccount()) throw Error("This account changed. Open your current imports.");
    };
    void (async () => {
      // Never accept the original over corrections the person has already started.
      const edits = await localDrafts.load(owner, `import-edit:${generation}:${id}`);
      guard();
      if (edits) return;
      const sharing = capabilities.data!.discover === true && job.result!.workout!.capture_kind === "url";
      if (sharing) {
        const disclosure = await api.publishingDisclosure();
        guard();
        // A first publishing choice stays interactive; never open a surprise sheet from Library.
        if (disclosure.requires_acceptance) return;
      }
      await api.acceptImport(id, job.result!.workout!, generation, sharing, false);
      guard();
      await cache.invalidateQueries({ queryKey: [owner, "library"] });
      await q.refetch();
    })().catch(() => { if (alive && storage.isCurrent()) setSaveError("Could not finish saving. Open this import to retry."); });
    return () => { alive = false; };
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
