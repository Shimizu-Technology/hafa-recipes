import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { emptyState, type Child, type DeviceState } from "./models";
import type { FamilyMember } from "./family";

const m = vi.hoisted(() => ({ baby: null as any, toast: vi.fn() }));
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("@/lib/context", () => ({ useBaby: () => m.baby }));
vi.mock("../components/ui", () => ({ Choice: "Choice", Copy: "Copy", useToast: () => m.toast }));
import { ExpectingAsk } from "../components/expecting-ask";

const member = (id: string, role: "parent" | "caregiver", name: string): FamilyMember => ({ app_user_id: id, role, status: "active", access_version: 1, display_name: name });
const family = [member("kami", "parent", "Kami"), member("leon", "parent", "Leon"), member("nana", "caregiver", "Grandma")];
const baby = { id: "c", name: "Mia", due_date: "2026-12-10", birth_date: null, revision: 4, space_id: "fam", generation: 1,
  details: { expecting_member: "leon", expecting_confirmed: false } } as unknown as Child;
let renderer: ReactTestRenderer | undefined;
const choices = () => renderer!.root.findAll((n) => String(n.type) === "Choice");
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  m.toast.mockClear();
  let state = { ...emptyState(), bootstrap: { generation: 7, children: [baby] } } as unknown as DeviceState;
  m.baby = { owner: "leon", get state() { return state; }, refresh: vi.fn(async () => undefined),
    api: { child: vi.fn(async (write: Partial<Child>) => ({ ...baby, revision: 5, details: { ...baby.details, ...write.details } })) },
    commit: vi.fn(async (change: (s: DeviceState) => DeviceState) => { state = change(state); }) };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it("offers the other parents by name, then Me, and saves the answer for the whole family", async () => {
  await act(async () => { renderer = create(<ExpectingAsk child={baby} members={family} />); });
  // Grandma isn't a parent; nothing is chosen until someone says.
  expect(choices().map((c) => [c.props.label, c.props.selected])).toEqual([["Kami", false], ["Me", false]]);
  await act(async () => { await choices()[0].props.onPress(); });
  expect(m.baby.api.child).toHaveBeenCalledWith({ id: "c", revision: 4, details: { expecting_member: "kami", expecting_confirmed: true } }, expect.anything());
  expect(m.baby.state.bootstrap.children[0].details).toMatchObject({ expecting_member: "kami", expecting_confirmed: true });
});
it("someone changed the profile first: it's read again, and she's told", async () => {
  m.baby.api.child = vi.fn(async () => { throw new ApiError("changed", 409); });
  await act(async () => { renderer = create(<ExpectingAsk child={baby} members={family} />); });
  await act(async () => { await choices()[1].props.onPress(); });
  expect(m.baby.refresh).toHaveBeenCalled();
  expect(m.toast).toHaveBeenCalled();
});
it("no signal: nothing changes, and she's told to choose again later", async () => {
  m.baby.api.child = vi.fn(async () => { throw new ApiError("offline", 0, true); });
  await act(async () => { renderer = create(<ExpectingAsk child={baby} members={family} />); });
  await act(async () => { await choices()[0].props.onPress(); });
  expect(m.toast).toHaveBeenCalledWith("No signal right now. Choose again once you’re back online.");
  expect(m.baby.state.bootstrap.children[0].details.expecting_confirmed).toBe(false);
});
