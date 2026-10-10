import { it, expect } from "vitest";
import { checkAuthConfiguration } from "./config";
it("requires explicit issuer environment and matching public key", () => {
  expect(checkAuthConfiguration("", "development")).toBeTruthy();
  expect(checkAuthConfiguration("pk_test_example", "production")).toBeTruthy();
  expect(checkAuthConfiguration("pk_test_example", "development", "production")).toBeTruthy();
  expect(checkAuthConfiguration("pk_live_example", undefined)).toBeTruthy();
  expect(checkAuthConfiguration("pk_live_example", "production")).toBeNull();
});
