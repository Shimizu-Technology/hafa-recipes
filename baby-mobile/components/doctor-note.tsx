import { useEffect, useRef, useState } from "react";
import { TextInput, View, useWindowDimensions } from "react-native";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { doctorNote, doctorNoteTitle } from "@/lib/contractions";
import { messageFor, type Mutation } from "@/lib/models";
import { Card, Copy, fonts, radii, useColors, useToast } from "./ui";

/**
 * Her own words from her own doctor, at the top of the timer. It's one private journal entry labelled as a clinician
 * instruction, so it syncs and stays findable. We show no examples, so nothing here reads as advice.
 */
export function DoctorNote({ childId }: { childId: string | null }) {
  // Each baby has their own. Changing baby saves what's typed to the one it was typed for, and starts from the other's.
  return <ChildNote key={childId} childId={childId} />;
}
function ChildNote({ childId }: { childId: string | null }) {
  const b = useBaby(), c = useColors(), toast = useToast(), { fontScale } = useWindowDimensions(), saved = doctorNote(b.records, childId),
    [text, setText] = useState(saved?.body ?? ""), editing = useRef(false), latest = useRef({ text, saved, b });
  latest.current = { text, saved, b };
  // Another phone's copy arrives while she isn't typing.
  useEffect(() => { if (!editing.current) setText(saved?.body ?? ""); }, [saved?.body]);
  useEffect(() => {
    // Only the newest few entries are on a phone at first, so look for it once.
    let active = true;
    if (!saved) void b.api.search(doctorNoteTitle, "journal", childId, { limit: 5 }).then((page) => {
      const found = active ? doctorNote(page.items, childId) : undefined;
      if (found) void b.commit((state) => (state.records.some((row) => row.id === found.id) ? state : { ...state, records: [found, ...state.records] }));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  function save() {
    editing.current = false;
    const { text: value, saved: row, b: account } = latest.current, body = value.trim();
    if (body === (row?.body ?? "")) return;
    const change: Mutation = { id: Crypto.randomUUID(), generation: account.state.bootstrap!.generation, type: "save", files: [], record: row ? { ...row, body } : {
      id: Crypto.randomUUID(), kind: "journal", title: doctorNoteTitle, body, child_id: childId, occurred_at: new Date().toISOString(), data: { provenance: "clinician_instruction" } } };
    void account.queue(change).catch((e) => toast(messageFor(e)));
  }
  // She can leave with the keyboard still up. What she wrote stays.
  useEffect(() => () => { if (editing.current) save(); }, []);
  return <Card tone="soft">
    <View style={{ gap: 7 }}>
      <Copy kind="label">{doctorNoteTitle}</Copy>
      <TextInput key={fontScale} accessibilityLabel={doctorNoteTitle} value={text} multiline maxLength={4000} maxFontSizeMultiplier={0} placeholderTextColor={c.muted} placeholder="Write it here"
        onChangeText={(value) => { editing.current = true; setText(value); }} onBlur={save}
        style={{ minHeight: 64, padding: 12, borderRadius: radii.field, backgroundColor: c.surface, color: c.text, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, textAlignVertical: "top" }} />
    </View>
  </Card>;
}
