import { beforeEach, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));
import { Alert } from "react-native";
import { confirmAccountDeletion } from "./account-deletion";

beforeEach(() => vi.mocked(Alert.alert).mockClear());

it("requires both confirmations before deleting the shared account", () => {
  const remove = vi.fn();
  confirmAccountDeletion(remove);
  const first = vi.mocked(Alert.alert).mock.calls[0];
  expect(first[1]).toContain("Recipes and Workouts");
  expect(remove).not.toHaveBeenCalled();
  first[2]!.find((button) => button.text === "Delete entire account")!.onPress!();
  expect(remove).not.toHaveBeenCalled();
  const second = vi.mocked(Alert.alert).mock.calls[1];
  expect(second[1]).toContain("every Håfa app");
  second[2]!.find((button) => button.text === "Permanently delete account")!.onPress!();
  expect(remove).toHaveBeenCalledOnce();
});

it("leaves the account intact when either confirmation is cancelled", () => {
  const remove = vi.fn();
  confirmAccountDeletion(remove);
  const first = vi.mocked(Alert.alert).mock.calls[0];
  const keep = first[2]!.find((button) => button.style === "cancel")!;
  keep.onPress?.();
  expect(remove).not.toHaveBeenCalled();
  first[2]!.find((button) => button.text === "Delete entire account")!.onPress!();
  const second = vi.mocked(Alert.alert).mock.calls[1];
  second[2]!.find((button) => button.style === "cancel")!.onPress?.();
  expect(remove).not.toHaveBeenCalled();
});
