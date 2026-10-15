import { useState } from "react";
import { View } from "react-native";
import { Button, Card, Copy } from "@/components/ui";
import { SourceImage } from "@/components/source-image";
import type { Workout } from "@/lib/models";
export function WorkoutSource({ source }: { source: Pick<Workout, "source_title" | "source_creator" | "source_thumbnail_url" | "source_context"> }) {
  if (!source.source_title && !source.source_creator && !source.source_thumbnail_url && !source.source_context) return null;
  return <Card compact>
    {source.source_thumbnail_url && <SourceImage uri={source.source_thumbnail_url} label={source.source_title ?? "Original workout source"} />}
    <Copy kind="caption" tone="accent">Original source</Copy>
    {!!source.source_title && <Copy kind="subheading">{source.source_title}</Copy>}
    {!!source.source_creator && <Copy kind="small" tone="muted">By {source.source_creator}</Copy>}
    <SavedSourceText context={source.source_context} />
  </Card>;
}

const sourceLabel = (location: string) => ({ caption: "Caption", transcript: "Transcript",
  page_text: "Web page", provided_text: "Provided text", document_text: "Document text" }[location] ??
  `Document page ${location.split(":")[1]}`);

export function SavedSourceText({ context }: { context: Workout["source_context"] }) {
  const [expanded, setExpanded] = useState<string[]>([]);
  if (!context) return null;
  const locations = [...new Set(context.parts.map((part) => part.location))];
  return <View style={{ gap: 8 }}>
    <Copy kind="small" tone="muted">Saved source text · private to you. Reference text, separate from your workout instructions.</Copy>
    {locations.map((location) => {
      const open = expanded.includes(location);
      return <View key={location} style={{ gap: 8 }}>
        <Button title={`${open ? "Hide" : "Show"} ${sourceLabel(location).toLowerCase()}`} variant="ghost"
          onPress={() => setExpanded(open ? expanded.filter((item) => item !== location) : [...expanded, location])} />
        {open && <Copy kind="small">{context.parts.filter((part) => part.location === location).map(part => part.text).join("")}</Copy>}
      </View>;
    })}
    {context.truncated && <Copy kind="small" tone="muted">Only part of the source text could be saved.</Copy>}
  </View>;
}
