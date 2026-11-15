import type { Bootstrap, Child } from "./models";

/**
 * Today's "This week" card before the birth, and "Day N" in the first two weeks after it.
 *
 * Each line that states a fact names where it came from, and was checked against that page on 2026-11-15. The
 * to-dos are practical, not medical: none of them activates a schedule or a reminder, and each one opens the
 * place in the app where she'd do it. The "most babies" lines are Leon's Nov 15 decision (they reassure in week 1);
 * they're typical ranges, never a check on her baby's counts, and she can hide them.
 */
export interface Source { name: string; url: string }
export interface Sourced { text: string; source: Source }
export type TodoLink = "bag" | "question" | "baby_doctor" | "delivery";
export interface Todo { id: string; label: string; link: TodoLink }

export const sources = {
  thirdTrimester: { name: "MedlinePlus", url: "https://medlineplus.gov/ency/patientinstructions/000558.htm" },
  carSeat: { name: "AAP, HealthyChildren.org", url: "https://www.healthychildren.org/English/safety-prevention/on-the-go/Pages/Car-Safety-Seats-Information-for-Families.aspx" },
  enoughMilk: { name: "AAP, HealthyChildren.org", url: "https://www.healthychildren.org/English/ages-stages/baby/breastfeeding/Pages/How-to-Tell-if-Baby-is-Getting-Enough-Milk.aspx" },
  newborn: { name: "CDC", url: "https://www.cdc.gov/infant-toddler-nutrition/breastfeeding/newborn-basics.html" },
} satisfies Record<string, Source>;

const everyTwoWeeks: Sourced = { text: "Visits usually come every 2 weeks until week 36.", source: sources.thirdTrimester };
const weekly: Sourced = { text: "From week 36, visits are usually every week.", source: sources.thirdTrimester };
const strepTest: Sourced = { text: "A few weeks before your due date, your provider checks for group B strep. You can ask when yours is.", source: sources.thirdTrimester };
const rearFacing: Sourced = { text: "Babies ride rear-facing from their first ride home. A certified car seat technician can check how it’s installed.", source: sources.carSeat };

const todo = {
  startBag: { id: "bag", label: "Start your hospital bag list", link: "bag" },
  packBag: { id: "bag", label: "Pack your hospital bag, and the car seat", link: "bag" },
  finishBag: { id: "bag", label: "Finish packing your bag", link: "bag" },
  bagReady: { id: "bag", label: "Keep your bag by the door", link: "bag" },
  babyDoctor: { id: "baby_doctor", label: "Choose your baby’s doctor", link: "baby_doctor" },
  delivery: { id: "delivery", label: "Save where you’ll deliver, and their number", link: "delivery" },
  questions: { id: "question", label: "Write down questions for your next visit", link: "question" },
  whenToCall: { id: "question", label: "Ask your provider when to call or come in once contractions start", link: "question" },
} satisfies Record<string, Todo>;

/** From week 28, when a bag and visits every two weeks start to matter. Nothing before that, and nothing past 42. */
export function weekPlan(week: number): { expect: Sourced[]; prepare: Todo[] } | null {
  if (week < 28 || week > 42) return null;
  if (week <= 31) return { expect: [everyTwoWeeks], prepare: [todo.startBag, todo.babyDoctor, todo.questions] };
  if (week <= 33) return { expect: [everyTwoWeeks, rearFacing], prepare: [todo.packBag, todo.babyDoctor, todo.delivery, todo.questions] };
  if (week <= 35) return { expect: [everyTwoWeeks, strepTest, rearFacing], prepare: [todo.packBag, todo.delivery, todo.babyDoctor, todo.questions] };
  if (week <= 37) return { expect: [weekly, strepTest], prepare: [todo.finishBag, todo.whenToCall, todo.delivery, todo.babyDoctor] };
  return { expect: [weekly], prepare: [todo.bagReady, todo.questions, todo.delivery, todo.babyDoctor] };
}

/** Day 1 is the day she was born, as AAP counts "days 1 and 2". */
export function dayOfLife(birthDate: string, today: Date) {
  const [y, m, d] = birthDate.split("-").map(Number);
  if (!y || !m || !d) return null;
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(y, m - 1, d).getTime()) / 86_400_000);
  return days >= 0 ? days + 1 : null;
}

export const typicalNote = "Typical ranges, not a check on your baby. Every baby is different, and your logs may not have everything.";
/** CDC's signs that a baby might not be getting enough, and its next sentence, in one line. */
export const callIf: Sourced = {
  text: "Talk to your baby’s doctor right away if, by 5 days old, there are fewer than 6 pees and fewer than 3 poops a day; if breastfeeding is fewer than 8 times a day most days; if weight keeps dropping after day 5; if the skin looks a bit yellow; or any time you’re worried.",
  source: sources.newborn,
};

/** Days 1 to 14. The diaper lines follow the days AAP names; the feeding line is for a baby who's nursed. */
export function dayPlan(day: number, feeding?: NonNullable<Child["details"]>["feeding"]): Sourced[] | null {
  if (day < 1 || day > 14) return null;
  const lines: Sourced[] = [];
  if (day <= 2) lines.push({ text: "On days 1 and 2, most babies have 1 or 2 poops a day, blackish and tarry.", source: sources.enoughMilk });
  else if (day <= 4) lines.push({ text: "On days 3 and 4, most babies have at least 2 poops a day, turning greenish to yellow.", source: sources.enoughMilk });
  else lines.push({ text: "By 5 to 7 days old, most babies have 6 or more wet diapers a day, with pale yellow pee, and at least 3 to 4 yellow, loose poops.", source: sources.enoughMilk });
  if (feeding !== "bottle") lines.push({ text: "Breastfed newborns nurse at least 8 to 12 times every 24 hours.", source: sources.enoughMilk });
  if (day <= 3) lines.push({ text: "AAP suggests a first checkup no more than 48 hours after you leave the hospital.", source: sources.enoughMilk });
  return lines;
}

/** A to-do she's already done shows as done, from what the app already knows. The bag says how far she's got. */
export function todoDone(item: Todo, bootstrap: Pick<Bootstrap, "contacts"> | null | undefined, child: Pick<Child, "details">) {
  if (item.link === "baby_doctor") return !!child.details?.doctor?.phone;
  if (item.link === "delivery") return !!bootstrap?.contacts?.delivery?.phone;
  return false;
}

export type TodayCard = "this_week" | "day_of_life";
export const hiddenOnToday = (hidden: readonly string[] | undefined, card: TodayCard) => !!hidden?.includes(card);
export const withHidden = (hidden: readonly string[] | undefined, card: TodayCard, hide: boolean) =>
  hide ? [...new Set([...(hidden ?? []), card])] : (hidden ?? []).filter((one) => one !== card);
