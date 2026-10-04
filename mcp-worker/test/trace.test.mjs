import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTrace, detectFormat, binaryKind } from "../src/trace/parse.mjs";
import { analyzeTrace, analysisText, crc32 } from "../src/trace/analyze.mjs";
import { flashOk, flashFail, imageBytes, writers, VIN } from "./scenario.mjs";

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const FILES = { "log": "candump", "asc": "asc", "trc": "trc", "v11.trc": "trc", "savvycan.csv": "csv", "pythoncan.csv": "csv" };

for (const [ext, format] of Object.entries(FILES)) {
  test(`${ext}: detected as ${format} and parsed to the scenario frames`, () => {
    const text = fx(`flash-ok.${ext}`);
    assert.equal(detectFormat(text), format);
    const { frames, warnings } = parseTrace(text);
    assert.deepEqual(warnings, []);
    const want = flashOk();
    assert.equal(frames.length, want.length);
    for (let i = 0; i < want.length; i++) {
      assert.equal(frames[i].id, want[i].id, `frame ${i} id`);
      assert.deepEqual(frames[i].data, want[i].data, `frame ${i} data`);
      assert.ok(Math.abs(frames[i].t - want[i].t) < 0.06, `frame ${i} t ${frames[i].t} vs ${want[i].t}`);
    }
  });
}

test("successful flash: no errors, image and CRC reconstructed, retransmit counted, VIN extracted", () => {
  const a = analyzeTrace(parseTrace(fx("flash-ok.asc")).frames);
  assert.equal(a.rootCause, null, JSON.stringify(a.rootCause));
  assert.equal(a.findings.filter((f) => f.severity === "error").length, 0);
  assert.equal(a.flash.length, 1);
  const f = a.flash[0];
  assert.equal(f.address, 0x08000000);
  assert.equal(f.size, 1024);
  assert.equal(f.bytesTransferred, 1024);
  assert.equal(f.blocks, 4);
  assert.equal(f.retransmits, 1);
  assert.equal(f.complete, true);
  assert.equal(f.crc32, crc32(Uint8Array.from(imageBytes())).toString(16).toUpperCase().padStart(8, "0"));
  assert.deepEqual(Array.from(f.image), imageBytes());
  assert.equal(a.identification.find((x) => x.did === "F190").ascii, VIN);
  assert.ok(a.findings.some((x) => x.code === "invalidKey" && x.severity === "warning"));
  assert.ok(a.findings.some((x) => x.code === "securityUnlocked"));
  const erase = a.pairs.find((p) => p.sid === 0x31 && p.request === "31 01 FF 00");
  assert.equal(erase.pendingCount, 1);
  assert.ok(erase.p2StarMs > 700 && erase.p2StarMs < 900, String(erase.p2StarMs));
  assert.equal(a.timing.p2Star.count, 1);
  assert.deepEqual(a.sessions.map((s) => s.session), ["extendedDiagnosticSession", "programmingSession"]);
  assert.deepEqual(a.summary.ecus, [{ tester: "7E0", ecu: "7E8" }]);
  assert.equal(a.pairs.find((p) => p.sid === 0x3e).status, "suppressed");
});

test("failed flash: root cause is the wrong block counter, then an ECU timeout", () => {
  const { frames } = parseTrace(fx("flash-fail.trc"));
  const a = analyzeTrace(frames);
  assert.equal(a.rootCause.code, "wrongBlockSequenceCounter");
  assert.match(a.rootCause.title, /TransferData #4/);
  const bad = a.pairs[a.rootCause.pairRef];
  assert.equal(bad.response, "7F 36 73");
  assert.ok(a.rootCause.frameRefs.every((i) => frames[i]));
  assert.ok(a.rootCause.frameRefs.some((i) => frames[i].data[0] === 0x03 && frames[i].data[1] === 0x7f), "refs include the 7F 36 73 frame");
  const timeout = a.findings.find((f) => f.code === "timeout" && f.severity === "error");
  assert.ok(timeout, "ECU went silent after the erase request");
  assert.match(timeout.title, /eraseMemory/);
  assert.equal(a.flash[0].complete, false);
  assert.equal(a.flash[0].bytesTransferred, 512);
  assert.ok(a.findings.some((f) => f.code === "flashIncomplete"));
  const text = analysisText(a);
  assert.match(text, /ROOT CAUSE: TransferData #4 refused: wrongBlockSequenceCounter/);
  assert.ok(text.split("\n").length <= 40);
});

test("ASC: base dec, extended ids, CAN FD lines and junk produce warnings, not exceptions", () => {
  const text = [
    "date Wed Oct 4 10:00:00 2026", "base dec  timestamps absolute", "Begin Triggerblock",
    "   0.001000 1  2016             Tx   d 8 02 10 03 AA AA AA AA AA",
    "   0.002000 1  417001744x       Rx   d 8 06 50 03 00 32 01 F4 AA",
    "   0.003000 CANFD   1 Rx        7E8  Msg1   1 0 a 12 0B 62 F1 90 41 42 43 44 45 46 47 48",
    "   0.004000 1  ErrorFrame",
    "this is not a trace line",
    "End TriggerBlock",
  ].join("\n");
  const { frames, warnings } = parseTrace(text);
  assert.equal(frames.length, 3);
  assert.equal(frames[0].id, 0x7e0);
  assert.equal(frames[1].ext, true);
  assert.equal(frames[1].id, 0x18daf110);
  assert.equal(frames[2].fd, true);
  assert.equal(frames[2].data.length, 12);
  assert.equal(warnings.length, 1);
});

test("unknown text is rejected with the supported list; binary formats are named", () => {
  assert.throws(() => parseTrace("hello world\nfoo"), /Supported: candump/);
  assert.equal(binaryKind(new TextEncoder().encode("LOGG\x90\x00")), "Vector BLF");
  assert.equal(binaryKind(Uint8Array.from([0x0a, 0x0d, 0x0d, 0x0a, 0, 0])), "pcapng");
  assert.equal(binaryKind(new TextEncoder().encode("(1.0) can0 7E0#00")), null);
});

test("interleaved ECUs are paired by id", () => {
  const lines = [
    "(0.000) can0 7E0#0322F190", "(0.001) can0 7E1#0322F18C", "(0.010) can0 7E9#0562F18C4142", "(0.011) can0 7E8#037F2231",
  ].join("\n");
  const a = analyzeTrace(parseTrace(lines).frames);
  assert.equal(a.pairs.length, 2);
  assert.equal(a.pairs[0].ecuId, "7E8");
  assert.equal(a.pairs[0].nrcName, "requestOutOfRange");
  assert.equal(a.pairs[1].ecuId, "7E9");
  assert.equal(a.pairs[1].positive, true);
});

test("ISO-TP sequence error becomes an error finding", () => {
  const lines = ["(0.000) can0 7E8#100A62F190414243", "(0.001) can0 7E0#300000", "(0.002) can0 7E8#2244454647"].join("\n");
  const a = analyzeTrace(parseTrace(lines).frames);
  assert.equal(a.rootCause.code, "isotpSequenceError");
});

test("performance: 100k frames analyzed in under 2 s", () => {
  const one = flashOk();
  const frames = [];
  let t = 0;
  while (frames.length < 100000) {
    for (const f of one) frames.push({ i: frames.length, t: t + f.t, id: f.id, ext: false, data: f.data, fd: false });
    t += one[one.length - 1].t + 10;
  }
  const t0 = performance.now();
  const a = analyzeTrace(frames);
  const ms = performance.now() - t0;
  assert.ok(a.pairs.length > 1000);
  assert.ok(ms < 2000, `${ms} ms`);
});
