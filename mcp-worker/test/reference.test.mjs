import { test } from "node:test";
import assert from "node:assert/strict";
import { udsReference } from "../src/reference.mjs";
import { TOOLS } from "../src/tools.mjs";

test("nrc 0x78", () => {
  const r = udsReference({ topic: "0x78" });
  assert.match(r.text, /responsePending/);
  assert.equal(r.data.kind, "nrc");
  assert.equal(udsReference({ topic: "nrc 78" }).data.code, 0x78);
  assert.equal(udsReference({ topic: "NRC 0x22" }).data.name, "conditionsNotCorrect");
});

test("service by name and id", () => {
  assert.match(udsReference({ topic: "securityaccess" }).text, /§10\.4/);
  assert.match(udsReference({ topic: "SecurityAccess" }).text, /§10\.4/);
  const r = udsReference({ topic: "0x27" });
  assert.equal(r.data.kind, "service");
  assert.match(r.text, /§10\.4/);
  assert.match(udsReference({ topic: "request download" }).text, /0x34/);
});

test("ambiguous SID/NRC byte returns both", () => {
  const r = udsReference({ topic: "22" });
  assert.equal(r.data.kind, "ambiguous");
  assert.deepEqual(r.data.matches.map((m) => m.kind).sort(), ["nrc", "service"]);
  assert.match(r.text, /ReadDataByIdentifier/);
  assert.match(r.text, /conditionsNotCorrect/);
});

test("DID and RID", () => {
  assert.match(udsReference({ topic: "F190" }).text, /VIN/);
  assert.match(udsReference({ topic: "0xF190" }).text, /VIN/);
  assert.equal(udsReference({ topic: "FF00" }).data.kind, "rid");
  assert.match(udsReference({ topic: "FF00" }).text, /eraseMemory/);
  assert.match(udsReference({ topic: "F1FF" }).text, /not|unknown/i);
});

test("timing", () => {
  for (const t of ["p2", "P2*", "p2star", "s3", "timing"]) {
    const r = udsReference({ topic: t });
    assert.equal(r.data.kind, "timing", t);
    assert.match(r.text, /5000 ms/);
    assert.match(r.text, /50 ms/);
    assert.match(r.text, /3E 80/);
  }
});

test("reprogramming sequence", () => {
  const r = udsReference({ topic: "reprogramming_sequence" });
  assert.equal(r.data.steps.length, 17);
  assert.equal(r.data.steps[0].request, "10 03");
  assert.equal(r.data.steps[16].request, "85 01");
  assert.match(r.text, /not mandated by ISO 14229/);
  assert.equal(udsReference({ topic: "Reprogramming Sequence" }).data.steps.length, 17);
});

test("security comparison and sessions", () => {
  assert.equal(udsReference({ topic: "security" }).data.kind, "security_comparison");
  assert.equal(udsReference({ topic: "0x27 vs 0x29" }).data.kind, "security_comparison");
  const s = udsReference({ topic: "sessions" });
  assert.equal(s.data.kind, "sessions");
  assert.match(s.text, /programming/i);
});

test("unknown topic returns help, not error", () => {
  const r = udsReference({ topic: "banana" });
  assert.equal(r.data.kind, "help");
  assert.match(r.text, /reprogramming_sequence/);
  assert.equal(udsReference({}).data.kind, "help");
  assert.equal(udsReference({ topic: "   " }).data.kind, "help");
});

test("tool registered", () => {
  const r = TOOLS.find((t) => t.name === "uds_reference").run({ topic: "0x78" });
  assert.match(r.text, /responsePending/);
});
