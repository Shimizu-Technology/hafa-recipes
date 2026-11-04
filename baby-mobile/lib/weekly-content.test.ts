import { afterEach, describe, expect, it, vi } from "vitest";
import { batches, canPreview, factSources, sourceName, weekContent, weekHasDraft, type ContentBatch } from "./weekly-content";

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
        expect(week.average.weight.display).toMatch(/^about \d+ lb \d+ oz/);
        expect(week.average.length.display).toMatch(/^about [\d.]+ in/);
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
  it("the first batch ships unapproved, until a doctor has signed off", () => {
    expect(batches.find((batch) => batch.batch === "weeks-34-42")!.approved).toBe(false);
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
    const from = batches.map(approved);
    expect(weekContent(36, { from })!.content.week).toBe(36);
    expect(weekContent(33, { from })).toBeNull();
    expect(weekContent(43, { from })).toBeNull();
  });
});

it("knows which weeks a preview has anything for, and names a link's site", () => {
  expect(weekHasDraft(34)).toBe(true);
  expect(weekHasDraft(33)).toBe(false);
  expect(sourceName("https://www.cdc.gov/hearher/maternal-warning-signs/index.html")).toBe("cdc.gov");
  expect(sourceName("https://my.clevelandclinic.org/health/articles/7247")).toBe("clevelandclinic.org");
});
