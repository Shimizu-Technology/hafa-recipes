import { it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App, WorkoutView } from "./App";
import { repsLabel } from "./public-share";
import type { PublicWorkout } from "./public-share";
import { shareToken, safeSourceURL, parseSnapshot, fetchSnapshot, publicApiBase } from "./public-share";
const token = "a".repeat(43);
const workout = {
  title: "Source <script>bad()</script>",
  kind: "session",
  provenance: "source",
  equipment_required: ["dumbbells"],
  blocks: [
    {
      label: "Circuit",
      grouping: "circuit",
      rounds: 2,
      exercises: [
        {
          name: "Squat",
          sets: 3,
          reps_min: null,
          reps_max: null,
          per_side: true,
          load: 20,
          load_unit: "lb",
          load_convention: "per_hand",
          notes: "private health note",
          evidence: [{ wording: "private" }],
        },
      ],
    },
  ],
  notes: ["private creator note"],
  profile: { weight: 200 },
};
const snapshot = {
  kind: "workout",
  content: workout,
  expires_at: "2026-12-01T00:00:00Z",
  review_required: true,
  attribution: { shared_by_display_name: "A member", source_revision: 2, original_source_included: false },
  private_session_id: "private-ID",
};
it("accepts bounded literal path/fragment tokens and rejects query, percent alias or malformed intake", () => {
  expect(shareToken("/shared", "#" + token, "")).toBe(token);
  expect(shareToken("/shared/" + token, "", "")).toBe(token);
  for (const [path, hash, query] of [
    ["/shared/" + token + "%2f", "", ""],
    ["/shared", "#" + token, "?token=private"],
    ["/shared", "#" + token.repeat(100), ""],
    ["/shared", "#bad", ""],
    ["/other", "#" + token, ""],
  ])
    expect(shareToken(path, hash, query)).toBeNull();
});
it("projects only public prescription fields and preserves numeric omissions/source unit conventions", () => {
  const parsed = parseSnapshot(snapshot);
  expect(JSON.stringify(parsed)).not.toMatch(/private health|private creator|private-ID|weight|evidence/);
  if (parsed.kind === "workout") {
    const e = (parsed.content as PublicWorkout).blocks[0].exercises[0];
    expect(e.reps_min).toBeNull();
    expect(e.load_unit).toBe("lb");
    expect(e.load_convention).toBe("per_hand");
    expect(e.sets).toBe(3);
    expect((parsed.content as PublicWorkout).blocks[0].rounds).toBe(2);
  }
});
it("bounds schemas before rendering and rejects invalid provenance dimensions", () => {
  expect(() =>
    parseSnapshot({ ...snapshot, content: { ...workout, blocks: Array(101).fill(workout.blocks[0]) } })
  ).toThrow();
  expect(() => parseSnapshot({ ...snapshot, content: { ...workout, title: "a".repeat(201) } })).toThrow();
  expect(() => parseSnapshot({ ...snapshot, review_required: "true" })).toThrow();
});
it("accepts programs only as relative schedules, without owner dates/history", () => {
  const program = parseSnapshot({
    ...snapshot,
    kind: "program",
    content: {
      title: "Shared program",
      notice: "Review before using",
      sessions: [{ sequence: 1, day_offset: 3, workout, date: "private-date" }],
      profile: { health: "private" },
    },
  });
  expect(JSON.stringify(program)).not.toMatch(/private-date|health/);
  expect(() =>
    parseSnapshot({
      ...snapshot,
      kind: "program",
      content: { title: "Program", sessions: [{ sequence: 1, day_offset: 366, workout }] },
    })
  ).toThrow();
});
it("rejects dangerous source destinations and fails closed on unselected API configuration", () => {
  for (const source of [
    "javascript:alert(1)",
    "https://user:password@example.com",
    "http://example.com",
    "https://127.0.0.1/private",
    "https://2130706433/private",
  ])
    expect(safeSourceURL(source)).toBeNull();
  expect(safeSourceURL("https://example.com/workout")).toBe("https://example.com/workout");
  expect(() => publicApiBase("")).toThrow();
  expect(() => publicApiBase("http://localhost:8080")).toThrow();
  expect(publicApiBase("http://localhost:8080", true)).toBe("http://localhost:8080");
});
it("fetches no credentials/referrer and does not expose raw revoked/provider responses", async () => {
  const transport = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(snapshot), { headers: { "content-type": "application/json" } })
  );
  await fetchSnapshot("https://api.example", token, new AbortController().signal, transport);
  expect(transport.mock.calls[0][1]).toMatchObject({
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    redirect: "error",
  });
  await expect(
    fetchSnapshot(
      "https://api.example",
      token,
      new AbortController().signal,
      async () => new Response("private provider body", { status: 410 })
    )
  ).rejects.toMatchObject({ code: "unavailable" });
});
it("stops oversized streamed data and does not process invalid tokens", async () => {
  await expect(
    fetchSnapshot(
      "https://api.example",
      token,
      new AbortController().signal,
      async () => new Response("x".repeat(2 * 1024 * 1024 + 1), { headers: { "content-type": "application/json" } })
    )
  ).rejects.toMatchObject({ code: "too_large" });
  const transport = vi.fn();
  await expect(
    fetchSnapshot("https://api.example", "malformed", new AbortController().signal, transport)
  ).rejects.toMatchObject({ code: "invalid" });
  expect(transport).not.toHaveBeenCalled();
});
it("server-renders honest beta/help/deletion pages without install URLs or private tokens", () => {
  const home = renderToStaticMarkup(<App path="/" />);
  expect(home).toContain("beta is being prepared");
  expect(home).not.toMatch(/apps\.apple\.com|play\.google\.com|testflight\.apple\.com/);
  const deletion = renderToStaticMarkup(<App path="/delete-account" />);
  expect(deletion).toContain("whole Håfa account");
  expect(deletion).toContain("48 hours");
  expect(deletion).toContain("shimizutechnology@gmail.com");
  const share = renderToStaticMarkup(<App path={"/shared/" + token} />);
  expect(share).not.toContain(token);
  expect(share).toContain("Loading the reviewed public snapshot");
});

it("renders partial repetition bounds without inventing a fixed target", () => {
  expect(repsLabel(null, null)).toBe("Not specified");
  expect(repsLabel(8, null)).toContain("maximum unspecified");
  expect(repsLabel(null, 12)).toContain("minimum unspecified");
  expect(repsLabel(8, 8)).toBe("8");
  expect(repsLabel(8, 12)).toBe("8–12");
});

it("escapes adversarial source labels in the actual public renderer without private notes", () => {
  const projected = parseSnapshot(snapshot).content as PublicWorkout;
  const html = renderToStaticMarkup(<WorkoutView workout={projected} />);
  expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
  expect(html).not.toContain("<script>bad()");
  expect(html).not.toMatch(/private health|private creator|private-ID/);
  expect(html).toContain("2 group rounds");
  expect(html).toContain("Reps per side");
  expect(html).toContain("per hand");
});
