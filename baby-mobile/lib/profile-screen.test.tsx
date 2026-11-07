import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ params: {} as { open?: string }, boot: {} as any, profile: vi.fn(), contacts: vi.fn(), toast: vi.fn(), back: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", useWindowDimensions: () => ({ fontScale: 1 }) }));
vi.mock("expo-router", () => ({ router: { back: f.back }, useLocalSearchParams: () => f.params }));
vi.mock("@/components/disclosure", () => ({ Disclosure: "Disclosure" }));
vi.mock("@/lib/context", () => ({ useBaby: () => ({ state: { bootstrap: f.boot }, api: { profile: f.profile, contacts: f.contacts }, commit: async (change: (s: any) => any) => { f.boot = change({ bootstrap: f.boot }).bootstrap; } }) }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/components/ui", () => ({ Button: "Button", Copy: "Copy", Field: "Field", Notice: "Notice", Screen: ({ children, footer }: { children: unknown; footer: unknown }) => [children, footer], useToast: () => f.toast }));
import ProfileDetails from "../app/profile";

let view: ReactTestRenderer;
const fields = () => view.root.findAll((n) => String(n.type) === "Field");
const sections = () => view.root.findAll((n) => String(n.type) === "Disclosure").map((n) => n.props.title);
const opened = () => view.root.findAll((n) => String(n.type) === "Disclosure" && n.props.startOpen).map((n) => n.props.title);
const type = (index: number, text: string) => act(async () => fields()[index].props.onChange(text));
const save = () => act(async () => view.root.findByType("Button" as React.ElementType).props.onPress());
const open = async (extra: object) => {
  f.boot = { generation: 2, profile: { display_name: "", timezone: "Pacific/Guam", ai_consent: true }, children: [{ id: "e", name: "Noa", due_date: "2030-01-01" }], ...extra };
  await act(async () => { view = create(<ProfileDetails />); });
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  f.profile.mockReset().mockImplementation(async (value: object) => value);
  f.contacts.mockReset().mockImplementation(async (value: object) => ({ ...f.boot.contacts, ...value }));
  f.toast.mockClear(); f.back.mockClear(); f.params = {};
});

it("against an API that doesn't keep contacts, asks for her name only and never calls for them", async () => {
  await open({});
  expect(fields().map((n) => n.props.label)).toEqual(["Your name"]);
  expect(fields()[0].props.autoFocus).toBe(true);
  await type(0, " Kami ");
  await save();
  expect(f.profile.mock.calls[0][0]).toEqual({ display_name: "Kami", timezone: expect.any(String) });
  expect(f.contacts).not.toHaveBeenCalled();
  expect(f.back).toHaveBeenCalled();
});
it("sends only the contact she touched, so another phone's edit stays", async () => {
  await open({ contacts: { delivery: { name: "GMH", phone: "671-555-0103" } } });
  expect(sections()).toEqual(["Your doctor", "Where you plan to deliver"]);
  await type(1, "Dr. Cruz");
  await type(2, "671-555-0101");
  await save();
  expect(f.contacts).toHaveBeenCalledWith({ doctor: { name: "Dr. Cruz", phone: "671-555-0101" } }, 2);
  expect(f.boot.contacts).toEqual({ doctor: { name: "Dr. Cruz", phone: "671-555-0101" }, delivery: { name: "GMH", phone: "671-555-0103" } });
});
it("sends the latest of what she didn't touch, not what was there when the screen opened", async () => {
  await open({ contacts: { doctor: { name: "Dr. A", phone: "671-555-0101" }, delivery: { name: "GMH", phone: "671-555-0103" } } });
  // Another phone saves a new doctor, and this phone hears about it while the screen is open.
  f.boot = { ...f.boot, contacts: { doctor: { name: "Dr. B", phone: "671-555-0199" }, delivery: { name: "Naval", phone: "671-555-0177" } } };
  await act(async () => { view.update(<ProfileDetails />); });
  expect(fields()[2].props.value).toBe("671-555-0199");
  await type(1, "Dr. Bea");
  await save();
  expect(f.contacts).toHaveBeenCalledWith({ doctor: { name: "Dr. Bea", phone: "671-555-0199" } }, 2);
});
it("sends neither a name nor permission she didn't edit", async () => {
  await open({ contacts: {} });
  await save();
  expect(f.profile.mock.calls[0][0]).toEqual({ timezone: expect.any(String) });
});
it("doesn't send a profile contact save when nothing changed", async () => {
  await open({ contacts: { doctor: { name: "Dr. Cruz", phone: "671-555-0101" } } });
  await save();
  expect(f.profile).toHaveBeenCalled();
  expect(f.contacts).not.toHaveBeenCalled();
});
it("clears a contact when both boxes are emptied", async () => {
  await open({ contacts: { doctor: { name: "Dr. Cruz", phone: "671-555-0101" } } });
  await type(1, "");
  await type(2, "");
  await save();
  expect(f.contacts).toHaveBeenCalledWith({ doctor: null }, 2);
});
it("keeps what she typed and says so kindly when a number can't be dialled", async () => {
  await open({ contacts: {} });
  await type(2, "soon");
  await save();
  expect(f.profile).not.toHaveBeenCalled();
  expect(f.back).not.toHaveBeenCalled();
  expect(fields()[2].props.value).toBe("soon");
  expect(view.root.findAll((n) => String(n.type) === "Notice")[0].props.children).toMatch(/Try just the digits/);
});
it("turns down a pasted name with a line break, kindly", async () => {
  await open({ contacts: {} });
  await type(1, "Dr.\nCruz");
  await save();
  expect(f.profile).not.toHaveBeenCalled();
  expect(view.root.findAll((n) => String(n.type) === "Notice")[0].props.children).toMatch(/line break/);
});
it("shows a caregiver neither, unless one is already saved", async () => {
  const spaces = [{ id: "p", kind: "personal" }, { id: "f", kind: "family", role: "caregiver" }];
  await open({ contacts: {}, spaces });
  expect(sections()).toEqual([]);
  await open({ contacts: { doctor: { phone: "671-555-0101" } }, spaces });
  expect(sections()).toEqual(["Your doctor"]);
});
it("asks for where she plans to deliver only until the baby's here", async () => {
  await open({ contacts: {}, children: [{ id: "b", name: "Kai", birth_date: "2026-01-01" }] });
  expect(sections()).toEqual(["Your doctor"]);
});
it("keeps empty sections shut, and opens the one she came for or one already filled in", async () => {
  await open({ contacts: {} });
  expect(opened()).toEqual([]);
  f.params = { open: "delivery" };
  await open({ contacts: { doctor: { phone: "671-555-0101" } } });
  expect(opened()).toEqual(["Your doctor", "Where you plan to deliver"]);
  expect(fields()[0].props.autoFocus).toBe(false);
});

it("uses a phone refresh received while the name request is in flight", async () => {
  await open({ contacts: { doctor: { name: "Dr. A", phone: "671-555-0101" } } });
  await type(1, "Dr. Edited");
  let finish!: (value: object) => void;
  f.profile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => { void view.root.findByType("Button" as React.ElementType).props.onPress(); });
  f.boot = { ...f.boot, contacts: { doctor: { name: "Dr. B", phone: "671-555-0199" } } };
  await act(async () => view.update(<ProfileDetails />));
  await act(async () => finish({ display_name: "", timezone: "Pacific/Guam" }));
  expect(f.contacts).toHaveBeenCalledWith({ doctor: { name: "Dr. Edited", phone: "671-555-0199" } }, 2);
});
