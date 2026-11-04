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
        expect(week.facts).toHaveLength(3);
        expect(week.size_comparison.object.trim()).not.toBe("");
        if (week.average) expect(week.average.weight.display).toMatch(/^about (\d+ lb )?\d+ oz/);
        if (week.average?.length) expect(week.average.length.display).toMatch(/^about [\d.]+ in/);
        // Below WHO's first week there's no published number to show, and from it on there always is one.
        expect(!!week.average, `week ${week.week}`).toBe(week.week >= 14);
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

describe("nothing unapproved is displayed", () => {
  it("every batch ships unapproved, until a doctor has signed off", () => {
    expect([...batches, ...ageBatches].map((batch) => [batch.batch, batch.approved])).toEqual([
      ["weeks-34-42", false], ["weeks-4-33", false], ["baby-weeks-1-12", false], ["baby-months-3-24", false],
    ]);
  });
  it("has no size or fact to give for any week while it's unapproved", () => {
    for (let week = 1; week <= 45; week++) expect(weekContent(week)).toBeNull();
  });
  it("in a release build, even asking for a preview shows nothing", () => {
    vi.stubGlobal("__DEV__", false);
    expect(canPreview()).toBe(false);
    expect(weekContent(35, { preview: true })).toBeNull();
    vi.unstubAllGlobals();
    expect(canPreview()).toBe(false); // No __DEV__ at all counts as a release build.
    expect(weekContent(35, { preview: true })).toBeNull();
  });
  it("a development build can preview it, only when asked", () => {
    vi.stubGlobal("__DEV__", true);
    expect(weekContent(35)).toBeNull();
    expect(weekContent(35, { preview: true })!.content.size_comparison.object).toBe("a honeydew melon");
  });
  it("flipping a batch to approved shows it, for its own weeks only", () => {
    const from = batches.map((batch) => batch.batch === "weeks-34-42" ? approved(batch) : batch);
    expect(weekContent(36, { from })!.content.week).toBe(36);
    expect(weekContent(33, { from })).toBeNull();
    expect(weekContent(43, { from })).toBeNull();
  });
});

describe("after birth", () => {
  const lines = ageBatches.flatMap((batch) => [batch.note, ...batch.periods.flatMap((period) => period.items)]);
  const open = (batch: AgeBatch): AgeBatch => ({ ...batch, approved: true });
  it("covers every week to 12 and every month from 3 to 24, three short lines each", () => {
    expect(ageBatches[0].periods.map((period) => period.age)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(ageBatches[1].periods.map((period) => period.age)).toEqual(Array.from({ length: 22 }, (_, index) => index + 3));
    for (const batch of ageBatches) for (const period of batch.periods) {
      expect(period.items).toHaveLength(3);
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
    expect(ageContent({ unit: "week", age: 1 })).toBeNull();
    expect(ageContent({ unit: "month", age: 12 })).toBeNull();
    vi.stubGlobal("__DEV__", false);
    expect(ageContent({ unit: "week", age: 1 }, { preview: true })).toBeNull();
  });
  it("a development build previews only when asked, and an approved batch shows its own ages only", () => {
    vi.stubGlobal("__DEV__", true);
    expect(ageContent({ unit: "week", age: 3 })).toBeNull();
    expect(ageContent({ unit: "week", age: 3 }, { preview: true })!.content.age).toBe(3);
    vi.unstubAllGlobals();
    const from = ageBatches.map((batch) => batch.unit === "week" ? open(batch) : batch);
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
