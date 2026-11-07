import { describe, expect, it } from "vitest";
import { optimisticRecord, type Child } from "./models";
import {
  babyDetailLine, changeUnit, chooseDue, chooseStage, childWrite, dueSaid, formFor, measureProblem, noEdits, sameSpace, saveProblem, shownForm, startingUnit, touch,
  typeProgress, weightFields, withChildDraft, type ChildField, type ChildForm,
} from "./child-setup";
import { ApiError } from "./api";

const today = new Date(2026, 10, 5, 9, 30);
const child = (extra: Partial<Child> = {}): Child => ({ id: "kid", name: "Mia", revision: 4, ...extra });
const write = (form: ChildForm, saved?: Child, touched: ChildField[] = []) => {
  const result = childWrite(form, touched, saved, "new-id", today);
  if ("error" in result) throw new Error(result.error);
  return result.write;
};
const problem = (form: ChildForm) => {
  const result = childWrite(form, [], undefined, "new-id", today);
  return "error" in result ? result.error : "";
};
const named = (stage: "expecting" | "here" | null = null, extra: Partial<ChildForm> = {}) =>
  ({ ...formFor(undefined, stage, today, "imperial"), name: " Mia ", ...extra });

describe("the first question", () => {
  it("opens on what Today already chose, and otherwise asks", () => {
    expect(formFor(undefined, null, today, "imperial").stage).toBeNull();
    expect(formFor(undefined, "expecting", today, "imperial").stage).toBe("expecting");
    expect(formFor(undefined, "here", today, "imperial").stage).toBe("here");
  });
  it("reads an existing profile from its dates", () => {
    expect(formFor(child({ birth_date: "2026-11-01" }), null, today, "imperial").stage).toBe("here");
    expect(formFor(child({ due_date: "2026-12-10" }), null, today, "imperial").stage).toBe("expecting");
    expect(formFor(child(), null, today, "imperial").stage).toBeNull();
    // A birth date still ahead isn't born, as Today counts it.
    expect(formFor(child({ birth_date: "2026-12-01", due_date: "2026-12-10" }), null, today, "imperial").stage).toBe("expecting");
  });
  it("Today's choice wins, on a profile with no dates and on one that's overdue for a birth date", () => {
    expect(formFor(child(), "here", today, "imperial").stage).toBe("here");
    expect(formFor(child({ due_date: "2026-12-10" }), "here", today, "imperial").stage).toBe("here");
  });
  it("doesn't suggest today for a birth date long past the due date", () => {
    expect(formFor(child({ due_date: "2026-07-01" }), "here", today, "imperial").birth).toBe("");
    expect(formFor(child({ due_date: "2026-11-01" }), "here", today, "imperial").birth).toBe("2026-11-05");
  });
});

describe("only a name is required", () => {
  it("asks for the name in plain words", () => {
    expect(problem({ ...named("expecting"), name: "  " })).toBe("Enter a name or nickname. You can change it later.");
  });
  it("saves expecting with a name alone and sends no details", () => {
    expect(write(named("expecting"))).toEqual({ id: "new-id", name: "Mia", birth_date: null, due_date: null });
  });
  it("saves here with a name alone, on today's date, the same as the one-tap on Today", () => {
    expect(write(named("here"))).toEqual({ id: "new-id", name: "Mia", birth_date: "2026-11-05", due_date: null });
  });
  it("lets her clear that date", () => {
    expect(write(named("here", { birth: "" })).birth_date).toBeNull();
  });
});

describe("how far along", () => {
  it("fills in the due date with the 280-day count, shown back as a date", () => {
    const form = typeProgress(named("expecting"), { weeks: "35", days: "0" }, today);
    expect(form.due).toBe("2026-12-10");
    expect(dueSaid(form.due)).toBe("Due Thursday, December 10, 2026");
    expect(write(form).due_date).toBe("2026-12-10");
  });
  it("counts today in the profile's day, and days alone or weeks alone both work", () => {
    expect(typeProgress(named("expecting"), { weeks: "40", days: "" }, today).due).toBe("2026-11-05");
    expect(typeProgress(named("expecting"), { weeks: "", days: "3" }, today).due).toBe("2027-08-09");
  });
  it("stops a number that can't be right, and says what would be", () => {
    for (const change of [{ weeks: "45", days: "" }, { weeks: "30", days: "7" }, { weeks: "3.5", days: "" }, { weeks: "abc", days: "" }, { weeks: "", days: "x" }]) {
      const form = typeProgress(named("expecting"), change, today);
      expect(form.due).toBe("");
      expect(problem(form)).toBe("Enter weeks from 0 to 44 and days from 0 to 6, or pick the due date instead.");
    }
  });
  it("clearing both numbers clears the date they filled in", () => {
    const form = typeProgress(typeProgress(named("expecting"), { weeks: "35", days: "0" }, today), { weeks: "", days: "" }, today);
    expect(form.due).toBe("");
    expect(problem(form)).toBe("");
  });
  it("clearing the weeks over a date's shown-back 0 days clears the date, not a new one 40 weeks off", () => {
    const form = typeProgress(chooseDue(named("expecting"), "2026-12-10", today), { weeks: "" }, today);
    expect([form.due, form.days]).toEqual(["", "0"]);
    expect(problem(form)).toBe("");
  });
  it("picking a date shows it back as weeks and days", () => {
    const form = chooseDue(named("expecting"), "2026-12-10", today);
    expect([form.weeks, form.days]).toEqual(["35", "0"]);
    // Further off than a pregnancy runs: keep the date, and don't show a made-up count.
    const far = chooseDue(form, "2027-11-05", today);
    expect([far.due, far.weeks, far.days]).toEqual(["2027-11-05", "", ""]);
    expect(problem(far)).toBe("");
  });
  it("an existing due date opens with its count", () => {
    const form = formFor(child({ due_date: "2026-12-10" }), null, today, "imperial");
    expect([form.weeks, form.days]).toEqual(["35", "0"]);
  });
});

describe("Baby's here on a profile that was expecting", () => {
  const expecting = child({ due_date: "2026-12-10" });
  it("keeps the due date and starts on today's date", () => {
    // Left out, so the API keeps the due date, and can't get a stale copy of it.
    const edits = touch(noEdits(formFor(expecting, null, today, "imperial")), "stage", (form) => ({ ...form, stage: "here" }));
    expect(write(shownForm(expecting, edits, today), expecting, edits.touched)).toEqual({ id: "kid", birth_date: "2026-11-05", revision: 4 });
  });
  it("doesn't take a chosen birth date in the future", () => {
    const form = { ...chooseStage(formFor(expecting, null, today, "imperial"), "here", today), birth: "2026-11-06" };
    expect(childWrite(form, ["birth"], expecting, "id", today)).toEqual({ error: "Pick a birth date on or before today." });
  });
  it("going back to expecting takes the birth date away, and keeps the rest", () => {
    const born = child({ birth_date: "2026-11-01", due_date: "2026-12-10", details: { weight_at_birth_g: 3402 } }),
      edits = touch(noEdits(formFor(born, null, today, "imperial")), "stage", (form) => ({ ...form, stage: "expecting" }));
    expect(write(shownForm(born, edits, today), born, edits.touched)).toEqual({ id: "kid", birth_date: null, revision: 4 });
  });
  it("a date that only defaulted to today isn't sent over a real one", () => {
    const born = child({ birth_date: "2026-11-03" }),
      edits = touch(noEdits(formFor(undefined, null, today, "imperial")), "stage", (form) => ({ ...form, stage: "here" })),
      form = shownForm(born, edits, today);
    expect(form.birth).toBe("2026-11-03");
    expect(write(form, born, edits.touched)).toEqual({ id: "kid", revision: 4 });
  });
});

describe("what she touched", () => {
  const profile = child({ birth_date: "2026-11-01", details: { sex: "girl", weight_at_birth_g: 3400 } }), opened = noEdits(formFor(profile, null, today, "imperial"));
  it("shows the latest profile for everything else, whatever it was when she opened", () => {
    const edits = touch(opened, "name", (form) => ({ ...form, name: "Rose" })),
      form = shownForm(child({ revision: 9, birth_date: "2026-11-02", details: { sex: "boy" } }), edits, today);
    expect([form.name, form.birth, form.sex, form.lb]).toEqual(["Rose", "2026-11-02", "boy", ""]);
  });
  it("keeps a clear, even if the profile has the same empty value or a new one", () => {
    const edits = touch(opened, "sex", (form) => ({ ...form, sex: "" }));
    expect(shownForm(child({ birth_date: "2026-11-01", details: { sex: "boy" } }), edits, today).sex).toBe("");
    expect(write(shownForm(profile, edits, today), profile, edits.touched)).toEqual({ id: "kid", details: { sex: null }, revision: 4 });
  });
  it("counts from a create attempt only once one is made", () => {
    const before = touch(opened, "name", (form) => ({ ...form, name: "A" }));
    expect(before.since).toEqual([]);
    const after = touch(touch({ ...before, attempted: true }, "name", (form) => ({ ...form, name: "B" })), "sex", (form) => ({ ...form, sex: "boy" }));
    expect(after.since).toEqual(["name", "sex"]);
    expect(after.touched).toEqual(["name", "sex"]);
  });
  it("only touching a field makes it hers, not its value changing", () => {
    expect(write(shownForm(profile, opened, today), profile, opened.touched)).toEqual({ id: "kid", revision: 4 });
  });
});

describe("drafts stay inside their generation", () => {
  const draft = { ...noEdits(formFor(undefined, "expecting", today, "imperial")), creation_id: "id", generation: 1 },
    state = (generation: number, active = true) => ({ bootstrap: { generation, active }, childDrafts: { new: draft } }) as never;
  it("writes and removes in the same generation", () => {
    expect(withChildDraft(state(1), "kid", draft, 1).childDrafts).toEqual({ new: draft, kid: draft });
    expect(withChildDraft(state(1), "new", null, 1).childDrafts).toEqual({});
  });
  it("does nothing once the generation moved on or the space isn't active, removal included", () => {
    for (const s of [state(2), state(1, false)]) {
      expect(withChildDraft(s, "kid", draft, 1)).toBe(s);
      expect(withChildDraft(s, "new", null, 1)).toBe(s);
      expect(sameSpace(s, 1)).toBe(false);
    }
  });
});

describe("details", () => {
  it("sends a new profile only what she answered, in the API's words", () => {
    const form = named("here", { sex: "girl", lb: "7", oz: "8", length: "20", weeksAtBirth: "39", feeding: "both" });
    expect(write(form).details).toEqual({ sex: "girl", weight_at_birth_g: 3402, length_at_birth_cm: 50.8, weeks_at_birth: 39, feeding: "both" });
  });
  it("sends an edit only what changed, with null to clear, and never the trackers", () => {
    const saved = child({ birth_date: "2026-11-01", details: { sex: "girl", feeding: "both", weeks_at_birth: 39, tracking: { diaper: false } } });
    const form = { ...formFor(saved, null, today, "imperial"), sex: "" as const, feeding: "bottle" as const };
    expect(write(form, saved, ["sex", "feeding"]).details).toEqual({ sex: null, feeding: "bottle" });
    expect(write(form, saved).details).toBeUndefined();
  });
  it("copes with an older API that has no details", () => {
    const saved = child({ due_date: "2026-12-10" });
    const form = formFor(saved, null, today, "imperial");
    expect([form.sex, form.lb, form.feeding]).toEqual(["", "", ""]);
    expect(write({ ...form, name: "New name" }, saved, ["name"])).toEqual({ id: "kid", name: "New name", revision: 4 });
  });
  it("leaves birth-only answers alone while still expecting", () => {
    const saved = child({ due_date: "2026-12-10", details: { weight_at_birth_g: 3402 } });
    const form = { ...formFor(saved, null, today, "imperial"), sex: "boy" as const, lb: "" };
    expect(write(form, saved, ["sex", "weight"]).details).toEqual({ sex: "boy" });
  });
  it.each([
    [{ lb: "30" }, "Check the birth weight. Use up to 22 lb, with ounces under 16."],
    [{ lb: "7", oz: "16" }, "Check the birth weight. Use up to 22 lb, with ounces under 16."],
    [{ lb: "abc" }, "Check the birth weight. Use up to 22 lb, with ounces under 16."],
    [{ length: "40" }, "Check the birth length. Use 6 to 31 in."],
    [{ weeksAtBirth: "19" }, "Enter weeks at birth as a whole number from 20 to 45."],
    [{ weeksAtBirth: "39.5" }, "Enter weeks at birth as a whole number from 20 to 45."],
  ])("says what's wrong with %j", (fields, message) => {
    expect(problem(named("here", fields))).toBe(message);
  });
  it("words metric limits in metric", () => {
    expect(problem(named("here", { unit: "metric", kg: "11" }))).toBe("Check the birth weight. Use 0.1 to 10 kg.");
    expect(problem(named("here", { unit: "metric", length: "90" }))).toBe("Check the birth length. Use 15 to 80 cm.");
  });
  it("takes a comma for a decimal point", () => {
    expect(write(named("here", { unit: "metric", kg: "3,4", length: "50,5" })).details).toEqual({ weight_at_birth_g: 3400, length_at_birth_cm: 50.5 });
  });
});

describe("units", () => {
  it("start from the last bottle: ounces until she uses something else", () => {
    const bottle = (id: string, unit: "oz" | "ml", at: string) => optimisticRecord({ id, kind: "feeding", title: "Bottle", body: "", child_id: null, occurred_at: at, data: { method: "bottle", unit } });
    expect(startingUnit([])).toBe("imperial");
    expect(startingUnit([bottle("a", "ml", "2026-11-01T00:00:00Z"), bottle("b", "oz", "2026-11-02T00:00:00Z")])).toBe("imperial");
    expect(startingUnit([bottle("a", "ml", "2026-11-03T00:00:00Z"), bottle("b", "oz", "2026-11-02T00:00:00Z")])).toBe("metric");
  });
  it("show a saved weight in pounds and ounces, carrying a rounded-up 16", () => {
    expect(weightFields(3402, "imperial")).toEqual({ lb: "7", oz: "8", kg: "" });
    expect(weightFields(3400, "metric")).toEqual({ lb: "", oz: "", kg: "3.4" });
    expect(weightFields(3175, "imperial")).toEqual({ lb: "7", oz: "0", kg: "" });
    expect(weightFields(3628, "imperial")).toEqual({ lb: "8", oz: "0", kg: "" });
  });
  it("convert what's typed when she switches", () => {
    const form = changeUnit(named("here", { lb: "7", oz: "8", length: "20" }), "metric");
    expect([form.unit, form.kg, form.lb, form.oz, form.length]).toEqual(["metric", "3.402", "", "", "50.8"]);
    expect(changeUnit(form, "imperial")).toMatchObject({ lb: "7", oz: "8", kg: "", length: "20" });
  });
  it("keep a saved number through any number of switches, untouched", () => {
    for (const details of [{ weight_at_birth_g: 3400 }, { length_at_birth_cm: 50.4 }, { weight_at_birth_g: 3399, length_at_birth_cm: 50.3 }]) {
      const saved = child({ birth_date: "2026-11-01", details });
      for (const start of ["imperial", "metric"] as const) {
        const other = start === "imperial" ? "metric" : "imperial";
        expect(write(changeUnit(formFor(saved, null, today, start), other), saved).details).toBeUndefined();
        expect(write(changeUnit(changeUnit(formFor(saved, null, today, start), other), start), saved).details).toBeUndefined();
      }
    }
  });
  it.each([100, 10000])("don't refuse an untouched %i g in pounds, and judge it only once she edits it", (grams) => {
    const saved = child({ birth_date: "2026-11-01", details: { weight_at_birth_g: grams } }), form = formFor(saved, null, today, "imperial");
    expect(childWrite(form, [], saved, "id", today)).toMatchObject({ write: { id: "kid", revision: 4 } });
    expect(childWrite({ ...form, lb: "30", grams: null }, ["weight"], saved, "id", today)).toEqual({ error: "Check the birth weight. Use up to 22 lb, with ounces under 16." });
  });
  it("a value she typed in one unit is what's saved after a switch", () => {
    const form = changeUnit(named("here", { unit: "metric", kg: "3.4", length: "50.5" }), "imperial");
    expect(write(form).details).toEqual({ weight_at_birth_g: 3400, length_at_birth_cm: 50.5 });
    // She edited it after the switch, so now it's the typed pounds and ounces that count.
    expect(write(changeUnit({ ...form, lb: "8", grams: null }, "metric")).details?.weight_at_birth_g).toBe(3853);
  });
  it("keep an edit or a clear exact through ten switches", () => {
    const saved = child({ birth_date: "2026-11-01", details: { weight_at_birth_g: 3400, length_at_birth_cm: 50.4 } });
    let form: ChildForm = { ...formFor(saved, null, today, "metric"), kg: "3.456", grams: null, length: "50.7", cm: null };
    for (let n = 0; n < 10; n++) form = changeUnit(form, n % 2 ? "metric" : "imperial");
    expect(write(form, saved, ["weight", "length"]).details).toEqual({ weight_at_birth_g: 3456, length_at_birth_cm: 50.7 });
    const cleared = changeUnit({ ...formFor(saved, null, today, "metric"), kg: "", grams: null, length: "", cm: null }, "imperial");
    expect(write(cleared, saved, ["weight", "length"]).details).toEqual({ weight_at_birth_g: null, length_at_birth_cm: null });
  });
  it("take pounds with no ounces", () => {
    const form = changeUnit({ ...formFor(child({ birth_date: "2026-11-01" }), null, today, "imperial"), lb: "7" }, "metric");
    expect(write(form, child({ birth_date: "2026-11-01" }), ["weight"]).details).toEqual({ weight_at_birth_g: 3175 });
  });
  it.each([{ lb: "7", oz: "16" }, { lb: "0", oz: "0" }, { lb: "abc" }, { length: "0" }])("won't switch with what can't be converted: %j", (typed) => {
    const saved = child({ birth_date: "2026-11-01", details: { weight_at_birth_g: 3400 } }),
      form = { ...formFor(saved, null, today, "imperial"), grams: null, ...typed };
    expect(measureProblem(form, ["weight", "length"])).not.toBe("");
  });
  it("don't refuse a switch or another edit for a stored number she hasn't touched", () => {
    for (const grams of [0, 50, 10001]) {
      const saved = child({ birth_date: "2026-11-01", details: { weight_at_birth_g: grams, length_at_birth_cm: 10 } }),
        form = { ...formFor(saved, null, today, "imperial"), name: "Rose" };
      expect(measureProblem(form, ["name"])).toBe("");
      expect(write(changeUnit(form, "metric"), saved, ["name"])).toEqual({ id: "kid", name: "Rose", revision: 4 });
    }
  });
  it("don't nudge a saved weight just by opening it in the other unit", () => {
    const saved = child({ birth_date: "2026-11-01", details: { weight_at_birth_g: 3400, length_at_birth_cm: 50.5 } });
    expect(write(formFor(saved, null, today, "imperial"), saved).details).toBeUndefined();
    expect(write(formFor(saved, null, today, "metric"), saved).details).toBeUndefined();
    expect(write(changeUnit(formFor(saved, null, today, "metric"), "imperial"), saved).details).toBeUndefined();
  });
});

describe("when saving fails", () => {
  it("says offline plainly, without the app-wide promise that it's queued", () => {
    const message = saveProblem(new ApiError("Could not connect. You’re offline. Your work is saved on this phone and can retry when you reconnect.", 0));
    expect(message).toBe("You’re offline, so this isn’t saved yet. What you typed is still here. Try again when you’re connected.");
  });
  it("says what a conflict means here, and keeps the API's own plain answers", () => {
    expect(saveProblem(new ApiError("x", 409))).toBe("This profile changed on another phone. Check it, then save again.");
    expect(saveProblem(new ApiError("Enter weeks at birth between 20 and 45.", 422))).toBe("Enter weeks at birth between 20 and 45.");
  });
});

describe("Your little ones", () => {
  it("says where each baby is, and what's still missing", () => {
    expect(babyDetailLine(child({ birth_date: "2026-11-01", details: { sex: "girl" } }))).toBe("Born November 1, 2026 · Girl");
    expect(babyDetailLine(child({ due_date: "2026-12-10", details: { sex: "boy" } }))).toBe("Due December 10, 2026 · Boy");
    expect(babyDetailLine(child({ due_date: "2026-12-10" }))).toBe("Due December 10, 2026");
    expect(babyDetailLine(child())).toBe("Add a due date or birth date");
  });
});

describe("the baby's doctor", () => {
  const doctor = { name: "Dr. Lee", phone: "671-555-0102" };
  const typed = (saved: Child | undefined, doctorName: string, doctorPhone: string) =>
    touch(touch(noEdits(formFor(saved, null, today, "imperial")), "doctorName", (form) => ({ ...form, doctorName })), "doctorPhone", (form) => ({ ...form, doctorPhone }));
  it("reads what's saved into the form", () => {
    const form = formFor(child({ details: { doctor } }), null, today, "imperial");
    expect([form.doctorName, form.doctorPhone]).toEqual(["Dr. Lee", "671-555-0102"]);
  });
  it("sends nothing about a doctor she didn't touch", () => {
    const saved = child({ details: { doctor } });
    expect(write(formFor(saved, null, today, "imperial"), saved, ["name"]).details).toBeUndefined();
  });
  it("sends the doctor on an edit, and null when both boxes are emptied", () => {
    const saved = child({ details: { doctor } });
    expect(write(typed(saved, "Dr. Kim", "671-555-0104").form, saved, ["doctorName", "doctorPhone"]).details).toEqual({ doctor: { name: "Dr. Kim", phone: "671-555-0104" } });
    expect(write(typed(saved, " ", "").form, saved, ["doctorName", "doctorPhone"]).details).toEqual({ doctor: null });
  });
  it("goes on a new profile only if she filled it in", () => {
    expect(write(named("expecting", { doctorName: "Dr. Lee", doctorPhone: "671-555-0102" })).details).toEqual({ doctor });
    expect(write(named("expecting")).details).toBeUndefined();
  });
  it("is turned down kindly when the number can't be dialled", () => {
    const saved = child();
    expect(childWrite(typed(saved, "", "soon").form, ["doctorPhone"], saved, "new-id", today)).toEqual({ error: expect.stringContaining("Try just the digits") });
  });
  it("takes the box she didn't touch from the latest save", () => {
    const edits = touch(noEdits(formFor(child({ details: { doctor } }), null, today, "imperial")), "doctorName", (form) => ({ ...form, doctorName: "Dr. Kim" })),
      newer = child({ revision: 9, details: { doctor: { name: "Dr. Lee", phone: "671-555-0199" } } }), form = shownForm(newer, edits, today);
    expect(write(form, newer, edits.touched).details).toEqual({ doctor: { name: "Dr. Kim", phone: "671-555-0199" } });
  });
  it("survives an edit from what she typed, over a newer save", () => {
    const edits = typed(child(), "Dr. Kim", "671-555-0104"), form = shownForm(child({ revision: 9, details: { doctor } }), edits, today);
    expect([form.doctorName, form.doctorPhone]).toEqual(["Dr. Kim", "671-555-0104"]);
  });
  it("uses the recovered child's latest untouched doctor field on create retry", () => {
    const stale = named("expecting", { doctorName: "Dr. Edited", doctorPhone: "671-555-0101" });
    const recovered = child({ details: { doctor: { name: "Dr. Other", phone: "671-555-0199" } } });
    expect(write(stale, recovered, ["doctorName"]).details).toEqual({ doctor: { name: "Dr. Edited", phone: "671-555-0199" } });
  });

});
