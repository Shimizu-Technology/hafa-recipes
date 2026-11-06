import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ boot: {} as any, profile: vi.fn(), toast: vi.fn(), back: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", useWindowDimensions: () => ({ fontScale: 1 }) }));
vi.mock("expo-router", () => ({ router: { back: f.back } }));
vi.mock("@/lib/context", () => ({ useBaby: () => ({ state: { bootstrap: f.boot }, api: { profile: f.profile }, commit: async (change: (s: any) => any) => { f.boot = change({ bootstrap: f.boot }).bootstrap; } }) }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/components/ui", () => ({ Button: "Button", Copy: "Copy", Field: "Field", Notice: "Notice", Screen: ({ children, footer }: { children: unknown; footer: unknown }) => [children, footer], useToast: () => f.toast }));
import ProfileDetails from "../app/profile";

let view: ReactTestRenderer;
const field = () => view.root.findByType("Field" as React.ElementType);
const save = () => act(async () => view.root.findByType("Button" as React.ElementType).props.onPress());
const open = async (name: string) => {
  f.boot = { generation: 2, profile: { display_name: name, timezone: "Pacific/Guam", ai_consent: true }, children: [] };
  await act(async () => { view = create(<ProfileDetails />); });
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  f.profile.mockReset().mockImplementation(async (value: object) => value);
  f.toast.mockClear(); f.back.mockClear();
});

it("saves her name and time zone as before, and goes back", async () => {
  await open("");
  expect(field().props.autoFocus).toBe(true);
  await act(async () => field().props.onChange(" Kami "));
  await save();
  expect(f.profile.mock.calls[0][0]).toMatchObject({ display_name: "Kami", ai_consent: true });
  expect(f.profile.mock.calls[0][0].timezone).toBeTruthy();
  expect(f.boot.profile.display_name).toBe("Kami");
  expect(f.back).toHaveBeenCalled();
});
it("doesn't jump into the keyboard when she already has a name", async () => {
  await open("Kami");
  expect(field().props.autoFocus).toBe(false);
});
it("stays put and says what went wrong if it can't save", async () => {
  await open("Kami");
  f.profile.mockRejectedValueOnce(Error("Couldn’t save"));
  await save();
  expect(f.back).not.toHaveBeenCalled();
  expect(view.root.findByType("Notice" as React.ElementType).props.children).toBe("Couldn’t save");
});
