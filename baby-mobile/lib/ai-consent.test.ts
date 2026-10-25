import { beforeEach, expect, it, vi } from "vitest";

type Button = { text: string; onPress?: () => void };
const alert = vi.hoisted(() => ({ calls: [] as { buttons: Button[]; options?: { onDismiss?: () => void } }[] }));
vi.mock("react-native", () => ({
  Alert: { alert: (_title: string, _body: string, buttons: Button[], options?: { onDismiss?: () => void }) => {
    alert.calls.push({ buttons, options });
  } },
}));

import { AI_CONSENT_BODY, ensureAiConsent } from "./ai-consent";

function baby(consent: boolean, profileSave = vi.fn(async (value: { ai_consent: boolean }) => ({ ...value }))) {
  const state = { bootstrap: { generation: 3, profile: { ai_consent: consent, display_name: "Kai" } } };
  return {
    state,
    api: { profile: profileSave },
    commit: vi.fn(async (change: (s: typeof state) => typeof state) => { Object.assign(state, change(state)); }),
  } as never as Parameters<typeof ensureAiConsent>[0] & { state: typeof state; api: { profile: typeof profileSave } };
}
const press = (label: string) => alert.calls.at(-1)!.buttons.find((button) => button.text === label)!.onPress!();

beforeEach(() => { alert.calls = []; });

it("proceeds without asking when permission already exists", async () => {
  const b = baby(true);
  await expect(ensureAiConsent(b)).resolves.toBe(true);
  expect(alert.calls).toHaveLength(0);
  expect(b.api.profile).not.toHaveBeenCalled();
});

it("saves permission only after Allow processing, then proceeds", async () => {
  const b = baby(false);
  const result = ensureAiConsent(b);
  press("Allow processing");
  await expect(result).resolves.toBe(true);
  expect(b.api.profile).toHaveBeenCalledWith(expect.objectContaining({ ai_consent: true, display_name: "Kai" }), 3);
  expect(b.state.bootstrap.profile.ai_consent).toBe(true);
});

it.each([
  ["Keep off", () => press("Keep off")],
  ["dismissal", () => alert.calls.at(-1)!.options!.onDismiss!()],
])("does not save or proceed after %s", async (_label, decline) => {
  const b = baby(false);
  const result = ensureAiConsent(b);
  decline();
  await expect(result).resolves.toBe(false);
  expect(b.api.profile).not.toHaveBeenCalled();
});

it("does not proceed when saving permission fails", async () => {
  const b = baby(false, vi.fn(async () => { throw new Error("offline"); }));
  const result = ensureAiConsent(b);
  press("Allow processing");
  await expect(result).rejects.toThrow("offline");
  expect(b.state.bootstrap.profile.ai_consent).toBe(false);
});

it("tells people what is shared before they allow it", () => {
  expect(AI_CONSENT_BODY).toMatch(/text, images, audio or sampled video frames/);
  expect(AI_CONSENT_BODY).toMatch(/relevant Baby records and recent conversation/);
});
