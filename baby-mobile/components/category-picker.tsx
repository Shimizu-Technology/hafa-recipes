import { useRef, useState } from "react";
import { Modal } from "react-native";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { useLibraryHistory } from "@/lib/use-library-history";
import { changeCategory } from "@/lib/categories";
import { messageFor, type BabyRecord } from "@/lib/models";
import { Button, Copy, Field, Loading, Notice, Row, Screen } from "./ui";

export function CategoryPicker({ sourceIds, onClose, onSaved }: {
  sourceIds: string[]; onClose: () => void; onSaved: (record: BabyRecord, added: string[]) => void;
}) {
  const b = useBaby(), history = useLibraryHistory({ kind: "collection", childId: null, query: "" });
  const [creating, setCreating] = useState(false), [name, setName] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [id] = useState(Crypto.randomUUID), [occurredAt] = useState(() => new Date().toISOString());
  const working = useRef(false);
  async function organize(categoryId?: string) {
    if (working.current) return;
    working.current = true; setBusy(true); setError("");
    try {
      if (!b.online) throw Error("Connect to organize these saved posts. Your selection is kept.");
      if (sourceIds.some((id) => b.state.outbox.some((m) => m.type === "save" && m.record.id === id)))
        throw Error("These posts are still syncing. Your selection is kept; try again after they sync.");
      const generation = b.state.bootstrap!.generation;
      const result = categoryId ? await changeCategory(b.api, categoryId, sourceIds, generation) : {
        record: await b.api.save({ id, kind: "collection", title: name.trim(), body: "", child_id: null,
          occurred_at: occurredAt, data: { record_ids: sourceIds } }, generation), added: sourceIds,
      };
      if (b.current()) onSaved(result.record, result.added);
    } catch (failure) { if (b.current()) setError(messageFor(failure)); }
    finally { working.current = false; setBusy(false); }
  }
  return <Modal visible animationType="slide" onRequestClose={() => !busy && onClose()}>
    <Screen nativeHeader={false} numericSubtitle title="Choose category" subtitle={`${sourceIds.length} selected`}
      action={<Button variant="ghost" title="Cancel" disabled={busy} onPress={onClose} />}>
      {!!error && <Notice error>{error}</Notice>}
      {creating ? <>
        <Field label="Category name" value={name} onChange={setName} placeholder="Sleep, getting ready…" />
        <Button title="Create & organize" disabled={!name.trim()} busy={busy} onPress={() => void organize()} />
      </> : <Button secondary title="New category" icon="add" disabled={busy} onPress={() => setCreating(true)} />}
      {history.loading && !history.rows.length && <Loading label="Loading categories…" />}
      {history.rows.map((record) => <Row key={record.id} title={record.title} icon="folder-outline"
        numericDetail detail={`${record.data.record_ids?.length ?? 0} saved posts`} onPress={() => !busy && void organize(record.id)} />)}
      {!!history.error && <><Notice error>{history.error}</Notice><Button secondary title="Try again" onPress={history.refresh} /></>}
      {history.more && <Button secondary title="Load more categories" busy={history.loading} onPress={() => void history.loadMore()} />}
      <Copy kind="small" tone="muted">Posts can belong to more than one category. Existing categories are kept.</Copy>
    </Screen>
  </Modal>;
}
