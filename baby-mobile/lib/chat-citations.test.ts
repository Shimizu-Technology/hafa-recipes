import { describe, expect, it } from "vitest";
import { citationExcerpt, readableCitations } from "./chat-citations";
const one = "5aad80ac-b608-4120-8e84-7999be847bc8";
const two = "7aad80ac-b608-4120-8e84-7999be847bc8";
describe("readable source references", () => {
  it("maps repeated references to the same source card and preserves ordinary bracketed content", () => {
    expect(readableCitations(`Your saved note [${two}] agrees with [${one.toUpperCase()}]. Again [${two}]. Keep [12] and [a note].`, [
      { id: one, title: "First", excerpt: "" }, { id: two, title: "Second", excerpt: "" },
    ])).toBe("Your saved note [2] agrees with [1]. Again [2]. Keep [12] and [a note].");
  });
  it("does not present an unavailable record ID as a usable source", () => {
    expect(readableCitations(`Details [${one}]`)).toBe("Details [source unavailable]");
  });
});

describe("citation previews", () => {
  it("drops the repeated title and stored care data from older conversations", () => {
    expect(citationExcerpt({ id: one, title: "Feeding", excerpt:
      'Feeding\n{"side": "left", "unit": null, "amount": null, "method": "breast", "duration_minutes": 15.0}' }))
      .toBe("Breastfeeding · Left side · 15 min");
    expect(citationExcerpt({ id: one, title: "Diaper", excerpt: 'Diaper\n{"type": "wet"}' })).toBe("Wet diaper");
    expect(citationExcerpt({ id: one, title: "Sleep", excerpt: "Sleep\n{}", kind: "sleep" })).toBe("Sleep in progress");
    expect(citationExcerpt({ id: one, title: "Feeding", excerpt: 'Feeding\n{\n  "method": "bottle",\n  "amount": 4,\n  "unit": "oz"\n}\nAfter nap' }))
      .toBe("Bottle · 4 oz\nAfter nap");
  });
  it("keeps ordinary note text and unknown braces intact", () => {
    expect(citationExcerpt({ id: one, title: "First call", excerpt: "First call\n\nFeed every 2 to 3 hours." }))
      .toBe("Feed every 2 to 3 hours.");
    expect(citationExcerpt({ id: one, title: "Note", excerpt: "{not json}" })).toBe("{not json}");
    expect(citationExcerpt({ id: one, title: "Tip", excerpt: '{"keep": "this"}', kind: "source" })).toBe('{"keep": "this"}');
    expect(citationExcerpt({ id: one, title: "Note", excerpt: "{ a thought\nthat continues" })).toBe("{ a thought\nthat continues");
  });
});
