import { useState } from "react";
import { View } from "react-native";
import { canPreview, factSources, sourceName, weekContent, weekHasDraft } from "@/lib/weekly-content";
import { Copy, PressTarget, useColors } from "./ui";
import { Disclosure } from "./disclosure";
import { MedicalSource } from "./medical-source";

/**
 * This week's size and three facts, on the week card. They come only from an approved batch. Until one covers this week
 * she sees the line below and no fact or number; a development build can look ahead, and a release build can't.
 */
export function WeekFacts({ week }: { week: number }) {
  const c = useColors(), [preview, setPreview] = useState(false), found = weekContent(week, { preview }),
    previewing = preview && !!found && !found.batch.approved;
  const toggle = canPreview() && weekHasDraft(week) && !found?.batch.approved && <PressTarget accessibilityRole="button" onPress={() => setPreview(!preview)}
    accessibilityLabel={preview ? "Development only: hide unreviewed facts" : "Development only: preview unreviewed facts"}
    style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: c.outline }}>
    <Copy kind="small">{preview ? "Development only: hide unreviewed facts" : "Development only: preview unreviewed facts"}</Copy>
  </PressTarget>;
  if (!found) return <View style={{ gap: 8 }}>
    <Copy kind="small" tone="muted">Weekly facts are coming once a doctor has reviewed them.</Copy>
    {toggle}
  </View>;
  const { batch, content } = found, links = [...new Set(content.facts.flatMap(factSources))];
  return <View style={{ gap: 12 }}>
    {toggle}
    {previewing && <Copy kind="label" tone="error">Development only. Not reviewed by a doctor.</Copy>}
    <View style={{ gap: 2 }}>
      <Copy kind="label">{`Roughly ${content.size_comparison.object}, by weight`}</Copy>
      <Copy numeric>{content.average.weight.display}</Copy>
      <Copy numeric>{content.average.length.display}</Copy>
      <Copy kind="small" tone="muted">{content.average.label}</Copy>
    </View>
    <View style={{ gap: 8 }}>
      {content.facts.map((fact) => <Copy key={fact.text}>{fact.text}</Copy>)}
    </View>
    <Disclosure title="Sources">
      <View style={{ gap: 2 }}>
        {links.map((url) => <MedicalSource key={url} source={sourceName(url)} url={url} />)}
        <Copy kind="small" tone="muted">{`Sizes: ${batch.size_source.used}`}</Copy>
        {batch.size_source.urls.map((url, index) => <MedicalSource key={url} source={`${sourceName(url)}, table ${index + 1}`} url={url} />)}
      </View>
    </Disclosure>
  </View>;
}
