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

/**
 * Before 37 weeks there's no pattern to wait for: the preterm notice says don't wait, so "5-1-1" isn't shown, and nor
 * is it when the week isn't known. `name` is whose labor it is, on someone else's phone.
 */
export const whenToCall = (week: number | undefined, name?: string) => {
  const shown = name ? about(name) : lines;
  return week !== undefined && week >= 37 ? shown : [shown[0], shown[2]];
};

/**
 * On someone else's phone in the family: the person expecting, by id and name. Only when whoever added the pregnancy
 * is clearly the other parent, an active parent in this family who isn't this phone's owner; otherwise null, and the
 * screen keeps its everyday words. Null too until the family has been read.
 */
export function supporting(child: { created_by?: string | null } | null | undefined, owner: string | null | undefined,
  people: Record<string, string> | undefined, members: readonly { app_user_id: string; role: string; status: string }[] | null) {
  const id = child?.created_by;
  if (!id || id === owner || !members?.some((member) => member.app_user_id === id && member.role === "parent" && member.status === "active")) return null;
  return { id, name: people?.[id]?.trim() || "" };
}
