import { useState } from "react";
import { Linking, Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import type { BabyRecord, Relevance } from "@/lib/models";
import { sourceProcessingNotes, sourceEvidenceItems } from "@/lib/models";
import { pointParts, readSummary } from "../lib/source-reading";
import { timingLabel } from "@/lib/timing";
import { Button, Card, Copy, Grouped, Icon, Notice, fonts, sectionHeadingLimit, typeScale, useColors } from "./ui";
import { Disclosure } from "./disclosure";
import { TimingEditor, TimingRow } from "./timing-editor";
import { SourceRecovery } from "./source-recovery";
import { ShareToggle, whoCanSee } from "./share-toggle";
import { useBaby } from "@/lib/context";

/** A quiet small-caps label over a block of reading, such as "What it says". */
function Eyebrow({ children }: { children: string }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <Text key={fontScale} accessibilityRole="header" maxFontSizeMultiplier={2}
    style={{ ...typeScale.footnote, fontFamily: fonts.medium, letterSpacing: 0.6, textTransform: "uppercase", color: c.muted }}>{children}</Text>;
}

/** Numbered points in a card, each with its slide reference on a quiet line below. */
function NumberedCard({ title, items }: { title: string; items: string[] }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), badge = Math.round(24 * Math.min(fontScale, 1.6)),
    // At the largest sizes the number sits above its point, so long words keep the card's full width.
    stacked = fontScale >= 2;
  return <Card>
    <Copy kind="heading" limit={sectionHeadingLimit}>{title}</Copy>
    {items.map((item, index) => {
      const { text, ref } = pointParts(item);
      return <View key={index} accessible accessibilityLabel={[`${index + 1}. ${text}`, ref].filter(Boolean).join(". ")}
        style={{ flexDirection: stacked ? "column" : "row", gap: stacked ? 6 : 12, alignItems: "flex-start", paddingTop: 4 }}>
        <View style={{ width: badge, height: badge, borderRadius: badge / 2, backgroundColor: c.soft, alignItems: "center", justifyContent: "center", marginTop: 1 }}>
          <Text allowFontScaling={false} style={{ fontFamily: fonts.semibold, fontSize: Math.round(badge * 0.5), color: c.muted, fontVariant: ["tabular-nums"] }}>{index + 1}</Text>
        </View>
        <View style={{ flex: stacked ? undefined : 1, alignSelf: stacked ? "stretch" : undefined, gap: 2 }}>
          <Copy>{text}</Copy>
          {!!ref && <Copy kind="small" tone="muted">{ref}</Copy>}
        </View>
      </View>;
    })}
  </Card>;
}

/** What a saved post says, its points and what to do with it, in reading order. Problems with the read sit above this. */
export function SourceContent({ record, onError }: { record: BabyRecord; onError: (message: string) => void }) {
  const data = record.data, c = useColors(), { fontScale } = useWindowDimensions(), notes = sourceProcessingNotes(data.coverage_notes);
  const points = data.key_points ?? [], steps = data.steps ?? [],
    // Sampling is said everywhere; anything else about how it was read is worth a line.
    worthSaying = notes.filter(note => !note.includes("sampled") && !note.includes("samples")).slice(0, 2).join(" ");
  async function openOriginal() {
    try {
      const url = new URL(data.url!);
      if (!["http:", "https:"].includes(url.protocol)) throw Error();
      await Linking.openURL(url.toString());
    } catch { onError("Could not open the original link. Check the saved address or try again."); }
  }
  const side = fontScale < 1.3;
  return <>
    <View style={{ gap: 8 }}>
      {(data.summary || data.source_text) && <Eyebrow>What it says</Eyebrow>}
      {data.summary ? <Copy>{data.summary}</Copy> : data.source_text ? <Copy lines={5}>{data.source_text}</Copy>
        : (data.status === "queued" || data.status === "processing") && <Notice>Your original is saved. The useful details will appear here when reading finishes.</Notice>}
    </View>
    {points.length > 0 && <NumberedCard title="Key points" items={points} />}
    {steps.length > 0 && <NumberedCard title="Steps" items={steps} />}
    {!!worthSaying && <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
      <View style={{ paddingTop: 2 }}><Icon name="information-circle-outline" size={16} color={c.muted} /></View>
      <View style={{ flex: 1 }}><Copy kind="small" tone="muted">{worthSaying}</Copy></View>
    </View>}
    <View style={{ flexDirection: side ? "row" : "column", gap: 12 }}>
      {!!data.url && <View style={{ flex: side ? 1 : undefined }}>
        <Button secondary title="Open post" icon="open-outline" accessibilityLabel="Open the original post" onPress={() => void openOriginal()} />
      </View>}
      <View style={{ flex: side ? 1 : undefined }}>
        <Button secondary title={record.body.trim() ? "Edit note" : "Add a note"} icon="create-outline"
          onPress={() => router.push({ pathname: "/edit", params: { id: record.id, kind: "source" } })} />
      </View>
    </View>
  </>;
}

/** Everything a parent rarely needs, closed: timing, what was read, reading again, and who can see it. */
export function SourceMore({ record, onTiming, onError }: { record: BabyRecord; onTiming: (relevance: Relevance | null) => void; onError: (message: string) => void }) {
  const b = useBaby(), data = record.data, [editing, setEditing] = useState(false), label = timingLabel(data.relevance),
    notes = sourceProcessingNotes(data.coverage_notes), evidence = sourceEvidenceItems(data.evidence),
    who = whoCanSee(record, b.state.bootstrap, b.owner);
  return <>
    <View style={{ gap: 4 }}>
      <Copy kind="small" tone="muted">More about this post</Copy>
      <Disclosure title="When this shows up on Today" detail={label || "Not set"}>
        {editing ? <TimingEditor relevance={data.relevance} onClose={() => setEditing(false)}
          onSave={(relevance) => { setEditing(false); onTiming(relevance); }} />
          : record.cache_partial ? <Copy tone="muted">Reconnect to change when this shows up.</Copy>
          : <Grouped><TimingRow relevance={data.relevance} onPress={() => setEditing(true)} /></Grouped>}
      </Disclosure>
      {(data.source_text || evidence.length > 0) && <Disclosure title="What was read from this post" detail={readSummary(data) || undefined}>
        {data.source_text ? <Card><Copy>{data.source_text}</Copy></Card> : evidence.map((entry, index) => (
          <Card key={index}><Copy>{entry.text}</Copy>{entry.location && <Copy kind="small" tone="muted">{entry.location}</Copy>}</Card>
        ))}
        {!!data.legacy_saved_text && data.legacy_saved_text !== data.source_text && <Disclosure title="Earlier saved text">
          <Copy kind="small" tone="muted">Kept from before this read. This may include your earlier notes.</Copy>
          <Card><Copy>{data.legacy_saved_text}</Copy></Card>
        </Disclosure>}
        {(notes.length > 0 || evidence.length > 0) && <Disclosure title="Processing details">
          {notes.map((note, index) => <Copy key={index} kind="small" tone="muted">{note}</Copy>)}
          {evidence.length > 0 && <Disclosure title="Supporting passages">
            {evidence.map((entry, index) => <Card key={index}>
              <Copy>{entry.text}</Copy>
              {!!(entry.location || entry.timestamp || entry.source) && <Copy kind="small" tone="muted">
                {[entry.location, entry.timestamp, entry.source].filter(Boolean).join(" · ")}
              </Copy>}
            </Card>)}
          </Disclosure>}
        </Disclosure>}
      </Disclosure>}
      {data.status === "ready" && <SourceRecovery record={record} onError={onError} />}
      {!!who && <Disclosure title="Who can see it" detail={who}><ShareToggle record={record} plain /></Disclosure>}
    </View>
    <Copy kind="small" tone="muted">These are the creator’s claims, not medical advice. The original stays with your saved post.</Copy>
  </>;
}
