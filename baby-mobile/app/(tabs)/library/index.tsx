import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useBaby } from "@/lib/context";
import { sourceTitle } from "@/lib/source-title";
import { messageFor, type BabyRecord } from "@/lib/models";
import { useLibraryHistory } from "@/lib/use-library-history";
import { changeCategory } from "@/lib/categories";
import { replaceRecord } from "@/lib/outbox";
import { Button, HeaderAction, Card, TextLinks, Grouped, Choice, Copy, Empty, Loading, Notice, Row, Screen, useToast } from "@/components/ui";
import { RecordRow } from "@/components/record-row";
import { SyncStatus } from "@/components/sync-status";
import { ChildFilter } from "@/components/child-filter";
import { CategoryPicker } from "@/components/category-picker";
import { ImportUpdates } from "@/components/import-updates";
import { HeaderSearch } from "@/components/header-search";
import { TabActions } from "@/components/tab-stack";
import { Disclosure } from "@/components/disclosure";
import { SuggestionLine } from "@/components/tips";
import { byStart, profileToday, timingChild, timingContext } from "@/lib/timing";
import { acceptMessage, acceptSuggestions, dismissSuggestion, pendingSuggestion, restoreSuggestion, undoAccepted } from "@/lib/suggestions";

export default function Library() {
  const b = useBaby();
  const [q, setQ] = useState(""), [view, setView] = useState("inbox"), [collection, setCollection] = useState("");
  const [selecting, setSelecting] = useState(false), [selected, setSelected] = useState<string[]>([]);
  const [organizing, setOrganizing] = useState(false), [error, setError] = useState("");
  const [lastChange, setLastChange] = useState<{ record: BabyRecord; added: string[] } | null>(null);
  const [undoing, setUndoing] = useState(false), undoBusy = useRef(false);
  const toast = useToast(), [deciding, setDeciding] = useState(""), params = useLocalSearchParams<{ view?: string; at?: string }>();
  const today = profileToday(new Date(), b.state.bootstrap?.profile.timezone), tipsChild = timingChild(b.state, today),
    context = timingContext(tipsChild, today), timedView = view === "now" || view === "upcoming",
    timed = timedView && tipsChild && context ? { mode: view, childId: tipsChild.id, context } as const : undefined;
  useEffect(() => { if (params.view && ["inbox", "all", "now", "upcoming", "categories"].includes(params.view)) chooseView(params.view); },
    [params.view, params.at]);
  // For now and Coming up need a current week or age; without one (a past due date, a removed child) show everything.
  useEffect(() => { if (timedView && !context) chooseView("all"); }, [timedView, !!context]);
  const history = useLibraryHistory({ kind: "source", childId: b.state.selectedChild, query: q,
    collectionId: collection || undefined, uncategorized: view === "inbox", timing: timed });
  const rows = timed?.mode === "upcoming" ? [...history.rows].sort(byStart(timed.context.stage)) : history.rows,
    suggested = view === "inbox" && !collection ? rows.filter((row) => pendingSuggestion(row)) : [];
  const categories = useLibraryHistory({ kind: "collection", childId: null, query: "" });
  const category = categories.rows.find((r) => r.id === collection);
  const drafts = Object.entries(b.state.drafts).filter(([, d]) => d.kind === "source" &&
    (d.title.trim() || d.body.trim() || d.data.url || d.files.length));
  function chooseView(value: string) {
    setView(value); setCollection(""); setSelected([]); setSelecting(false); setError("");
  }
  function toggle(id: string) {
    setSelected((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : ids.length < 100 ? [...ids, id] : ids);
  }
  async function categorized(record: BabyRecord, added: string[]) {
    try {
      await b.commit((s) => ({ ...s, records: replaceRecord(s.records, record) }));
      setOrganizing(false); setSelecting(false); setSelected([]);
      history.refresh(); categories.refresh();
      setLastChange({ record, added });
    } catch (failure) { setError(messageFor(failure)); }
  }
  async function undoCategory() {
    if (!lastChange || undoBusy.current) return;
    const change = lastChange;
    undoBusy.current = true; setUndoing(true); setError("");
    try {
      const result = await changeCategory(b.api, change.record.id, change.added, b.state.bootstrap!.generation, "remove");
      await b.commit((s) => ({ ...s, records: replaceRecord(s.records, result.record) }));
      history.refresh(); categories.refresh();
      setLastChange((current) => current === change ? null : current);
    } catch (failure) { setError(messageFor(failure)); }
    finally { undoBusy.current = false; setUndoing(false); }
  }
  async function accept(sources: BabyRecord[], key: string) {
    if (deciding) return;
    setDeciding(key); setError("");
    try {
      const known = new Set(b.records.filter((row) => row.kind === "collection").map((row) => row.id)),
        outcome = await acceptSuggestions(b, sources, known);
      history.refresh(); categories.refresh();
      toast(acceptMessage(outcome), outcome.accepted.length ? { label: "Undo", onPress: async () => {
        try { await undoAccepted(b, outcome); toast("Moved back to Uncategorized."); }
        catch (failure) { toast(messageFor(failure)); }
        finally { history.refresh(); categories.refresh(); }
      } } : undefined);
    } catch (failure) { setError(messageFor(failure)); }
    finally { setDeciding(""); }
  }
  async function dismiss(source: BabyRecord) {
    if (deciding) return;
    setDeciding(source.id); setError("");
    try {
      const before = await dismissSuggestion(b, source);
      toast("Suggestion removed.", before ? { label: "Undo", onPress: async () => {
        try { await restoreSuggestion(b, source.id, before); } catch (failure) { toast(messageFor(failure)); }
      } } : undefined);
    } catch (failure) { setError(messageFor(failure)); }
    finally { setDeciding(""); }
  }
  const listingCategories = view === "categories" && !collection;
  return <Screen title="Saved"
    onRefresh={() => { history.refresh(); categories.refresh(); }}
    footer={selecting ? <Button title={`Choose category · ${selected.length} selected`} disabled={!selected.length}
      onPress={() => setOrganizing(true)} /> : lastChange ? <Card tone="soft">
      <Copy lines={2}>Saved to {lastChange.record.title}.</Copy>
      {lastChange.added.length > 0 && <Button secondary title="Undo category change" busy={undoing} onPress={() => void undoCategory()} />}
      <Button variant="ghost" title="Dismiss confirmation" disabled={undoing} onPress={() => setLastChange(null)} />
    </Card> : undefined}>
    <Stack.Screen options={{ headerRight: () => <TabActions title="Saved" add={{ pathname: "/edit", params: { kind: "source" } }}
      action={<HeaderAction title={selecting ? "Cancel" : "Select"} disabled={listingCategories || !history.rows.length}
        onPress={() => { setSelecting(!selecting); setSelected([]); }} />} /> }} />
    <HeaderSearch value={q} onChange={setQ} placeholder="Search saved posts" />
    <SyncStatus />
    <ChildFilter scroll />
    <TextLinks value={view} label="Saved posts" options={[
      { label: "Uncategorized", value: "inbox" }, { label: "All saved", value: "all" },
      ...(context ? [{ label: "For now", value: "now" }, { label: "Coming up", value: "upcoming" }] : []),
      { label: "Categories", value: "categories" },
    ]} onChange={chooseView} />
    {!!error && <Notice error>{error}</Notice>}
    {listingCategories ? <>
      {categories.rows.map((r) => <Row key={r.id} title={r.title} detail={`${r.data.record_ids?.length ?? 0} saved posts`}
        icon="folder-outline" onPress={() => setCollection(r.id)} />)}
      {!categories.rows.length && !categories.loading && <Copy tone="muted">Select saved posts to create your first category.</Copy>}
      {categories.loading && <Loading label="Loading categories…" />}
      {!!categories.error && <><Notice error>{categories.error}</Notice><Button secondary title="Try loading categories again" onPress={categories.refresh} /></>}
      {categories.more && <Button secondary title="Load more categories" busy={categories.loading} onPress={() => void categories.loadMore()} />}
      <Button secondary title="Organize saved posts" onPress={() => chooseView("all")} />
    </> : <>
      {category && <Button variant="ghost" title={`Edit category: ${category.title}`} icon="pencil-outline"
        onPress={() => router.push({ pathname: "/edit", params: { kind: "collection", id: category.id } })} />}
      {!!history.error && <><Notice error>{history.error} Saved posts already on this device remain available.</Notice>
        <Button secondary title="Try loading posts again" onPress={history.refresh} busy={history.loading} /></>}
      {suggested.length > 0 && !selecting && <Button secondary icon="checkmark-done-outline" busy={deciding === "all"} disabled={!!deciding}
        title={suggested.length === 1 ? "Accept suggestion" : `Accept all ${suggested.length} suggestions`}
        onPress={() => void accept(suggested, "all")} />}
      {history.loading && !rows.length ? <Loading label="Loading saved posts…" /> : rows.length ? (
        <Grouped separatorInset={selecting ? 52 : 80}>
          {rows.map((record) => selecting ? <Choice key={record.id} label={sourceTitle(record)}
            detail={record.data.creator || record.data.summary?.slice(0, 100)} selected={selected.includes(record.id)} onPress={() => toggle(record.id)} />
            : <View key={record.id}>
              <RecordRow record={record} pending={b.state.outbox.some((m) => m.type === "save" && m.record.id === record.id)} />
              {view === "inbox" && <SuggestionLine record={record} busy={!!deciding}
                onAccept={() => void accept([record], record.id)} onDismiss={() => void dismiss(record)} />}
            </View>)}
        </Grouped>
      ) : <Empty title={q ? "No matching posts" : view === "now" ? "Nothing for right now yet" : view === "upcoming" ? "Nothing coming up yet"
        : view === "inbox" ? "You’re caught up." : "Keep something worth remembering."}
        body={q ? "Try another phrase. Search includes text inside saved posts." : timed
          ? "Saved tips that mention a pregnancy week or baby age show up here. You can add timing to any saved post."
          : view === "inbox"
          ? "New saves stay here until you choose a category. Your organized posts are in All saved."
          : "Share a post from another app or paste a link. You can organize it later."}
        action={<Button secondary title={view === "inbox" ? "See all saved posts" : "Save a post"}
          onPress={() => view === "inbox" ? chooseView("all") : router.push({ pathname: "/edit", params: { kind: "source" } })} />} />}
      {history.more && !history.error && <Button secondary title="Load more posts" busy={history.loading} onPress={() => void history.loadMore()} />}
      {selecting && <Copy kind="small" tone="muted">Select up to 100 posts. Your selection stays while you choose a category.</Copy>}
    </>}
    <ImportUpdates />
    {drafts.length > 0 && <Disclosure title={`Unfinished drafts · ${drafts.length}`}>
      {drafts.map(([key, draft]) => <Row key={key} title={draft.title || "Continue your draft"} detail="Saved privately on this device"
        icon="pencil-outline" onPress={() => router.push({ pathname: "/edit", params: { draft: key, kind: "source" } })} />)}
    </Disclosure>}
    {organizing && <CategoryPicker sourceIds={selected} onClose={() => setOrganizing(false)} onSaved={(r, ids) => void categorized(r, ids)} />}
  </Screen>;
}
