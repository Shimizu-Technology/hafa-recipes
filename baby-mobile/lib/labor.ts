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

/**
 * Before 37 weeks there's no pattern to wait for: the preterm notice says don't wait, so "5-1-1" isn't shown, and nor
 * is it when the week isn't known.
 */
export const whenToCall = (week: number | undefined) => week !== undefined && week >= 37 ? lines : [lines[0], lines[2]];
