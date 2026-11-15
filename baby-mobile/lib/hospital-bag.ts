import type { BabyRecord, RecordData } from "./models";

/**
 * The hospital bag is an ordinary checklist routine, so it syncs, is shared with the family like any list, and opens
 * in Lists & routines too. What makes it the bag is its items' ids: `bag:<section>:<key>`. The API keeps item ids as
 * they are and allows nothing else on an item, so the section rides in the id. An item added in the ordinary routine
 * editor has a plain id, and shows under "Also packing".
 */
export const bagSections = [
  { id: "mom", title: "For you", add: "Add something for you" },
  { id: "baby", title: "For baby", add: "Add something for baby" },
  { id: "partner", title: "For your partner", add: "Add something for your partner" },
  { id: "papers", title: "Papers & phone", add: "Add a paper or something else to bring" },
] as const;
export type BagSection = (typeof bagSections)[number]["id"];
export const otherSection = { id: "other", title: "Also packing" } as const;

/**
 * A starting point, not a rule: hospitals differ and many give pads, diapers and gowns. Written from the usual
 * packing lists (ACOG, Mayo Clinic, NHS), with nothing medical in it. Every line can be unticked, changed or removed.
 */
export const starterBag: Record<BagSection, [key: string, label: string][]> = {
  mom: [
    ["robe", "Robe or loose, comfortable clothes"],
    ["bras", "Two nursing or soft bras"],
    ["underwear", "Comfortable high-waisted underwear"],
    ["pads", "Maternity pads (the hospital may give some)"],
    ["socks", "Warm socks and slippers"],
    ["toiletries", "Toothbrush, lip balm, hair ties and toiletries"],
    ["glasses", "Glasses or contacts"],
    ["pillow", "Your own pillow, in a coloured pillowcase"],
    ["snacks", "Snacks and a water bottle"],
    ["outfit", "Loose going-home outfit"],
  ],
  baby: [
    ["car-seat", "Rear-facing car seat, installed before the day"],
    ["outfit", "Going-home outfit in newborn and 0–3 month sizes"],
    ["hat", "Hat, socks or mittens"],
    ["blanket", "Swaddle or blanket for the ride home"],
    ["diapers", "A few diapers and wipes"],
  ],
  partner: [
    ["clothes", "Change of clothes and toiletries"],
    ["snacks", "Snacks and drinks"],
    ["medicines", "Their own medicines"],
    ["money", "Card or cash for parking and food"],
    ["pillow", "Pillow and a light blanket"],
  ],
  papers: [
    ["id", "Photo ID and insurance card"],
    ["registration", "Hospital pre-registration papers"],
    ["plan", "Birth plan, if you have one"],
    ["medicines", "List of your medicines and allergies"],
    ["pediatrician", "Your baby’s doctor’s name and number"],
    ["charger", "Phone charger with a long cable"],
    ["headphones", "Headphones"],
  ],
};

export const bagTitle = "Hospital bag";
export const bagItemId = (section: BagSection, key: string) => `bag:${section}:${key}`;
export function sectionOf(id: string): BagSection | "other" {
  const [prefix, section] = id.split(":");
  return prefix === "bag" && bagSections.some((one) => one.id === section) ? section as BagSection : "other";
}
/** Its own items say so, or (once she's removed every one of them) its title still does, so the bag never vanishes. */
export const isBag = (record: BabyRecord) => record.kind === "routine" && record.data.routine_type === "checklist" &&
  ((record.data.items ?? []).some((item) => item.id.startsWith("bag:")) || record.title === bagTitle);

const fromStarter = (record: BabyRecord) => (record.data.items ?? []).some((item) => item.id.startsWith("bag:"));
/**
 * Every bag-like list, the one to show first first: one started from the starter list, newest first, then any list she
 * made herself and called "Hospital bag". Two phones starting one at once each make one. None is ever hidden.
 */
export function findBags(records: BabyRecord[]) {
  return records.filter(isBag).sort((a, b) => Number(fromStarter(b)) - Number(fromStarter(a)) || (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
}
/** The bag the screen is built around. The rest are shown under it. */
export const findBag = (records: BabyRecord[]) => findBags(records)[0];
export function starterItems(): NonNullable<RecordData["items"]> {
  return bagSections.flatMap((section) => starterBag[section.id].map(([key, label]) => ({ id: bagItemId(section.id, key), label, done: false })));
}
export function grouped(record: BabyRecord) {
  const items = record.data.items ?? [];
  return [...bagSections, otherSection].map((section) => ({ ...section, items: items.filter((item) => sectionOf(item.id) === section.id) }))
    .filter((section) => section.id !== "other" || section.items.length);
}
export function packedLine(record: BabyRecord) {
  const items = record.data.items ?? [], done = items.filter((item) => item.done).length;
  if (!items.length) return "Nothing on the list yet";
  return done === items.length ? `All ${items.length} packed` : `${done} of ${items.length} packed`;
}
/** Each change is the whole list, as the routine editor saves it. */
export const toggled = (record: BabyRecord, id: string): RecordData =>
  ({ ...record.data, items: record.data.items?.map((item) => (item.id === id ? { ...item, done: !item.done } : item)) });
export const removed = (record: BabyRecord, id: string): RecordData =>
  ({ ...record.data, items: record.data.items?.filter((item) => item.id !== id) });
export function added(record: BabyRecord, section: BagSection, label: string, key: string): RecordData {
  const items = record.data.items ?? [], at = items.map((item) => sectionOf(item.id)).lastIndexOf(section),
    item = { id: bagItemId(section, key), label: label.trim().slice(0, 500), done: false };
  // After the last of its own section, so it shows where she added it.
  return { ...record.data, items: at < 0 ? [...items, item] : [...items.slice(0, at + 1), item, ...items.slice(at + 1)] };
}
