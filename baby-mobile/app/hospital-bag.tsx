import { useRef, useState } from "react";
import { View } from "react-native";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { messageFor, type BabyRecord, type RecordData } from "../lib/models";
import { familySpaces } from "../lib/spaces";
import { added, bagTitle, findBag, grouped, packedLine, removed, starterItems, toggled, type BagSection } from "../lib/hospital-bag";
import { Button, Card, Choice, Copy, Field, HeaderAction, Icon, Notice, PressTarget, Screen, Section, tap, useColors, useToast } from "@/components/ui";
import { SyncStatus } from "@/components/sync-status";

/**
 * Her hospital bag: a starter list she packs from, grouped the way a bag is packed. It's a checklist routine
 * underneath, so it's shared with the family like any list and Leon can tick things off from his phone.
 */
export default function HospitalBag() {
  const b = useBaby(), c = useColors(), toast = useToast(), bag = findBag(b.records),
    [editing, setEditing] = useState(false), [error, setError] = useState(""), [starting, setStarting] = useState(false),
    [drafts, setDrafts] = useState<Partial<Record<BagSection, string>>>({});
  const shared = familySpaces(b.state.bootstrap).length > 0, latest = useRef(b);
  latest.current = b;
  async function save(record: BabyRecord, data: RecordData) {
    setError("");
    try {
      const now = latest.current;
      await now.queue({ id: Crypto.randomUUID(), generation: now.state.bootstrap!.generation, type: "save",
        record: { ...record, data }, files: [] });
    } catch (failure) { setError(messageFor(failure)); }
  }
  async function start() {
    if (starting) return;
    setStarting(true); setError("");
    try {
      await b.queue({ id: Crypto.randomUUID(), generation: b.state.bootstrap!.generation, type: "save", files: [],
        record: { id: Crypto.randomUUID(), kind: "routine", title: bagTitle, body: "", child_id: null, occurred_at: new Date().toISOString(),
          data: { routine_type: "checklist", items: starterItems(), enabled: false, repeat: "none" } } });
      tap("success");
    } catch (failure) { setError(messageFor(failure)); }
    finally { setStarting(false); }
  }
  function add(record: BabyRecord, section: BagSection) {
    const label = drafts[section]?.trim();
    if (!label) return;
    void save(record, added(record, section, label, Crypto.randomUUID()));
    setDrafts((all) => ({ ...all, [section]: "" }));
  }
  function remove(record: BabyRecord, id: string, label: string) {
    const before = record.data;
    void save(record, removed(record, id));
    toast(`Removed ${label}`, { label: "Undo", onPress: () => {
      // That same list as it is now (not whichever is newest), with that one line back where it was.
      const now = latest.current.records.find((row) => row.id === record.id) ?? record;
      if (now.data.items?.some((item) => item.id === id)) return;
      const at = before.items?.findIndex((item) => item.id === id) ?? -1, item = before.items?.[at];
      if (!item) return;
      const items = [...(now.data.items ?? [])];
      items.splice(Math.min(at, items.length), 0, item);
      void save(now, { ...now.data, items });
    } });
  }
  return <Screen title={bagTitle} back subtitle={bag ? `${packedLine(bag)}${shared ? " · shared with your family" : ""}` : undefined} numericSubtitle
    action={bag && <HeaderAction title={editing ? "Done" : "Edit"} onPress={() => setEditing(!editing)} />}>
    <SyncStatus />
    {!!error && <Notice error>{error}</Notice>}
    {!bag ? <Card tone="hero" style={{ gap: 12 }}>
      <Copy kind="heading">A list to pack from</Copy>
      <Copy tone="muted">Start with a list of what most people bring for the birth: things for you, for baby, for your partner, and the papers.
        Tick things off as you pack, and change anything to suit you and your hospital.</Copy>
      <Copy kind="small" tone="muted">Many hospitals give pads, diapers and gowns. Their own list, if they gave you one, wins.</Copy>
      <Button title="Start my hospital bag" icon="bag-handle-outline" busy={starting} onPress={() => void start()} />
    </Card> : grouped(bag).map((section) => <Section key={section.id} title={section.title}>
      {section.items.map((item) => editing ? <View key={item.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 50 }}>
        <View style={{ flex: 1 }}><Copy>{item.label}</Copy></View>
        <PressTarget accessibilityRole="button" accessibilityLabel={`Remove ${item.label}`} onPress={() => remove(bag, item.id, item.label)}
          style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
          <Icon name="remove-circle-outline" size={22} color={c.muted} />
        </PressTarget>
      </View> : <Choice key={item.id} label={item.label} selected={item.done} onPress={() => void save(bag, toggled(bag, item.id))} />)}
      {!section.items.length && !editing && <Copy kind="small" tone="muted">Nothing here. Tap Edit to add something.</Copy>}
      {editing && "add" in section && <>
        <Field label={section.add} maxLength={500} value={drafts[section.id as BagSection] ?? ""}
          onChange={(text) => setDrafts((all) => ({ ...all, [section.id]: text }))} returnKeyType="done"
          onSubmit={() => add(bag, section.id as BagSection)} />
        <Button secondary title="Add" disabled={!drafts[section.id as BagSection]?.trim()} onPress={() => add(bag, section.id as BagSection)} />
      </>}
    </Section>)}
    {bag && !editing && <Copy kind="small" tone="muted">{shared
      ? "Everyone in your family sees this list and can tick things off."
      : "Only you see this list. If you invite family, it’s shared with them."}</Copy>}
  </Screen>;
}
