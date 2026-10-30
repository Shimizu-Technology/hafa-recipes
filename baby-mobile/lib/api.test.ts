import { describe, it, expect, vi } from "vitest";
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
  expect(init?.headers).toEqual({ Authorization: "Bearer verified-token", "Content-Type": "application/json" });
});

it("distinguishes server upload failure from offline without reflecting private details", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ detail: "private database error" }, { status: 500 }));
  const api = createBabyApi("https://service.example", async () => "token", () => true, transport);
  await expect(api.upload(new FormData(), 1, "photo")).rejects.toMatchObject({ status: 500, message: expect.stringContaining("could not upload this attachment") });
  transport.mockRejectedValueOnce(new TypeError("Network request failed"));
  await expect(api.save(row, 1)).rejects.toMatchObject({ status: 0, message: expect.stringContaining("offline") });
});
