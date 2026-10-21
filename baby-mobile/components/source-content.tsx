import { Linking } from "react-native";
import type { RecordData } from "@/lib/models";
import { sourceProcessingNotes, sourceEvidenceItems } from "@/lib/models";
import { Button, Card, Copy, Notice, Section } from "./ui";
import { Disclosure } from "./disclosure";

export function SourceContent({ data, onError }: { data: RecordData; onError: (message: string) => void }) {
  const notes = sourceProcessingNotes(data.coverage_notes), evidence = sourceEvidenceItems(data.evidence);
  const points = data.key_points ?? [], steps = data.steps ?? [];
  async function openOriginal() {
    try {
      const url = new URL(data.url!);
      if (!["http:", "https:"].includes(url.protocol)) throw Error();
      await Linking.openURL(url.toString());
    } catch { onError("Could not open the original link. Check the saved address or try again."); }
  }
  return (
    <>
      {!!(data.creator || data.platform) && <Copy kind="small" tone="muted">
        {[data.creator, data.platform].filter(Boolean).join(" · ")}
      </Copy>}
      {data.summary ? <Copy>{data.summary}</Copy> : data.source_text ? <Copy lines={5}>{data.source_text}</Copy> : (
        <Notice>{data.status === "queued" || data.status === "processing"
          ? "Your original is saved. The useful details will appear here when processing finishes."
          : "Your original is saved. No summary is available yet."}</Notice>
      )}
      {points.length > 0 && <Section title="Worth remembering">
        {points.map((point, index) => <Copy key={index}>• {point}</Copy>)}
      </Section>}
      {steps.length > 0 && <Section title="Steps from this source">
        {steps.map((step, index) => <Copy key={index}>{index + 1}. {step}</Copy>)}
      </Section>}
      {data.status === "incomplete" && <Copy kind="small" tone="muted">
        Some source details were unavailable. See processing details below.
      </Copy>}
      {!!data.url && <Button secondary title="Open original post" icon="open-outline" onPress={() => void openOriginal()} />}
      {(data.source_text || evidence.length > 0) && <Disclosure title="Original text & transcript">
        {data.source_text ? <Card><Copy>{data.source_text}</Copy></Card> : evidence.map((entry, index) => (
          <Card key={index}><Copy>{entry.text}</Copy>{entry.location && <Copy kind="small" tone="muted">{entry.location}</Copy>}</Card>
        ))}
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
      <Copy kind="small" tone="muted">These are the source creator’s claims. The original stays with your saved post.</Copy>
    </>
  );
}
