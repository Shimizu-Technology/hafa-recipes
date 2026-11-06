import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ signedIn: false, push: vi.fn() }));
vi.mock("@clerk/expo", () => ({ useAuth: () => ({ isSignedIn: f.signedIn }) }));
vi.mock("expo-router", () => ({ Redirect: "Redirect", router: { push: f.push } }));
vi.mock("@/components/ui", () => ({ Button: "Button", Copy: "Copy", Screen: "Screen", Section: "Section" }));
import JoinLink from "../app/join";
import Index from "../app/index";
import { holdJoinLink, takeJoinLink } from "./join-link";

const code = "hfbi_v1.abcdefghijklmnopqrstuvwxyz012345";
let view: ReactTestRenderer | undefined;
const open = async (Page: React.ComponentType) => { await act(async () => { view = create(<Page />); }); };
const all = (type: string) => view!.root.findAll((n) => String(n.type) === type);
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React); f.signedIn = false; f.push.mockClear(); });
afterEach(async () => { await act(async () => view?.unmount()); view = undefined; takeJoinLink(); vi.unstubAllGlobals(); });

describe("a family link on a signed-out phone", () => {
  it("says what the link is and asks them to sign in, without showing the code", async () => {
    holdJoinLink(code);
    await open(JoinLink);
    expect(JSON.stringify(view!.toJSON())).toMatch(/Sign in or create an account/);
    expect(JSON.stringify(view!.toJSON())).not.toContain("hfbi_v1");
    await act(async () => all("Button")[0].props.onPress());
    expect(f.push).toHaveBeenCalledWith("/sign-in");
  });
  it("keeps the code waiting, for after they sign in", async () => {
    holdJoinLink(code);
    await open(JoinLink);
    expect(takeJoinLink()).toBe(code);
  });
});
describe("a family link once signed in", () => {
  it("goes to Family from the link", async () => {
    f.signedIn = true; holdJoinLink(code);
    await open(JoinLink);
    expect(all("Redirect")[0].props.href).toBe("/family");
  });
  it("goes to Family from the start of the app, when signing in led there", async () => {
    f.signedIn = true; holdJoinLink(code);
    await open(Index);
    expect(all("Redirect")[0].props.href).toBe("/family");
  });
  it("opens Today as usual with no link waiting, and signed out goes to sign in", async () => {
    f.signedIn = true;
    await open(Index);
    expect(all("Redirect")[0].props.href).toBe("/(tabs)/(today)");
    await act(async () => view!.unmount());
    f.signedIn = false; holdJoinLink(code);
    await open(Index);
    expect(all("Redirect")[0].props.href).toBe("/sign-in");
  });
});
