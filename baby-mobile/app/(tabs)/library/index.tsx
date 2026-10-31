import { useRef, useState } from "react";
import { Stack, router } from "expo-router";
import { useBaby } from "@/lib/context";
import { sourceTitle } from "@/lib/source-title";
import { messageFor, type BabyRecord } from "@/lib/models";
import { useLibraryHistory } from "@/lib/use-library-history";
import { changeCategory } from "@/lib/categories";
import { replaceRecord } from "@/lib/outbox";
import { Button, Card, TextLinks, Grouped, Choice, Copy, Empty, Loading, Notice, Row, Screen } from "@/components/ui";
import { RecordRow } from "@/components/record-row";
import { SyncStatus } from "@/components/sync-status";
import { ChildFilter } from "@/components/child-filter";
import { CategoryPicker } from "@/components/category-picker";
import { ImportUpdates } from "@/components/import-updates";
import { HeaderSearch } from "@/components/header-search";
import { TabActions } from "@/components/tab-stack";
import { Disclosure } from "@/components/disclosure";

export default function Library() {
  const b = useBaby();
  const [q, setQ] = useState(""), [view, setView] = useState("inbox"), [collection, setCollection] = useState("");
  const [selecting, setSelecting] = useState(false), [selected, setSelected] = useState<string[]>([]);
  const [organizing, setOrganizing] = useState(false), [error, setError] = useState("");
  const [lastChange, setLastChange] = useState<{ record: BabyRecord; added: string[] } | null>(null);
  const [undoing, setUndoing] = useState(false), undoBusy = useRef(false);
  const history = useLibraryHistory({ kind: "source", childId: b.state.selectedChild, query: q,
    collectionId: collection || undefined, uncategorized: view === "inbox" });
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
      action={<Button variant="ghost" title={selecting ? "Cancel" : "Select"} disabled={listingCategories || !history.rows.length}
        onPress={() => { setSelecting(!selecting); setSelected([]); }} />} /> }} />
    <HeaderSearch value={q} onChange={setQ} placeholder="Search saved posts" />
    <SyncStatus />
    <ChildFilter scroll />
    <TextLinks value={view} label="Saved posts" options={[
      { label: "Uncategorized", value: "inbox" }, { label: "All saved", value: "all" }, { label: "Categories", value: "categories" },
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
      {history.loading && !history.rows.length ? <Loading label="Loading saved posts…" /> : history.rows.length ? (
        <Grouped>
          {history.rows.map((record) => selecting ? <Choice key={record.id} label={sourceTitle(record)}
            detail={record.data.creator || record.data.summary?.slice(0, 100)} selected={selected.includes(record.id)} onPress={() => toggle(record.id)} />
            : <RecordRow key={record.id} record={record} pending={b.state.outbox.some((m) => m.type === "save" && m.record.id === record.id)} />)}
        </Grouped>
      ) : <Empty title={q ? "No matching posts" : view === "inbox" ? "You’re caught up." : "Keep something worth remembering."}
        body={q ? "Try another phrase. Search includes text inside saved posts." : view === "inbox"
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
