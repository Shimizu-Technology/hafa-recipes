import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ profile: {} as object, save: vi.fn(async (change: object) => change), alert: vi.fn(), replace: vi.fn() }));
vi.mock("react-native", () => ({ Alert: { alert: f.alert } }));
vi.mock("expo-router", () => ({ router: { replace: f.replace, back: f.replace } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "id" }));
vi.mock("@/lib/context", () => ({ useBaby: () => ({ api: { profile: f.save, child: vi.fn() }, refresh: async () => undefined, state: { bootstrap: { generation: 1, children: [], profile: f.profile } } }) }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/components/ui", () => ({ Button: "Button", Choice: "Choice", Field: "Field", Notice: "Notice", Screen: "Screen" }));
vi.mock("@/components/date-field", () => ({ DateField: "DateField" }));
import Onboarding from "../app/onboarding";

let view: ReactTestRenderer;
const open = async (profile: object) => { f.profile = { display_name: "", timezone: "Pacific/Guam", ai_consent: false, ...profile }; await act(async () => { view = create(<Onboarding />); }); };
const finish = () => act(async () => view.root.findByType("Button" as React.ElementType).props.onPress());
const choice = (label: RegExp) => view.root.findAll((n) => String(n.type) === "Choice").find((n) => label.test(n.props.label))!;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); f.save.mockClear(); f.alert.mockClear(); });

it("leaves permission alone unless she changes it here, whatever this phone last read", async () => {
  await open({ ai_consent: true, auto_process_shares: true, display_name: "Kami" });
  await finish();
  expect(f.save).toHaveBeenCalledWith({ timezone: expect.any(String) }, 1);
});
it("sends what she chose, once she's confirmed it", async () => {
  await open({});
  await act(async () => choice(/^Allow optional AI/).props.onPress());
  await act(async () => f.alert.mock.calls[0][2].at(-1).onPress());
  await finish();
  expect(f.save).toHaveBeenCalledWith({ timezone: expect.any(String), ai_consent: true }, 1);
});
it("sends a withdrawal, which also stops automatic posts", async () => {
  await open({ ai_consent: true, auto_process_shares: true });
  await act(async () => choice(/^Allow optional AI/).props.onPress());
  await finish();
  expect(f.save).toHaveBeenCalledWith({ timezone: expect.any(String), ai_consent: false, auto_process_shares: false }, 1);
});
