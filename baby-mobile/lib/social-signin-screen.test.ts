import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  signIn: { id: "attempt_A", status: "needs_identifier", createdSessionId: null as string | null,
    identifier: "parent@example.test", firstFactorVerification: { status: "transferable" } },
  signUp: { status: "missing_requirements", createdSessionId: null as string | null,
    createdUserId: null as string | null, create: vi.fn() },
  social: vi.fn(), activate: vi.fn(), begin: vi.fn(), sso: vi.fn(),
}));
vi.mock("react-native", () => ({ View: "View", Platform: { OS: "ios" }, useColorScheme: () => "dark",
  AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock("expo-apple-authentication", () => ({ AppleAuthenticationButton: "AppleButton",
  AppleAuthenticationButtonType: { SIGN_IN: "sign-in" }, AppleAuthenticationButtonStyle: { WHITE: "white" } }));
vi.mock("@clerk/expo/legacy", () => ({ useSignIn: () => ({ signIn: m.signIn, setActive: m.activate, isLoaded: true }),
  useSignUp: () => ({ signUp: m.signUp, isLoaded: true }) }));
vi.mock("@clerk/expo", () => ({ useSSO: () => ({ startSSOFlow: m.sso }) }));
vi.mock("expo-web-browser", () => ({ maybeCompleteAuthSession() {} }));
vi.mock("@/components/ui", () => ({ Button: "Button", Choice: "Choice", Copy: "Copy", Field: "Field", Notice: "Notice", Screen: "Screen" }));
vi.mock("@/lib/auth-recovery", () => import("./auth-recovery"));
vi.mock("@/lib/social", () => ({ callbackUrl: "hafababy://oauth-callback", socialSignIn: m.social }));
vi.mock("@/lib/config", () => ({ configuration: { clerkEnvironment: "production" } }));
vi.mock("@/lib/signup-setup", () => ({ signupSetup: { begin: m.begin } }));
vi.mock("@/lib/native-apple-sign-in", () => ({ nativeAppleSignIn: vi.fn() }));
import SignIn from "../app/sign-in";
let view: ReactTestRenderer;
const notices = () => view.root.findAll(n => String(n.type) === "Notice");
async function press(title: string) {
  await act(async () => view.root.findAll(n => String(n.type) === "Button" && n.props.title === title)[0].props.onPress());
}
async function adult() { await act(async () => view.root.findByType("Choice" as any).props.onPress()); }
beforeEach(async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated")) throw Error(String(args[0]));
  });
  vi.clearAllMocks(); m.begin.mockResolvedValue(undefined); m.activate.mockResolvedValue(undefined);
  Object.assign(m.signIn, { id: "attempt_A", status: "needs_identifier", createdSessionId: null,
    firstFactorVerification: { status: "transferable" } });
  Object.assign(m.signUp, { status: "missing_requirements", createdSessionId: null, createdUserId: null });
  m.social.mockResolvedValue(m.signIn);
  m.signUp.create.mockImplementation(async () => {
    Object.assign(m.signUp, { status: "complete", createdSessionId: "session_new", createdUserId: "user_new" });
    return m.signUp;
  });
  await act(async () => { view = TestRenderer.create(React.createElement(SignIn)); });
});
afterEach(async () => { await act(async () => view.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("signs an existing Google user in without signup, adult prompts or new owner intent", async () => {
  Object.assign(m.signIn, { status: "complete", createdSessionId: "session_existing", firstFactorVerification: { status: "verified" } });
  await press("Continue with Google");
  expect(m.activate).toHaveBeenCalledWith({ session: "session_existing" });
  expect(m.begin).not.toHaveBeenCalled(); expect(m.signUp.create).not.toHaveBeenCalled(); expect(notices()).toHaveLength(0);
});
it("continues a verified new Google email to signup without repeating OAuth and persists intent before activation", async () => {
  await press("Continue with Google");
  expect(view.root.findByType("Screen" as any).props.title).toBe("Create your Håfa account");
  expect(notices()).toHaveLength(0); expect(m.signUp.create).not.toHaveBeenCalled(); expect(m.activate).not.toHaveBeenCalled();
  await press("Create account and continue"); expect(m.signUp.create).not.toHaveBeenCalled();
  await adult();
  let release!: () => void; m.begin.mockReturnValue(new Promise<void>(yes => { release = yes; }));
  await press("Create account and continue");
  expect(m.begin).toHaveBeenCalledWith("session_new", "user_new"); expect(m.activate).not.toHaveBeenCalled();
  await act(async () => release());
  expect(m.signUp.create).toHaveBeenCalledWith({ transfer: true });
  expect(m.activate).toHaveBeenCalledWith({ session: "session_new" }); expect(m.social).toHaveBeenCalledTimes(1);
});
it("keeps cancellation quiet and never creates an account", async () => {
  m.social.mockResolvedValue(null); await press("Continue with Google");
  expect(notices()).toHaveLength(0); expect(m.begin).not.toHaveBeenCalled(); expect(m.signUp.create).not.toHaveBeenCalled();
});
it("will not transfer another or expired Google attempt", async () => {
  await press("Continue with Google"); await adult(); m.signIn.id = "attempt_B";
  await press("Create account and continue");
  expect(m.signUp.create).not.toHaveBeenCalled(); expect(m.activate).not.toHaveBeenCalled();
});
it("allows choosing another account without completing the first signup", async () => {
  await press("Continue with Google"); await adult(); await press("Use a different account");
  expect(m.signUp.create).not.toHaveBeenCalled(); expect(m.activate).not.toHaveBeenCalled();
  await press("Continue with Google");
  expect(view.root.findByType("Choice" as any).props.selected).toBe(false);
});
it("retries durable activation setup without creating the Google account twice", async () => {
  await press("Continue with Google"); await adult(); m.begin.mockRejectedValueOnce(Error("Locked storage"));
  await press("Create account and continue"); expect(m.activate).not.toHaveBeenCalled();
  await press("Create account and continue");
  expect(m.signUp.create).toHaveBeenCalledTimes(1); expect(m.begin).toHaveBeenCalledTimes(2);
  expect(m.activate).toHaveBeenCalledWith({ session: "session_new" });
});
it("an existing Google account also works from the email signup screen", async () => {
  await press("Create a new account");
  Object.assign(m.signIn, { status: "complete", createdSessionId: "session_existing", firstFactorVerification: { status: "verified" } });
  await press("Continue with Google");
  expect(m.activate).toHaveBeenCalledWith({ session: "session_existing" }); expect(m.begin).not.toHaveBeenCalled();
});
it("cannot discard completed signup recovery when secure setup storage is unavailable", async () => {
  await press("Continue with Google"); await adult();
  m.begin.mockRejectedValueOnce(Error("Locked storage")).mockRejectedValueOnce(Error("Still locked"));
  await press("Create account and continue"); await press("Use a different account");
  expect(view.root.findByType("Screen" as any).props.title).toBe("Create your Håfa account");
  expect(m.activate).not.toHaveBeenCalled();
  await press("Use a different account");
  expect(m.begin).toHaveBeenLastCalledWith("session_new", "user_new");
  expect(view.root.findByType("Screen" as any).props.title).toBe("Håfa adai");
  expect(m.signUp.create).toHaveBeenCalledTimes(1);
});
