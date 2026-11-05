import { describe, expect, it } from "vitest";
import { captureBelongs, captureSpace, shareDestination, shareOwner, sessionScope } from "./share-scope";
import type { Bootstrap } from "./models";

const family = "11111111-1111-4111-8111-111111111111", personal = "22222222-2222-4222-8222-222222222222";
const off: Bootstrap = { generation: 1, ai_available: false, children: [], profile: { display_name: "", timezone: "UTC", ai_consent: false } };
const live = (role?: "parent" | "caregiver"): Bootstrap => ({ ...off, personal_space_id: personal, spaces: [{ id: personal, kind: "personal", role: "parent", generation: 1, access_version: 1 },
  ...(role ? [{ id: family, kind: "family" as const, role, generation: 1, access_version: 1 }] : [])] });

describe("whose a capture is", () => {
  it.each([["owner:1"], ["owner:1:personal"], [`owner:1:${family}`], ["owner:7"]])("reads the account out of %s", (scope) => {
    expect(shareOwner(scope)).toBe("owner");
  });
  it("keeps an id that has its own colons", () => {
    expect(shareOwner(`a:b:3:${family}`)).toBe("a:b");
    expect(shareOwner("a:b:3")).toBe("a:b");
  });
  it("has no owner for an unassigned capture", () => {
    expect(shareOwner(undefined)).toBeUndefined();
  });
});

describe("whether this account can take a capture", () => {
  it("takes its own, from before spaces or since", () => {
    expect(captureBelongs("owner:1", "owner", off)).toBe(true);
    expect(captureBelongs("owner:1:personal", "owner", live())).toBe(true);
    expect(captureBelongs(`owner:1:${family}`, "owner", live("parent"))).toBe(true);
  });
  it("takes one for a family it has left, since those are still its own words", () => {
    expect(captureBelongs(`owner:1:${family}`, "owner", live())).toBe(true);
  });
  it("refuses another account's, an unassigned one, and one from before its own space was cleared", () => {
    expect(captureBelongs("someone:1", "owner", off)).toBe(false);
    expect(captureBelongs(undefined, "owner", off)).toBe(false);
    expect(captureBelongs("owner:2", "owner", off)).toBe(false);
    expect(captureBelongs("owner:2:personal", "owner", live())).toBe(false);
    expect(captureBelongs(`owner:2:${family}`, "owner", live("parent"))).toBe(false);
  });
});

describe("where a capture goes", () => {
  it("names nothing with the flag off", () => {
    expect(captureSpace("owner:1", off)).toBeUndefined();
  });
  it("keeps one made before spaces in the personal space, even once there's a family: pending private work is never published", () => {
    expect(captureSpace("owner:1", live("parent"))).toBe(personal);
    expect(captureSpace("owner:1:personal", live("parent"))).toBe(personal);
  });
  it("sends one made for the family to the family", () => {
    expect(captureSpace(`owner:1:${family}`, live("parent"))).toBe(family);
  });
  it("keeps one made for a family she's since left, in her own space", () => {
    expect(captureSpace(`owner:1:${family}`, live())).toBe(personal);
  });
  it("keeps it hers if she's only a caregiver there now", () => {
    expect(captureSpace(`owner:1:${family}`, live("caregiver"))).toBe(personal);
  });
});

describe("where new captures go", () => {
  it("names nothing with the flag off", () => {
    expect(shareDestination(off)).toBeUndefined();
    expect(sessionScope(off, { generation: 1 })).toBeNull();
  });
  it("is the family for a parent, and personal otherwise", () => {
    expect(shareDestination(live())).toBe(personal);
    expect(shareDestination(live("parent"))).toBe(family);
    expect(shareDestination(live("caregiver"))).toBe(personal);
  });
  it("tags personal by name and a family by id", () => {
    expect(sessionScope(live(), { space_id: personal, generation: 1 })).toBe("personal");
    expect(sessionScope(live("parent"), { space_id: family, generation: 1 })).toBe(family);
  });
});
