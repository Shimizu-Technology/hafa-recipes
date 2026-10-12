import { useState } from "react";
import { router } from "expo-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Button, Card, Choice, Copy, Field, Notice } from "./ui";
import { useTraining } from "@/lib/context";
export function SavedSourcePicker({
  selected,
  minutes,
  change,
  disabled,
}: {
  selected: string[];
  minutes: Record<string, string>;
  change(selected: string[], minutes: Record<string, string>): void;
  disabled: boolean;
}) {
  const { api, owner, enrollment } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const [search, setSearch] = useState("");
  const q = useInfiniteQuery({
    queryKey: [owner, "library", generation, "source-picker", search],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.searchLibrary({ q: search }, pageParam, generation),
    getNextPageParam: (page) => (page.has_more ? (page.next_cursor ?? undefined) : undefined),
    enabled: !!enrollment?.enrolled,
  });
  const chosen = useQuery({
    queryKey: [owner, "selected-sources", generation, selected],
    queryFn: () =>
      Promise.all(
        selected.map(async (id) => {
          try {
            return { id, workout: await api.workout(id), error: null };
          } catch (e) {
            return { id, workout: null, error: (e as Error).message };
          }
        })
      ),
    enabled: !!enrollment?.enrolled && !!selected.length,
  });
  const shown = [
    ...new Map(
      [
        ...(chosen.data?.flatMap((item) => (item.workout ? [item.workout] : [])) ?? []),
        ...(q.data?.pages.flatMap((page) => page.items) ?? []),
      ]
        .filter((workout) => workout.kind !== "program")
        .map((workout) => [workout.id, workout])
    ).values(),
  ];
  function toggle(id: string) {
    if (disabled) return;
    if (!selected.includes(id) && selected.length >= 10) return;
    change(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id], minutes);
  }
  return (
    <>
      <Field
        label="Find saved sessions"
        value={search}
        onChange={setSearch}
        placeholder="Search your private library"
      />
      <Copy kind="small">{selected.length}/10 selected · Imported programs are assigned days separately.</Copy>
      {chosen.data
        ?.filter((item) => item.error)
        .map((item) => (
          <Card key={item.id}>
            <Notice error>{item.error} The selected source is still in your draft.</Notice>
            <Button
              title="Remove unavailable source selection"
              secondary
              disabled={disabled}
              onPress={() =>
                change(
                  selected.filter((id) => id !== item.id),
                  minutes
                )
              }
            />
          </Card>
        ))}
      {shown.map((workout) => (
        <Card key={workout.id}>
          <Choice label={workout.title} selected={selected.includes(workout.id)} onPress={() => toggle(workout.id)} />
          {selected.includes(workout.id) && (
            <Field
              label={`Reviewed approximate time for ${workout.title} · minutes`}
              value={minutes[workout.id] ?? ""}
              onChange={(value) => {
                if (!disabled) change(selected, { ...minutes, [workout.id]: value });
              }}
              numeric
              optional
              placeholder={
                workout.estimated_minutes
                  ? String(workout.estimated_minutes)
                  : "Enter only if you reviewed its duration"
              }
            />
          )}
          <Button
            title="Inspect original session"
            secondary
            disabled={disabled}
            onPress={() => router.push({ pathname: "/workout/[id]", params: { id: workout.id } })}
          />
        </Card>
      ))}
      {q.error && <Notice error>{q.error.message}</Notice>}
      {q.hasNextPage && (
        <Button
          title="Load more saved sessions"
          secondary
          busy={q.isFetchingNextPage}
          onPress={() => {
            void q.fetchNextPage();
          }}
        />
      )}
      {!shown.length && !q.isPending && (
        <Copy>
          No saved sessions match this search. You can save a source, or use suitable generated training in a blended
          plan.
        </Copy>
      )}
    </>
  );
}
