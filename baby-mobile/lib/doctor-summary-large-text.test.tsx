import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState } from "./models";

const mock = vi.hoisted(() => ({ fontScale: 1, footer: null as unknown, baby: null as any }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Switch: "Switch", useWindowDimensions: () => ({ fontScale: mock.fontScale }) }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => ({}) }));
vi.mock("@/lib/context", () => ({ useBaby: () => mock.baby }));
vi.mock("@/lib/care-stats", () => import("./care-stats"));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/doctor-summary", () => import("./doctor-summary"));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/use-care-stats", () => ({ useCareStats: () => ({ stats: undefined, loading: false, refresh: vi.fn() }) }));
vi.mock("@/lib/files", () => ({ exportOnePagePdf: vi.fn() }));
vi.mock("@/components/date-field", () => ({ DateField: "DateField" }));
vi.mock("@/components/sync-status", () => ({ SyncStatus: "SyncStatus" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Chips: "Chips", Choice: "Choice", Copy: "Copy", Grouped: "Grouped", Notice: "Notice", Section: "Section", useColors: () => ({}),
  Screen: ({ children, footer }: { children: unknown; footer: unknown }) => { mock.footer = footer; return [children, footer]; } }));
import DoctorSummary from "../app/doctor-summary";

let renderer: ReactTestRenderer | undefined;
const share = () => renderer!.root.findAll((n) => String(n.type) === "Button").find((n) => n.props.title === "Share PDF");
const mount = () => act(async () => { renderer = create(<DoctorSummary />); await new Promise((resolve) => setTimeout(resolve, 5)); });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.baby = { owner: "owner", sync: vi.fn(async () => undefined), state: { ...emptyState(), bootstrap: { generation: 1, active: true, ai_available: false, children: [{ id: "baby", name: "Mia", revision: 1, birth_date: "2026-10-10" }], profile: { display_name: "", timezone: "Pacific/Guam", ai_consent: false } } },
    api: { records: vi.fn(async () => ({ items: [], total: 0, has_more: false })), careStats: vi.fn(async () => null) } };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it("docks its buttons at normal sizes", async () => {
  mock.fontScale = 1.4;
  await mount();
  expect(mock.footer).toBeTruthy();
  expect(share()).toBeDefined();
});
it("at large text puts them in the page, where they can't take half the screen", async () => {
  mock.fontScale = 1.5;
  await mount();
  expect(mock.footer).toBeFalsy();
  expect(share()).toBeDefined();
});
