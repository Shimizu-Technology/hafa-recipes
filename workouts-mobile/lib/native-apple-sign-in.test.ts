import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SignInResource } from "@clerk/shared/types";

const fixture = vi.hoisted(() => ({
  authorize: vi.fn(),
  nonce: vi.fn(),
  create: vi.fn(),
  setActive: vi.fn(),
  signup: vi.fn(),
  sso: vi.fn(),
}));
vi.mock("expo-apple-authentication", () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  AppleAuthenticationButton: "AppleAuthenticationButton",
  AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 },
  AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
  signInAsync: fixture.authorize,
}));
vi.mock("expo-crypto", () => ({ randomUUID: fixture.nonce }));
vi.mock("@clerk/expo/legacy", () => ({
  useSignIn: () => ({ isLoaded: true, signIn: { create: fixture.create }, setActive: fixture.setActive }),
  useSignUp: () => ({ isLoaded: true, signUp: { create: fixture.signup } }),
}));
vi.mock("@clerk/expo", () => ({ useSSO: () => ({ startSSOFlow: fixture.sso }) }));
vi.mock("expo-web-browser", () => ({ maybeCompleteAuthSession: vi.fn(), openAuthSessionAsync: vi.fn() }));
vi.mock("react-native", () => ({
  View: "View", Platform: { OS: "ios" }, useColorScheme: () => "light",
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
vi.mock("@/components/ui", () => ({
  Button: "Button", Card: "Card", Choice: "Choice", Copy: "Copy", Field: "Field", Notice: "Notice", Screen: "Screen",
  useColors: () => ({ muted: "#000" }),
}));
import { nativeAppleSignIn } from "./native-apple-sign-in";
import SignIn from "../app/sign-in";

let renderer: ReactTestRenderer | undefined;
const complete = { status: "complete", createdSessionId: "synthetic-session" } as SignInResource;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const mock of Object.values(fixture)) mock.mockReset();
  fixture.authorize.mockResolvedValue({ identityToken: "synthetic-identity-token" });
  fixture.nonce.mockReturnValue("6d3671b8-28a0-42d0-a7d9-042cd8bd56bd");
  fixture.create.mockResolvedValue(complete);
  fixture.setActive.mockResolvedValue(undefined);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
});
async function pressApple() {
  await act(async () => {
    // iOS renders Apple's native button; other platforms keep the themed Button.
    const button = renderer!.root.findByType("AppleAuthenticationButton" as never);
    expect(button.props.buttonType).toBe(0);
    expect(button.props.buttonStyle).toBe(2);
    button.props.onPress();
  });
}
function errors() { return renderer!.root.findAllByType("Notice" as never).filter((node) => node.props.error); }

it("requests a fresh Recipes-style nonce for each attempt and exchanges only the native token", async () => {
  fixture.nonce.mockReturnValueOnce("nonce-one").mockReturnValueOnce("nonce-two");
  const signIn = { create: fixture.create };
  expect(await nativeAppleSignIn(signIn)).toBe(complete);
  expect(await nativeAppleSignIn(signIn)).toBe(complete);
  expect(fixture.authorize.mock.calls).toEqual([
    [{ requestedScopes: [0, 1], nonce: "nonce-one" }],
    [{ requestedScopes: [0, 1], nonce: "nonce-two" }],
  ]);
  expect(fixture.create.mock.calls).toEqual([
    [{ strategy: "oauth_token_apple", token: "synthetic-identity-token" }],
    [{ strategy: "oauth_token_apple", token: "synthetic-identity-token" }],
  ]);
});

it("mounted existing-account Apple sign-in activates its session without signup, transfer or browser SSO", async () => {
  await act(async () => { renderer = create(createElement(SignIn)); });
  await pressApple();
  expect(fixture.authorize).toHaveBeenCalledExactlyOnceWith({ requestedScopes: [0, 1], nonce: "6d3671b8-28a0-42d0-a7d9-042cd8bd56bd" });
  expect(fixture.create).toHaveBeenCalledExactlyOnceWith({ strategy: "oauth_token_apple", token: "synthetic-identity-token" });
  expect(fixture.setActive).toHaveBeenCalledExactlyOnceWith({ session: "synthetic-session" });
  expect(fixture.signup).not.toHaveBeenCalled();
  expect(fixture.sso).not.toHaveBeenCalled();
  expect(errors()).toHaveLength(0);
});

it("mounted Apple cancellation stays quiet and never exchanges a token or creates an account", async () => {
  fixture.authorize.mockRejectedValue({ code: "ERR_REQUEST_CANCELED", message: "private native detail" });
  await act(async () => { renderer = create(createElement(SignIn)); });
  await pressApple();
  expect(errors()).toHaveLength(0);
  expect(fixture.create).not.toHaveBeenCalled();
  expect(fixture.setActive).not.toHaveBeenCalled();
  expect(fixture.signup).not.toHaveBeenCalled();
  expect(fixture.sso).not.toHaveBeenCalled();
});

it("mounted missing Apple credential gives a clear fixed message without token exchange or signup", async () => {
  fixture.authorize.mockResolvedValue({ identityToken: null });
  await act(async () => { renderer = create(createElement(SignIn)); });
  await pressApple();
  expect(errors().map((node) => node.props.children)).toEqual(["Apple did not return a sign-in credential. Try signing in with Apple again."]);
  expect(fixture.create).not.toHaveBeenCalled();
  expect(fixture.setActive).not.toHaveBeenCalled();
  expect(fixture.signup).not.toHaveBeenCalled();
});

it("mounted Clerk rejection stays strict and exposes no provider body or credential", async () => {
  fixture.create.mockRejectedValue({ errors: [{ code: "not_allowed_access", message: "private provider detail" }], token: "synthetic-identity-token" });
  await act(async () => { renderer = create(createElement(SignIn)); });
  await pressApple();
  expect(errors().map((node) => node.props.children)).toEqual(["Could not complete sign-in. Check your details and connection, then try again."]);
  expect(fixture.setActive).not.toHaveBeenCalled();
  expect(fixture.signup).not.toHaveBeenCalled();
  expect(fixture.sso).not.toHaveBeenCalled();
});
