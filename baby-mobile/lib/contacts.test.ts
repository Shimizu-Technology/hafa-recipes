import { describe, expect, it } from "vitest";
import { summaryHtml, withDoctor } from "./doctor-summary";
import { callLabel, callLines, contactFrom, contactsOn, deliveryLine, dialUrl, nextContactPrompt, phoneProblem, sameContact, summaryDoctor } from "./contacts";

const today = new Date(2026, 10, 6);
const expecting = { id: "e", name: "Noa", birth_date: null, due_date: "2026-12-10", revision: 1 };
const born = { id: "b", name: "Kai", birth_date: "2026-01-01", due_date: null, revision: 1 };
const account = (extra: object = {}) => ({ profile: {}, children: [], generation: 1, contacts: {}, ...extra }) as never;
const change = () => true;

describe("phone numbers", () => {
  it.each(["671-555-0100", "(671) 555-0100", "+1 671 555 0100", "6715550100", "555-0100", "671.555.0100", "671-555-0100 ext 12", "671-555-0100 x12", "", "   "])("takes %s", (phone) => {
    expect(phoneProblem(phone)).toBe("");
  });
  it.each(["12345", "call the office", "671-555-0100; drop", "tel:6715550100", "1".repeat(16), "1-800-FLOWERS"])("kindly turns down %s", (phone) => {
    expect(phoneProblem(phone)).toMatch(/Try just the digits/);
  });
  it.each([
    ["671-555-0100", "tel:6715550100"], ["(671) 555-0100", "tel:6715550100"], ["+1 671 555 0100", "tel:+16715550100"], ["671-555-0100 ext 12", "tel:6715550100"], ["671 x12", "tel:671"],
  ])("dials only digits for %s", (phone, url) => expect(dialUrl(phone)).toBe(url));
  it("can't be made to do anything but dial", () => {
    expect(dialUrl("671;phone-context=evil?a=b#c")).toBe("tel:671");
    expect(dialUrl("")).toBeNull();
    expect(dialUrl(undefined)).toBeNull();
  });
  it("labels a call with only what she typed", () => {
    expect(callLabel({ name: " Dr. Cruz ", phone: "671-555-0100" })).toBe("Call Dr. Cruz\n671-555-0100");
    expect(callLabel({ phone: "671-555-0100" })).toBe("Call 671-555-0100");
  });
  it("turns two empty boxes into a clear", () => {
    expect(contactFrom(" ", "")).toBeNull();
    expect(contactFrom(" Dr. Cruz ", "")).toEqual({ name: "Dr. Cruz" });
    expect(sameContact(undefined, null)).toBe(true);
    expect(sameContact({ name: "A" }, { name: "A", phone: "1" })).toBe(false);
  });
});

describe("where they show", () => {
  it("is nowhere until the API says it keeps them", () => {
    const old = { profile: {}, children: [expecting], generation: 1 } as never;
    expect(contactsOn(old)).toBe(false);
    expect(nextContactPrompt(old, today, change)).toBeNull();
    expect(callLines(old, today)).toEqual([]);
  });
  it("offers no call without a number", () => {
    expect(callLines(account({ contacts: { doctor: { name: "Dr. Cruz" } }, children: [{ ...born, details: { doctor: { name: "Dr. Lee" } } }] }), today)).toEqual([]);
  });
  it("drops where she planned to deliver from Help once the baby's here", () => {
    const delivery = { name: "GMH", phone: "671-555-0103" };
    expect(callLines(account({ contacts: { delivery }, children: [expecting] }), today).map((line) => line.key)).toEqual(["delivery"]);
    expect(callLines(account({ contacts: { delivery }, children: [] }), today).map((line) => line.key)).toEqual(["delivery"]);
    expect(callLines(account({ contacts: { delivery }, children: [born] }), today)).toEqual([]);
    expect(callLines(account({ contacts: { delivery }, children: [{ id: "n", name: "No dates", revision: 1 }] }), today).map((line) => line.key)).toEqual(["delivery"]);
    expect(callLines(account({ contacts: { delivery }, children: [{ ...expecting, due_date: "2025-01-01" }] }), today).map((line) => line.key)).toEqual(["delivery"]);
    expect(deliveryLine(account({ contacts: { delivery } }))?.contact).toEqual(delivery);
  });
  it("shows a doctor two babies share once, named for both", () => {
    const doctor = { name: "Dr. Lee", phone: "(671) 555-0102" }, same = { name: "Dr. Lee", phone: "671-555-0102" };
    expect(callLines(account({ children: [{ ...born, details: { doctor } }, { ...expecting, details: { doctor: same } }] }), today).map((line) => line.heading)).toEqual(["Kai and Noa’s doctor"]);
  });
  it("asks for one thing at a time, in the order that fits the stage", () => {
    const doctor = { phone: "671-555-0101" };
    expect(nextContactPrompt(account({ children: [expecting] }), today, change)?.title).toBe("Add your doctor’s number");
    expect(nextContactPrompt(account({ children: [expecting], contacts: { doctor } }), today, change)?.title).toBe("Add where you plan to deliver");
    expect(nextContactPrompt(account({ children: [born] }), today, change)).toEqual({ title: "Add Kai’s doctor", child: "b" });
    expect(nextContactPrompt(account({ children: [{ ...born, details: { doctor } }] }), today, change)?.title).toBe("Add your doctor’s number");
    expect(nextContactPrompt(account({ children: [] }), today, change)?.title).toBe("Add your doctor’s number");
    expect(nextContactPrompt(account({ children: [{ ...born, details: { doctor } }], contacts: { doctor } }), today, change)).toBeNull();
  });
  it("names a page for her doctor before the birth and the baby's after", () => {
    const hers = { name: "Dr. Cruz" }, theirs = { name: "Dr. Lee" };
    expect(summaryDoctor({ birth_date: null, details: { doctor: theirs } }, account({ contacts: { doctor: hers } }))).toEqual(hers);
    expect(summaryDoctor({ birth_date: "2026-01-01", details: { doctor: theirs } }, account({ contacts: { doctor: hers } }))).toEqual(theirs);
    expect(summaryDoctor({ birth_date: "2026-01-01", details: {} }, account({ contacts: { doctor: hers } }))).toBeNull();
    expect(summaryDoctor({ birth_date: null, details: { doctor: theirs } }, account({ contacts: { doctor: hers }, spaces: [{ id: "f", kind: "family", role: "caregiver" }] }))).toEqual(theirs);
    expect(summaryDoctor(null, account({ contacts: { doctor: hers } }))).toEqual(hers);
  });
});

describe("the doctor on a summary's page", () => {
  const page = summaryHtml({ stats: null, child: null, timezone: "Pacific/Guam", prepared: new Date(2026, 10, 6), questions: [], notes: [] });
  it("is left off unless it's asked for", () => expect(withDoctor(page, null)).toBe(page));
  it("is what she typed, escaped, under the heading", () => {
    const html = withDoctor(page, { name: "Dr. <b>Cruz</b> $& Co", phone: "671-555-0101" });
    expect(html).toContain("</h1><p>For Dr. &lt;b&gt;Cruz&lt;/b&gt; $&amp; Co · 671-555-0101</p>");
  });
});
