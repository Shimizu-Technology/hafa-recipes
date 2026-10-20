import { expect, it } from "vitest";
import { accountIdentity } from "./account-identity";

it("shows the full name, primary email and first-name initial", () => {
  expect(accountIdentity({ firstName: "leon", lastName: "Shimizu", primaryEmailAddress: { emailAddress: "leon@example.com" } }))
    .toEqual({ name: "leon Shimizu", email: "leon@example.com", initial: "L", photo: undefined });
});

it("falls back to the email when the account has no name", () => {
  expect(accountIdentity({ emailAddresses: [{ emailAddress: "åsa@example.com" }] }))
    .toEqual({ name: "åsa", email: "åsa@example.com", initial: "Å", photo: undefined });
});

it("ignores Clerk's generated avatar and keeps a chosen photo", () => {
  expect(accountIdentity({ firstName: "A", imageUrl: "https://img/default", hasImage: false }).photo).toBeUndefined();
  expect(accountIdentity({ firstName: "A", imageUrl: "https://img/me", hasImage: true }).photo).toBe("https://img/me");
});

it("still renders something while the user is loading", () => {
  expect(accountIdentity(undefined)).toEqual({ name: "Your account", email: undefined, initial: undefined, photo: undefined });
});
