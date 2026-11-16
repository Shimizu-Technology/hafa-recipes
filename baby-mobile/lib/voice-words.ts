import { doctorNoteTitle } from "./contractions";
import type { Voice } from "./labor";

/**
 * Words that follow who's reading, the way the contraction screen's guidance does (`Voice` from `laborView`): "my" and
 * "you" on the phone of whoever's expecting, her name on her partner's phone, and everyday words until the family has
 * said who it is. Only the person addressed changes; the advice and the stored data never do.
 */
/** What's shown above the note. The saved entry keeps its one title, so a note is found from either phone. */
export const doctorNoteLabel = (voice: Voice = "mine") =>
  voice === "mine" ? doctorNoteTitle : voice === "neutral" ? "What the doctor said" : `What ${voice.name}’s doctor said`;
/** The line under the contraction timer. */
export const careTeamLine = (voice: Voice = "mine") => voice === "mine" ? "This timer records contractions. Your care team tells you when to call or go in."
  : voice === "neutral" ? "This timer records contractions. The care team says when to call or go in."
  : `This timer records contractions. ${voice.name}’s care team says when to call or go in.`;
/** The hospital bag's two people-sections. On her partner's phone "For you" is for him, and she's by name. */
export function bagSectionTitle(id: string, title: string, voice: Voice = "mine") {
  if (voice === "mine" || (id !== "mom" && id !== "partner")) return title;
  if (id === "mom") return voice === "neutral" ? "For the person giving birth" : `For ${voice.name}`;
  return voice === "neutral" ? "For their partner" : "For you";
}
export function bagAddLabel(id: string, add: string, voice: Voice = "mine") {
  if (voice === "mine" || (id !== "mom" && id !== "partner")) return add;
  const who = bagSectionTitle(id, "", voice).replace(/^For /, "");
  return `Add something for ${who}`;
}
/** "Add where you plan to deliver", for whoever it's about. */
export const deliveryRowTitle = (voice: Voice = "mine") => voice === "mine" ? "Add where you plan to deliver"
  : voice === "neutral" ? "Add where the baby will be born" : `Add where ${voice.name} plans to deliver`;
/** The bag's opening line, with the people it's for. */
export const bagIntro = (voice: Voice = "mine") => voice === "mine"
  ? "Start with a list of what most people bring for the birth: things for you, for baby, for your partner, and the papers. Tick things off as you pack, and change anything to suit you and your hospital."
  : `Start with a list of what most people bring for the birth: things for ${voice === "neutral" ? "the person giving birth, for baby, for their partner" : `${voice.name}, for baby, for you`}, and the papers. Tick things off as they’re packed, and change anything to suit the hospital.`;
