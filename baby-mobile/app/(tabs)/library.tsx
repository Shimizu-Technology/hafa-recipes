import { importFinished, importRetryable, importLabel, importProblem, importCardVisible } from "@/lib/import-status";
import { useState } from "react";
import { router } from "expo-router";
import { View } from "react-native";
import { useBaby } from "@/lib/context";
import { messageFor } from "@/lib/models";
import { useLibraryHistory } from "@/lib/use-library-history";
import { Button, Card, Chips, Copy, Empty, Field, Loading, Notice, Row, Screen, Section } from "@/components/ui";
import { RecordRow } from "@/components/record-row";
import { SyncStatus } from "@/components/sync-status";
import { ChildFilter } from "@/components/child-filter";
export default function Library() {
  const b = useBaby(),
    [q, setQ] = useState(""),
    [topic, setTopic] = useState(""),
    [collection, setCollection] = useState(""),
    [error, setError] = useState(""),
    [showAllUpdates, setShowAllUpdates] = useState(false);
  const selected = b.records.find((row) => row.kind === "collection" && row.id === collection);
  const deletedCollection =
    !!collection && b.state.outbox.some((m) => m.type === "delete" && m.record.id === collection);
  const localCollection = !!selected && selected.revision === 0;
  const history = useLibraryHistory(
    {
      kind: "source",
      childId: b.state.selectedChild,
      query: q,
      collectionId: collection || undefined,
      topic: topic || undefined,
    },
    !localCollection && !deletedCollection
  );
  const collectionHistory = useLibraryHistory({ kind: "collection", childId: null, query: "" });
  const collections =
    selected && !collectionHistory.rows.some((row) => row.id === selected.id)
      ? [selected, ...collectionHistory.rows]
      : collectionHistory.rows;
  const attentionJobs = b.state.imports.filter((job) => importCardVisible(job.status, job.error));
  const sources = history.rows,
    busy = history.loading,
    topics = [
      ...new Set([
        ...(topic ? [topic] : []),
        ...b.records.filter((r) => r.kind === "source").flatMap((r) => r.data.topics ?? []),
      ]),
    ].sort(),
    drafts = Object.entries(b.state.drafts).filter(([, d]) => d.kind === "source");
  return (
    <Screen
      title="Keep what helps."
      subtitle="Your saved advice, with the original always close."
      action={
        <Button
          secondary
          title="Save"
          icon="add"
          onPress={() => router.push({ pathname: "/edit", params: { kind: "source" } })}
        />
      }
    >
      <SyncStatus />
      <Field
        label="Search inside your saved sources"
        value={q}
        onChange={setQ}
        placeholder="Try “hospital bag” or “breastfeeding”…"
      />
      <ChildFilter />
      {topics.length > 0 && (
        <Chips
          value={topic}
          options={[{ label: "All topics", value: "" }, ...topics.map((value) => ({ value, label: value }))]}
          onChange={setTopic}
        />
      )}
      {collections.length > 0 && (
        <Chips
          value={collection}
          options={[
            { label: "All collections", value: "" },
            ...collections.map((r) => ({ value: r.id, label: r.title })),
          ]}
          onChange={setCollection}
        />
      )}
      {collectionHistory.more && !collectionHistory.error && (
        <Button
          secondary
          title="Load more collections"
          busy={collectionHistory.loading}
          onPress={() => void collectionHistory.loadMore()}
        />
      )}
      {!!collectionHistory.error && (
        <>
          <Notice error>Could not load all collections. Collections already on this device are still available.</Notice>
          <Button
            secondary
            title="Try loading collections again"
            busy={collectionHistory.loading}
            onPress={() => void collectionHistory.loadMore()}
          />
        </>
      )}
      <Button
        variant="ghost"
        title="New collection"
        icon="folder-open-outline"
        onPress={() => router.push({ pathname: "/edit", params: { kind: "collection" } })}
      />
      {selected && !history.missing && !deletedCollection && (
        <Button
          variant="ghost"
          title={`Edit collection: ${selected.title}`}
          icon="pencil-outline"
          onPress={() => router.push({ pathname: "/edit", params: { kind: "collection", id: selected.id } })}
        />
      )}
      {localCollection && (
        <Notice>This collection is saved on this device. Its sources will update after syncing.</Notice>
      )}
      {deletedCollection && (
        <Notice>This collection was removed on this device. Show all sources or choose another collection.</Notice>
      )}
      {(history.missing || deletedCollection) && (
        <Button secondary title="Show all sources" onPress={() => setCollection("")} />
      )}
      {drafts.length > 0 && (
        <Section title="Pick up where you left off">
          {drafts.map(([key, d]) => (
            <Row
              key={key}
              title={d.title || "Unfinished source"}
              detail="Private draft on this device"
              icon="pencil-outline"
              onPress={() => router.push({ pathname: "/edit", params: { draft: key, kind: "source" } })}
            />
          ))}
        </Section>
      )}
      {attentionJobs.length > 0 && (
        <Section title="Source processing">
          {(showAllUpdates ? attentionJobs : attentionJobs.slice(0, 4)).map((job) => (
            <Card key={job.id} tone="soft">
              <Copy>{importLabel(job.status, job.error)}</Copy>
              {job.error && <Copy tone="muted">{importProblem(job.error)}</Copy>}
              {job.record_id && (
                <Button
                  secondary
                  title="Open saved source"
                  onPress={() => router.push({ pathname: "/record/[id]", params: { id: job.record_id! } })}
                />
              )}
              <View style={{ gap: 8 }}>
                {importRetryable(job.status, job.error) && (
                  <Button
                    secondary
                    title="Retry processing"
                    onPress={() =>
                      void b.api
                        .retryJob(job.id, b.state.bootstrap!.generation)
                        .then((fresh) =>
                          b.commit((s) => ({ ...s, imports: s.imports.map((j) => (j.id === fresh.id ? fresh : j)) }))
                        )
                        .catch((e) => setError(messageFor(e)))
                    }
                  />
                )}
                {!importFinished(job.status) && (
                  <Button
                    variant="ghost"
                    title="Cancel processing"
                    onPress={() =>
                      void b.api
                        .cancelJob(job.id, b.state.bootstrap!.generation)
                        .then((fresh) =>
                          b.commit((s) => ({ ...s, imports: s.imports.map((j) => (j.id === fresh.id ? fresh : j)) }))
                        )
                        .catch((e) => setError(messageFor(e)))
                    }
                  />
                )}
              </View>
            </Card>
          ))}
          {!showAllUpdates && attentionJobs.length > 4 && (
            <Button
              variant="ghost"
              title={`Show ${attentionJobs.length - 4} more processing updates`}
              onPress={() => setShowAllUpdates(true)}
            />
          )}
        </Section>
      )}
      {!!error && <Notice error>{error}</Notice>}
      {!!history.error && (
        <>
          <Notice error>
            {history.error}
            {!history.missing ? " Sources already on this device are shown below." : ""}
          </Notice>
          <Button
            secondary
            title="Try loading sources again"
            busy={busy}
            onPress={() => (history.missing ? history.refresh() : void history.loadMore())}
          />
        </>
      )}
      {busy && !sources.length ? (
        <Loading label="Looking inside your library…" />
      ) : sources.length ? (
        <Section title={q ? `${sources.length} matching source${sources.length === 1 ? "" : "s"}` : "Your library"}>
          {sources.map((r) => (
            <RecordRow
              key={r.id}
              record={r}
              pending={b.state.outbox.some((m) => m.type === "save" && m.record.id === r.id)}
            />
          ))}
        </Section>
      ) : (
        <Empty
          title={q || topic || collection ? "Nothing here yet" : "The good advice deserves a home."}
          body={
            q || topic || collection
              ? "Try a different phrase or clear a filter. Search includes notes, transcripts, summaries, and topics."
              : "Share a video from your favorite app, paste a link, or save a screenshot. Find the useful part without replaying everything."
          }
          action={
            <Button
              secondary
              title="Save your first source"
              onPress={() => router.push({ pathname: "/edit", params: { kind: "source" } })}
            />
          }
        />
      )}
      {history.more && !history.error && (
        <Button
          secondary
          title={q.trim() ? "Load more matching sources" : "Load older sources"}
          busy={busy}
          onPress={() => void history.loadMore()}
        />
      )}
      <Button
        variant="ghost"
        title="Refresh library"
        onPress={() => {
          history.refresh();
          collectionHistory.refresh();
        }}
      />
      <View style={{ height: 55 }} />
    </Screen>
  );
}
