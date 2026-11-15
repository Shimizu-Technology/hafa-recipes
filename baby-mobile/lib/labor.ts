import type { Child } from "./models";
import type { FamilyMember } from "./family";
import { expectingFor } from "./expecting";

export interface Sourced { text: string; source: { name: string; url: string } }

/**
 * "When to call", under the contraction timer. Each line is a source's own guidance, named, checked 2026-11-15.
 * It's a pattern to know, never a reading of her timer: the app doesn't say she's reached it. Her provider's
 * instructions, in "What my doctor told me", come first, and the week's guidance notice above still stands.
 */
const lines: Sourced[] = [
  { text: "Your provider’s instructions come first. If you think you’re in labor and aren’t sure, call them or the hospital.",
    source: { name: "MedlinePlus, Am I in labor?", url: "https://medlineplus.gov/ency/patientinstructions/000508.htm" } },
  { text: "Many hospitals use “5-1-1”: call when contractions are about 5 minutes apart, last about 1 minute, and have been like that for about an hour.",
    source: { name: "Cleveland Clinic", url: "https://my.clevelandclinic.org/locations/akron-general/specialties/maternity-services/faqs" } },
  { text: "Call your doctor or midwife right away if fluid is leaking, there’s bleeding beyond light spotting, or your baby is moving less.",
    source: { name: "MedlinePlus, Am I in labor?", url: "https://medlineplus.gov/ency/patientinstructions/000508.htm" } },
];

/** The same guidance on her partner's phone, by her name: the person reading isn't the one in labor. */
const about = (name: string): Sourced[] => [
  { text: `${name}’s provider’s instructions come first. If labor might have started and you aren’t sure, call them or the hospital.`, source: lines[0].source },
  lines[1],
  { text: `Call ${name}’s doctor or midwife right away if fluid is leaking, there’s bleeding beyond light spotting, or the baby is moving less.`, source: lines[2].source },
];
/** Until the family says who's expecting: words that fit whoever is reading. */
const neutral: Sourced[] = [
  { text: "The provider’s instructions come first. If labor might have started and you aren’t sure, call the doctor or midwife, or the hospital.", source: lines[0].source },
  lines[1],
  { text: "Call the doctor or midwife right away if fluid is leaking, there’s bleeding beyond light spotting, or the baby is moving less.", source: lines[2].source },
];
/** Whose words: hers ("you"), her partner's (her by name), or everyday ones while that isn't settled. */
export type Voice = "mine" | "neutral" | { name: string };

/**
 * Before 37 weeks there's no pattern to wait for: the preterm notice says don't wait, so "5-1-1" isn't shown, and nor
 * is it when the week isn't known.
 */
export const whenToCall = (week: number | undefined, voice: Voice = "mine") => {
  const shown = voice === "mine" ? lines : voice === "neutral" ? neutral : about(voice.name);
  return week !== undefined && week >= 37 ? shown : [shown[0], shown[2]];
};

/**
 * Labor as this phone should say it, from who the family says is expecting (`expecting_member`). Hers in her words;
 * on another parent's phone a support view by her name; and while it isn't settled, everyday words and the question.
 */
export function laborView(child: Pick<Child, "birth_date" | "details"> | null | undefined, owner: string | null | undefined,
  people: Record<string, string> | undefined, family: { inFamily: boolean; members: readonly Pick<FamilyMember, "app_user_id" | "role" | "status">[] | null }) {
  const who = expectingFor(child, owner, family), name = who.id && who.id !== owner ? people?.[who.id]?.trim() ?? "" : "";
  const voice: Voice = !who.id ? "neutral" : who.id === owner ? "mine" : name ? { name } : "neutral";
  return { who, voice, support: typeof voice === "object" ? { id: who.id!, name: voice.name } : null };
}
