import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
const gate = vi.hoisted(() => ({
  revoke: vi.fn(async () => undefined), onboard: vi.fn(), opened: vi.fn(),
  loaded: true, sessionLoaded: true,
  auth: { sessionId: "session_A", userId: "user_A", getToken: async () => "token" },
  clerk: { session: { id: "session_A", user: { id: "user_A" } }, signOut: vi.fn() },
}));
vi.mock("@clerk/expo", () => ({ useAuth: () => ({ ...gate.auth, isLoaded: gate.loaded }),
  useSession: () => ({ session: gate.clerk.session, isLoaded: gate.sessionLoaded }), useClerk: () => gate.clerk }));
vi.mock("./config", () => ({ configuration: { clerkEnvironment: "production", apiBase: "https://service.example" } }));
vi.mock("./api", async (original) => ({ ...(await original<object>()), createWorkoutsApi: () => ({ onboard: gate.onboard }) }));
vi.mock("../components/ui", () => ({ Button: "Button", Copy: "Copy", Notice: "Notice", Screen: "Screen" }));
vi.mock("./native-share-session", () => ({ revokeNativeSharing: gate.revoke }));
vi.mock("expo-secure-store", () => ({}));
vi.mock("expo-crypto", () => ({}));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
import { SignupGate } from "../components/signup-gate";
import { signupSetup, createSignupSetup } from "./signup-setup";
function fixture() {
  const data = new Map<string, string>();
  const storage = {
    getItemAsync: vi.fn(async (key: string) => data.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => { data.set(key, value); }),
    deleteItemAsync: vi.fn(async (key: string) => { data.delete(key); }),
  };
  const random = vi.fn(async () => "a".repeat(64));
  return { data, storage, random, setup: createSignupSetup(storage, random) };
}
it("ordinary sign-in, another owner and another session never provision an account", async () => {
  const { setup } = fixture(), onboard = vi.fn();
  await setup.complete("session_A", "user_A", onboard, () => true);
  await setup.begin("session_A", "user_A");
  await setup.complete("session_A", "user_B", onboard, () => true);
  await setup.complete("session_B", "user_A", onboard, () => true);
  expect(onboard).not.toHaveBeenCalled();
  expect(await setup.pending("session_A", "user_A")).toBe(true);
});
it("resumes durable explicit signup after restart and clears only after verified provisioning", async () => {
  const { setup, storage, random } = fixture();
  await setup.begin("session_A", "user_A");
  const restored = createSignupSetup(storage, random), onboard = vi.fn(async () => ({ status: "created", app_user_id: "app_owner" }));
  await restored.complete("session_A", "user_A", onboard, () => true);
  expect(onboard).toHaveBeenCalledWith("cmi_" + "a".repeat(64));
  expect(await restored.pending("session_A", "user_A")).toBe(false);
  await restored.complete("session_A", "user_A", onboard, () => true);
  expect(onboard).toHaveBeenCalledTimes(1);
});
it("retains intent and installation identity after a failed call or invalid response, then retries safely", async () => {
  const { setup, random } = fixture(); await setup.begin("session_A", "user_A");
  const onboard = vi.fn().mockRejectedValueOnce(Error("Offline")).mockResolvedValueOnce({ status: "created" })
    .mockResolvedValueOnce({ status: "existing", app_user_id: "app_owner" });
  await expect(setup.complete("session_A", "user_A", onboard, () => true)).rejects.toThrow("Offline");
  await expect(setup.complete("session_A", "user_A", onboard, () => true)).rejects.toThrow("could not be verified");
  expect(await setup.pending("session_A", "user_A")).toBe(true);
  await setup.complete("session_A", "user_A", onboard, () => true);
  expect(random).toHaveBeenCalledTimes(1);
  expect(new Set(onboard.mock.calls.map(([id]) => id)).size).toBe(1);
});
it("stops a retired read before provisioning and leaves another session's intent untouched", async () => {
  const { setup, storage } = fixture(); await setup.begin("session_A", "user_A"); await setup.begin("session_B", "user_B");
  let current = true; const original = storage.getItemAsync;
  storage.getItemAsync.mockImplementationOnce(async (key) => { const value = await original(key); current = false; return value; });
  const onboard = vi.fn();
  await expect(setup.complete("session_A", "user_A", onboard, () => current)).rejects.toThrow("stopped");
  expect(onboard).not.toHaveBeenCalled();
  await setup.clear("session_A", "user_A");
  expect(await setup.pending("session_B", "user_B")).toBe(true);
});
it("a late successful response after account switch cannot clear the pending retry", async () => {
  const { setup } = fixture(); await setup.begin("session_A", "user_A");
  let current = true; const onboard = vi.fn(async () => { current = false; return { status: "created", app_user_id: "app_owner" }; });
  await expect(setup.complete("session_A", "user_A", onboard, () => current)).rejects.toThrow("stopped");
  expect(await setup.pending("session_A", "user_A")).toBe(true);
});

let renderer: ReactTestRenderer | undefined;
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.restoreAllMocks(); });
function prepareGate(setup: ReturnType<typeof createSignupSetup>) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated")) throw Error(String(args[0]));
  });
  gate.loaded = true; gate.sessionLoaded = true; gate.opened.mockClear(); gate.onboard.mockReset(); gate.clerk.signOut.mockReset(); gate.revoke.mockReset();
  gate.auth.sessionId = "session_A"; gate.auth.userId = "user_A";
  gate.clerk.session = { id: "session_A", user: { id: "user_A" } };
  vi.spyOn(signupSetup, "begin").mockImplementation(setup.begin);
  vi.spyOn(signupSetup, "pending").mockImplementation(setup.pending);
  vi.spyOn(signupSetup, "recoverable").mockImplementation(setup.recoverable);
  vi.spyOn(signupSetup, "complete").mockImplementation(setup.complete);
  vi.spyOn(signupSetup, "clear").mockImplementation(setup.clear);
}
function PrivateData() { gate.opened(gate.auth.userId); return null; }
async function mountGate() {
  await act(async () => { renderer = TestRenderer.create(React.createElement(React.StrictMode, null,
    React.createElement(SignupGate, null, React.createElement(PrivateData)))); });
}
it("holds actual private-provider children until explicit signup is provisioned, including effect replay", async () => {
  const { setup } = fixture(); await setup.begin("session_A", "user_A"); prepareGate(setup);
  let release!: (value: unknown) => void;
  gate.onboard.mockReturnValue(new Promise((resolve) => { release = resolve; }));
  await mountGate();
  expect(gate.onboard).toHaveBeenCalledTimes(1); expect(gate.opened).not.toHaveBeenCalled();
  await act(async () => release({ status: "created", app_user_id: "app_owner" }));
  expect(gate.opened).toHaveBeenCalled(); expect(await setup.pending("session_A", "user_A")).toBe(false);
});
it("opens an ordinary existing session without calling the account-creation endpoint", async () => {
  const { setup } = fixture(); prepareGate(setup); await mountGate();
  expect(gate.opened).toHaveBeenCalled(); expect(gate.onboard).not.toHaveBeenCalled();
});
it("keeps private children closed on failure and allows one deliberate retry of the same setup", async () => {
  const { setup } = fixture(); await setup.begin("session_A", "user_A"); prepareGate(setup);
  gate.onboard.mockRejectedValueOnce(Error("Unavailable")).mockResolvedValueOnce({ status: "existing", app_user_id: "app_owner" });
  await mountGate(); expect(gate.opened).not.toHaveBeenCalled();
  expect(await setup.pending("session_A", "user_A")).toBe(true);
  const button = renderer!.root.findAll((node) => String(node.type) === "Button" && node.props.title === "Try again")[0];
  await act(async () => { button.props.onPress(); button.props.onPress(); });
  expect(gate.onboard).toHaveBeenCalledTimes(2); expect(gate.opened).toHaveBeenCalled();
  expect(new Set(gate.onboard.mock.calls.map(([id]) => id)).size).toBe(1);
});

it("retains explicit setup intent if sign-out itself fails", async () => {
  const { setup } = fixture(); await setup.begin("session_A", "user_A"); prepareGate(setup);
  gate.onboard.mockRejectedValue(Error("Unavailable")); gate.clerk.signOut.mockRejectedValueOnce(Error("Unavailable"));
  await mountGate();
  const button = renderer!.root.findAll((node) => String(node.type) === "Button" && node.props.title === "Sign out")[0];
  await act(async () => { button.props.onPress(); button.props.onPress(); });
  expect(gate.clerk.signOut).toHaveBeenCalledTimes(1);
  expect(await setup.pending("session_A", "user_A")).toBe(true);
  expect(gate.opened).not.toHaveBeenCalled();
});

it("offers sign-out when secure setup storage cannot be read", async () => {
  const { setup, storage } = fixture(); prepareGate(setup);
  storage.getItemAsync.mockRejectedValue(Error("Keychain unavailable"));
  gate.clerk.signOut.mockResolvedValue(undefined);
  await mountGate();
  expect(gate.opened).not.toHaveBeenCalled(); expect(gate.onboard).not.toHaveBeenCalled();
  await act(async () => renderer!.root.findAll((node) => String(node.type) === "Button" && node.props.title === "Sign out")[0].props.onPress());
  expect(gate.clerk.signOut).toHaveBeenCalledTimes(1);
});

it("successful logout preserves exact-user recovery and requires an explicit finish in the new session", async () => {
  const { setup } = fixture(); await setup.begin("session_A", "user_A"); prepareGate(setup);
  gate.onboard.mockRejectedValueOnce(Error("Offline")).mockResolvedValueOnce({ status: "existing", app_user_id: "app_owner" });
  gate.clerk.signOut.mockResolvedValue(undefined);
  await mountGate();
  await act(async () => renderer!.root.findAll((node) => String(node.type) === "Button" && node.props.title === "Sign out")[0].props.onPress());
  expect(await setup.pending("session_A", "user_A")).toBe(false);
  expect(await setup.recoverable("user_A")).toBe(true);
  await act(async () => renderer!.unmount());
  gate.auth.sessionId = "session_B"; gate.clerk.session = { id: "session_B", user: { id: "user_A" } };
  await mountGate();
  expect(gate.onboard).toHaveBeenCalledTimes(1); expect(gate.opened).not.toHaveBeenCalled();
  const finish = renderer!.root.findAll((node) => String(node.type) === "Button" && node.props.title === "Finish account setup")[0];
  await act(async () => { finish.props.onPress(); finish.props.onPress(); });
  expect(gate.onboard).toHaveBeenCalledTimes(2); expect(gate.opened).toHaveBeenCalled();
  expect(new Set(gate.onboard.mock.calls.map(([id]) => id)).size).toBe(1);
  expect(await setup.recoverable("user_A")).toBe(false);
});

it("interruption before session activation retains exact-user recovery provenance", async () => {
  const { setup, storage, data } = fixture();
  storage.setItemAsync.mockImplementationOnce(async (key, value) => { data.set(key, value); })
    .mockRejectedValueOnce(Error("Interrupted"));
  await expect(setup.begin("session_A", "user_A")).rejects.toThrow("Interrupted");
  expect(await setup.pending("session_A", "user_A")).toBe(false);
  expect(await setup.recoverable("user_A")).toBe(true);
  expect(await setup.recoverable("user_B")).toBe(false);
});

it("an expired signup session offers recovery only to the original user", async () => {
  const { setup } = fixture(); await setup.begin("session_A", "user_A");
  prepareGate(setup); gate.auth.sessionId = "session_B";
  gate.clerk.session = { id: "session_B", user: { id: "user_A" } };
  await mountGate();
  expect(gate.opened).not.toHaveBeenCalled(); expect(gate.onboard).not.toHaveBeenCalled();
  expect(renderer!.root.findAll((node) => String(node.type) === "Button" && node.props.title === "Finish account setup")).toHaveLength(1);
  await act(async () => renderer!.unmount());
  gate.auth.userId = "user_B"; gate.clerk.session = { id: "session_B", user: { id: "user_B" } };
  await mountGate();
  expect(gate.opened).toHaveBeenCalled(); expect(gate.onboard).not.toHaveBeenCalled();
  expect(renderer!.root.findAll((node) => String(node.type) === "Button" && node.props.title === "Finish account setup")).toHaveLength(0);
});

it("waits silently for exact loaded Clerk session before onboarding or private reads", async () => {
  const { setup } = fixture(); await setup.begin("session_A", "user_A"); prepareGate(setup);
  gate.loaded = false; gate.sessionLoaded = false;
  gate.onboard.mockResolvedValue({ status: "created", app_user_id: "app_owner" });
  await mountGate();
  expect(gate.onboard).not.toHaveBeenCalled(); expect(gate.opened).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer!.toJSON())).not.toContain("could not finish");
  gate.loaded = true;
  await act(async () => renderer!.update(React.createElement(React.StrictMode, null,
    React.createElement(SignupGate, null, React.createElement(PrivateData)))));
  expect(gate.onboard).not.toHaveBeenCalled();
  gate.sessionLoaded = true;
  await act(async () => renderer!.update(React.createElement(React.StrictMode, null,
    React.createElement(SignupGate, null, React.createElement(PrivateData)))));
  expect(gate.onboard).toHaveBeenCalledOnce(); expect(gate.opened).toHaveBeenCalled();
});
it("holds a mismatched session without error and cannot open a replacement owner from late provisioning", async () => {
  const { setup } = fixture(); await setup.begin("session_A", "user_A"); prepareGate(setup);
  gate.clerk.session = { id: "previous", user: { id: "user_A" } };
  await mountGate(); expect(gate.onboard).not.toHaveBeenCalled();
  let finish!: (value: unknown) => void;
  gate.onboard.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  gate.clerk.session = { id: "session_A", user: { id: "user_A" } };
  const update = () => renderer!.update(React.createElement(React.StrictMode, null,
    React.createElement(SignupGate, null, React.createElement(PrivateData))));
  await act(async () => update()); expect(gate.onboard).toHaveBeenCalledOnce();
  gate.auth.userId = "user_B"; gate.clerk.session = { id: "session_A", user: { id: "user_B" } };
  await act(async () => { finish({ status: "created", app_user_id: "app_owner_A" }); });
  expect(gate.opened.mock.calls).not.toContainEqual(["user_A"]);
  expect(gate.onboard).toHaveBeenCalledOnce();
  expect(await setup.pending("session_A", "user_A")).toBe(true);
});

it("revokes native sharing before sign-out and preserves setup recovery when cleanup fails", async () => {
  const { setup } = fixture(); await setup.begin("session_A", "user_A"); prepareGate(setup);
  gate.onboard.mockRejectedValue(Error("Offline")); gate.revoke.mockRejectedValueOnce(Error("Locked"));
  await mountGate();
  const leave = () => renderer!.root.findAll(n => n.props.title === "Sign out")[0].props.onPress();
  await act(async () => leave()); expect(gate.clerk.signOut).not.toHaveBeenCalled();
  expect(await setup.pending("session_A", "user_A")).toBe(true);
  gate.revoke.mockResolvedValue(undefined); gate.clerk.signOut.mockResolvedValue(undefined);
  await act(async () => leave());
  expect(gate.revoke.mock.invocationCallOrder.at(-1)).toBeLessThan(gate.clerk.signOut.mock.invocationCallOrder[0]);
  expect(await setup.pending("session_A", "user_A")).toBe(false);
  expect(await setup.recoverable("user_A")).toBe(true);
});

it("a replacement session cannot inherit readiness when the gate is reused without a parent key", async () => {
  const { setup } = fixture(); await setup.begin("session_A", "user_A"); prepareGate(setup);
  gate.onboard.mockResolvedValueOnce({ status: "created", app_user_id: "app_owner_A" });
  await mountGate(); expect(gate.opened).toHaveBeenCalledWith("user_A");
  await setup.begin("session_B", "user_B");
  let finish!: (value: unknown) => void;
  gate.onboard.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  gate.opened.mockClear(); gate.auth.sessionId = "session_B"; gate.auth.userId = "user_B";
  gate.clerk.session = { id: "session_B", user: { id: "user_B" } };
  await act(async () => renderer!.update(React.createElement(React.StrictMode, null,
    React.createElement(SignupGate, null, React.createElement(PrivateData)))));
  expect(gate.onboard).toHaveBeenCalledTimes(2); expect(gate.opened).not.toHaveBeenCalled();
  expect(await setup.pending("session_B", "user_B")).toBe(true);
  await act(async () => finish({ status: "created", app_user_id: "app_owner_B" }));
  expect(gate.opened).toHaveBeenCalledWith("user_B");
  expect(await setup.pending("session_B", "user_B")).toBe(false);
});
