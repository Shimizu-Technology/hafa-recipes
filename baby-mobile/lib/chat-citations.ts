import type { Citation, Kind, RecordData } from "./models";
import { careSummary } from "./care-format";

/** Show stable, readable source numbers while retaining server IDs for authorized navigation. */
export function readableCitations(message: string, citations: Citation[] = []) {
  const indexes = new Map(citations.map((citation, index) => [citation.id.toLowerCase(), index + 1]));
  return message.replace(/\[([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\]/gi, (_, id: string) => {
    const index = indexes.get(id.toLowerCase());
    return index ? `[${index}]` : "[source unavailable]";
  });
}

function readableData(line: string, kind?: Kind) {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return line;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return line;
  const record = data as RecordData,
    inferred: Kind | undefined =
      kind ?? (record.method ? "feeding" : record.type ? "diaper" : "end_at" in record ? "sleep" : undefined);
  if (inferred === "feeding" || inferred === "diaper") return careSummary(inferred, record, "");
  if (inferred === "sleep") return record.end_at ? "Sleep recorded" : "Sleep in progress";
  return "";
}

/** Citation preview without the repeated title or stored data shapes, including older conversations. */
export function citationExcerpt(citation: Citation) {
  const lines = citation.excerpt.split("\n").map((line) => line.trim());
  if (lines[0] === citation.title.trim()) lines.shift();
  return lines
    .map((line) => (line.startsWith("{") && line.endsWith("}") ? readableData(line, citation.kind) : line))
    .filter(Boolean)
    .join("\n")
    .trim();
}
