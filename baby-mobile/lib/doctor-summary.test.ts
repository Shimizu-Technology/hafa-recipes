import { describe, expect, it, vi } from "vitest";
import { answer, day } from "./care-stats-fixtures";
import { emptyState, optimisticRecord, type BabyRecord, type Mutation } from "./models";
import { lastSummaryLevel, localEntries, summaryEntries, SummaryTooLong, summaryFileName, summaryHtml, type SummaryPage } from "./doctor-summary";

const row = (id: string, kind: BabyRecord["kind"], occurred_at: string, body = "", changes: Partial<BabyRecord> = {}) =>
  ({ ...optimisticRecord({ id, kind, title: kind === "journal" ? `Entry ${id}` : "", body, child_id: "baby", occurred_at, data: {} }), revision: 1, ...changes });
const page = (changes: Partial<SummaryPage> = {}): SummaryPage => ({
  stats: answer([day("2026-11-03", false, { feeding: { ...day("x").feeding, count: 9, left: 4, right: 3, both: 1, bottle_oz: 4, breast_minutes: 95 }, diapers: { count: 6, pee: 5, poo: 2, dry: 0 }, sleep: { total_minutes: 480, longest_minutes: 180 } }), day("2026-11-04"), day("2026-11-05", true)]),
  child: { name: "Mia", birth_date: "2026-10-10" }, timezone: "Pacific/Guam", prepared: new Date("2026-11-05T00:00:00Z"), questions: [], notes: [], ...changes,
});

describe("the page", () => {
  it("carries daily totals, the baby and the dates, and leaves out days with nothing logged", () => {
    const html = summaryHtml(page());
    for (const text of ["Mia", "Born October 10, 2026", "November 3, 2026", "to November 5, 2026", "Pacific/Guam", "4 / 3 / 1", "4 oz", "8 h", "not a medical assessment"]) expect(html).toContain(text);
    expect(html).toContain("left out: 2 days of 3");
  });
  it("adds contractions and kicks only when there are some", () => {
    expect(summaryHtml(page())).not.toContain("Contractions");
    const stats = answer([day("2026-11-03", false, { contractions: { count: 2, timed: 2, average_seconds: 45 }, kicks: { sessions: 1, movements: 7 } })]);
    stats.contractions = { count: 2, timed: 2, average_seconds: 45 }; stats.kicks = { sessions: 1, movements: 7 };
    const html = summaryHtml(page({ stats, child: { name: "Noa", due_date: "2026-12-10" } }));
    for (const text of ["Due December 10, 2026", "Contractions", "45 sec", "Movements", "1 session, 7 movements"]) expect(html).toContain(text);
    expect(html).not.toContain("<th>Feeds</th>");
  });
  it("stays black on white: no colour, images or links, so it copies and prints", () => {
    const html = summaryHtml(page({ questions: [row("q", "question", "2026-11-03T00:00:00Z", "Ask?")] }));
    expect(html.match(/#[0-9a-f]{3,6}/gi)!.every((hex) => /^#(000|777|fff)$/i.test(hex))).toBe(true);
    expect(html).not.toMatch(/<img|https?:|<a |rgb\(|url\(/i);
  });
  it("escapes every word a parent wrote", () => {
    const html = summaryHtml(page({
      child: { name: "<b>Mia</b>" },
      questions: [row("q", "question", "2026-11-03T00:00:00Z", "a < b & \"c\"", { title: "<script>alert(1)</script>" })],
      notes: [row("n", "journal", "2026-11-03T00:00:00Z", "<img src=x onerror=y>")],
    }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>Mia</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a &lt; b &amp; &quot;c&quot;");
  });
  it("marks a clinician's words as the parent's label, and a poo colour by name", () => {
    const html = summaryHtml(page({ notes: [
      row("c", "journal", "2026-11-03T00:00:00Z", "Keep going.", { data: { provenance: "clinician_instruction" } }),
      row("d", "diaper", "2026-11-03T01:00:00Z", "Looked dark", { data: { type: "dirty", color: "black" } }),
    ] }));
    expect(html).toContain("Clinician instruction, labelled by the parent");
    expect(html).toContain("colour: black");
  });
  it("gives up detail in steps, and says how many entries it left off", () => {
    const notes = Array.from({ length: 20 }, (_, n) => row(`n${n}`, "journal", "2026-11-03T00:00:00Z", "x".repeat(600)));
    const first = summaryHtml(page({ notes })), last = summaryHtml(page({ notes }), lastSummaryLevel);
    expect(first).toContain("6 more entries not on this page");
    expect(last).toContain("18 more entries not on this page");
    expect(last.length).toBeLessThan(first.length);
    expect(last).not.toContain("x".repeat(51));
    expect(last).toContain("x".repeat(50) + "…");
  });
  it("tightens a month's table, and leaves a short one easy to read", () => {
    const month = answer(Array.from({ length: 31 }, (_, n) => day(`2026-10-${String(n + 1).padStart(2, "0")}`, false, { feeding: { ...day("x").feeding, count: 8 } })));
    expect(summaryHtml(page({ stats: month }))).toContain("font-size:7.5pt");
    expect(summaryHtml(page())).toContain("font-size:8.5pt");
  });
  it("reads as sentences: no doubled punctuation", () => {
    const html = summaryHtml(page({ questions: [row("q", "question", "2026-11-03T00:00:00Z", "After feeds.", { title: "Is this rash fine?" }), row("r", "question", "2026-11-03T00:00:00Z", "Since Monday", { title: "Rash" })] }));
    expect(html).toContain("Is this rash fine? After feeds.");
    expect(html).toContain("Rash: Since Monday");
    expect(html).toContain("6 diapers (5 pee, 2 poo, 0 dry)");
    expect(html).toContain("Mia: care summary");
  });
  it("names the file with dates and no person", () => {
    expect(summaryFileName("2026-11-01", "2026-11-05")).toBe("care-summary-2026-11-01-to-2026-11-05.pdf");
    expect(summaryFileName("2026-11-01", "2026-11-05", "questions-and-notes")).toBe("questions-and-notes-2026-11-01-to-2026-11-05.pdf");
  });
  it("with no numbers from the API, makes a page of what she chose and says the totals aren't there", () => {
    const html = summaryHtml(page({ stats: null, questions: [row("q", "question", "2026-11-03T00:00:00Z", "After feeds.", { title: "Is this rash fine?" })] }));
    expect(html).toContain("Mia: questions and notes");
    expect(html).toContain("Is this rash fine? After feeds.");
    expect(html).toContain("Care totals aren’t on this page.");
    expect(html).not.toContain("<h2>Totals</h2>");
    expect(html).not.toContain("Day by day");
    expect(html).not.toContain("<p>.");
  });
});

describe("gathering it with no network", () => {
  const held = [row("old-q", "question", "2026-01-01T00:00:00.000Z", "Kept"), row("gone", "question", "2026-11-03T00:00:00.000Z", "Deleted"), row("in", "journal", "2026-11-03T04:00:00.000Z", "Inside"),
    row("out", "journal", "2026-10-01T04:00:00.000Z", "Outside"), row("sister", "question", "2026-11-03T04:00:00.000Z", "Hers", { child_id: "sister" })];
  const outbox: Mutation[] = [
    { id: "1", generation: 1, type: "save", files: [], record: row("new", "question", "2026-11-04T00:00:00.000Z", "Queued") },
    { id: "2", generation: 1, type: "delete", record: held[1] },
  ];
  it("takes what this phone holds with its queued changes applied, for this baby, in these dates", () => {
    const found = localEntries({ ...emptyState(), records: held, outbox }, "baby", "2026-11-01", "2026-11-05", "Pacific/Guam");
    expect(found.questions.map((item) => item.id)).toEqual(["new", "old-q"]);
    expect(found.journal.map((item) => item.id)).toEqual(["in"]);
  });
});

describe("gathering what can go on it", () => {
  const api = (items: BabyRecord[]) => ({ records: vi.fn(async (filters: any) => {
    const list = items.filter((item) => filters.kinds.includes(item.kind)).filter((item) => !filters.occurred_from || (item.occurred_at >= filters.occurred_from && item.occurred_at < filters.occurred_to));
    return { items: list, total: list.length, has_more: false };
  }) });
  it("takes any open question, notes only from logs with some, and journal entries in the dates", async () => {
    const source = api([
      row("old-q", "question", "2026-01-01T00:00:00Z", "From months ago"),
      row("feed-note", "feeding", "2026-11-03T02:00:00.000Z", "Fussy"),
      row("feed-plain", "feeding", "2026-11-03T03:00:00.000Z"),
      row("in", "journal", "2026-11-03T04:00:00.000Z", "Inside"),
      row("general", "journal", "2026-11-03T05:00:00.000Z", "General", { child_id: null }),
      row("out", "journal", "2026-10-01T04:00:00.000Z", "Outside"),
      row("other", "journal", "2026-11-03T04:00:00.000Z", "Sister's", { child_id: "sister" }),
    ]);
    const found = await summaryEntries(source as never, emptyState(), "baby", "2026-11-01", "2026-11-05", "Pacific/Guam");
    expect(found.questions.map((item) => item.id)).toEqual(["old-q"]);
    expect(found.logNotes.map((item) => item.id)).toEqual(["feed-note"]);
    expect(found.journal.map((item) => item.id)).toEqual(["general", "in"]);
    expect(source.records.mock.calls.every(([filters]) => filters.child_id === "baby")).toBe(true);
  });
  it("refuses rather than quietly stopping when there are more entries than it can read", async () => {
    const endless = (kind: string) => ({ records: vi.fn(async (filters: any) => ({ items: [], total: 9999, has_more: filters.kinds.includes(kind) })) });
    const logs = endless("feeding"), questions = endless("question");
    const asked = summaryEntries(logs as never, emptyState(), "baby", "2026-11-01", "2026-11-05", "Pacific/Guam");
    await expect(asked).rejects.toBeInstanceOf(SummaryTooLong);
    await expect(asked).rejects.toThrow("Choose fewer days");
    await expect(summaryEntries(questions as never, emptyState(), "baby", "2026-11-01", "2026-11-05", "Pacific/Guam")).rejects.toThrow("more questions saved");
  });
  it("counts a queued question and drops a queued delete", async () => {
    const deleted = row("gone", "question", "2026-11-03T00:00:00.000Z", "Gone");
    const outbox: Mutation[] = [
      { id: "1", generation: 1, type: "save", files: [], record: row("new", "question", "2026-11-05T00:00:00.000Z", "Queued") },
      { id: "2", generation: 1, type: "delete", record: deleted },
    ];
    const found = await summaryEntries(api([deleted]) as never, { ...emptyState(), outbox }, "baby", "2026-11-01", "2026-11-05", "Pacific/Guam");
    expect(found.questions.map((item) => item.id)).toEqual(["new"]);
  });
  it("leaves another baby's care logs out, when asked about no baby", async () => {
    const found = await summaryEntries(api([row("feed", "feeding", "2026-11-03T02:00:00.000Z", "Hers")]) as never, emptyState(), null, "2026-11-01", "2026-11-05", "Pacific/Guam");
    expect(found.logNotes).toEqual([]);
  });
});
