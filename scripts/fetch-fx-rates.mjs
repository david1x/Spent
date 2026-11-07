#!/usr/bin/env node
// Regenerates src/server/data/fx-rates.json: Bank of Israel representative
// exchange rates (shekels per unit) for the last two years. The app ships
// this file so foreign purchases can be converted offline; Settings > General
// > "Update rates" adds newer days to the local database later.
//
// Usage: node scripts/fetch-fx-rates.mjs [years=2]

import fs from "node:fs";
import path from "node:path";

const CURRENCIES = ["USD", "EUR", "GBP"];
const years = Number(process.argv[2] ?? 2);
const out = path.join(process.cwd(), "src/server/data/fx-rates.json");

const day = (d) => d.toISOString().slice(0, 10);
const end = new Date();
const start = new Date(end);
start.setFullYear(start.getFullYear() - years);

const rates = {};
for (const currency of CURRENCIES) {
  const url =
    "https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/" +
    `RER_${currency}_ILS?format=csv&startperiod=${day(start)}&endperiod=${day(end)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${currency}: HTTP ${res.status}`);
  const [header, ...lines] = (await res.text()).trim().split(/\r?\n/);
  const cols = header.split(",");
  const iDate = cols.indexOf("TIME_PERIOD");
  const iValue = cols.indexOf("OBS_VALUE");
  const iMult = cols.indexOf("UNIT_MULT");
  rates[currency] = lines
    .map((line) => line.split(","))
    .map((f) => [f[iDate], Number(f[iValue]) / 10 ** Number(f[iMult] || 0)])
    .filter(([d, v]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && v > 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  console.log(`${currency}: ${rates[currency].length} days`);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  JSON.stringify({ source: "Bank of Israel representative rates", fetchedAt: day(end), rates }) + "\n"
);
console.log(`wrote ${path.relative(process.cwd(), out)}`);
