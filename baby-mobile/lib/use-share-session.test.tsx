import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ baby: null as any, foreground: null as null | ((state: string) => void), previous: null as string | null,
  clearSession: vi.fn(async () => undefined), configureSession: vi.fn(async () => undefined) }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" }, AppState: { addEventListener: (_: string, fn: (state: string) => void) => { mock.foreground = fn; return { remove() {} }; } } }));
vi.mock("@clerk/expo", () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true }) }));
vi.mock("./context", () => ({ useBaby: () => mock.baby }));
vi.mock("./config", () => ({ configuration: { apiBase: "https://api.test" } }));
vi.mock("@/modules/hafa-baby-share/src", () => ({ nativeSharingAvailable: true, sessionOwner: async () => mock.previous, clearSession: mock.clearSession,
  installationId: async () => "install", configureSession: mock.configureSession }));
vi.mock("./share-session-state", async (original) => ({ ...(await original<object>()) }));
vi.mock("../modules/hafa-baby-share/src", () => ({ clearSession: mock.clearSession }));
import { askForShareSession } from "./share-session-state";
import { useShareSession } from "./use-share-session";

const personal = "22222222-2222-4222-8222-222222222222", family = "11111111-1111-4111-8111-111111111111";
const own = { id: personal, kind: "personal", role: "parent", generation: 1, access_version: 1 }, shared = { id: family, kind: "family", role: "parent", generation: 1, access_version: 1 };
const expires_at = "2027-01-01T00:00:00Z";
function account(bootstrap: object, session: object = {}) {
  const request = vi.fn(async (..._: unknown[]) => ({ credential_id: "c", token: "hfbs_v1.c.s", generation: 1, expires_at, ...session }));
  return { owner: "owner", current: () => true, state: { bootstrap: { generation: 1, profile: {}, active: true, ...bootstrap } }, api: { request } };
}
function Probe() { useShareSession(); return null; }
let renderer: ReactTestRenderer | undefined;
const mount = async (baby: any) => {
  mock.baby = baby;
  await act(async () => { renderer = create(<Probe />); });
};
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); mock.previous = null; });
afterEach(async () => { await act(async () => renderer?.unmount()); vi.unstubAllGlobals(); });

describe("the share credential", () => {
  it("with the flag off asks as it did, and names no destination", async () => {
    mock.previous = "owner:1";
    const baby = account({});
    await mount(baby);
    expect(mock.clearSession).not.toHaveBeenCalled();
    expect(baby.api.request).toHaveBeenCalledWith("/share/session", "POST", { installation_id: "install" }, 1);
    expect(mock.configureSession.mock.calls[0].slice(2)).toEqual(["owner", null]);
  });
  it("updating from a build before spaces rebinds, with its pending captures still there", async () => {
    mock.previous = "owner:1";
    const baby = account({ personal_space_id: personal, spaces: [own] }, { space_id: personal });
    await mount(baby);
    expect(mock.clearSession).not.toHaveBeenCalled();
    expect(baby.api.request.mock.calls[0][3]).toEqual({ generation: 1, space_id: personal });
    expect(mock.configureSession.mock.calls[0].slice(2)).toEqual(["owner", "personal"]);
  });
  it("after Create family rebinds to the family, without clearing a thing", async () => {
    mock.previous = "owner:1:personal";
    const baby = account({ personal_space_id: personal, spaces: [own, shared] }, { space_id: family });
    await mount(baby);
    expect(mock.clearSession).not.toHaveBeenCalled();
    expect(baby.api.request.mock.calls[0][3]).toEqual({ generation: 1, space_id: family });
    expect(mock.configureSession.mock.calls[0].slice(2)).toEqual(["owner", family]);
  });
  it("gets a new credential when the family changes, which is what a 401 on a capture asks for", async () => {
    const baby = account({ personal_space_id: personal, spaces: [own] }, { space_id: personal });
    await mount(baby);
    expect(baby.api.request).toHaveBeenCalledTimes(1);
    mock.baby = { ...baby, state: { bootstrap: { ...baby.state.bootstrap, spaces: [own, shared] } } };
    await act(async () => { renderer!.update(<Probe />); });
    expect(baby.api.request).toHaveBeenCalledTimes(2);
    expect(mock.clearSession).not.toHaveBeenCalled();
  });
  it("asks again as soon as the flag turns on, which is what tells the gate this phone has updated", async () => {
    const baby = account({});
    await mount(baby);
    expect(baby.api.request).toHaveBeenCalledTimes(1);
    mock.baby = { ...baby, state: { bootstrap: { ...baby.state.bootstrap, personal_space_id: personal, spaces: [own] } } };
    await act(async () => { renderer!.update(<Probe />); });
    expect(baby.api.request).toHaveBeenCalledTimes(2);
    expect(baby.api.request.mock.calls[1][3]).toEqual({ generation: 1, space_id: personal });
  });
  it("asks again when the Family screen wants a fresh answer about this phone", async () => {
    const baby = account({ personal_space_id: personal, spaces: [own] }, { space_id: personal });
    await mount(baby);
    expect(baby.api.request).toHaveBeenCalledTimes(1);
    await act(async () => { askForShareSession(); });
    expect(baby.api.request).toHaveBeenCalledTimes(2);
  });
  it("gets a new one each time the app comes forward, so a capture refused with a 401 meanwhile is back in play", async () => {
    const baby = account({ personal_space_id: personal, spaces: [own] }, { space_id: personal });
    await mount(baby);
    await act(async () => { mock.foreground?.("active"); });
    expect(baby.api.request).toHaveBeenCalledTimes(2);
    expect(mock.clearSession).not.toHaveBeenCalled();
  });
  it("still clears another account's", async () => {
    mock.previous = "someone-else:1";
    await mount(account({}));
    expect(mock.clearSession).toHaveBeenCalledTimes(1);
  });
});
