import { describe, it, expect, vi } from "vitest";
import { sourceRefusalMessages } from "./import-status";
import { ApiError, createBabyApi } from "./api";
import { optimisticRecord } from "./models";
const row = optimisticRecord({
  id: "record",
  kind: "journal",
  title: "Note",
  body: "Private",
  child_id: null,
  occurred_at: "2026-10-20T00:00:00Z",
  data: {},
});
describe("Baby wire boundaries", () => {
  it("sends all of an event's data on an edit, because PATCH replaces it", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(row)),
      api = createBabyApi("https://service.example", async () => "token", () => true, transport),
      data = { timezone: "Pacific/Guam", recurrence: { frequency: "weekly" as const }, reminder_minutes: [60], exceptions: [{ original_start: "2026-11-16T00:00:00Z", cancelled: true }] };
    await api.save({ id: "e", kind: "event", title: "Class", body: "", child_id: null, occurred_at: "2026-11-02T00:00:00Z", data, revision: 3 }, 1);
    expect(transport.mock.calls[0][1]?.method).toBe("PATCH");
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body)).data).toEqual(data);
  });
  it("tells her plainly when she has too many repeating events", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ detail: "You can keep up to 200 repeating events" }, { status: 422 })),
      api = createBabyApi("https://service.example", async () => "token", () => true, transport);
    await expect(api.save({ id: "e", kind: "event", title: "Class", body: "", child_id: null, occurred_at: "2026-11-02T00:00:00Z", data: {} }, 1))
      .rejects.toThrow("You can keep up to 200 repeating events. Delete one you no longer need, or save this one without repeating.");
  });
  it("reads occurrences by calendar day, for one baby or everyone", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ items: [], complete: true })),
      api = createBabyApi("https://service.example", async () => "token", () => true, transport);
    await api.events("2026-12-01", "2026-12-31", "baby");
    await api.events("2026-12-01", "2026-12-31", null);
    expect(transport.mock.calls.map(([url]) => String(url).split("/baby")[1])).toEqual(["/events?from=2026-12-01&to=2026-12-31&child_id=baby", "/events?from=2026-12-01&to=2026-12-31"]);
  });
  it("sends a split as one request, with only what the new event is", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ series: null, event: {} })),
      api = createBabyApi("https://service.example", async () => "token", () => true, transport);
    const event = { id: "n", kind: "event" as const, title: "New", body: "", child_id: null, occurred_at: "2026-11-16T00:00:00Z", data: { timezone: "Pacific/Guam" }, revision: undefined };
    await api.splitEvent("class", { revision: 4, from_start: "2026-11-16T00:00:00Z", event }, 1);
    const [url, init] = transport.mock.calls[0];
    expect(String(url)).toMatch(/\/events\/class\/split$/);
    expect(init!.method).toBe("POST");
    expect(JSON.parse(String(init!.body))).toEqual({ revision: 4, from_start: "2026-11-16T00:00:00Z", event: { id: "n", kind: "event", title: "New", body: "", child_id: null, occurred_at: "2026-11-16T00:00:00Z", data: { timezone: "Pacific/Guam" } } });
    expect((init!.headers as Record<string, string>)["X-Baby-Generation"]).toBe("1");
  });
  it("uses the shared account routes registered by the existing Håfa API", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: "owner" }));
    const api = createBabyApi(
      "https://service.example",
      async () => "token",
      () => true,
      transport
    );
    await api.identity();
    await api.deleteAccount();
    expect(transport.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["https://service.example/api/users/me/identity", "GET"],
      ["https://service.example/api/users/me", "DELETE"],
    ]);
  });
  it("sends generation and revision while retaining the caller durable record ID", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(row));
    const api = createBabyApi(
      "https://service.example",
      async () => "token",
      () => true,
      transport
    );
    await api.save({ ...row, revision: 3 }, 7);
    expect(transport).toHaveBeenCalledWith(
      "https://service.example/api/v1/baby/records/record",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "X-Baby-Generation": "7", Authorization: "Bearer token" }),
        body: expect.stringContaining('"revision":3'),
      })
    );
  });
  it("creates a new child with its durable ID rather than patching it", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "child" }));
    await createBabyApi(
      "https://service.example",
      async () => "token",
      () => true,
      transport
    ).child({ id: "child", name: "Baby" }, 1);
    expect(transport.mock.calls[0][0]).toBe("https://service.example/api/v1/baby/children");
    expect(transport.mock.calls[0][1]?.method).toBe("POST");
  });
  it("fences account changes while obtaining a token", async () => {
    let current = true;
    const transport = vi.fn<typeof fetch>();
    const api = createBabyApi(
      "https://service.example",
      async () => {
        current = false;
        return "token";
      },
      () => current,
      transport
    );
    await expect(api.save(row, 1)).rejects.toMatchObject({ status: 409 });
    expect(transport).not.toHaveBeenCalled();
  });
  it("keeps token-refresh failures in the authentication pause rather than failing queued records", async () => {
    const transport = vi.fn<typeof fetch>();
    const api = createBabyApi("https://service.example", async () => { throw Error("private SDK detail"); },
      () => true, transport);
    await expect(api.save(row, 1)).rejects.toMatchObject({ status: 401, message: expect.stringContaining("sign-in") });
    expect(transport).not.toHaveBeenCalled();
  });
  it("retains the account fence when token refresh rejects after an account change", async () => {
    let current = true;
    const transport = vi.fn<typeof fetch>();
    const api = createBabyApi("https://service.example", async () => { current = false; throw Error("SDK detail"); },
      () => current, transport);
    await expect(api.save(row, 1)).rejects.toMatchObject({ status: 409 });
    expect(transport).not.toHaveBeenCalled();
  });
  it("fences account changes while a response is in flight", async () => {
    let current = true;
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
      current = false;
      return Response.json(row);
    });
    const api = createBabyApi(
      "https://service.example",
      async () => "token",
      () => current,
      transport
    );
    await expect(api.record("record")).rejects.toMatchObject({ status: 409 });
  });
  it("uses safe error text rather than disclosing server response content", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ detail: "database private content" }, { status: 409 }));
    const api = createBabyApi(
      "https://service.example",
      async () => "token",
      () => true,
      transport
    );
    await expect(api.save(row, 1)).rejects.toThrow("local version is safe");
  });
  it("does not silently reactivate a tombstoned account", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ active: false, generation: 2 }));
    const api = createBabyApi(
      "https://service.example",
      async () => "token",
      () => true,
      transport
    );
    await api.bootstrap();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toBe("https://service.example/api/v1/baby/bootstrap");
  });
});

describe("generation response leases", () => {
  it("rejects a held record read after product deletion begins", async () => {
    let release!: (value: Response) => void;
    const held = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const api = createBabyApi(
      "https://service.example",
      async () => "token",
      () => true,
      async (path) => (path.includes("/records/") ? held : Response.json({ generation: 1, active: true }))
    );
    await api.bootstrap();
    const reading = api.record("old-record");
    await Promise.resolve();
    await api.erase(1);
    release(Response.json(row));
    await expect(reading).rejects.toMatchObject({ status: 410, local: true });
  });
  it("fences pending list responses when bootstrap discovers a newer generation", async () => {
    let generation = 1,
      release!: (value: Response) => void;
    const held = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const api = createBabyApi(
      "https://service.example",
      async () => "token",
      () => true,
      async (path) => (path.includes("/records?") ? held : Response.json({ generation, active: true }))
    );
    await api.bootstrap();
    const reading = api.records();
    await Promise.resolve();
    generation = 2;
    await api.bootstrap();
    release(Response.json({ items: [row], total: 1, has_more: false }));
    await expect(reading).rejects.toMatchObject({ status: 410, local: true });
  });
  it("retires an already-returned response lease before its queued device commit", async () => {
    const api = createBabyApi(
      "https://service.example",
      async () => "token",
      () => true,
      async () => Response.json({ generation: 1, active: true })
    );
    await api.bootstrap();
    const lease = api.lease();
    await api.erase(1);
    expect(() => api.assertLease(lease)).toThrow("earlier Baby space");
  });
});

it("retries a private file with its original durable upload identity", async () => {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: "file" }));
  const api = createBabyApi(
    "https://service.example",
    async () => "token",
    () => true,
    transport
  );
  const body = new FormData();
  await api.upload(body, 4, "same-file-id");
  await api.upload(body, 4, "same-file-id");
  for (const [, init] of transport.mock.calls)
    expect(init?.headers).toEqual(
      expect.objectContaining({ "Idempotency-Key": "same-file-id", "X-Baby-Generation": "4" })
    );
});


it("serializes kind groups as repeated query values and preserves false and zero", async () => {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({items: [], total: 0, has_more: false}));
  const api = createBabyApi("https://service.example", async () => "token", () => true, transport);
  await api.records({kinds: ["journal", "question", "feeding"], include_general: false, offset: 0,
    child_id: "child & one", q: "hospital & bag", limit: 30});
  const query = new URL(String(transport.mock.calls[0][0])).searchParams;
  expect(query.getAll("kinds")).toEqual(["journal", "question", "feeding"]);
  expect(query.get("include_general")).toBe("false");
  expect(query.get("offset")).toBe("0");
  expect(query.get("child_id")).toBe("child & one");
  expect(query.get("q")).toBe("hospital & bag");
  expect(query.has("kind")).toBe(false);
  await api.search("old question", "source", "child", {include_general: true});
  expect(new URL(String(transport.mock.calls[1][0])).searchParams.get("include_general")).toBe("true");
});


describe("daily AI limit privacy boundary", () => {
  it("maps only the allowlisted Baby code to clear daily-limit copy", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      detail: { code: "baby_ai_daily_limit", message: "private provider response must not appear" },
    }, { status: 429 }));
    const api = createBabyApi("https://service.example", async () => "token", () => true, transport);
    await expect(api.chat({ request_id: "question", message: "Saved?", scope: "all" }, 1))
      .rejects.toMatchObject({ status: 429, message: "Daily AI limit reached. Your originals and available text are saved. Try again later." });
  });
  it.each([
    { detail: "private response" },
    { detail: { code: "other_limit", message: "private response" } },
    { detail: { code: "workouts_ai_budget_exceeded" } },
  ])("keeps unrelated 429 details private", async (body) => {
    const api = createBabyApi("https://service.example", async () => "token", () => true,
      async () => Response.json(body, { status: 429 }));
    await expect(api.records()).rejects.toMatchObject({ status: 429, message: "Please wait a moment before trying again." });
  });
  it("keeps malformed 429 bodies private", async () => {
    const api = createBabyApi("https://service.example", async () => "token", () => true,
      async () => new Response("not JSON", { status: 429 }));
    await expect(api.records()).rejects.toMatchObject({ status: 429, message: "Please wait a moment before trying again." });
  });

  it.each([
    ["Add the birth date to see what is relevant now", "Add the birth date to see what is relevant now."],
    ["Choose which child to show timing for", "Choose which child to show timing for."],
    ["private provider detail", "Some details need review. Check your entries and try again."],
    [{ msg: "Add the birth date to see what is relevant now" }, "Some details need review. Check your entries and try again."],
  ])("shows only the server's fixed timing 422 messages (%s)", async (detail, message) => {
    const api = createBabyApi("https://service.example", async () => "token", () => true,
      async () => Response.json({ detail }, { status: 422 }));
    await expect(api.records({ timing: "now" })).rejects.toMatchObject({ status: 422, message });
  });
  it("keeps malformed 422 bodies private", async () => {
    const api = createBabyApi("https://service.example", async () => "token", () => true,
      async () => new Response("not JSON", { status: 422 }));
    await expect(api.records()).rejects.toMatchObject({ status: 422, message: "Some details need review. Check your entries and try again." });
  });
});


describe("optional saved source links", () => {
  it("repairs an existing durable photo-share create with a blank URL without mutating the queued record", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(row));
    const api = createBabyApi("https://service.example", async () => "token", () => true, transport);
    const queued = { ...row, kind: "source" as const, revision: undefined,
      data: { url: "", attachment_ids: ["first-photo", "second-photo"], status: "saved" } };
    await api.save(queued, 7);
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe("https://service.example/api/v1/baby/records");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ id: row.id, kind: "source",
      data: { url: null, attachment_ids: ["first-photo", "second-photo"], status: "saved" } });
    expect(init?.headers).toMatchObject({ "X-Baby-Generation": "7" });
    expect(queued.data.url).toBe("");
  });
  it("sends an explicit null on PATCH to clear a whitespace-only source URL", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(row));
    const api = createBabyApi("https://service.example", async () => "token", () => true, transport);
    await api.save({ ...row, kind: "source", revision: 3, data: { url: " \n\t ", topics: ["Hospital bag"] } }, 7);
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe("https://service.example/api/v1/baby/records/record");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ title: row.title, body: row.body, child_id: null,
      occurred_at: row.occurred_at, revision: 3, data: { url: null, topics: ["Hospital bag"] } });
  });
  it("preserves nonblank source URLs exactly, other record kinds and omitted optional URLs", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(row));
    const api = createBabyApi("https://service.example", async () => "token", () => true, transport);
    const url = "https://example.test/baby?name=Hospital%20bag#packing";
    await api.save({ ...row, kind: "source", data: { url: `  ${url} \n`, topics: ["Prep"] } }, 7);
    await api.save({ ...row, kind: "source", revision: 3, data: { url: `  ${url} \n`, topics: ["Prep"] } }, 7);
    const journalData = { url: "  keep unchanged  ", provenance: "caregiver_observation" as const };
    await api.save({ ...row, data: journalData }, 7);
    await api.save({ ...row, kind: "source", data: { attachment_ids: ["photo"] } }, 7);
    const bodies = transport.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies[0].data).toEqual({ url: `  ${url} \n`, topics: ["Prep"] });
    expect(bodies[1].data).toEqual(bodies[0].data);
    expect(bodies[2].data).toEqual(journalData);
    expect(bodies[3].data).toEqual({ attachment_ids: ["photo"] });
  });
  it("replays the original accepted create payload after a lost acknowledgement without a URL-induced conflict", async () => {
    // This is the body accepted by the old client before the response was lost.
    // The durable outbox survives the update; the server rejects changed replays.
    const queued = { id: "0f6ca0c9-25b5-4c75-a908-e9471409da31", kind: "source" as const,
      title: "Feeding tips", body: "", child_id: null, occurred_at: row.occurred_at,
      data: { url: "  https://example.test/baby?topic=feeding  ", topics: ["Feeding"] } };
    const originalBody = JSON.stringify(queued);
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) =>
      String(init?.body) === originalBody
        ? Response.json({ ...queued, revision: 1 })
        : Response.json({ detail: "changed replay" }, { status: 409 }));
    const api = createBabyApi("https://service.example", async () => "token", () => true, transport);
    await expect(api.save(queued, 7)).resolves.toMatchObject({ id: queued.id, revision: 1 });
    await expect(api.save(queued, 7)).resolves.toMatchObject({ id: queued.id, revision: 1 });
    expect(transport.mock.calls.map(([, init]) => init?.body)).toEqual([originalBody, originalBody]);
  });

});

it("sends collection/topic membership filters with paginated records and search", async () => {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ items: [], total: 0, has_more: false }));
  const api = createBabyApi("https://service.example", async () => "token", () => true, transport);
  const filters = { collection_id: "collection", topic: "Hospital & bag", offset: 30, limit: 30, include_general: true };
  await api.records({ kind: "source", child_id: "child", q: "packing", ...filters });
  await api.search("packing", "source", "child", filters);
  for (const [url] of transport.mock.calls) {
    const query = new URL(String(url)).searchParams;
    expect(Object.fromEntries(query)).toMatchObject({ kind: "source", collection_id: "collection", topic: "Hospital & bag",
      child_id: "child", q: "packing", offset: "30", limit: "30", include_general: "true" });
  }
});

it("uses the explicit shared signup provisioner without a Baby generation header", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: "created", app_user_id: "app_owner" }));
  const api = createBabyApi("https://service.example", async () => "verified-token", () => true, transport);
  await api.onboard("cmi_" + "a".repeat(64));
  const [url, init] = transport.mock.calls[0];
  expect(url).toBe("https://service.example/api/auth/clerk-transition/onboard");
  expect(init?.method).toBe("POST");
  expect(JSON.parse(init?.body as string)).toEqual({ installation_id: "cmi_" + "a".repeat(64), intent: "create_account" });
  expect(init?.headers).toEqual({ Authorization: "Bearer verified-token", "Content-Type": "application/json", "X-Baby-Client": "2" });
});

it("distinguishes server upload failure from offline without reflecting private details", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ detail: "private database error" }, { status: 500 }));
  const api = createBabyApi("https://service.example", async () => "token", () => true, transport);
  await expect(api.upload(new FormData(), 1, "photo")).rejects.toMatchObject({ status: 500, message: expect.stringContaining("could not upload this attachment") });
  transport.mockRejectedValueOnce(new TypeError("Network request failed"));
  await expect(api.save(row, 1)).rejects.toMatchObject({ status: 0, message: expect.stringContaining("offline") });
});

it("sends client 2 until bootstrap says the family stack is on", async () => {
  const { babyClient, createBabyApi: create } = await import("./api");
  const seen: Record<string, string>[] = [];
  const api = create("https://api.test", async () => "token", () => true, async (_url, init) => {
    seen.push(init!.headers as Record<string, string>);
    return new Response(JSON.stringify({ items: [], total: 0, has_more: false }), { status: 200 });
  });
  await api.records({});
  expect(babyClient).toBe(2);
  expect(seen[0]["X-Baby-Client"]).toBe("2");
  // Client 2 stays in the personal space, so it never names one.
  expect(seen[0]["X-Baby-Space"]).toBeUndefined();
});

describe("feed actions on the wire", () => {
  function capture() {
    const calls: { url: string; method?: string; body?: any }[] = [];
    const api = createBabyApi("https://api.test", async () => "token", () => true, async (url, init) => {
      calls.push({ url, method: init?.method, body: JSON.parse(String(init?.body ?? "null")) });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    return { api, calls };
  }
  it("posts the contract's body, with the action's id as its idempotency", async () => {
    const { api, calls } = capture();
    await api.feedAction("feed", { id: "act", action: "switch", at: "2026-11-04T12:00:00Z", side: "right" }, 2);
    expect(calls[0]).toMatchObject({ url: "https://api.test/api/v1/baby/records/feed/feed-action", method: "POST", body: { action_id: "act", action: "switch", at: "2026-11-04T12:00:00Z", side: "right" } });
    await api.feedAction("feed", { id: "end", action: "finish", at: "2026-11-04T12:09:00Z" }, 2);
    expect(calls[1].body).toEqual({ action_id: "end", action: "finish", at: "2026-11-04T12:09:00Z" });
  });
  it("creates a feed with its start, and never sends actions back on an ordinary edit", async () => {
    const { api, calls } = capture(), data = { method: "breast" as const, side: "left" as const, state: "running" as const, actions: [{ id: "s", action: "start" as const, at: "2026-11-04T12:00:00Z", side: "left" as const }] },
      write = { id: "feed", kind: "feeding" as const, title: "Feeding", body: "", child_id: "baby", occurred_at: "2026-11-04T12:00:00Z", data };
    await api.save(write, 2);
    expect(calls[0].body.data.actions).toHaveLength(1);
    await api.save({ ...write, revision: 3, body: "A note" }, 2);
    expect(calls[1]).toMatchObject({ method: "PATCH", body: { body: "A note", revision: 3, data: { method: "breast", side: "left" } } });
    expect(calls[1].body.data).not.toHaveProperty("actions");
    expect(calls[1].body.data).not.toHaveProperty("state");
    // A sleep's end is not a feed's.
    await api.save({ ...write, kind: "sleep", data: { end_at: "2026-11-04T13:00:00Z" }, revision: 3 }, 2);
    expect(calls[2].body.data.end_at).toBe("2026-11-04T13:00:00Z");
  });
});

describe("the client level", () => {
  const personal = "11111111-1111-4111-8111-111111111111", family = "22222222-2222-4222-8222-222222222222";
  const spaces = [{ id: personal, kind: "personal", role: "parent", generation: 1, access_version: 1 }];
  const live = { generation: 1, children: [], ai_available: false, profile: {}, personal_space_id: personal, spaces };
  function wire(known: () => any = () => undefined) {
    const calls: { url: string; method?: string; headers: Record<string, string> }[] = [];
    let answer: unknown = { items: [], total: 0, has_more: false };
    const api = createBabyApi("https://api.test", async () => "token", () => true, async (url, init) => {
      calls.push({ url, method: init?.method, headers: init!.headers as Record<string, string> });
      return new Response(JSON.stringify(answer), { status: 200 });
    }, known);
    return { api, calls, last: () => calls[calls.length - 1], answers: (value: unknown) => { answer = value; } };
  }
  const row = { id: "a", kind: "diaper", title: "", body: "", child_id: null, occurred_at: "2026-11-05T00:00:00Z", data: {} } as never;
  it("always asks bootstrap as client 3, which is how it hears the family stack is on, and it answers the same as 2 while it's off", async () => {
    const { api, last, answers } = wire();
    answers({ generation: 1, children: [], ai_available: false, profile: {} });
    await api.bootstrap();
    expect(last().headers["X-Baby-Client"]).toBe("3");
    expect(last().headers["X-Baby-Space"]).toBeUndefined();
  });
  it("stays client 2 everywhere else while bootstrap doesn't list spaces: with the flag off the API treats client 3 as legacy, without events", async () => {
    const { api, last } = wire(() => ({ generation: 1, children: [], ai_available: false, profile: {} }));
    await api.records({});
    expect(last().headers["X-Baby-Client"]).toBe("2");
    await api.save(row, 1);
    expect(last().headers["X-Baby-Client"]).toBe("2");
    expect(last().headers["X-Baby-Space"]).toBeUndefined();
  });
  it("becomes client 3 as soon as this account's bootstrap lists spaces, including what was saved on this phone before it reconnects", async () => {
    const { api, last } = wire(() => live);
    await api.records({});
    expect(last().headers["X-Baby-Client"]).toBe("3");
    expect(last().headers["X-Baby-Space"]).toBeUndefined();
  });
  it("asks for a share credential as client 3 whatever it holds: an older client asking would read as an old phone", async () => {
    const { api, last } = wire(() => ({ generation: 1, children: [], ai_available: false, profile: {} }));
    await api.request("/share/session", "POST", { installation_id: "i" }, 1);
    expect(last().headers["X-Baby-Client"]).toBe("3");
    expect(last().headers["X-Baby-Space"]).toBeUndefined();
  });
  it("names the personal space on a write unless it's told the row's own", async () => {
    const { api, last } = wire(() => live);
    await api.save(row, 1);
    expect(last().headers["X-Baby-Space"]).toBe(personal);
    expect(last().headers["X-Baby-Generation"]).toBe("1");
    await api.save(row, { generation: 4, space_id: family });
    expect(last().headers["X-Baby-Space"]).toBe(family);
    expect(last().headers["X-Baby-Generation"]).toBe("4");
  });
  it("drops back to client 2 if the flag is turned off, and ignores a space it was told about", async () => {
    const { api, last } = wire(() => ({ generation: 1, children: [], ai_available: false, profile: {} }));
    await api.save(row, { generation: 1, space_id: family });
    expect(last().headers["X-Baby-Client"]).toBe("2");
    expect(last().headers["X-Baby-Space"]).toBeUndefined();
  });
  it("sends its cursor and access versions as JSON maps to /changes", async () => {
    const { api, last, answers } = wire(() => live);
    answers({ spaces: [], cursor: {}, has_more: false, removed_space_ids: [] });
    await api.changes({ [personal]: 5 }, { [personal]: 2 });
    const url = new URL(last().url);
    expect(url.pathname).toBe("/api/v1/baby/changes");
    expect(JSON.parse(url.searchParams.get("cursor")!)).toEqual({ [personal]: 5 });
    expect(JSON.parse(url.searchParams.get("access_version")!)).toEqual({ [personal]: 2 });
  });
  describe("the generation map", () => {
    const answer = (familySpaces: object[], generation = 1) => ({ ...live, generation, spaces: [...spaces, ...familySpaces] });
    const familySpace = (generation = 1) => ({ id: family, kind: "family", role: "parent", generation, access_version: 1 });
    it("joining a space doesn't end the lease on work under way", async () => {
      const { api, answers } = wire(() => live);
      answers(answer([]));
      await api.bootstrap();
      const lease = api.lease();
      answers(answer([familySpace()]));
      await api.bootstrap();
      expect(api.lease()).toBe(lease);
    });
    it("a space's generation changing, or a space going, ends the lease", async () => {
      const { api, answers } = wire(() => live);
      answers(answer([familySpace()]));
      await api.bootstrap();
      let lease = api.lease();
      answers(answer([familySpace(2)]));
      await api.bootstrap();
      expect(api.lease()).toBe(lease + 1);
      lease = api.lease();
      answers(answer([]));
      await api.bootstrap();
      expect(api.lease()).toBe(lease + 1);
    });
    it("refuses an older answer for any one space", async () => {
      const { api, answers } = wire(() => live);
      answers(answer([familySpace(3)]));
      await api.bootstrap();
      answers(answer([familySpace(2)]));
      await expect(api.bootstrap()).rejects.toMatchObject({ status: 410, local: true });
    });
  });
});

describe("a 409 that says where a row went", () => {
  const moved = { code: "moved", space_id: "f", generation: 1, revision: 4, record: { id: "a", kind: "diaper", revision: 4 } };
  const on = (status: number, body: unknown) => createBabyApi("https://api.test", async () => "token", () => true, async () => new Response(JSON.stringify(body), { status }));
  const row = { id: "a", kind: "diaper", title: "", body: "", child_id: null, occurred_at: "2026-11-05T00:00:00Z", data: {} } as never;
  it("says so, with the row, as the API really sends it: the body itself, not under detail", async () => {
    await expect(on(409, moved).save(row, 1)).rejects.toMatchObject({ status: 409, moved: { space_id: "f", generation: 1, revision: 4 } });
  });
  it("reads other coded refusals from detail", async () => {
    await expect(on(409, { detail: { code: "phones_not_ready", ready: false, phones: [{ id: "p", state: "outdated", last_seen: null, this_phone: false }] } }).createInvite("parent", true, 1))
      .rejects.toMatchObject({ readiness: { phones: [{ id: "p" }] } });
    await expect(on(409, { detail: { code: "family_exit_required" } }).erase(1)).rejects.toMatchObject({ message: expect.stringContaining("Leave your family") });
  });
  it("leaves an ordinary conflict as it was", async () => {
    const failure = await on(409, { detail: "This entry changed" }).save(row, 1).catch((e) => e);
    expect(failure.status).toBe(409);
    expect(failure.moved).toBeUndefined();
    expect(failure.message).toMatch(/changed elsewhere/);
  });
});

describe("opening a private file", () => {
  const api = (known: () => any) => createBabyApi("https://api.test", async () => "token", () => true, async () => new Response("{}"), known);
  it("asks at the client level everything else does, or the API answers a family file with 404", () => {
    expect(api(() => ({ spaces: [{ id: "p" }], personal_space_id: "p" })).fileHeaders()).toEqual({ "X-Baby-Client": "3" });
    expect(api(() => ({})).fileHeaders()).toEqual({ "X-Baby-Client": "2" });
  });
});

it.each(Object.entries(sourceRefusalMessages))("maps %s for record and Library retries", async (code, message) => {
  const status = code === "source_attachment_limit" ? 422 : code === "source_already_processing" ? 409 : 429;
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({detail:{code, message:"private provider text"}}, {status}));
  const api = createBabyApi("https://service.example", async () => "token", () => true, transport);
  await expect(api.import({id:"request", record_id:"source"}, 1)).rejects.toThrow(message);
  await expect(api.retryJob("job", 1)).rejects.toThrow(message);
});

it.each(["Related items must be in the same Baby space", "Unrelated validation", "Related items must be in the same Baby space: provider text"])("classifies only the exact relation reason: %s", async (detail) => {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ detail }, { status: 422 })), api = createBabyApi("https://service.example", async () => "token", () => true, transport);
  const error = await api.save(row, 1).catch((error) => error);
  expect(error.reason).toBe(detail === "Related items must be in the same Baby space" ? "related_space" : undefined);
  expect(error.message).not.toContain("provider text");
});

it("defers attributed import writes across an API rollback and retries identical words when support returns", async () => {
  let available = true;
  const imported = { ...row, revision: undefined, data: { paste_origin: { text: "Private", start: 0, end: 7, original: true } } };
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(imported));
  const api = createBabyApi("https://service.example", async () => "token", () => true, transport, () => ({ visit_import_available: available }));
  available = false;
  await expect(api.save(imported, 1)).rejects.toMatchObject({ status: 503 });
  expect(transport).not.toHaveBeenCalled();
  available = true;
  await api.save(imported, 1);
  expect(JSON.parse(String(transport.mock.calls[0][1]?.body)).data).toEqual(imported.data);
});


it.each(["journal", "event"] as const)("rechecks support after a racing rollback 422 for an attributed %s and resends unchanged", async (kind) => {
  let rolledBack = false;
  const imported = { ...row, kind, revision: undefined, data: { paste_origin: { text: "Private", start: 0, end: 7, original: kind === "journal" } } };
  const transport = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).endsWith("/bootstrap")
    ? Response.json({ generation: 1, profile: {}, children: [], ...(rolledBack ? {} : { visit_import_available: true }) })
    : rolledBack ? Response.json({ detail: "Enter valid details for this entry" }, { status: 422 }) : Response.json(imported));
  const api = createBabyApi("https://service.example", async () => "token", () => true, transport, () => ({ visit_import_available: true }));
  await api.bootstrap();rolledBack = true;
  await expect(api.save(imported, 1)).rejects.toMatchObject({ status: 503 });
  rolledBack = false;await api.save(imported, 1);
  const writes = transport.mock.calls.filter(([url]) => !String(url).endsWith("/bootstrap"));
  expect(writes).toHaveLength(2);
  expect(writes[0][1]?.body).toBe(writes[1][1]?.body);
});
it("keeps genuine attributed validation errors for review when the service still supports them", async () => {
  const imported = { ...row, data: { paste_origin: { text: "Private", start: 0, end: 7, original: true } } };
  const transport = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).endsWith("/bootstrap")
    ? Response.json({ generation: 1, profile: {}, children: [], visit_import_available: true })
    : Response.json({ detail: "Enter valid details for this entry" }, { status: 422 }));
  const api = createBabyApi("https://service.example", async () => "token", () => true, transport, () => ({ visit_import_available: true }));
  await api.bootstrap();await expect(api.save(imported, 1)).rejects.toMatchObject({ status: 422 });
  expect(transport.mock.calls.filter(([url]) => String(url).endsWith("/bootstrap"))).toHaveLength(2);
});

it("fences an account generation change during rollback verification", async () => {
  let generation = 1;
  const imported = { ...row, data: { paste_origin: { text: "Private", start: 0, end: 7, original: true } } };
  const transport = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).endsWith("/bootstrap")
    ? Response.json({ generation, profile: {}, children: [], visit_import_available: generation === 1 })
    : Response.json({ detail: "Enter valid details for this entry" }, { status: 422 }));
  const api = createBabyApi("https://service.example", async () => "token", () => true, transport, () => ({ visit_import_available: true }));
  await api.bootstrap();generation = 2;
  await expect(api.save(imported, 1)).rejects.toMatchObject({ status: 410, local: true });
});
