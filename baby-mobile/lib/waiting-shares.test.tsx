import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const w = vi.hoisted(() => ({
  baby: null as any, rows: [] as any[], current: true, alerts: [] as { title: string; message: string; buttons: { text: string; onPress?: () => void }[] }[],
  count: vi.fn(async () => w.rows.length),
  claim: vi.fn(async (..._: unknown[]) => "claimed"), discard: vi.fn(async (..._: unknown[]) => true), toast: vi.fn(), foreground: null as null | ((state: string) => void),
}));
vi.mock("react-native", () => ({
  View: "View", Alert: { alert: (title: string, message: string, buttons: any[]) => w.alerts.push({ title, message, buttons }) },
  AppState: { addEventListener: (_: string, fn: (state: string) => void) => { w.foreground = fn; return { remove() {} }; } },
}));
vi.mock("@clerk/expo", () => ({ useUser: () => ({ user: { primaryEmailAddress: { emailAddress: "kami@example.com" } } }) }));
vi.mock("@/lib/context", () => ({ useBaby: () => w.baby }));
vi.mock("@/modules/hafa-baby-share/src", () => ({
  waitingShares: async (owner: string) => (owner === "owner" ? w.rows : []), waitingShareCount: () => w.count(),
  claimShare: w.claim, discardShare: w.discard, clearSession: async () => undefined,
}));
vi.mock("../components/ui", () => ({
  Button: "Button", Card: "Card", Copy: "Copy", Icon: "Icon", Notice: "Notice", PressTarget: "PressTarget", radii: { thumb: 14 }, tap: vi.fn(),
  useColors: () => ({ tile: "#fff", muted: "#000" }), useToast: () => w.toast,
}));
import { WaitingShares } from "../components/waiting-shares";
import { confirmSignOut, removedWarning, shareLabel, shareWhen, shareKeptUntil, signInNotice, useWaitingShareCount } from "./waiting-shares";
import { claimSettled, revokeShareSession } from "./share-session-state";

const row = (over = {}) => ({ token: "a:1", kind: "link", count: 0, host: "tiktok.com", shared_at: "2026-11-06T14:14:00.000Z", kept_until: "2026-12-06T14:14:00.000Z", ...over });
let renderer: ReactTestRenderer | undefined;
const mount = async () => { await act(async () => { renderer = create(<WaitingShares />); }); };
const text = () => JSON.stringify(renderer!.toJSON());
// A render with the latest account, keeping the tap handed out before it.
const latestRender = () => { renderer!.update(<WaitingShares />); };
const press = async (title: string) => {
  const button = renderer!.root.findAll((node) => (node.type as unknown) === "Button" && node.props.title === title)[0];
  await act(async () => { await button.props.onPress(); });
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); w.alerts = []; w.rows = []; w.current = true;
  w.baby = { owner: "owner", current: () => w.current, state: { bootstrap: { generation: 3 } } };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it("requires confirmation if the waiting count cannot be read", async () => {
  w.count.mockRejectedValueOnce(Error("locked"));
  const out = vi.fn();
  await confirmSignOut(out);
  expect(out).not.toHaveBeenCalled();
  expect(w.alerts[0].message).toContain("Any shares waiting on this phone will be removed.");
  w.alerts[0].buttons.find(button => button.text === "Sign out and clear device")!.onPress!();
  expect(out).toHaveBeenCalledOnce();
});
describe("the words", () => {
  it("name a share by its type and website only", () => {
    expect(shareLabel(row() as any)).toBe("Link from tiktok.com");
    expect(shareLabel(row({ kind: "link", host: undefined }) as any)).toBe("Link");
    expect(shareLabel(row({ kind: "photo", count: 1 }) as any)).toBe("Photo");
    expect(shareLabel(row({ kind: "photo", count: 3 }) as any)).toBe("3 photos");
    expect(shareLabel(row({ kind: "pdf", count: 1 }) as any)).toBe("PDF");
    expect(shareLabel(row({ kind: "video", count: 1 }) as any)).toBe("Video");
  });
  it("say when, and until when", () => {
    const now = new Date(2026, 10, 6, 15), share = row({ shared_at: new Date(2026, 10, 6, 14, 14).toISOString(), kept_until: new Date(2026, 11, 6, 14, 14).toISOString() });
    expect(shareWhen(share as any, now)).toMatch(/^Today, 2:14.PM$/);
    expect(shareWhen(row({ shared_at: new Date(2026, 10, 5, 21, 3).toISOString() }) as any, now)).toMatch(/^Yesterday, 9:03.PM$/);
    expect(shareWhen(row({ shared_at: new Date(2026, 9, 30, 9, 0).toISOString() }) as any, now)).toMatch(/^Oct 30, 9:00.AM$/);
    expect(shareKeptUntil(share as any)).toBe("kept until Dec 6");
  });
  it("count for the sign-in screen and the sign-out warning", () => {
    expect(signInNotice(1)).toBe("1 share is waiting on this phone. Sign in to add it.");
    expect(signInNotice(3)).toBe("3 shares are waiting on this phone. Sign in to add them.");
    expect(removedWarning(1)).toBe("1 share waiting here will be removed.");
    expect(removedWarning(2)).toBe("2 shares waiting here will be removed.");
  });
});
describe("the card", () => {
  it("isn't there with nothing waiting", async () => {
    await mount();
    expect(renderer!.toJSON()).toBeNull();
  });
  it("names the account, and adds this exact share to it with no other step", async () => {
    w.rows = [row()];
    await mount();
    expect(text()).toContain("Add this to your saved posts?");
    expect(text()).toContain("Adding to kami@example.com. Only you will see it.");
    expect(text()).toContain("Link from tiktok.com");
    expect(text()).toContain("kept until");
    await press("Add to my saved posts");
    expect(w.claim).toHaveBeenCalledExactlyOnceWith("a:1", "owner", 3);
    // She's said it's hers, and it isn't saved yet.
    expect(w.toast).not.toHaveBeenCalled();
    expect(text()).toContain("Adding to your saved posts…");
    await act(async () => { claimSettled("a:1", "saved"); });
    expect(w.toast).toHaveBeenCalledExactlyOnceWith("Added to your saved posts");
    expect(text()).not.toContain("Adding to your saved posts…");
  });
  it("ends an old Adding card and ignores its success after a personal reset", async () => {
    w.rows = [row()];
    await mount();
    await press("Add to my saved posts");
    w.baby.state.bootstrap.generation = 4;
    await act(async () => { latestRender(); });
    expect(text()).not.toContain("Adding to your saved posts…");
    expect(text()).toContain("Your personal space changed");
    expect(text()).toContain("Add to my saved posts");
    await act(async () => { claimSettled("a:1", "saved"); });
    expect(w.toast).not.toHaveBeenCalled();
  });
  it("reconciles a save arriving before the native claim returns", async () => {
    w.rows = [row()];
    w.claim.mockImplementationOnce(async () => { claimSettled("a:1", "saved"); return "claimed"; });
    await mount();
    await press("Add to my saved posts");
    expect(w.toast).toHaveBeenCalledExactlyOnceWith("Added to your saved posts");
    expect(text()).not.toContain("Adding to your saved posts…");
  });
  it("settles earlier successful claims when a later claim throws", async () => {
    w.rows = [row(), row({ token: "b:1" })];
    w.claim.mockResolvedValueOnce("claimed").mockRejectedValueOnce(Error("store unavailable"));
    await mount();
    await press("Add all 2");
    expect(text()).toContain("Adding to your saved posts…");
    await act(async () => { claimSettled("a:1", "saved"); });
    expect(w.toast).toHaveBeenCalledExactlyOnceWith("Added to your saved posts");
    expect(text()).not.toContain("Adding to your saved posts…");
  });
  it("doesn't say Added for a share that turns out not to fit, or that couldn't be written", async () => {
    for (const outcome of ["blocked", "failed"] as const) {
      w.rows = [row({ token: `${outcome}:1` })];
      await mount();
      await press("Add to my saved posts");
      await act(async () => { claimSettled(`${outcome}:1`, outcome); });
      expect(w.toast).not.toHaveBeenCalled();
      expect(text()).not.toContain("Adding to your saved posts…");
      await act(async () => renderer!.unmount());
      renderer = undefined;
    }
  });
  it("waits for every one of several before saying so", async () => {
    w.rows = [row({ token: "w:1" }), row({ token: "w:2" })];
    await mount();
    await press("Add all 2");
    await act(async () => { claimSettled("w:1", "saved"); });
    expect(w.toast).not.toHaveBeenCalled();
    await act(async () => { claimSettled("someone-elses:1", "saved"); });
    expect(w.toast).not.toHaveBeenCalled();
    await act(async () => { claimSettled("w:2", "saved"); });
    expect(w.toast).toHaveBeenCalledOnce();
  });
  it("says plainly when a share's 30 days ran out with the card open", async () => {
    w.rows = [row({ token: "old:1" })]; w.claim.mockResolvedValueOnce("expired");
    await mount();
    w.rows = [];
    await press("Add to my saved posts");
    expect(text()).toContain("That share’s 30 days are up. It can’t be added any more.");
    expect(w.toast).not.toHaveBeenCalled();
    await press("OK");
    expect(renderer!.toJSON()).toBeNull();
  });
  it("says it's still here if it couldn't be added, and isn't told it was", async () => {
    w.rows = [row()]; w.claim.mockResolvedValueOnce("refused");
    await mount();
    await press("Add to my saved posts");
    expect(text()).toContain("It’s still on this phone.");
    expect(w.toast).not.toHaveBeenCalled();
  });
  it("won't claim on a space generation the card has fallen behind", async () => {
    w.rows = [row({ token: "g:1" })];
    await mount();
    w.baby = { ...w.baby, state: { bootstrap: { generation: 4 } } };
    // The tap's closure still says 3, and the latest account says 4.
    const tap = renderer!.root.findAll((node) => (node.type as unknown) === "Button" && node.props.title === "Add to my saved posts")[0].props.onPress;
    await act(async () => latestRender());
    await act(async () => { await tap(); });
    expect(w.claim).not.toHaveBeenCalled();
    expect(text()).toContain("It’s still on this phone.");
  });
  it("Not mine asks first, then removes only this one", async () => {
    w.rows = [row()];
    await mount();
    await press("Not mine, remove it");
    expect(w.discard).not.toHaveBeenCalled();
    expect(w.alerts[0].title).toBe("Remove from this phone?");
    expect(w.alerts[0].buttons.map((b) => b.text)).toEqual(["Keep it", "Remove"]);
    await act(async () => { w.alerts[0].buttons[1].onPress!(); });
    expect(w.discard).toHaveBeenCalledExactlyOnceWith("a:1");
    expect(w.claim).not.toHaveBeenCalled();
  });
  it("Not now leaves it on the phone and out of the way, for this account", async () => {
    w.rows = [row({ token: "nn:1" })];
    await mount();
    await press("Not now");
    expect(renderer!.toJSON()).toBeNull();
    await act(async () => { w.foreground?.("active"); });
    expect(renderer!.toJSON()).toBeNull();
    expect(w.discard).not.toHaveBeenCalled();
    expect(w.claim).not.toHaveBeenCalled();
  });
  it("several get a count, a remove on each row, and Add all", async () => {
    w.rows = [row({ token: "m:1" }), row({ token: "m:2", kind: "photo", count: 2, host: undefined })];
    await mount();
    expect(text()).toContain("Add these 2 to your saved posts?");
    expect(text()).toContain("Only you will see them.");
    await press("Add all 2");
    expect(w.claim.mock.calls.map((call) => call[0])).toEqual(["m:1", "m:2"]);
  });
  it("stops adding when the account changes partway", async () => {
    w.rows = [row({ token: "c:1" }), row({ token: "c:2" })];
    w.claim.mockImplementationOnce(async () => { w.current = false; return "claimed"; });
    await mount();
    await press("Add all 2");
    expect(w.claim).toHaveBeenCalledTimes(1);
  });
  it("adds nothing once sign-out has started", async () => {
    w.rows = [row({ token: "s:1" })];
    await mount();
    await act(async () => { await revokeShareSession(); });
    await press("Add to my saved posts");
    expect(w.claim).not.toHaveBeenCalled();
  });
});
describe("signing out", () => {
  it("goes straight through with nothing waiting", async () => {
    const out = vi.fn();
    await confirmSignOut(out);
    expect(out).toHaveBeenCalledOnce();
    expect(w.alerts).toEqual([]);
  });
  it("warns first with something waiting", async () => {
    w.rows = [row()];
    const out = vi.fn();
    await confirmSignOut(out);
    expect(out).not.toHaveBeenCalled();
    expect(w.alerts[0].message).toContain("1 share waiting here will be removed.");
    w.alerts[0].buttons[1].onPress!();
    expect(out).toHaveBeenCalledOnce();
  });
  it("the sign-in screen learns only how many", async () => {
    w.rows = [row(), row()];
    let seen = -1;
    const Probe = () => { seen = useWaitingShareCount(); return null; };
    await act(async () => { renderer = create(<Probe />); });
    expect(seen).toBe(2);
  });
});
