import { Card, Copy } from "@/components/ui";
import { SourceImage } from "@/components/source-image";
import type { Workout } from "@/lib/models";
export function WorkoutSource({ source }: { source: Pick<Workout, "source_title" | "source_creator" | "source_thumbnail_url"> }) {
  if (!source.source_title && !source.source_creator && !source.source_thumbnail_url) return null;
  return <Card compact>
    {source.source_thumbnail_url && <SourceImage uri={source.source_thumbnail_url} label={source.source_title ?? "Original workout source"} />}
    <Copy kind="caption" tone="accent">Original source</Copy>
    {!!source.source_title && <Copy kind="subheading">{source.source_title}</Copy>}
    {!!source.source_creator && <Copy kind="small" tone="muted">By {source.source_creator}</Copy>}
  </Card>;
}
