import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ open: vi.fn(async (_url: string) => undefined as unknown), toast: vi.fn(), push: vi.fn(), account: null as null | { state: { bootstrap?: unknown } } }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Linking: { openURL: mock.open }, useWindowDimensions: () => ({ fontScale: 1 }) }));
vi.mock("expo-router", () => ({ router: { push: mock.push } }));
// Not the API, and no account to start with: the screen has to open with no account data and no signal.
vi.mock("@/lib/context", () => ({ useBabyIfSignedIn: () => mock.account }));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/components/call-contact", () => import("../components/call-contact"));
vi.mock("@/lib/medical-wording", () => import("./medical-wording"));
vi.mock("@/components/ui", () => ({ Button: "Button", Copy: "Copy", QuietRow: "QuietRow", Screen: "Screen", Section: "Section", useToast: () => mock.toast }));
vi.mock("../components/ui", () => ({ Copy: "Copy", Icon: "Icon", PressTarget: "PressTarget", fonts: {}, useColors: () => ({}) }));
vi.mock("@/components/disclosure", () => import("../components/disclosure"));
vi.mock("@/components/medical-source", () => import("../components/medical-source"));
import Help from "../app/help";
import { cdcUrgentClosing, cdcUrgentOpening, cdcUrgentSigns, cdcWarningSignsSource, cdcWarningSignsUrl, helpLines } from "./medical-wording";

let renderer: ReactTestRenderer | undefined;
const buttons = () => renderer!.root.findAll((n) => String(n.type) === "Button");
const copy = () => renderer!.root.findAll((n) => String(n.type) === "Copy").map((n) => n.props.children);
const press = (label: string) => act(async () => buttons().find((n) => n.props.title === label)!.props.onPress());
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.spyOn(console, "error").mockImplementation(() => undefined);
  mock.open.mockReset().mockResolvedValue(undefined); mock.toast.mockClear(); mock.push.mockClear(); mock.account = null;
  await act(async () => { renderer = create(<Help />); });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("calls and texts the numbers it lists, each one tappable", async () => {
  const expected: [string, string][] = [
    ["Call 911", "tel:911"], ["Call 988", "tel:988"], ["Text 988", "sms:988"],
    ["Call 1-833-TLC-MAMA (1-833-852-6262)", "tel:18338526262"], ["Text 1-833-TLC-MAMA (1-833-852-6262)", "sms:18338526262"],
  ];
  expect(buttons().map((n) => n.props.title)).toEqual(expected.map(([label]) => label));
  for (const [label, url] of expected) {
    await press(label);
    expect(mock.open).toHaveBeenLastCalledWith(url);
  }
});
const signedIn = async (bootstrap: object) => {
  mock.account = { state: { bootstrap: { profile: { timezone: "Pacific/Guam" }, children: [], ...bootstrap } } };
  await act(async () => { renderer!.update(<Help />); });
};
const quiet = () => renderer!.root.findAll((n) => String(n.type) === "QuietRow").map((n) => n.props.title);
const expecting = { id: "b", name: "Noa", due_date: "2030-01-01" };
const hasContacts = { doctor: { name: "Dr. Cruz", phone: "671-555-0101" }, delivery: { name: "Guam Memorial", phone: "671-555-0103" } };
it("with an API that doesn't keep them, shows and asks nothing new, signed in or not", async () => {
  const before = buttons().map((n) => n.props.title);
  await signedIn({ children: [expecting] });
  expect(buttons().map((n) => n.props.title)).toEqual(before);
  expect(quiet()).toEqual([]);
});
it("keeps 911, 988 and the hotline first, in their order, with her own numbers after, each dialling only digits", async () => {
  await signedIn({ contacts: hasContacts, children: [{ ...expecting, details: { doctor: { name: "Dr. Lee", phone: "(671) 555-0102 ext 4" } } }] });
  expect(buttons().map((n) => n.props.title)).toEqual(["Call 911", "Call 988", "Text 988", "Call 1-833-TLC-MAMA (1-833-852-6262)", "Text 1-833-TLC-MAMA (1-833-852-6262)", "Call Dr. Cruz\n671-555-0101", "Call Dr. Lee\n(671) 555-0102 ext 4", "Call Guam Memorial\n671-555-0103"]);
  await press("Call Dr. Lee\n(671) 555-0102 ext 4");
  expect(mock.open).toHaveBeenLastCalledWith("tel:6715550102");
  expect(copy()).toEqual(expect.arrayContaining(["Your doctor", "Noa’s doctor", "Where you plan to deliver"]));
  expect(quiet()).toEqual([]);
});
it("gives their number in words if the device can't dial it", async () => {
  await signedIn({ contacts: hasContacts, children: [expecting] });
  mock.open.mockRejectedValueOnce(Error("no phone"));
  await press("Call Dr. Cruz\n671-555-0101");
  expect(mock.toast.mock.calls[0][0]).toContain("The number is 671-555-0101.");
});
it("offers one quiet line for the next useful number", async () => {
  await signedIn({ contacts: {}, children: [expecting] });
  expect(quiet()).toEqual(["Add your doctor’s number"]);
  await act(async () => renderer!.root.findByType("QuietRow" as React.ElementType).props.onPress());
  expect(mock.push).toHaveBeenLastCalledWith({ pathname: "/profile", params: { open: "doctor" } });
});
it("takes a parent to the baby's doctor on the baby's profile", async () => {
  await signedIn({ contacts: {}, children: [{ id: "b", name: "Noa", birth_date: "2026-01-01" }] });
  expect(quiet()).toEqual(["Add Noa’s doctor"]);
  await act(async () => renderer!.root.findByType("QuietRow" as React.ElementType).props.onPress());
  expect(mock.push).toHaveBeenLastCalledWith({ pathname: "/child", params: { id: "b", doctor: "1" } });
});
it("lets a caregiver call the baby's doctor, and asks them for nothing", async () => {
  await signedIn({ contacts: {}, personal_space_id: "p", spaces: [{ id: "p", kind: "personal" }, { id: "f", kind: "family", role: "caregiver" }],
    children: [{ id: "b", name: "Noa", space_id: "f", birth_date: "2026-01-01", details: { doctor: { phone: "671-555-0102" } } }] });
  expect(buttons().map((n) => n.props.title)).toContain("Call 671-555-0102");
  expect(quiet()).toEqual([]);
});
it("gives the number in words if the device can't dial it", async () => {
  mock.open.mockRejectedValueOnce(Error("no phone"));
  await press("Call 911");
  expect(mock.toast.mock.calls[0][0]).toContain("The number is 911.");
});
it("has CDC's 15 signs in order, each opening CDC's own detail, with attribution and a link", async () => {
  expect(cdcUrgentSigns).toHaveLength(15);
  const titled = renderer!.root.findAll((n) => String(n.type) === "Pressable").filter((n) => cdcUrgentSigns.some((sign) => sign.title === n.props.accessibilityLabel));
  expect(titled.map((n) => n.props.accessibilityLabel)).toEqual(cdcUrgentSigns.map((sign) => sign.title));
  expect(copy()).not.toContain(cdcUrgentSigns[10].detail);
  await act(async () => titled[10].props.onPress());
  expect(copy()).toContain(cdcUrgentSigns[10].detail);
  expect(cdcUrgentSigns[10].detail).toContain("There is no specific number of movements that is considered normal.");
  const source = renderer!.root.findAll((n) => String(n.type) === "PressTarget").find((n) => n.props.accessibilityLabel === `Source: ${cdcWarningSignsSource}`)!;
  await act(async () => source.props.onPress());
  expect(mock.open).toHaveBeenLastCalledWith(cdcWarningSignsUrl);
});
it("says nothing of ours: every line of text is CDC's or a service's own name", () => {
  const allowed = new Set([cdcUrgentOpening, cdcUrgentClosing, ...cdcUrgentSigns.flatMap((sign) => [sign.title, sign.detail]), ...helpLines.flatMap((line) => line.note ? [line.note] : []), ...helpLines.map((line) => line.name), cdcWarningSignsSource, "988lifeline.org", "HRSA"]);
  for (const text of copy()) expect(allowed, String(text)).toContain(text);
});
it("keeps CDC's sentences word for word", () => {
  expect(cdcUrgentOpening).toBe("Urgent maternal warning signs, during pregnancy and in the year after delivery. Seek medical care immediately if you experience any signs or symptoms that are listed below. The symptoms below can be a sign of a life-threatening condition.");
  expect(cdcUrgentSigns[3]).toEqual({ title: "Fever of 100.4°F or higher", detail: "You have a temperature of 100.4°F (38°C) or higher." });
  expect(cdcUrgentSigns[5].title).toBe("Thoughts about harming yourself or your baby");
});

it("says the maternal hotline's connection from Guam isn't confirmed, until a Guam test is recorded", () => {
  const hotline = helpLines.find((line) => line.name === "National Maternal Mental Health Hotline")!;
  expect(hotline.note).toMatch(/Guam/);
  expect(copy()).toContain(hotline.note);
});
