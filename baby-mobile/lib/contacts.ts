import type { Bootstrap, CareContact, Child } from "./models";
import { babyLabel, isCaregiver } from "./spaces";
import { todayStage, trackerStage } from "./timing";

type Account = Pick<Bootstrap, "contacts" | "children" | "spaces" | "personal_space_id"> | null | undefined;
export interface CallLine { key: string; heading: string; contact: CareContact }
export interface ContactPrompt { title: string; child?: string; open?: "doctor" | "delivery" }

/** Only an API that keeps them says it has them. Older ones drop them, so until then nothing here is asked for or shown. */
export const contactsOn = (bootstrap: Pick<Bootstrap, "contacts"> | null | undefined) => !!bootstrap?.contacts;

const withoutExtension = (phone: string) => phone.replace(/\s*(?:x|ext).*$/i, "");
const digitsIn = (phone: string) => phone.replace(/\D/g, "");
/** Any layout is fine, since Guam and US numbers both occur, with or without the area code. It only has to be dialable. */
export function phoneProblem(phone: string) {
  const typed = phone.trim();
  if (!typed) return "";
  const digits = digitsIn(withoutExtension(typed)).length;
  return /^\+?[\d\s().\-/]+?(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?$/i.test(typed) && digits >= 7 && digits <= 15 ? "" : "That number doesn’t look right. Try just the digits, like 671-555-0100.";
}
/** Digits and a leading plus, so what she typed can only ever dial a number. */
export function dialUrl(phone: string | null | undefined) {
  const main = withoutExtension(phone ?? "").trim(), digits = digitsIn(main);
  return digits ? `tel:${main.startsWith("+") ? "+" : ""}${digits}` : null;
}
/** What the button says is what she typed, and nothing more. */
export const callLabel = ({ name, phone }: CareContact) => (name?.trim() ? `Call ${name.trim()}\n${phone}` : `Call ${phone}`);
/** What goes to the API from two boxes: null if both are empty, which clears it. */
export function contactFrom(name: string, phone: string): CareContact | null {
  const n = name.trim(), p = phone.trim();
  return n || p ? { ...(n ? { name: n } : {}), ...(p ? { phone: p } : {}) } : null;
}
export const sameContact = (saved: CareContact | null | undefined, next: CareContact | null) =>
  (saved?.name ?? "") === (next?.name ?? "") && (saved?.phone ?? "") === (next?.phone ?? "");

/** Anyone not known to be born, since a profile with no dates yet may well be a pregnancy. */
const expecting = (bootstrap: Account, today: Date) => (bootstrap?.children ?? []).some((child) => todayStage(child, today) !== "baby");
const dialable = (contact: CareContact | null | undefined): contact is CareContact => !!contact?.phone;

/** Where she plans to deliver only matters until the baby's here. Saved, it stays editable in Your details. */
export const deliveryMatters = (bootstrap: Account, today: Date) => !isCaregiver(bootstrap) && (!bootstrap?.children.length || expecting(bootstrap, today));
/** Her own doctor means nothing to the app for someone who's only helping with a baby. */
export const herDoctorMatters = (bootstrap: Account) => !isCaregiver(bootstrap);

/** A baby's doctor, once however many babies share them. */
function babyDoctors(bootstrap: Account) {
  const groups = new Map<string, { names: string[]; contact: CareContact }>();
  for (const child of bootstrap?.children ?? []) {
    const doctor = child.details?.doctor;
    if (!dialable(doctor)) continue;
    const key = digitsIn(doctor.phone!), found = groups.get(key);
    if (found) found.names.push(babyLabel(child, bootstrap));
    else groups.set(key, { names: [babyLabel(child, bootstrap)], contact: doctor });
  }
  return [...groups.entries()].map(([key, { names, contact }]) => ({ key: `baby:${key}`, heading: `${names.join(" and ")}’s doctor`, contact }));
}
/** The numbers Help offers, under the ones everyone gets. */
export function callLines(bootstrap: Account, today: Date): CallLine[] {
  const mine = bootstrap?.contacts;
  return [
    ...(dialable(mine?.doctor) ? [{ key: "doctor", heading: "Your doctor", contact: mine.doctor }] : []),
    ...babyDoctors(bootstrap),
    ...(dialable(mine?.delivery) && deliveryMatters(bootstrap, today) ? [{ key: "delivery", heading: "Where you plan to deliver", contact: mine.delivery }] : []),
  ];
}
/** The contraction timer's one number. */
export const deliveryLine = (bootstrap: Account): CallLine | null =>
  dialable(bootstrap?.contacts?.delivery) ? { key: "delivery", heading: "Where you plan to deliver", contact: bootstrap.contacts.delivery } : null;
/**
 * The one thing worth adding next, as a single quiet line. Whoever's expecting starts with her own doctor, and once a baby's
 * here, theirs. Nothing to a caregiver about a baby they can't change.
 */
export function nextContactPrompt(bootstrap: Account, today: Date, canChange: (child: Child) => boolean): ContactPrompt | null {
  if (!contactsOn(bootstrap) || isCaregiver(bootstrap)) return null;
  const mine = bootstrap!.contacts!, babies = bootstrap!.children.filter(canChange),
    baby = babies.find((child) => trackerStage(child, today) === "born" && !child.details?.doctor?.phone),
    doctor = !mine.doctor?.phone ? { title: "Add your doctor’s number", open: "doctor" as const } : null,
    delivery = deliveryMatters(bootstrap, today) && !mine.delivery?.phone ? { title: "Add where you plan to deliver", open: "delivery" as const } : null,
    babyPrompt = baby ? { title: `Add ${babyLabel(baby, bootstrap)}’s doctor`, child: baby.id } : null;
  return expecting(bootstrap, today) || !babies.length ? doctor ?? delivery ?? babyPrompt : babyPrompt ?? doctor;
}
/** Who a summary's page is for: the baby's doctor once they're here, and before that hers. A caregiver has only the baby's. */
export function summaryDoctor(child: Pick<Child, "birth_date" | "details"> | null, bootstrap: Account): CareContact | null {
  const doctor = child?.birth_date || isCaregiver(bootstrap) ? child?.details?.doctor : bootstrap?.contacts?.doctor;
  return doctor?.name || doctor?.phone ? doctor : null;
}
export const contactWords = ({ name, phone }: CareContact) => [name, phone].filter(Boolean).join(" · ");
