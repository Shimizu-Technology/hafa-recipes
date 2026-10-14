import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  owner: "owner", generation: 3, current: true, accepted: true, wantsPublic: false, requiresDisclosure: true,
  signedIn: true, aiConsent: vi.fn(), provision: vi.fn(), configure: vi.fn(), clear: vi.fn(),
  sessionOwner: vi.fn(), listener: null as null | ((state: string) => void),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" }, AppState: {
  addEventListener: (_: string, listener: (state: string) => void) => { state.listener = listener; return { remove() {} }; },
} }));
vi.mock("@clerk/expo", () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: state.signedIn, userId: "subject", sessionId: "session" }) }));
vi.mock("@/lib/config", () => ({ configuration: { apiBase: "https://example.test" } }));
vi.mock("@/modules/hafa-workouts-share/src", () => ({
  nativeSharingAvailable: true, clearSession: state.clear, configureSession: state.configure, sessionOwner: state.sessionOwner,
  installationId: async () => "installation",
}));
vi.mock("@/lib/context", () => {
  const api = { aiConsent: state.aiConsent, createShareSession: state.provision,
    publishingDisclosure: async () => ({ requires_acceptance: state.requiresDisclosure }) };
  const localDrafts = { load: async () => state.wantsPublic };
  return { useTraining: () => ({ api, localDrafts, owner: state.owner, enrollment: { enrolled: true, generation: state.generation },
    isCurrentAccount: () => state.current }) };
});
import { NativeShareAccountGuard, useNativeShareSession } from "../components/native-share-session";
import { serializeShare, setNativeShareVisibility, observeNativeShareAuthSession, revokeNativeSharing, suspendNativeSharing, updateNativeSharingConsent } from "./native-share-session";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
function Registrar() { useNativeShareSession(); return null; }
async function mount(component = Registrar) {
  await act(async () => { tree = create(createElement(component)); });
  await serializeShare(async () => undefined);
}
beforeEach(() => {
  observeNativeShareAuthSession(null); observeNativeShareAuthSession("test-session");
  state.owner = "owner"; state.generation = 3; state.current = true; state.accepted = true;
  state.wantsPublic = false; state.requiresDisclosure = true; state.signedIn = true;
  vi.clearAllMocks();
  state.aiConsent.mockImplementation(async () => ({ accepted: state.accepted, disclosure_version: 1 }));
  state.sessionOwner.mockResolvedValue("owner:3"); state.clear.mockResolvedValue(undefined);
  state.configure.mockResolvedValue(undefined);
  state.provision.mockImplementation(async (_: string, is_public: boolean, generation: number) => ({ token: "hfws_v1.example", generation, is_public }));
});
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = undefined; await serializeShare(async () => undefined); });
it("provisions a private Workouts-only capability after consent with the verified membership generation", async () => {
  await mount();
  expect(state.provision).toHaveBeenCalledWith("installation", false, 3);
  expect(state.configure).toHaveBeenCalledWith(expect.objectContaining({ token: "hfws_v1.example", generation: 3 }), "https://example.test", "owner");
});
it("requested Discover visibility requires an already accepted publishing disclosure", async () => {
  state.wantsPublic = true; await mount();
  expect(state.provision).toHaveBeenLastCalledWith("installation", false, 3);
  state.requiresDisclosure = false; state.listener!("active"); await serializeShare(async () => undefined);
  expect(state.provision).toHaveBeenLastCalledWith("installation", true, 3);
});
it("revoked AI consent disables native credentials without provisioning", async () => {
  state.accepted = false; await mount();
  expect(state.clear).toHaveBeenCalled(); expect(state.provision).not.toHaveBeenCalled();
});
it("retired membership credentials are cleared before checking consent or provisioning", async () => {
  state.sessionOwner.mockResolvedValue("owner:2"); await mount();
  expect(state.clear.mock.invocationCallOrder[0]).toBeLessThan(state.aiConsent.mock.invocationCallOrder[0]);
});
it("an account change while a credential is being provisioned never configures it", async () => {
  state.provision.mockImplementationOnce(async () => { state.current = false; return { generation: 3, token: "hfws_v1.old" }; });
  await mount(); expect(state.configure).not.toHaveBeenCalled();
});
it("unmount revokes immediately during a slow refresh and never installs its late credential", async () => {
  let finish!: (value: unknown) => void;
  state.provision.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await mount(); expect(state.provision).toHaveBeenCalled();
  await act(async () => tree!.unmount()); tree = undefined;
  await serializeShare(async () => undefined);
  expect(state.clear).toHaveBeenCalled();
  finish({ generation: 3, token: "hfws_v1.late" });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await serializeShare(async () => undefined); expect(state.configure).not.toHaveBeenCalled();
});
it("revocation rejects a late provision even while the registrar remains mounted in the same account", async () => {
  let finish!: (value: unknown) => void;
  state.provision.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await mount(); await revokeNativeSharing();
  finish({ generation: 3, token: "hfws_v1.late" });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await serializeShare(async () => undefined); expect(state.configure).not.toHaveBeenCalled();
});
it("pending sign-out suppresses foreground refreshes and its held provision until an explicit failure resume", async () => {
  let finish!: (value: unknown) => void;
  state.provision.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await mount(); const sharing = suspendNativeSharing(); await sharing.clear;
  state.listener!("active");
  finish({ generation: 3, token: "hfws_v1.late" });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await serializeShare(async () => undefined);
  expect(state.provision).toHaveBeenCalledTimes(1); expect(state.configure).not.toHaveBeenCalled();
  sharing.resume();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await serializeShare(async () => undefined);
  expect(state.provision).toHaveBeenCalledTimes(2); expect(state.configure).toHaveBeenCalledTimes(1);
});
it("a previous failed sign-out cannot release a newer sign-out suspension", async () => {
  await mount(); const first = suspendNativeSharing(); await first.clear;
  const second = suspendNativeSharing(); await second.clear; first.resume();
  state.listener!("active"); await serializeShare(async () => undefined);
  expect(state.provision).toHaveBeenCalledTimes(1);
  second.resume(); await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await serializeShare(async () => undefined); expect(state.provision).toHaveBeenCalledTimes(2);
});
it("a new private choice retires an outstanding public refresh before it can reach the extension", async () => {
  state.wantsPublic = true; state.requiresDisclosure = false;
  let finish!: (value: unknown) => void;
  state.provision.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await mount();
  const storage = { save: async () => { state.wantsPublic = false; } } as unknown as ReturnType<typeof import("./drafts").drafts>;
  await setNativeShareVisibility(storage, "owner", false, () => { if (!state.current) throw Error("Account changed"); });
  expect(state.clear).toHaveBeenCalled();
  finish({ generation: 3, token: "hfws_v1.public", is_public: true });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await serializeShare(async () => undefined);
  expect(state.configure).toHaveBeenCalledTimes(1);
  expect(state.configure).toHaveBeenCalledWith(expect.objectContaining({ is_public: false }), "https://example.test", "owner");
});
it("a loaded signed-out account removes native credentials even outside the protected training screens", async () => {
  state.signedIn = false; await mount(NativeShareAccountGuard);
  expect(state.clear).toHaveBeenCalled(); expect(state.provision).not.toHaveBeenCalled();
});

it("foreground consent changes clear the old epoch and provision a fresh capability without AppState", async () => {
  await mount();
  expect(state.configure).toHaveBeenCalledTimes(1);
  state.clear.mockClear();
  const revoke = vi.fn(async () => { state.accepted = false; });
  await act(async () => { await updateNativeSharingConsent(revoke); });
  await serializeShare(async () => undefined);
  expect(state.clear.mock.invocationCallOrder[0]).toBeLessThan(revoke.mock.invocationCallOrder[0]);
  expect(state.configure).toHaveBeenCalledTimes(1);
  state.provision.mockResolvedValue({ generation: 3, token: "hfws_v1.new-epoch", is_public: false });
  await act(async () => { await updateNativeSharingConsent(async () => { state.accepted = true; }); });
  await serializeShare(async () => undefined);
  expect(state.configure).toHaveBeenCalledTimes(2);
  expect(state.configure).toHaveBeenLastCalledWith(expect.objectContaining({ token: "hfws_v1.new-epoch" }), "https://example.test", "owner");
});
it("a consent response cannot resume native sharing after a newer sign-out suspension", async () => {
  await mount();
  let finish!: () => void;
  const consent = updateNativeSharingConsent(() => new Promise<void>(resolve => { finish = resolve; }));
  await serializeShare(async () => undefined);
  const signOut = suspendNativeSharing(); await signOut.clear;
  finish(); await consent;
  state.listener!("active"); await serializeShare(async () => undefined);
  expect(state.configure).toHaveBeenCalledTimes(1);
});
