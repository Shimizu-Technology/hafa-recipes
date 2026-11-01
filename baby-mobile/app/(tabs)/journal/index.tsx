import { useCallback, useEffect, useRef, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useBaby } from "@/lib/context";
import { messageFor } from "@/lib/models";
import { replaceRecord } from "@/lib/outbox";
import { createHistoryPager, historyRows } from "@/lib/history";
import { exportVisit } from "@/lib/files";
import { visitSummary } from "@/lib/visit-summary";
import { Button, HeaderAction, Card, FilterChips, Grouped, Choice, Copy, Empty, Field, Loading, Notice, Row, Screen } from "@/components/ui";
import { HeaderSearch } from "@/components/header-search";
import { RecordRow } from "@/components/record-row";
import { ChildFilter } from "@/components/child-filter";
import { SyncStatus } from "@/components/sync-status";
export function JournalContent({ careHistory = false }: { careHistory?: boolean }) {
  const params = useLocalSearchParams<{ filter?: string; at?: string }>();
  const b = useBaby(),
    [filter, setFilter] = useState(careHistory ? "care" : "journal"),
    [q, setQ] = useState(""),
    [searching, setSearching] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [preparing, setPreparing] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [historyError, setHistoryError] = useState(""),
    [page, setPage] = useState<{ key: string; ticket: number; ids: string[] | null; more: boolean } | null>(null);
  useEffect(() => {
    if (careHistory) return;
    if (params.filter === "care") router.replace("/care-history");
    else if (params.filter && ["all", "journal", "question"].includes(params.filter))
      setFilter(params.filter === "all" ? "writing" : params.filter);
  }, [params.filter, params.at, careHistory]);
  useEffect(() => { setPreparing(false); setSelected([]); }, [filter]);
  const latest = useRef(b);
  latest.current = b;
  const view = { filter: preparing ? "all" : filter, childId: b.state.selectedChild, query: q },
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
  const records = historyRows(b.state, view, page?.key === key ? page.ids : null, [...localChanges.current.ids]);
  async function share() {
    setBusy(true);
    setError("");
    try {
      const rows = b.records.filter((r) => selected.includes(r.id));
      await exportVisit(
        visitSummary(rows, b.state.bootstrap!.children, b.state.bootstrap!.profile.timezone),
        b.owner
      );
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen
      title={careHistory ? "Care history" : "Journal"}
      onRefresh={refreshHistory}
      back={careHistory}
      action={careHistory && <HeaderAction title={searching ? "Close search" : "Search"}
        onPress={() => { setSearching(!searching); if (searching) setQ(""); }} />}
    >
      {!careHistory && <HeaderSearch value={q} onChange={setQ} placeholder="Search notes and questions" />}
      <SyncStatus />
      <ChildFilter scroll />
      {!careHistory && <FilterChips
        value={filter}
        label="Show"
        options={[
          { label: "Everything", value: "writing" },
          { label: "Journal", value: "journal" },
          { label: "Doctor questions", value: "question" },
        ]}
        onChange={setFilter}
      />}
      {searching && <Field label="Search" value={q} onChange={setQ} placeholder={careHistory ? "Search care logs" : "Notes and questions"} />}
      {filter === "question" && (preparing ? (
        <Card tone="soft">
          <Copy kind="label">Choose what to bring to the visit</Copy>
          <Copy kind="small" tone="muted">
            Tap questions and observations below, then share them as one summary.
          </Copy>
          <Button
            title={`Share ${selected.length} selected entr${selected.length === 1 ? "y" : "ies"}`}
            disabled={!selected.length}
            busy={busy}
            onPress={() => void share()}
          />
          <Button variant="ghost" title="Done choosing" onPress={() => setPreparing(false)} />
        </Card>
      ) : (
        <Row
          title="Prepare a visit summary"
          detail="Bring your questions and notes to the next appointment"
          icon="document-text-outline"
          onPress={() => setPreparing(true)}
        />
      ))}
      {!!error && <Notice error>{error}</Notice>}
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
            title={d.title || "Continue writing"}
            detail="Unfinished private draft"
            icon="pencil-outline"
            onPress={() => router.push({ pathname: "/edit", params: { draft: key, kind: d.kind } })}
          />
        ))}
      {loading && !records.length ? <Loading label={careHistory ? "Loading care history…" : "Loading your journal…"} /> : records.length ? (
        <Grouped>
          {records.map((r) =>
            preparing ? (
              <Card key={r.id} tone="soft">
                <Choice
                  label={r.title}
                  detail={r.body.slice(0, 160) || new Date(r.occurred_at).toLocaleString()}
                  selected={selected.includes(r.id)}
                  onPress={() =>
                    setSelected((ids) => (ids.includes(r.id) ? ids.filter((id) => id !== r.id) : [...ids, r.id]))
                  }
                />
              </Card>
            ) : (
              <RecordRow
                key={r.id}
                record={r}
                pending={b.state.outbox.some((m) => m.type === "save" && m.record.id === r.id)}
              />
            )
          )}
        </Grouped>
      ) : (
        <Empty
          icon="book-outline"
          title={q.trim() ? "No matching entries" : careHistory ? "No care logged yet" : "A place for your own words."}
          body={q.trim() ? "Try a different phrase or clear your search." : careHistory ? "Log a feed, sleep or diaper from Today. Your care history will be here." : "Write a thought, save a photo, or record something you want to ask about. It doesn’t have to be polished."}
          action={q.trim() ? <Button secondary title="Clear search" onPress={() => setQ("")} /> : undefined}
        />
      )}
      {!historyError && page?.key === key && page.more && (
        <Button secondary title={q.trim() ? "Load more matches" : "Load older entries"} busy={loading}
          onPress={() => void loadHistory(page.ticket, key)} />
      )}
      <View style={{ height: 55 }} />
    </Screen>
  );
}

export default function Journal() { return <JournalContent />; }
