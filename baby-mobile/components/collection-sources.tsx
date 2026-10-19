import { useEffect, useRef, useState } from "react";
import { useBaby } from "@/lib/context";
import { useLibraryHistory } from "@/lib/use-library-history";
import { collectionMemberRows, toggleCollectionMember } from "@/lib/library-history";
import { Button, Choice, Copy, Field, Loading, Notice, Section } from "./ui";

export function CollectionSources({
  collectionId,
  selected,
  onChange,
  disabled = false,
}: {
  collectionId?: string;
  selected: string[];
  disabled?: boolean;
  onChange: (ids: string[]) => void;
}) {
  const b = useBaby(),
    [query, setQuery] = useState(""),
    [shown, setShown] = useState(10);
  const liveSelection = useRef(selected);
  liveSelection.current = selected;
  const choices = useLibraryHistory({ kind: "source", childId: null, query });
  const members = useLibraryHistory(
    { kind: "source", childId: null, query: "", collectionId, pageSize: 100 },
    !!collectionId
  );
  // At most five sequential pages for the API's 500-member bound, never one GET per ID.
  useEffect(() => {
    if (collectionId && members.more && !members.loading && !members.error) void members.loadMore();
  }, [collectionId, members.more, members.loading, members.error, members.ids?.length]);
  function toggle(id: string) {
    if (disabled) return;
    const next = toggleCollectionMember(liveSelection.current, id);
    liveSelection.current = next;
    onChange(next);
  }
  const persisted = b.state.records.find((row) => row.id === collectionId)?.data.record_ids ?? [];
  const selectedRows = collectionMemberRows(selected, b.records, persisted, members.complete ? members.ids : null);
  const candidates = choices.rows.filter((row) => query.trim() || !selected.includes(row.id));
  return (
    <>
      <Section title={`In this collection · ${selected.length}`}>
        <Copy tone="muted">Your selection stays here while you search. Tap a selected source to remove it.</Copy>
        {selectedRows.slice(0, shown).map((row) => (
          <Choice
            key={row.id}
            label={row.title}
            detail={row.detail}
            selected
            disabled={disabled}
            onPress={() => toggle(row.id)}
          />
        ))}
        {!selected.length && <Copy tone="muted">Choose sources below to begin.</Copy>}
        {selectedRows.length > shown && (
          <Button
            secondary
            title={`Show more selected sources (${selectedRows.length - shown} remaining)`}
            onPress={() => setShown((value) => value + 20)}
          />
        )}
        {members.loading && (
          <Copy kind="small" tone="muted">
            Loading selected source titles…
          </Copy>
        )}
        {!!members.error && (
          <>
            <Notice error>Could not load all selected source titles. Your selections are still kept.</Notice>
            <Button secondary title="Retry selected source titles" onPress={members.refresh} busy={members.loading} />
          </>
        )}
      </Section>
      <Section title="Choose saved sources">
        <Field
          label="Find a saved source"
          value={query}
          onChange={setQuery}
          placeholder="Search titles, notes, and transcripts"
        />
        {selected.length >= 500 && (
          <Notice>This collection has 500 sources. Remove a source before adding another.</Notice>
        )}
        {!!choices.error && (
          <>
            <Notice error>{choices.error} Sources already on this device are shown below.</Notice>
            <Button
              secondary
              title="Try loading sources again"
              onPress={() => void choices.loadMore()}
              busy={choices.loading}
            />
          </>
        )}
        {choices.loading && !candidates.length ? (
          <Loading label="Finding your saved sources…" />
        ) : (
          candidates.map((row) => (
            <Choice
              key={row.id}
              label={row.title || "Saved source"}
              detail={
                selected.includes(row.id)
                  ? "Selected · tap to remove"
                  : row.body.slice(0, 120) || row.data.topics?.join(" · ")
              }
              selected={selected.includes(row.id)}
              disabled={disabled || (!selected.includes(row.id) && selected.length >= 500)}
              onPress={() => toggle(row.id)}
            />
          ))
        )}
        {!choices.loading && !candidates.length && (
          <Copy tone="muted">
            {query.trim()
              ? "No more matches here. Try another phrase."
              : "All sources shown here are already selected, or your library is empty."}
          </Copy>
        )}
        {choices.more && !choices.error && (
          <Button
            secondary
            title={query.trim() ? "Load more matching sources" : "Load older sources"}
            busy={choices.loading}
            onPress={() => void choices.loadMore()}
          />
        )}
      </Section>
    </>
  );
}
