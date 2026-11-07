import { describe, expect, it, vi } from "vitest";
import { answer, day } from "./care-stats-fixtures";
import { emptyState, optimisticRecord, type BabyRecord, type Mutation } from "./models";
import { visitSummaryRange, atBirthWords, lastSummaryLevel, localEntries, summaryEntries, SummaryTooLong, summaryFileName, summaryHtml, summaryWords, type SummaryPage } from "./doctor-summary";

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
  it("says a question or note typed straight on a visit once, whatever its length", () => {
    const words = "Is a tarry poo normal at three weeks, and should I bring a photo of it next time?";
    const typed = { title: `${[...words].slice(0, 59).join("").trimEnd()}…`, body: words };
    const html = summaryHtml(page({
      questions: [row("q", "question", "2026-11-03T00:00:00Z", "Is it normal?", { title: "Is it normal?" }), row("l", "question", "2026-11-03T00:00:00Z", words, typed)],
      notes: [row("n", "journal", "2026-11-03T00:00:00Z", "Come back in four weeks.", { title: "Come back in four weeks." })],
    }));
    expect(html.split("Is it normal?")).toHaveLength(2);
    expect(html.split("Is a tarry poo")).toHaveLength(2);
    expect(html.split("Come back in four weeks.")).toHaveLength(2);
    expect(summaryWords(typed)).toEqual({ title: words, detail: "" });
    expect(summaryWords({ title: "Rash", body: "Since Monday" })).toEqual({ title: "Rash", detail: "Since Monday" });
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

describe("the extra logs on the page", () => {
  const at = (hour: number) => `2026-11-03T${String(hour).padStart(2, "0")}:00:00.000Z`;
  const log = (id: string, kind: BabyRecord["kind"], hour: number, title: string, data: object, body = "", child: string | null = "baby") =>
    row(id, kind, at(hour), body, { title, data: data as never, child_id: child });
  const dose = log("dose", "medicine", 2, "Tylenol", { name: "Tylenol", dose: "2.5 mL" }, "after a feed"),
    temp = log("temp", "temperature", 3, "Temperature", { value: 99.1, unit: "f", method: "armpit" }),
    growth = log("grow", "growth", 4, "Growth", { weight: 7.5, weight_unit: "lb", length: 20, length_unit: "in", head: 35, head_unit: "cm" }),
    pumpOne = log("p1", "pumping", 1, "Pumping", { side: "left", amount: 3, unit: "oz" }),
    pumpTwo = log("p2", "pumping", 5, "Pumping", { side: "both", amount: 90, unit: "ml" }),
    pumpThree = log("p3", "pumping", 6, "Pumping", { side: "right", amount: 2.5, unit: "oz" }),
    bath = log("bath", "custom", 6, "Bath", { label: "Bath" }),
    note = log("note", "custom", 7, "Note", { label: "Note" }, "Spit up"),
    shot = log("shot", "custom", 2, "Hep B", { label: "Shot" }, "left leg"),
    pressure = log("bp", "custom", 2, "118/76", { label: "Blood pressure" }, "", null),
    weight = log("kg", "custom", 2, "My weight", { label: "My weight", value: 145.5, unit: "lb" }, "", null),
    feeling = log("fe", "custom", 3, "Tired", { label: "How I'm feeling" }, "long day", null),
    vitamin = log("vi", "custom", 4, "Prenatal", { label: "Vitamins and medicine" }, "", null),
    general = log("gen", "custom", 5, "Bath", { label: "Bath" }, "", null),
    rows = [dose, temp, growth, pumpOne, pumpTwo, pumpThree, bath, note, shot, pressure, weight, feeling, vitamin, general];
  const state = (records: BabyRecord[]) => ({ ...emptyState(), records });
  const found = () => localEntries(state(rows), "baby", "2026-11-03", "2026-11-03", "Pacific/Guam");
  const sorted = (list: BabyRecord[]) => list.map((item) => item.id).sort();
  it("keeps her logs off the baby's page, and a log with no baby isn't the baby's", () => {
    const entries = found();
    expect(sorted(entries.logs)).toEqual(["bath", "dose", "grow", "p1", "p2", "p3", "shot", "temp"]);
    expect(sorted(entries.her)).toEqual(["bp", "fe", "kg", "vi"]);
    expect(entries.logNotes.map((item) => item.id)).toEqual(["note"]);
    expect(entries.logs.map((item) => item.id)).not.toContain("gen");
  });
  it("lists each medicine with its name, dose, note and the family's clock", () => {
    const html = summaryHtml(page({ logs: found().logs }));
    expect(html).toContain("<h2>Medicine</h2>");
    expect(html).toContain("Tylenol, 2.5 mL");
    expect(html).toContain("after a feed");
    expect(html).toMatch(/Nov 3, 12:00 PM[^<]*<\/b> Tylenol/); // 02:00 UTC on Guam's clock.
  });
  it("lists a temperature with its unit and method, and a growth entry as a doctor says it", () => {
    const html = summaryHtml(page({ logs: found().logs }));
    expect(html).toContain("99.1 °F, armpit");
    expect(html).toContain("7 lb 8 oz, 20 in, head 35 cm");
  });
  it("adds up pumping by day, keeping oz and mL apart", () => {
    const html = summaryHtml(page({ logs: found().logs }));
    expect(html).toContain("<h2>Pumping</h2>");
    expect(html).toMatch(/Tue, Nov 3[^<]*<\/b> 3 sessions, 5\.5 oz, 90 mL/);
  });
  it("says a shot by name and date alone, and a custom log by its own label, never Entry", () => {
    const html = summaryHtml(page({ logs: found().logs, notes: found().logNotes }));
    expect(html).toContain("<h2>Shots</h2>");
    expect(html).toMatch(/Hep B<\/b> November 3, 2026/);
    expect(html).not.toContain("left leg");
    expect(html).toContain("Bath");
    expect(html).toMatch(/Note\.<\/b> Spit up/);
    expect(html).not.toContain("Entry");
  });
  it("keeps a custom entry's numbers, with or without a title of its own", () => {
    const html = summaryHtml(page({ logs: [log("a", "custom", 2, "Tummy time", { label: "Tummy time", value: 5, unit: "min" }), log("b", "custom", 3, "First bath", { label: "Bath", value: 2, unit: "min" }), log("c", "custom", 4, "Walk", { label: "Walk", value: 3 })] }));
    expect(html).toContain("Tummy time: 5 min");
    expect(html).toContain("Bath: First bath: 2 min");
    expect(html).toContain("Walk: 3");
  });
  it("gives her logs their own section on an expecting page, as she typed them, with nothing added", () => {
    const expecting = summaryHtml(page({ child: { name: "Noa", due_date: "2026-12-10" }, her: found().her }));
    expect(expecting).toContain("<h2>Her own logs</h2>");
    for (const text of ["Blood pressure: 118/76", "My weight: 145.5 lb", "How I&#39;m feeling: Tired", "long day", "Vitamins and medicine: Prenatal"]) expect(expecting).toContain(text);
    expect(expecting).not.toMatch(/normal|high|low\b|elevated|range|hypertens|should|warning/i);
    const high = summaryHtml(page({ child: { name: "Noa", due_date: "2026-12-10" }, her: [log("bp", "custom", 2, "190/120", { label: "Blood pressure" }, "", null)] }));
    expect(high).toContain("Blood pressure: 190/120");
    expect(high).not.toMatch(/normal|high|low\b|elevated|range|hypertens|should|warning/i);
  });
  it("gives her logs a Mom section on a page for a baby who's here, only when she's added them", () => {
    const added = summaryHtml(page({ her: found().her }));
    expect(added).toContain("<h2>Mom</h2>");
    expect(added).toContain("Blood pressure: 118/76");
    expect(added).not.toContain("Her own logs");
    expect(added).not.toMatch(/normal|high|low\b|elevated|range|hypertens|should|warning/i);
    expect(summaryHtml(page({ her: [] }))).not.toContain("<h2>Mom</h2>");
    expect(summaryHtml(page({}))).not.toContain("<h2>Mom</h2>");
  });
  it("escapes what she typed in every new section", () => {
    const html = summaryHtml(page({ logs: [log("x", "medicine", 2, "<b>", { name: "<script>", dose: "<i>" }), log("y", "custom", 2, "<img>", { label: "<u>" }), log("z", "custom", 2, "<svg>", { label: "Shot" })], child: { name: "Noa", due_date: "2026-12-10" }, her: [log("w", "custom", 2, "<em>", { label: "Blood pressure" }, "<a>", null)] }));
    expect(html).not.toMatch(/<script>|<i>|<u>|<img|<svg|<em>|<a>/);
  });
  it("gives up rows and says how many when a page runs short, as it does for notes", () => {
    const many = Array.from({ length: 30 }, (_, index) => log(`m${index}`, "medicine", 2, "Tylenol", { name: "Tylenol" }));
    const html = summaryHtml(page({ logs: many }), lastSummaryLevel);
    expect(html).toMatch(/\d+ more entries not on this page/);
    expect((html.match(/Tylenol/g) ?? []).length).toBeLessThan(30);
  });
  it("still refuses rather than quietly leaving logs out when there are too many to read", async () => {
    const records = vi.fn(async (filters: { kinds?: string[] }) => ({ items: [], total: 0, has_more: !filters.kinds?.includes("question") }));
    await expect(summaryEntries({ records } as never, state([]), "baby", "2026-11-03", "2026-11-03", "Pacific/Guam")).rejects.toBeInstanceOf(SummaryTooLong);
    const asked = records.mock.calls.map(([filters]) => filters.kinds ?? []).find((kinds) => kinds.includes("medicine"))!;
    for (const kind of ["medicine", "temperature", "growth", "pumping", "custom", "journal"]) expect(asked).toContain(kind);
  });
});

describe("the measurement at birth on the page", () => {
  const baby = { name: "Noa", birth_date: "2026-11-01", details: { weight_at_birth_g: 3345, length_at_birth_cm: 50.8 } },
    logged = (data: Record<string, unknown>, at = "2026-11-01T03:00:00.000Z") => ({ id: at, kind: "growth", title: "Growth", body: "", child_id: "baby", occurred_at: at, data, revision: 1, created_at: at, updated_at: at }) as any;
  it("leads the growth section, in plain words", () => {
    const html = summaryHtml(page({ child: baby, atBirth: true }));
    expect(html).toContain("<h2>Growth</h2>");
    expect(html).toContain("<b>At birth.</b> 7 lb 6 oz, 20 in");
  });
  it("sits above what she logged, and stays when the page runs short", () => {
    const rows = Array.from({ length: 20 }, (_, at) => logged({ weight: 9, weight_unit: "lb" }, `2026-12-${String(at + 1).padStart(2, "0")}T03:00:00.000Z`)),
      html = summaryHtml(page({ child: baby, atBirth: true, logs: rows }), lastSummaryLevel);
    expect(html.indexOf("At birth.")).toBeLessThan(html.indexOf("9 lb"));
  });
  it("says only what she didn't also log that day", () => {
    expect(summaryHtml(page({ child: baby, atBirth: true, logs: [logged({ weight: 7.4, weight_unit: "lb" })] }))).toContain("<b>At birth.</b> 20 in");
    expect(summaryHtml(page({ child: baby, atBirth: true, logs: [logged({ weight: 7.4, weight_unit: "lb", length: 20, length_unit: "in" })] }))).not.toContain("At birth.");
  });
  it("uses the unit she logs in", () => {
    expect(summaryHtml(page({ child: baby, atBirth: true, logs: [logged({ weight: 5, weight_unit: "kg", length: 55, length_unit: "cm" }, "2026-12-01T03:00:00.000Z")] }))).toContain("<b>At birth.</b> 3.35 kg, 50.8 cm");
  });
  it("is left out of a questions-only page, and with no answers", () => {
    expect(summaryHtml(page({ child: baby }))).not.toContain("At birth.");
    expect(summaryHtml(page({ child: { name: "Noa", birth_date: "2026-11-01" }, atBirth: true }))).not.toContain("At birth.");
  });
  it("says it's on the page, on the screen before she shares it", () => {
    expect(atBirthWords(baby, [])).toBe("measurements at birth");
    expect(atBirthWords({ birth_date: "2026-11-01" }, [])).toBe("");
  });
});

describe("appointment summaries", () => {
  it("chooses a past visit's own week and clamps an upcoming visit to today", () => {
    expect(visitSummaryRange("2026-10-15T12:00:00Z", "2026-11-06", "Pacific/Guam")).toEqual({ from: "2026-10-08", to: "2026-10-15" });
    expect(visitSummaryRange("2026-12-15T12:00:00Z", "2026-11-06", "Pacific/Guam")).toEqual({ from: "2026-10-30", to: "2026-11-06" });
  });
  it("reads only this appointment's questions, including ones older than the dates", async () => {
    const mine = row("mine", "question", "2025-01-01T00:00:00Z", "For this visit", { data: { event_id: "visit" } }), other = row("other", "question", "2026-11-03T00:00:00Z", "Other", { data: { event_id: "elsewhere" } });
    const api = { records: vi.fn(async (filters: any) => ({ items: filters.kinds.includes("question") ? [mine, other] : [], has_more: false, total: 2 })) };
    const state = { ...emptyState(), records: [mine, other] };
    expect(localEntries(state, "baby", "2026-11-01", "2026-11-05", "UTC", "visit").questions.map((r) => r.id)).toEqual(["mine"]);
    const entries = await summaryEntries(api, state, "baby", "2026-11-01", "2026-11-05", "UTC", "visit");
    expect(entries.questions.map((r) => r.id)).toEqual(["mine"]);
    expect(api.records).toHaveBeenCalledWith(expect.objectContaining({ event_id: "visit" }));
  });
  it("names the visit on the exported page and escapes the parent's words", () => {
    expect(summaryHtml(page({ visitTitle: "Check <one>" }))).toContain("For Check &lt;one&gt;");
  });
});

it("offers an attached journal outside the totals dates once, still leaving selection to the screen", async () => {
  const note = row("late-note", "journal", "2026-11-06T00:00:00Z", "Written after the visit", { data: { event_id: "visit" } });
  const api = { records: vi.fn(async (filters: any) => ({ items: filters.kinds.includes("journal") ? [note] : [], has_more: false, total: 1 })) };
  const result = await summaryEntries(api, emptyState(), "baby", "2026-11-01", "2026-11-02", "UTC", "visit");
  expect(result.journal.map((r) => r.id)).toEqual(["late-note"]);
});

it("actually reads a visit-linked journal missing from the date window and phone cache", async () => {
  const late = row("late", "journal", "2026-11-10T00:00:00Z", "After the visit", { data: { event_id: "visit" } });
  const api = { records: vi.fn(async (f: any) => ({ items: f.event_id === "visit" && f.kinds.includes("journal") ? [late] : [], has_more: false, total: 1 })) };
  expect((await summaryEntries(api, emptyState(), "baby", "2026-11-01", "2026-11-02", "UTC", "visit")).journal.map((r) => r.id)).toEqual(["late"]);
});
it("offers a kept private journal on an upcoming visit day without requesting future log totals", async () => {
  const privateQuestion = row("private", "journal", "2026-12-15T01:00:00Z", "My private question", { data: { just_me: true } });
  const api = { records: vi.fn(async (f: any) => ({ items: f.kinds.includes("journal") && f.occurred_from === "2026-12-15T00:00:00.000Z" ? [privateQuestion] : [], has_more: false, total: 1 })) };
  const rows = await summaryEntries(api, emptyState(), "baby", "2026-11-01", "2026-11-07", "UTC", "visit", "visit", "2026-12-15");
  expect(rows.journal.map((r) => r.id)).toEqual(["private"]);
  const logs = api.records.mock.calls.find(([f]) => f.kinds.includes("feeding"))![0];
  expect(logs.occurred_to).toBe("2026-11-08T00:00:00.000Z");
});
it("uses an all-day appointment's event zone for the summary end date", () => {
  expect(visitSummaryRange("2026-11-14T14:00:00Z", "2026-12-01", "America/Los_Angeles", "Pacific/Guam", true)).toEqual({ from: "2026-11-08", to: "2026-11-15" });
});

it("labels PDF questions only when more than one baby's entries are in play", () => {
  const a = row("a", "question", "2026-11-01T00:00:00Z", "Mia question"), b = { ...a, id: "b", child_id: "noa", body: "Noa question" }, children = [{ id: "baby", name: "Mia" }, { id: "noa", name: "Noa" }];
  expect(summaryHtml(page({ children, questions: [a] }))).not.toMatch(/General:|For Mia:/);
  expect(summaryHtml(page({ children, questions: [a, b] }))).toContain("For Noa:");
});
it("does not present a future private journal's visit time as the time it was written", () => {
  const future = row("private", "journal", "2026-12-15T09:00:00Z", "Kept question", { data: { just_me: true } });
  expect(summaryHtml(page({ notes: [future] }))).not.toContain("7:00");
});
