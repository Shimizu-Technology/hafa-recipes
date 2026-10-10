import { useCallback, useState, useEffect } from "react";
import { AppState } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Copy, Notice } from "./ui";
import { useTraining } from "@/lib/context";
import { importIsTerminal } from "@/lib/capture";
export function ImportList() {
  const { localDrafts, owner, enrollment } = useTraining();
  const [items, setItems] = useState<Array<{ id: string; label: string }>>([]);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void localDrafts
        .load<Array<{ id: string; label: string }>>(owner, `imports:${enrollment?.generation}`)
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
        <ImportCard key={item.id} id={item.id} label={item.label} />
      ))}
    </>
  );
}
function ImportCard({ id, label }: { id: string; label: string }) {
  const { api, owner, enrollment } = useTraining();
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
  if (q.data?.accepted_workout_id) return null;
  return (
    <Card>
      <Copy kind="small">{q.data?.status ?? "Saved import reference"}</Copy>
      <Copy>{q.data?.result?.workout?.title ?? label}</Copy>
      {q.error && <Notice error>{q.error.message}</Notice>}
      <Button
        title={q.data?.accepted_workout_id ? "Open saved workout" : "Review import"}
        secondary
        onPress={() =>
          router.push(
            q.data?.accepted_workout_id
              ? { pathname: "/workout/[id]", params: { id: q.data.accepted_workout_id } }
              : { pathname: "/import/[id]", params: { id } }
          )
        }
      />
    </Card>
  );
}
