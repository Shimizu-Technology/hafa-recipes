// Rebuilds content/who_growth.json from CDC's own files, unchanged: node scripts/build-who-growth.mjs <folder holding the six CSVs>
// Files: https://www.cdc.gov/growthcharts/who-data-files.htm (hosted on ftp.cdc.gov/pub/Health_Statistics/NCHS/growthcharts/).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const files = {
  boys: { weight: "WHO-Boys-Weight-for-age-Percentiles.csv", length: "WHO-Boys-Length-for-age-Percentiles.csv", head: "WHO-Boys-Head-Circumference-for-age-Percentiles.csv" },
  girls: { weight: "WHO-Girls-Weight-for-age%20Percentiles.csv", length: "WHO-Girls-Length-for-age-Percentiles.csv", head: "WHO-Girls-Head-Circumference-for-age-Percentiles.csv" },
};
const columns = ["Month", "L", "M", "S", "2nd (2.3rd)", "5th", "10th", "25th", "50th", "75th", "90th", "95th", "98th (97.7th)"];
const sha256 = {}, charts = {};
for (const [sex, measures] of Object.entries(files)) {
  charts[sex] = {};
  for (const [measure, name] of Object.entries(measures)) {
    const raw = readFileSync(join(process.argv[2], name)), lines = raw.toString("utf8").replace(/^﻿/, "").trim().split(/\r?\n/).map((line) => line.split(","));
    if (lines[0].join() !== columns.join()) throw Error(`${name}: unexpected columns`);
    const rows = lines.slice(1).map((line) => line.map(Number));
    if (rows.length !== 25 || rows.some((row, month) => row[0] !== month || row.some((value) => !Number.isFinite(value)))) throw Error(`${name}: expected months 0 to 24`);
    charts[sex][measure] = rows;
    sha256[name] = createHash("sha256").update(raw).digest("hex");
  }
}
const content = {
  source: {
    name: "CDC, WHO Growth Charts Data Files",
    url: "https://www.cdc.gov/growthcharts/who-data-files.htm",
    files: "https://ftp.cdc.gov/pub/Health_Statistics/NCHS/growthcharts/",
    retrieved: "2026-11-05",
    sha256,
  },
  units: { weight: "kg", length: "cm", head: "cm" },
  columns,
  charts,
};
writeFileSync(new URL("../content/who_growth.json", import.meta.url), `${JSON.stringify(content)}\n`);
