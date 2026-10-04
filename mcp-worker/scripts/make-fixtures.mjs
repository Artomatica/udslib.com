// Writes test/fixtures/* and the viewer's example traces from test/scenario.mjs.
import { writeFileSync, mkdirSync } from "node:fs";
import { flashOk, flashFail, writers } from "../test/scenario.mjs";
const ext = { candump: "log", asc: "asc", trc21: "trc", trc11: "v11.trc", savvycan: "savvycan.csv", pythoncan: "pythoncan.csv" };
mkdirSync(new URL("../test/fixtures/", import.meta.url), { recursive: true });
for (const [name, frames] of [["flash-ok", flashOk()], ["flash-fail", flashFail()]]) {
  for (const [fmt, w] of Object.entries(writers)) writeFileSync(new URL(`../test/fixtures/${name}.${ext[fmt]}`, import.meta.url), w(frames));
}
mkdirSync(new URL("../../viewer/examples/", import.meta.url), { recursive: true });
writeFileSync(new URL("../../viewer/examples/flash-ok.asc", import.meta.url), writers.asc(flashOk()));
writeFileSync(new URL("../../viewer/examples/flash-fail.trc", import.meta.url), writers.trc21(flashFail()));
console.log("fixtures written");
