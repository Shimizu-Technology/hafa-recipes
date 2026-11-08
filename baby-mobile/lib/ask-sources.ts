import type { Bootstrap, WebSource } from "./models";

/** True once this person has accepted what the new Ask does. Until then questions stay on the old path. */
export function askV2Active(bootstrap: Bootstrap | null | undefined) {
  return !!bootstrap?.ask_consent_version && !!bootstrap.profile.ai_consent &&
    bootstrap.profile.ai_consent_version === bootstrap.ask_consent_version;
}

/** The question box with AI off. It has one line, and these words have to fit it. */
export function unavailablePlaceholder(fontScale: number) {
  return fontScale >= 1.5 ? "Question" : "Urgent? Ask here or open Help";
}

/** The note about sources belongs under an ordinary answer, not under "call 911". */
export function answeredCalmly(messages: readonly { role: string; help?: unknown }[]) {
  return messages.some((m) => m.role === "assistant") && !messages.some((m) => m.help);
}

export const CANT_ANSWER_LINE = "If this might be urgent, open Help or call 911.";

/** Only a real web link is ever handed to the phone to open. */
export function openableUrl(url: string) {
  return /^https?:\/\/[^\s\\\x00-\x1f\x7f]+$/i.test(url);
}

export function openableSources(sources: WebSource[] = []) {
  return sources.filter((source) => openableUrl(source.url));
}

export type AnswerPart = { text: string; url?: string };

/** An answer's text, with each [S1] reference and written-out link becoming something to tap. */
export function answerParts(message: string, sources: WebSource[] = []): AnswerPart[] {
  const numbers = new Map(sources.map((source, index) => [source.ref, { url: source.url, number: index + 1 }]));
  return message.split(/(\[S\d+\]|https?:\/\/[^\s)\]>"']+)/).filter(Boolean).flatMap((piece): AnswerPart[] => {
    const reference = /^\[(S\d+)\]$/.exec(piece);
    if (reference) {
      const known = numbers.get(reference[1]);
      return known && openableUrl(known.url) ? [{ text: `[${known.number}]`, url: known.url }] : [];
    }
    return openableUrl(piece) ? [{ text: piece, url: piece }] : [{ text: piece }];
  });
}
