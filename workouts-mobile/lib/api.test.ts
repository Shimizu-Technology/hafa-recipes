import { describe, it, expect, vi } from "vitest";
import { createWorkoutsApi } from "./api";
describe("authenticated API boundary", () => {
  it("never makes an unauthenticated training request", async () => {
    const transport = vi.fn();
    const api = createWorkoutsApi("https://example.test", async () => null, transport);
    await expect(api.library()).rejects.toThrow("Sign in again");
    expect(transport).not.toHaveBeenCalled();
  });
  it("uses workouts namespace and bearer authentication", async () => {
    const transport = vi.fn().mockResolvedValue(new Response("[]"));
    const api = createWorkoutsApi("https://example.test/", async () => "owned-test-token", transport);
    await expect(api.library()).resolves.toEqual([]);
    expect(transport.mock.calls[0][0]).toBe("https://example.test/api/v1/workouts/library?limit=50&offset=0");
    expect(transport.mock.calls[0][1].headers.Authorization).toBe("Bearer owned-test-token");
  });
  it("does not expose provider bodies or mistake unavailable backend for an empty library", async () => {
    const transport = vi.fn().mockResolvedValue(new Response("private diagnostic", { status: 503 }));
    const api = createWorkoutsApi("https://example.test", async () => "token", transport);
    await expect(api.library()).rejects.toThrow("unavailable");
  });
});
it("retains the captured generation on delayed writes and never auto-enrolls", async () => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const transport = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: String(url), options: options ?? {} });
    if (String(url).endsWith("/enrollment"))
      return new Response(
        JSON.stringify({
          enrolled: false,
          generation: 2,
          disclosure_version: 1,
          adult_confirmed: false,
          shared_account_deletion_acknowledged: false,
          enrolled_at: null,
        })
      );
    return new Response("{}", { status: 409 });
  }) as typeof fetch;
  const api = createWorkoutsApi("https://example.test", async () => "token", transport);
  await api.enrollment();
  await expect(
    api.saveSession(
      {
        client_session_id: "owned-client",
        workout_id: "workout",
        workout_revision: 1,
        started_at: "2026-10-10T00:00:00Z",
        finished_at: "2026-10-10T00:10:00Z",
        status: "partial",
        actuals: [],
      },
      1
    )
  ).rejects.toThrow("changed elsewhere");
  expect((calls[1].options.headers as Record<string, string>)["X-Workouts-Generation"]).toBe("1");
  expect(calls.map((c) => c.options.method)).toEqual(["GET", "POST"]);
  expect(calls[1].url).toContain("/sessions");
});
it("uses original profile revision, then exposes the new server revision", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(new Response("null", { headers: { "X-Workouts-Revision": "0" } }))
    .mockResolvedValueOnce(new Response("{}", { headers: { "X-Workouts-Revision": "4" } }));
  const api = createWorkoutsApi("https://example.test", async () => "token", transport);
  await api.profile();
  expect(api.profileRevision()).toBe(0);
  await api.saveProfile({ adult_confirmed: true } as import("./models").TrainingProfile, 3, 1);
  expect(transport.mock.calls[1][1].headers["If-Match"]).toBe('"3"');
  expect(api.profileRevision()).toBe(4);
});

it("stops a delayed token when the Clerk identity changes, including bootstrap requests", async () => {
  let binding = "issuer:account-a";
  let release!: (value: string) => void;
  const token = new Promise<string>((resolve) => {
    release = resolve;
  });
  const transport = vi.fn();
  const api = createWorkoutsApi("https://example.test", () => token, transport, {
    binding,
    currentBinding: () => binding,
  });
  const pending = api.identity();
  binding = "issuer:account-b";
  release("new-account-token");
  await expect(pending).rejects.toThrow("account changed");
  expect(transport).not.toHaveBeenCalled();
});
it("captures the stable owner header and rejects old callbacks before requesting another token", async () => {
  let binding = "a";
  const getToken = vi.fn(async () => "token");
  const transport = vi.fn().mockResolvedValue(new Response("[]"));
  const api = createWorkoutsApi("https://example.test", getToken, transport, {
    owner: "stable-owner-a",
    binding,
    currentBinding: () => binding,
  });
  await api.library();
  expect(transport.mock.calls[0][1].headers["X-Hafa-Account-ID"]).toBe("stable-owner-a");
  binding = "b";
  await expect(api.library()).rejects.toThrow("account changed");
  expect(getToken).toHaveBeenCalledTimes(1);
});
it("changes only recipe choices with their original scoped revision and account/generation", async () => {
  const transport = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ generation: 7, revision: 2, library_context: false, meal_plan_context: true, scopes: [] })
      )
  );
  const api = createWorkoutsApi("https://example.test", async () => "token", transport, {
    owner: "stable-A",
    binding: "subject-A",
    currentBinding: () => "subject-A",
  });
  await api.saveRecipeGrants(1, false, true, 7);
  const [url, options] = transport.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain("/connections/recipes/grants");
  expect(JSON.parse(options.body as string)).toEqual({
    expected_revision: 1,
    library_context: false,
    meal_plan_context: true,
  });
  expect((options.headers as Record<string, string>)["X-Workouts-Generation"]).toBe("7");
  expect((options.headers as Record<string, string>)["X-Hafa-Account-ID"]).toBe("stable-A");
});
it("keeps export and removal owner/generation fences and never silently re-enrolls", async () => {
  const transport = vi.fn(async () => new Response(JSON.stringify({ generation: 3, enrolled: false })));
  const api = createWorkoutsApi("https://example.test", async () => "token", transport, {
    owner: "stable-A",
    binding: "subject-A",
    currentBinding: () => "subject-A",
  });
  await api.exportPage(2, 10);
  await api.removeWorkoutsData(2);
  expect(transport.mock.calls).toHaveLength(2);
  const calls = transport.mock.calls as unknown as [string, RequestInit][];
  expect(calls[0][0]).toContain("/export?limit=10&offset=10");
  expect(calls[1][1].method).toBe("DELETE");
  for (const [, options] of calls)
    expect((options.headers as Record<string, string>)["X-Workouts-Generation"]).toBe("2");
});
it("keeps manual activity UUID/revision/account/generation on retries and refetches profile epochs", async () => {
  let active = "subject-A";
  const body = {
    request_id: "immutable-operation",
    kind: "run" as const,
    date: "2026-10-10",
    duration_minutes: 20,
    strenuous: null,
    expected_revision: 4,
  };
  const transport = vi.fn(
    async (_url: RequestInfo | URL, _options?: RequestInit) =>
      new Response(JSON.stringify({ id: "activity", generation: 2, revision: 5, profile_revision: 9 }))
  );
  const api = createWorkoutsApi("https://example.test", async () => "token", transport, {
    owner: "stable-A",
    binding: "subject-A",
    currentBinding: () => active,
  });
  await api.saveActivity("activity", body, 2);
  await api.saveActivity("activity", body, 2);
  const calls = transport.mock.calls;
  expect(calls[0][1]?.body).toBe(calls[1][1]?.body);
  expect(JSON.parse(calls[0][1]?.body as string)).toEqual(body);
  expect((calls[0][1]?.headers as Record<string, string>)["X-Workouts-Generation"]).toBe("2");
  expect((calls[0][1]?.headers as Record<string, string>)["X-Hafa-Account-ID"]).toBe("stable-A");
  expect(api.profileRevision()).toBeNull();
  active = "subject-B";
  await expect(api.saveActivity("activity", body, 2)).rejects.toThrow("account changed");
  expect(transport).toHaveBeenCalledTimes(2);
});
it("rejects activity data from a changed generation even when read authentication remains valid", async () => {
  const api = createWorkoutsApi(
    "https://example.test",
    async () => "token",
    async () => new Response(JSON.stringify({ items: [{ generation: 3 }], generation: 3 }))
  );
  await expect(api.activityLog(2)).rejects.toThrow("enrollment changed");
  await expect(api.activity("owned", 2)).rejects.toThrow("enrollment changed");
});

it("does not revert API membership when a same-generation tombstone GET resolves after setup publication", async () => {
  let resolve!: (value: Response) => void;
  const pending = new Promise<Response>((done) => { resolve = done; });
  const api = createWorkoutsApi("https://example.test", async () => "synthetic", vi.fn(async () => pending));
  const old = api.enrollment();
  const checked = expect(old).rejects.toMatchObject({ status: 409 });
  api.commitEnrollment({ enrolled: true, generation: 2, disclosure_version: 1, adult_confirmed: true, shared_account_deletion_acknowledged: true, enrolled_at: "2026-10-10T00:00:00Z" });
  resolve(new Response(JSON.stringify({ enrolled: false, generation: 2 })));
  await checked; expect(api.generation()).toBe(2);
});

it("retires GETs that began while explicit enrollment was still awaiting acknowledgement", async () => {
  let resolve!: (value: Response) => void;
  const pending = new Promise<Response>((done) => { resolve = done; });
  const api = createWorkoutsApi("https://example.test", async () => "synthetic", vi.fn(async (_url, options) =>
    options?.method === "POST" ? new Response(JSON.stringify({ enrolled: true, generation: 3 })) : pending));
  const posted = api.enroll(true, 2);
  const old = api.enrollment(); const checked = expect(old).rejects.toMatchObject({ status: 409 });
  await posted; resolve(new Response(JSON.stringify({ enrolled: false, generation: 2 })));
  await checked; expect(api.generation()).toBe(3);
});
