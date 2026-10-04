import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeIsotp } from "../src/isotp.mjs";
import { ToolInputError, TOOLS } from "../src/tools.mjs";

const f = (id, data, t) => ({ id, data, ...(t === undefined ? {} : { t }) });

test("single frame with padding", () => {
  const { data } = decodeIsotp({ frames: [f("7E0", "03 22 F1 90 AA AA AA AA")] });
  assert.equal(data.pdus.length, 1);
  assert.equal(data.pdus[0].bytes, "22 F1 90");
  assert.equal(data.pdus[0].length, 3);
  assert.equal(data.pdus[0].paddingByte, 0xaa);
  assert.equal(data.pdus[0].uds.service, "ReadDataByIdentifier");
  assert.equal(data.frames[0].type, "SF");
  assert.deepEqual(data.errors, []);
});

test("multi-frame reassembly with FC on another id", () => {
  const { data } = decodeIsotp({
    frames: [f("7E8", "10 0B 62 F1 90 57 30 4C"), f("7E0", "30 00 00"), f("7E8", "21 31 32 33 34 35 36")],
  });
  assert.equal(data.pdus.length, 1);
  assert.equal(data.pdus[0].length, 11);
  assert.equal(data.pdus[0].bytes, "62 F1 90 57 30 4C 31 32 33 34 35");
  assert.equal(data.pdus[0].paddingByte, 0x36);
  assert.deepEqual(data.frames.map((x) => x.type), ["FF", "FC", "CF"]);
  assert.deepEqual(data.errors, []);
  assert.equal(data.pdus[0].uds.kind, "positive_response");
});

test("wrong sequence number", () => {
  const { data } = decodeIsotp({ frames: [f("7E8", "10 0B 62 F1 90 57 30 4C"), f("7E8", "22 31 32 33 34 35 36")] });
  assert.ok(data.errors.some((e) => /expected SN 1/.test(e)), data.errors.join("|"));
  assert.equal(data.pdus.length, 0);
});

test("SN wraps 15 -> 0", () => {
  const frames = [f("7E8", "10 C8 " + "AA ".repeat(6).trim())];
  let n = 6;
  for (let i = 1; n < 200; i++) {
    const sn = i % 16;
    frames.push(f("7E8", (0x20 | sn).toString(16) + " " + "BB ".repeat(7).trim()));
    n += 7;
  }
  const { data } = decodeIsotp({ frames });
  assert.deepEqual(data.errors, []);
  assert.equal(data.pdus[0].length, 200);
});

test("CF without FF", () => {
  const { data } = decodeIsotp({ frames: [f("7E8", "21 01 02 03 04 05 06 07")] });
  assert.ok(data.errors.some((e) => /without/i.test(e)));
});

test("FC overflow", () => {
  const { data } = decodeIsotp({ frames: [f("7E8", "10 0B 62 F1 90 57 30 4C"), f("7E0", "32 00 00")] });
  assert.ok(data.errors.some((e) => /overflow/i.test(e)));
  assert.equal(data.frames[1].status, "OVFLW");
});

test("FC WAIT and STmin decoding", () => {
  const { data } = decodeIsotp({ frames: [f("7E0", "30 08 F3"), f("7E0", "31 00 05"), f("7E0", "30 00 7F"), f("7E0", "30 00 80")] });
  assert.equal(data.frames[0].blockSize, 8);
  assert.equal(data.frames[0].stMin, "300 µs");
  assert.equal(data.frames[1].status, "WAIT");
  assert.equal(data.frames[2].stMin, "127 ms");
  assert.match(data.frames[3].stMin, /reserved/);
});

test("CAN-FD single frame escape", () => {
  const { data } = decodeIsotp({ frames: [f("7E0", "00 0C " + "11 ".repeat(12).trim())] });
  assert.equal(data.pdus[0].length, 12);
});

test("first frame length escape", () => {
  const { data } = decodeIsotp({ frames: [f("7E8", "10 00 00 00 00 14 AA BB")] });
  assert.equal(data.frames[0].totalLength, 20);
  assert.equal(data.pdus.length, 0);
  assert.ok(data.warnings.some((w) => /incomplete/i.test(w)));
});

test("timing: N_Cr warning", () => {
  const { data } = decodeIsotp({ frames: [f("7E8", "10 0B 62 F1 90 57 30 4C", 0), f("7E0", "30 00 00", 5), f("7E8", "21 31 32 33 34 35 36", 1500)] });
  assert.ok(data.warnings.some((w) => /N_Cr/.test(w)), data.warnings.join("|"));
  assert.equal(data.pdus.length, 1);
});

test("timing: N_Bs warning and STmin violation", () => {
  const a = decodeIsotp({ frames: [f("7E8", "10 0B 62 F1 90 57 30 4C", 0), f("7E0", "30 00 00", 1200)] });
  assert.ok(a.data.warnings.some((w) => /N_Bs/.test(w)));
  const b = decodeIsotp({
    frames: [f("7E8", "10 14 62 F1 90 57 30 4C", 0), f("7E0", "30 00 0A", 1), f("7E8", "21 31 32 33 34 35 36", 2), f("7E8", "22 31 32 33 34 35 36", 4)],
  });
  assert.ok(b.data.warnings.some((w) => /STmin/.test(w)), b.data.warnings.join("|"));
});

test("interleaved ids reassemble independently", () => {
  const { data } = decodeIsotp({
    frames: [
      f("7E8", "10 0A 62 F1 90 41 42 43"),
      f("7E9", "10 09 62 F1 8C 31 32 33"),
      f("7E0", "30 00 00"),
      f("7E9", "21 34 35 36"),
      f("7E8", "21 44 45 46 47"),
    ],
  });
  assert.deepEqual(data.errors, []);
  assert.equal(data.pdus.length, 2);
  const by = Object.fromEntries(data.pdus.map((p) => [p.id, p.bytes]));
  assert.equal(by["7E9"], "62 F1 8C 31 32 33 34 35 36");
  assert.equal(by["7E8"], "62 F1 90 41 42 43 44 45 46 47");
});

test("new FF interrupts reassembly", () => {
  const { data } = decodeIsotp({ frames: [f("7E8", "10 0B 62 F1 90 57 30 4C"), f("7E8", "02 3E 00")] });
  assert.ok(data.errors.some((e) => /interrupt/i.test(e)));
  assert.equal(data.pdus.length, 1);
  assert.equal(data.pdus[0].bytes, "3E 00");
});

test("candump formats", () => {
  const text = [
    "  can0  7E0   [8]  02 10 03 AA AA AA AA AA",
    "(1690000000.123456) can0 7E8#065003003201F4",
    "can0  7E0   [8]  02 3E 80 00 00 00 00 00   '.>......'",
  ].join("\n");
  const { data } = decodeIsotp({ frames: text });
  assert.equal(data.pdus.length, 3);
  assert.equal(data.pdus[1].firstT, 1690000000123.456);
  assert.equal(data.pdus[1].uds.fields.p2StarServerMs, 5000);
  const three = decodeIsotp({ frames: "can0 7E0 [3] 02 10 03\ncan0 7E0 [3] 02 10 03\ncan0 7E0 [3] 02 10 03" });
  assert.equal(three.data.pdus.length, 3);
  const one = decodeIsotp({ frames: "(1.0) can0 7E0#0210030000000000" });
  assert.equal(one.data.pdus.length, 1);
});

test("candump with garbage lines warns, all garbage throws", () => {
  const { data } = decodeIsotp({ frames: "hello\ncan0 7E0 [3] 02 10 03" });
  assert.equal(data.pdus.length, 1);
  assert.ok(data.warnings.some((w) => /skipped/i.test(w)));
  assert.throws(() => decodeIsotp({ frames: "hello world" }), ToolInputError);
});

test("input validation", () => {
  assert.throws(() => decodeIsotp({ frames: [] }), ToolInputError);
  assert.throws(() => decodeIsotp({}), ToolInputError);
  assert.throws(() => decodeIsotp({ frames: [{ id: "7E0" }] }), ToolInputError);
  assert.throws(() => decodeIsotp({ frames: [{ id: "7E0", data: "zz" }] }), ToolInputError);
});

test("reserved PCI and truncated SF are errors, not exceptions", () => {
  const { data } = decodeIsotp({ frames: [f("7E0", "50 00"), f("7E0", "07 01 02")] });
  assert.equal(data.errors.length, 2);
});

test("decodeUds:false and padding option", () => {
  const { data } = decodeIsotp({ frames: [f("7E0", "02 10 03")], decodeUds: false, padding: true });
  assert.equal(data.pdus[0].uds, undefined);
  assert.ok(data.warnings.some((w) => /padding/i.test(w)));
});

test("tool registered", () => {
  const r = TOOLS.find((t) => t.name === "decode_isotp").run({ frames: [f("7E0", "02 3E 00")] });
  assert.equal(r.data.pdus[0].bytes, "3E 00");
  assert.match(r.text, /3E 00/);
});
