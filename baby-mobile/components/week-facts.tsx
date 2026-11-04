import { useState } from "react";
import { View } from "react-native";
import { ageContent, ageHasDraft, canPreview, factSources, sourceName, weekContent, weekHasDraft, type BabyAge } from "@/lib/weekly-content";
import { Copy, PressTarget, useColors } from "./ui";
import { Disclosure } from "./disclosure";
import { MedicalSource } from "./medical-source";

function PreviewToggle({ preview, onPress, noun }: { preview: boolean; onPress: () => void; noun: string }) {
  const c = useColors(), label = `Development only: ${preview ? "hide" : "preview"} unreviewed ${noun}`;
  return <PressTarget accessibilityRole="button" onPress={onPress} accessibilityLabel={label}
    style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: c.outline }}>
    <Copy kind="small">{label}</Copy>
  </PressTarget>;
}

/**
 * This week's size and three facts, on the week card. They come only from an approved batch. Until one covers this week
 * she sees the line below and no fact or number; a development build can look ahead, and a release build can't.
 */
export function WeekFacts({ week }: { week: number }) {
  const [preview, setPreview] = useState(false), found = weekContent(week, { preview }),
    previewing = preview && !!found && !found.batch.approved;
  const toggle = canPreview() && weekHasDraft(week) && !found?.batch.approved && <PreviewToggle preview={preview} noun="facts" onPress={() => setPreview(!preview)} />;
  if (!found) return <View style={{ gap: 8 }}>
    <Copy kind="small" tone="muted">Weekly facts are coming once a doctor has reviewed them.</Copy>
    {toggle}
  </View>;
  const { batch, content } = found, comparison = content.size_comparison,
    links = [...new Set([...content.facts.flatMap(factSources), ...(comparison.source_url ? [comparison.source_url] : [])])];
  return <View style={{ gap: 12 }}>
    {toggle}
    {previewing && <Copy kind="label" tone="error">Development only. Not reviewed by a doctor.</Copy>}
    <View style={{ gap: 2 }}>
      <Copy kind="label">{`Roughly ${comparison.object}${comparison.compared_on === "weight" ? ", by weight" : ""}`}</Copy>
      {content.average && <Copy numeric>{content.average.weight.display}</Copy>}
      {content.average?.length && <Copy numeric>{content.average.length.display}</Copy>}
      {content.average && <Copy kind="small" tone="muted">{content.average.label}</Copy>}
    </View>
    <View style={{ gap: 8 }}>
      {content.facts.map((fact) => <Copy key={fact.text}>{fact.text}</Copy>)}
    </View>
    <Disclosure title="Sources">
      <View style={{ gap: 2 }}>
        {links.map((url) => <MedicalSource key={url} source={sourceName(url)} url={url} />)}
        {content.average && <>
          <Copy kind="small" tone="muted">{`Sizes: ${batch.size_source.used}`}</Copy>
          {batch.size_source.urls.map((url, index) => <MedicalSource key={url} source={`${sourceName(url)}, table ${index + 1}`} url={url} />)}
        </>}
      </View>
    </Disclosure>
  </View>;
}

/** The same gate, after birth: what's typically happening at this age, or the waiting line and nothing else. */
export function AgeFacts({ age }: { age: BabyAge }) {
  const [preview, setPreview] = useState(false), found = ageContent(age, { preview }),
    previewing = preview && !!found && !found.batch.approved;
  const toggle = canPreview() && ageHasDraft(age) && !found?.batch.approved && <PreviewToggle preview={preview} noun="lines" onPress={() => setPreview(!preview)} />;
  if (!found) return <View style={{ gap: 8 }}>
    <Copy kind="small" tone="muted">What’s typical at this age is coming once a doctor has reviewed it.</Copy>
    {toggle}
  </View>;
  const { batch, content } = found, links = [...new Set([...content.items, batch.note].flatMap(factSources))];
  return <View style={{ gap: 12 }}>
    {toggle}
    {previewing && <Copy kind="label" tone="error">Development only. Not reviewed by a doctor.</Copy>}
    <View style={{ gap: 8 }}>
      {content.items.map((item) => <Copy key={item.text}>{item.text}</Copy>)}
    </View>
    <Copy kind="small" tone="muted">{batch.note.text}</Copy>
    <Disclosure title="Sources">
      <View style={{ gap: 2 }}>
        {links.map((url) => <MedicalSource key={url} source={sourceName(url)} url={url} />)}
      </View>
    </Disclosure>
  </View>;
}
