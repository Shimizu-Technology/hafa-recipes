import { describe, expect, it } from "vitest";
import { expectingFor, statedExpecting } from "./expecting";

import type { FamilyMember } from "./family";

type Member = Pick<FamilyMember, "app_user_id" | "role" | "status">;
const parent = (id: string, status: Member["status"] = "active"): Member => ({ app_user_id: id, role: "parent", status });
const nana: Member = { app_user_id: "nana", role: "caregiver", status: "active" };
const family = [parent("kami"), parent("leon"), nana];
const kid = (expecting_member?: string, expecting_confirmed?: boolean, birth_date: string | null = null) =>
  ({ birth_date, details: { expecting_member, expecting_confirmed } });

describe("who's expecting", () => {
  it("is what the family confirmed, on every phone", () => {
    expect(expectingFor(kid("kami", true), "leon", { inFamily: true, members: family })).toEqual({ id: "kami", ask: false });
    expect(expectingFor(kid("kami", true), "kami", { inFamily: true, members: family })).toEqual({ id: "kami", ask: false });
  });
  it("an unconfirmed guess of someone else stands; of yourself, you're asked", () => {
    expect(expectingFor(kid("kami", false), "leon", { inFamily: true, members: family })).toEqual({ id: "kami", ask: false });
    // Leon added the pregnancy for Kami: the API guessed him. His phone asks.
    expect(expectingFor(kid("leon", false), "leon", { inFamily: true, members: family })).toEqual({ id: null, ask: true });
  });
  it("nothing said, or someone no longer a parent here: asked", () => {
    expect(expectingFor(kid(undefined), "leon", { inFamily: true, members: family })).toEqual({ id: null, ask: true });
    expect(expectingFor(kid("nana", true), "leon", { inFamily: true, members: family })).toEqual({ id: null, ask: true });
    expect(expectingFor(kid("kami", true), "leon", { inFamily: true, members: [parent("kami", "left"), parent("leon")] })).toEqual({ id: "leon", ask: false });
  });
  it("on her own, there's no one to mix her up with", () => {
    expect(expectingFor(kid("kami", false), "kami", { inFamily: false, members: null })).toEqual({ id: "kami", ask: false });
    expect(expectingFor(kid(undefined), "kami", { inFamily: true, members: [parent("kami"), nana] })).toEqual({ id: "kami", ask: false });
  });
  it("before the family is read, or after the birth: nothing asked, nothing guessed", () => {
    expect(expectingFor(kid(undefined), "leon", { inFamily: true, members: null })).toEqual({ id: null, ask: false });
    expect(expectingFor(kid(undefined, false, "2026-12-08"), "leon", { inFamily: true, members: family })).toEqual({ id: null, ask: false });
  });
  it("with only the profile to go on", () => {
    expect(statedExpecting(kid("kami", false), "leon")).toBe("kami");
    expect(statedExpecting(kid("kami", false), "kami")).toBeNull();
    expect(statedExpecting(kid("kami", true), "kami")).toBe("kami");
  });
});
