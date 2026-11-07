import { afterEach, describe, expect, it, vi } from "vitest";
import { ageBatches, ageContent, ageHasDraft, batches, canPreview, factSources, sourceName, weekContent, weekHasDraft, type AgeBatch, type ContentBatch } from "./weekly-content";

const approved = (batch: ContentBatch): ContentBatch => ({ ...batch, approved: true });
afterEach(() => vi.unstubAllGlobals());

describe("every batch that ships", () => {
  const facts = batches.flatMap((batch) => batch.weeks.flatMap((week) => week.facts.map((fact) => ({ batch: batch.batch, week: week.week, fact }))));
  it("has no fact without a source, and every source is a real https link", () => {
    expect(facts.length).toBeGreaterThan(0);
    for (const { batch, week, fact } of facts) {
      expect(fact.text.trim(), `${batch} week ${week}`).not.toBe("");
      expect(fact.source_url, `${batch} week ${week}: ${fact.text}`).toMatch(/^https:\/\/[^\s]+\.[^\s]+/);
      for (const url of factSources(fact)) expect(url).toMatch(/^https:\/\//);
    }
  });
  it("names where its sizes come from, and each week has a size and three short facts", () => {
    for (const batch of batches) {
      expect(batch.size_source.urls.length).toBeGreaterThan(0);
      for (const url of batch.size_source.urls) expect(url).toMatch(/^https:\/\//);
      for (const week of batch.weeks) {
        expect(week.facts.length).toBeGreaterThan(0);
        expect(week.facts.length).toBeLessThanOrEqual(3);
        expect(week.size_comparison.object.trim()).not.toBe("");
        if (week.average) expect(week.average.weight.display).toMatch(/^about (\d+ lb )?\d+ oz/);
        if (week.average?.length) expect(week.average.length.display).toMatch(/^about [\d.]+ in/);
        // Below WHO's first week there's no published number to show, and from it on there always is one.
        expect(!!week.average, `week ${week.week}`).toBe(week.week >= 14 && week.week <= 40);
        for (const fact of week.facts) expect(fact.text.length).toBeLessThanOrEqual(170);
      }
    }
  });
  it("says nothing specific to a baby's sex, since no sex is known", () => {
    for (const { fact } of facts) expect(fact.text).not.toMatch(/\b(boys?|girls?|males?|females?|sons?|daughters?)\b/i);
  });
  it("has one batch per week, so a week can never show two sets of facts", () => {
    const weeks = batches.flatMap((batch) => batch.weeks.map((week) => week.week));
    expect(new Set(weeks).size).toBe(weeks.length);
  });
});

describe("private-family review gates", () => {
  it("releases the four reviewed batches", () => {
    for (const batch of [...batches, ...ageBatches]) expect(batch.approved).toBe(true);
    for (let week = 4; week <= 42; week++) expect(weekContent(week)?.content.week).toBe(week);
  });
  it("holds unapproved content, and dev preview cannot bypass a release build", () => {
    const from = batches.map((batch) => ({ ...batch, approved: false }));
    vi.stubGlobal("__DEV__", false);
    expect(canPreview()).toBe(false);
    expect(weekContent(35, { from })).toBeNull();
    expect(weekContent(35, { from, preview: true })).toBeNull();
    vi.stubGlobal("__DEV__", true);
    expect(weekContent(35, { from })).toBeNull();
    expect(weekContent(35, { from, preview: true })?.content.week).toBe(35);
  });
  it("does not bundle the cut timing, reassurance or mixed newborn length claims", () => {
    const text = JSON.stringify(batches);
    expect(text).not.toContain("an ultrasound might pick it up");
    expect(text).not.toContain("several cups a day");
    expect(text).not.toContain("uncomplicated labor and healthy babies");
    expect(text).not.toMatch(/intergrowth|hadlock|figures_read|review_note/i);
    for (const batch of batches) for (const week of batch.weeks) expect(week.average?.length).toBeUndefined();
    expect(weekContent(41)?.content.average).toBeUndefined();
    expect(weekContent(42)?.content.average).toBeUndefined();
  });
});

describe("after birth", () => {
  const lines = ageBatches.flatMap((batch) => [batch.note, ...batch.periods.flatMap((period) => period.items)]);
  const open = (batch: AgeBatch): AgeBatch => ({ ...batch, approved: true });
  it("covers every week to 12 and every month from 3 to 24, three short lines each", () => {
    expect(ageBatches[0].periods.map((period) => period.age)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(ageBatches[1].periods.map((period) => period.age)).toEqual(Array.from({ length: 22 }, (_, index) => index + 3));
    for (const batch of ageBatches) for (const period of batch.periods) {
      expect(period.items.length).toBeGreaterThan(0);
      expect(period.items.length).toBeLessThanOrEqual(3);
      for (const item of period.items) expect(item.text.length).toBeLessThanOrEqual(170);
    }
  });
  it("has a real source for every line, and says nothing about a baby's sex", () => {
    for (const line of lines) {
      expect(line.source_url, line.text).toMatch(/^https:\/\/[^\s]+\.[^\s]+/);
      expect(line.text).not.toMatch(/\b(boys?|girls?|males?|females?|sons?|daughters?|he|she|his|her|him)\b/i);
    }
  });
  it("never judges: no line calls a baby behind, late, delayed or not normal, and none sets a deadline", () => {
    for (const line of lines) expect(line.text).not.toMatch(/\b(behind|delay(ed)?|late|abnormal|should|must|score|percent)\b|%/i);
  });
  it("shows nothing unapproved, even for a preview in a release build", () => {
    expect(ageContent({ unit: "week", age: 1 }, { from: ageBatches.map((b) => ({ ...b, approved: false })) })).toBeNull();
    expect(ageContent({ unit: "month", age: 12 }, { from: ageBatches.map((b) => ({ ...b, approved: false })) })).toBeNull();
    vi.stubGlobal("__DEV__", false);
    expect(ageContent({ unit: "week", age: 1 }, { preview: true, from: ageBatches.map((b) => ({ ...b, approved: false })) })).toBeNull();
  });
  it("a development build previews only when asked, and an approved batch shows its own ages only", () => {
    vi.stubGlobal("__DEV__", true);
    expect(ageContent({ unit: "week", age: 3 })!.content.age).toBe(3);
    expect(ageContent({ unit: "week", age: 3 }, { preview: true })!.content.age).toBe(3);
    vi.unstubAllGlobals();
    const from = ageBatches.map((batch) => ({ ...batch, approved: batch.unit === "week" }));
    expect(ageContent({ unit: "week", age: 12 }, { from })!.batch.batch).toBe("baby-weeks-1-12");
    expect(ageContent({ unit: "week", age: 13 }, { from })).toBeNull();
    expect(ageContent({ unit: "month", age: 3 }, { from })).toBeNull();
  });
  it("knows where a preview has anything to show", () => {
    expect(ageHasDraft({ unit: "month", age: 24 })).toBe(true);
    expect(ageHasDraft({ unit: "month", age: 25 })).toBe(false);
    expect(ageHasDraft({ unit: "week", age: 13 })).toBe(false);
  });
});

it("knows which weeks a preview has anything for, and names a link's site", () => {
  expect(weekHasDraft(34)).toBe(true);
  expect(weekHasDraft(4)).toBe(true);
  expect(weekHasDraft(3)).toBe(false);
  expect(weekHasDraft(43)).toBe(false);
  expect(sourceName("https://www.cdc.gov/hearher/maternal-warning-signs/index.html")).toBe("cdc.gov");
  expect(sourceName("https://my.clevelandclinic.org/health/articles/7247")).toBe("clevelandclinic.org");
});
