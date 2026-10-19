import { describe, expect, it } from "vitest";
import { readableCitations } from "./chat-citations";
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
