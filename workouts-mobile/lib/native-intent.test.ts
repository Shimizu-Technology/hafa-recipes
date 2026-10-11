import { it, expect } from "vitest";
import { incomingNativePath, safeIncomingEncoding } from "./native-intent";
import { callbackNonce } from "./oauth-callback";
const token = "a".repeat(43);
it("preserves observed rationale, share, capture and private deep-link paths", () => {
  expect(incomingNativePath("hafaworkouts://health-rationale")).toBe("/health-rationale");
  expect(incomingNativePath("hafaworkouts:///health-rationale")).toBe("/health-rationale");
  expect(incomingNativePath(`hafaworkouts://shared/${token}`)).toBe(`/shared/${token}`);
  expect(
    incomingNativePath(`https://workouts.example/shared/${token}`, { websiteOrigin: "https://workouts.example" })
  ).toBe(`/shared/${token}`);
  expect(incomingNativePath("hafaworkouts://workout/owned-id")).toBe("/workout/owned-id");
  expect(incomingNativePath("hafaworkouts://dataUrl=hafaworkoutsShareKey#media")).toBe("/capture");
  expect(incomingNativePath("/(tabs)/library")).toBe("/(tabs)/library");
});
it("allows OAuth subscribers to consume the unchanged original callback while Router opens sign-in", () => {
  const callback = "hafaworkouts://oauth-callback?rotating_token_nonce=nonce%2Bsafe";
  expect(incomingNativePath(callback)).toBe("/sign-in");
  expect(callbackNonce(callback)).toBe("nonce+safe");
  expect(incomingNativePath("hafaworkouts://oauth-callback?error=access_denied")).toBe("/sign-in");
});
it("rejects malformed and overlong UTF-8 sequences, lone/repeated percents and encoded route separators", () => {
  for (const value of ["%", "%GG", "%C0%AF", "%ED%A0%80", "%F0%28%8C%28", "%F4%90%80%80", "%E2%82", "%".repeat(8000)])
    expect(incomingNativePath(`/capture?text=${value}`)).toBe("/invalid-link");
  expect(incomingNativePath("/%2568ealth-rationale")).toBe("/invalid-link");
  expect(incomingNativePath(`/shared/${token}%2Fother`)).toBe("/invalid-link");
  expect(safeIncomingEncoding("a".repeat(8193))).toBe(false);
  expect(() => callbackNonce("hafaworkouts://oauth-callback?rotating_token_nonce=%E2%82")).toThrow("Malformed");
});
it("does not recursively decode legitimate nested source percent escapes or captions", () => {
  const query = "/capture?source_url=https%3A%2F%2Fcreator.example%2Fsession%3Fx%3D%2520%26y%3D2&caption=H%C3%A5fa";
  expect(incomingNativePath(query)).toBe(query);
  expect(new URL(incomingNativePath(query), "https://local.invalid").searchParams.get("source_url")).toBe(
    "https://creator.example/session?x=%20&y=2"
  );
  expect(incomingNativePath("/capture?text=%2525")).toBe("/capture?text=%2525");
});
it("rejects unrelated origins/schemes, credentials, control characters and ambiguous network paths", () => {
  for (const path of [
    "javascript:alert(1)",
    "hafarecipes://capture",
    "https://evil.example/capture",
    "hafaworkouts://user:secret@capture",
    "//evil.example/capture",
    "hafaworkouts://capture\\bad",
    "hafaworkouts://capture\n",
  ])
    expect(incomingNativePath(path, { websiteOrigin: "https://workouts.example" })).toBe("/invalid-link");
  expect(
    incomingNativePath("exp+hafa-workouts://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081", {
      development: true,
    })
  ).toBe("/");
  expect(incomingNativePath("exp+hafa-workouts://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081")).toBe(
    "/invalid-link"
  );
});
