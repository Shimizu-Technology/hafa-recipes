import { expect, it } from "vitest";
import { formatNumeral } from "./format-numeral";

it.each([
  ["45 min", "45", "min"], ["4 wks", "4", "wks"], ["EMOM 10", "10", "EMOM"], ["AMRAP 12 min", "12", "AMRAP min"],
  ["Every 90s × 8", null, "Every 90s × 8"], ["E2MOM × 10", null, "E2MOM × 10"], ["Tabata", null, "Tabata"], ["", null, ""],
])("splits %s into %s / %s", (label, numeral, caption) => {
  expect(formatNumeral(label)).toEqual({ numeral, caption });
});
