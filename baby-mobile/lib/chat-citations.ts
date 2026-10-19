import type { Citation } from "./models";

/** Show stable, readable source numbers while retaining server IDs for authorized navigation. */
export function readableCitations(message: string, citations: Citation[] = []) {
  const indexes = new Map(citations.map((citation, index) => [citation.id.toLowerCase(), index + 1]));
  return message.replace(/\[([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\]/gi, (_, id: string) => {
    const index = indexes.get(id.toLowerCase());
    return index ? `[${index}]` : "[source unavailable]";
  });
}
