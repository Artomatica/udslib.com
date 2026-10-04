import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeDtc } from "../src/dtc.mjs";
import { ToolInputError, TOOLS } from "../src/tools.mjs";

test("P0123 / FTB 45", () => {
  const { data } = decodeDtc({ dtc: "01 23 45" });
  assert.equal(data.code, "P0123");
  assert.equal(data.ftb, "45");
  assert.equal(data.system, "Powertrain");
  assert.equal(data.hex, "01 23 45");
});

test("U0073", () => {
  const { data } = decodeDtc({ dtc: "C0 73 00" });
  assert.equal(data.code, "U0073");
  assert.equal(data.system, "Network");
});

test("code form to hex", () => {
  assert.equal(decodeDtc({ dtc: "U0073-00" }).data.hex, "C0 73 00");
  assert.equal(decodeDtc({ dtc: "p0123-45" }).data.hex, "01 23 45");
  assert.equal(decodeDtc({ dtc: "P0123" }).data.hex, "01 23 00");
  assert.equal(decodeDtc({ dtc: "C1234-FF" }).data.hex, "52 34 FF");
});

test("B0123 from 81 23 00", () => {
  const { data } = decodeDtc({ dtc: "81 23 00" });
  assert.equal(data.code, "B0123");
  assert.equal(data.system, "Body");
});

test("chassis", () => assert.equal(decodeDtc({ dtc: "41 00 00" }).data.code, "C0100"));

test("hex forms: compact, 0x, array-like string", () => {
  assert.equal(decodeDtc({ dtc: "012345" }).data.code, "P0123");
  assert.equal(decodeDtc({ dtc: "0x01,0x23,0x45" }).data.code, "P0123");
  // 6 hex digits are always read as 3 bytes; use "B0123-34" for code form with FTB
  assert.equal(decodeDtc({ dtc: "B01234" }).data.code, "B3012");
  assert.equal(decodeDtc({ dtc: "B0123-34" }).data.hex, "81 23 34");
});

test("status 0x09", () => {
  const { data } = decodeDtc({ dtc: "01 23 45", status: "0x09" });
  assert.equal(data.status.raw, 9);
  const set = data.status.bits.filter((b) => b.set).map((b) => b.name);
  assert.deepEqual(set, ["testFailed", "confirmedDTC"]);
  assert.equal(data.status.bits.length, 8);
  assert.equal(data.status.bits[7].name, "warningIndicatorRequested");
  assert.equal(decodeDtc({ dtc: "01 23 45", status: 0x09 }).data.status.raw, 9);
  assert.equal(decodeDtc({ dtc: "01 23 45", status: "FF" }).data.status.bits.every((b) => b.set), true);
});

test("bad input", () => {
  assert.throws(() => decodeDtc({ dtc: "XYZ" }), ToolInputError);
  assert.throws(() => decodeDtc({ dtc: "01 23" }), ToolInputError);
  assert.throws(() => decodeDtc({ dtc: "P4123" }), ToolInputError);
  assert.throws(() => decodeDtc({}), ToolInputError);
  assert.throws(() => decodeDtc({ dtc: "01 23 45", status: "300" }), ToolInputError);
  assert.throws(() => decodeDtc({ dtc: "01 23 45", status: "zz" }), ToolInputError);
});

test("tool registered", () => {
  const r = TOOLS.find((t) => t.name === "decode_dtc").run({ dtc: "01 23 45", status: 9 });
  assert.match(r.text, /P0123/);
});
