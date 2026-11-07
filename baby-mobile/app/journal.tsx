import { useCallback, useEffect, useRef, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useBaby } from "@/lib/context";
import { messageFor } from "@/lib/models";
import { replaceRecord } from "@/lib/outbox";
import { createHistoryPager, historyRows } from "@/lib/history";
import { Button, Copy, HeaderAction, FilterChips, Grouped, Empty, Loading, Notice, Row, Screen } from "@/components/ui";
import { HeaderSearch } from "@/components/header-search";
import { firstWords, writtenTitle } from "../lib/journal-title";
import { RecordRow } from "@/components/record-row";
import { ChildFilter } from "@/components/child-filter";
import { SyncStatus } from "@/components/sync-status";
import { LinkQuestions } from "@/components/visit-sections";
export function JournalContent({ careHistory = false }: { careHistory?: boolean }) {
  const params = useLocalSearchParams<{ filter?: string; at?: string }>();
  const b = useBaby(),
    [filter, setFilter] = useState(careHistory ? "care" : "journal"),
    [q, setQ] = useState(""),
    [searching, setSearching] = useState(false),
    [loading, setLoading] = useState(false),
    [historyError, setHistoryError] = useState(""),
    [page, setPage] = useState<{ key: string; ticket: number; ids: string[] | null; more: boolean } | null>(null);
  useEffect(() => {
    if (careHistory) return;
    if (params.filter === "care") router.replace("/care-history");
    else if (params.filter && ["all", "journal", "question", "timeline"].includes(params.filter))
      setFilter(params.filter === "all" ? "writing" : params.filter);
  }, [params.filter, params.at, careHistory]);
  const latest = useRef(b);
  latest.current = b;
  const view = { filter, childId: b.state.selectedChild, query: q },
    key = JSON.stringify([b.owner, b.state.bootstrap?.generation, view.childId, view.filter, q.trim()]),
    viewKey = useRef(key),
    lastFocusedKey = useRef<string | null>(null),
    localChanges = useRef<{ key: string; ids: Set<string> }>({ key, ids: new Set() });
  viewKey.current = key;
  if (localChanges.current.key !== key) localChanges.current = { key, ids: new Set() };
  for (const change of b.state.outbox) if (change.type === "save") localChanges.current.ids.add(change.record.id);
  const pager = useRef(createHistoryPager(async (filters, current) => {
    const account = latest.current, lease = account.api.lease(),
      generation = account.state.bootstrap?.generation, capturedKey = viewKey.current;
    const response = await account.api.records(filters);
    if (!current() || !account.current() || capturedKey !== viewKey.current) return response;
    account.api.assertLease(lease);
    await account.commit((state) => {
      account.api.assertLease(lease);
      if (!current() || capturedKey !== viewKey.current || state.bootstrap?.generation !== generation) return state;
      return { ...state, records: response.items.reduce(replaceRecord, state.records) };
    });
    return response;
  }));
  async function loadHistory(ticket: number, capturedKey: string) {
    if (!pager.current.current(ticket) || capturedKey !== viewKey.current || pager.current.snapshot().busy) return;
    setLoading(true);
    try {
      const response = await pager.current.next();
      if (!response || !pager.current.current(ticket) || capturedKey !== viewKey.current || !latest.current.current()) return;
      const snapshot = pager.current.snapshot();
      setPage({ key: capturedKey, ticket, ids: snapshot.ids, more: snapshot.more });
      setHistoryError("");
    } catch (e) {
      if (pager.current.current(ticket) && capturedKey === viewKey.current) {
        setHistoryError(messageFor(e));
        setPage({ key: capturedKey, ticket, ids: null, more: pager.current.snapshot().more });
      }
    } finally {
      if (pager.current.current(ticket) && capturedKey === viewKey.current) setLoading(false);
    }
  }
  useFocusEffect(useCallback(() => {
    const retained = lastFocusedKey.current === key;
    const ticket = pager.current.reset(view, retained);
    lastFocusedKey.current = key;
    localChanges.current = { key, ids: new Set(latest.current.state.outbox.flatMap((m) => m.type === "save" ? [m.record.id] : [])) };
    setPage({ key, ticket, ids: retained ? pager.current.snapshot().ids : null, more: true });
    setHistoryError("");
    setLoading(true);
    const timer = setTimeout(() => void loadHistory(ticket, key), q.trim() ? 350 : 0);
    return () => { clearTimeout(timer); pager.current.cancel(); };
  }, [key]));
  async function refreshHistory() {
    const capturedTicket = pager.current.snapshot().ticket;
    await b.sync();
    // Sync can outlive this child/filter view or a navigation away.
    if (!b.current() || key !== viewKey.current || !pager.current.current(capturedTicket)) return;
    const ticket = pager.current.reset(view, true);
    setPage({ key, ticket, ids: pager.current.snapshot().ids, more: true });
    setHistoryError("");
    await loadHistory(ticket, key);
  }
  const records = historyRows(b.state, view, page?.key === key ? page.ids : null, [...localChanges.current.ids]),
    // With one baby there's nothing else she could be looking at.
    shownBaby = (b.state.bootstrap?.children.length ?? 0) > 1 ? b.state.bootstrap!.children.find((child) => child.id === b.state.selectedChild) : undefined;
  return (
    <Screen
      title={careHistory ? "Care history" : "Journal"}
      onRefresh={refreshHistory}
      back
      // A pushed screen has no tab bar, so Add isn't there to write from.
      action={careHistory ? <HeaderAction title={searching ? "Close search" : "Search"}
        onPress={() => { setSearching(!searching); if (searching) setQ(""); }} />
        : <HeaderAction title="Write" onPress={() => router.push({ pathname: "/edit", params: { kind: filter === "question" ? "question" : "journal" } })} />}
    >
      {!careHistory && <HeaderSearch value={q} onChange={setQ} placeholder="Search notes and questions" />}
      {!careHistory && <Row title="Bring in pregnancy notes" detail="Paste, review, then save" icon="document-text-outline" onPress={() => router.push("/paste-visits")} />}
      <SyncStatus />
      <ChildFilter scroll />
      {!careHistory && <FilterChips
        value={filter}
        label="Show"
        options={[
          { label: "Timeline", value: "timeline" },
          { label: "All writing", value: "writing" },
          { label: "Journal", value: "journal" },
          { label: "Doctor questions", value: "question" },
        ]}
        onChange={setFilter}
      />}
      {/* A baby's page here still holds what she wrote for no baby in particular, and that's easy to miss. */}
      {!careHistory && !!shownBaby && <Copy kind="small" tone="muted">{`${shownBaby.name.trim() || "This baby"}’s entries, and those for no baby in particular.`}</Copy>}
      {searching && <HeaderSearch value={q} onChange={setQ} placeholder={careHistory ? "Search care logs" : "Search notes and questions"} />}
      {filter === "question" && <Row title="Doctor summary" detail="One page with your questions, notes and daily totals"
        icon="document-text-outline" onPress={() => router.push({ pathname: "/doctor-summary", params: { child: b.state.selectedChild ?? undefined } })} />}
      {filter === "question" && <LinkQuestions rows={records} />}
      {!!historyError && <>
        <Notice error>{historyError} Entries already on this device are shown below.</Notice>
        <Button secondary title="Try loading again" busy={loading}
          onPress={() => void loadHistory(pager.current.snapshot().ticket, key)} />
      </>}
      {!careHistory && Object.entries(b.state.drafts)
        .filter(([key, d]) => !key.startsWith("chat:") && (d.kind === "journal" || d.kind === "question"))
        .map(([key, d]) => (
          <Row
            key={key}
            title={writtenTitle(d) || firstWords(d.body) || "Continue writing"}
            detail="Unfinished private draft"
            icon="pencil-outline"
            onPress={() => router.push({ pathname: "/edit", params: { draft: key, kind: d.kind } })}
          />
        ))}
      {loading && !records.length ? <Loading label={careHistory ? "Loading care history…" : "Loading your journal…"} /> : records.length ? (
        <Grouped separatorInset={72}>
          {records.map((r) => (
            <RecordRow
              key={r.id}
              record={r}
              pending={b.state.outbox.some((m) => m.type === "save" && m.record.id === r.id)}
            />
          ))}
        </Grouped>
      ) : (
        <Empty
          icon="book-outline"
          title={q.trim() ? "No matching entries" : careHistory ? "No care logged yet" : filter === "question" ? "No doctor questions yet." : "A place for your own words."}
          body={q.trim() ? "Try a different phrase or clear your search." : careHistory ? "Log a feed, sleep or diaper from Today. Your care history will be here." : filter === "question" ? "Write down what you want to ask, and bring it to your next visit." : "Write a thought, save a photo, or record something you want to ask about. It doesn’t have to be polished."}
          action={q.trim() ? <Button secondary title="Clear search" onPress={() => setQ("")} /> : undefined}
        />
      )}
      {!historyError && page?.key === key && page.more && (
        <Button secondary title={q.trim() ? "Load more matches" : "Load older entries"} busy={loading}
          onPress={() => void loadHistory(page.ticket, key)} />
      )}
      {/* The two other places she may remember typing. */}
      {!careHistory && <Copy kind="small" tone="muted">Baby notes and How I’m feeling are in Tracker, on the day you logged them.</Copy>}
      <View style={{ height: 55 }} />
    </Screen>
  );
}

export default function Journal() { return <JournalContent />; }
