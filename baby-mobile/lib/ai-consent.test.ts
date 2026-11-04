import { beforeEach, expect, it, vi } from "vitest";

type Button = { text: string; onPress?: () => void };
const alert = vi.hoisted(() => ({ calls: [] as { buttons: Button[]; options?: { onDismiss?: () => void } }[] }));
vi.mock("react-native", () => ({
  Alert: { alert: (_title: string, _body: string, buttons: Button[], options?: { onDismiss?: () => void }) => {
    alert.calls.push({ buttons, options });
  } },
}));

import { AI_CONSENT_BODY, ASK_CONSENT_BODY, acknowledgeAsk, consentCopy, ensureAiConsent, needsAskAcknowledgment } from "./ai-consent";

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

const withAsk = (version: number | null, acknowledged?: number, consent = true) => ({
  generation: 3, ask_consent_version: version, children: [], ai_available: true,
  profile: { ai_consent: consent, ai_consent_version: acknowledged, display_name: "Kai", timezone: "Pacific/Guam" },
});

it("names OpenAI, web search, family sharing and the private journal", () => {
  expect(ASK_CONSENT_BODY).toMatch(/OpenAI/);
  expect(ASK_CONSENT_BODY).toMatch(/web search receives a cleaned-up question with names removed and none of your records/);
  expect(ASK_CONSENT_BODY).toMatch(/every parent's Ask can use what's shared/);
  expect(ASK_CONSENT_BODY).toMatch(/private journal goes only to your own Ask/);
});

it("shows the old words until the new Ask is on", () => {
  expect(consentCopy(withAsk(null))).toBe(AI_CONSENT_BODY);
  expect(consentCopy(withAsk(1))).toBe(ASK_CONSENT_BODY);
});

it.each([
  ["the new Ask is off", withAsk(null, 0), false],
  ["AI is off", withAsk(1, 0, false), false],
  ["already acknowledged", withAsk(1, 1), false],
  ["an older version", withAsk(2, 1), true],
  ["never acknowledged", withAsk(1), true],
])("asks to review when %s: %s", (_label, bootstrap, expected) => {
  expect(needsAskAcknowledgment(bootstrap)).toBe(expected);
});

it("acknowledges only after Allow processing, sending the version the server asked for", async () => {
  const b = baby(true);
  Object.assign(b.state.bootstrap, { ask_consent_version: 1 });
  const accepted = acknowledgeAsk(b);
  press("Allow processing");
  await expect(accepted).resolves.toBe(true);
  expect(b.api.profile).toHaveBeenCalledWith(expect.objectContaining({ acknowledge_ai_consent_version: 1 }), 3);
  (b.api.profile as unknown as ReturnType<typeof vi.fn>).mockClear();
  const declined = acknowledgeAsk(b);
  press("Keep off");
  await expect(declined).resolves.toBe(false);
  expect(b.api.profile).not.toHaveBeenCalled();
});

it("turning AI on while the new Ask is on counts as seeing its words, and not before", async () => {
  const b = baby(false);
  Object.assign(b.state.bootstrap, { ask_consent_version: 1 });
  const on = ensureAiConsent(b);
  press("Allow processing");
  await on;
  expect(b.api.profile).toHaveBeenCalledWith(expect.objectContaining({ acknowledge_ai_consent_version: 1 }), 3);
  const off = baby(false), plain = ensureAiConsent(off);
  press("Allow processing");
  await plain;
  expect(off.api.profile).toHaveBeenCalledWith(expect.not.objectContaining({ acknowledge_ai_consent_version: expect.anything() }), 3);
});
