import type { Bootstrap, WebSource } from "./models";

/** True once this person has accepted what the new Ask does. Until then questions stay on the old path. */
export function askV2Active(bootstrap: Bootstrap | null | undefined) {
  return !!bootstrap?.ask_consent_version && !!bootstrap.profile.ai_consent &&
    bootstrap.profile.ai_consent_version === bootstrap.ask_consent_version;
}

/** Only a real web link is ever handed to the phone to open. */
export function openableUrl(url: string) {
  return /^https?:\/\/[^\s\\\x00-\x1f\x7f]+$/i.test(url);
}

export function sourceGroups(sources: WebSource[] = []) {
  const usable = sources.filter((source) => openableUrl(source.url));
  return { trusted: usable.filter((source) => source.kind === "trusted"), web: usable.filter((source) => source.kind !== "trusted") };
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
