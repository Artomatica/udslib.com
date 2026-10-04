import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHex, toHex } from "../src/hex.mjs";
import { ToolInputError, TOOLS } from "../src/tools.mjs";
import { decodeUds, buildUdsRequest } from "../src/uds.mjs";
import { SERVICES, NRCS, nrcInfo } from "../src/uds-tables.mjs";

const arr = (u) => Array.from(u);

test("hex normalisation", () => {
  assert.deepEqual(arr(parseHex("22 f1 90")), [0x22, 0xf1, 0x90]);
  assert.deepEqual(arr(parseHex("0x22,0xF1,0x90")), [0x22, 0xf1, 0x90]);
  assert.deepEqual(arr(parseHex([0x22, 0xf1, 0x90])), [0x22, 0xf1, 0x90]);
  assert.deepEqual(arr(parseHex("22F190")), [0x22, 0xf1, 0x90]);
  assert.deepEqual(arr(parseHex("0x22 0xF1\n0x90")), [0x22, 0xf1, 0x90]);
  assert.throws(() => parseHex("2"), ToolInputError);
  assert.throws(() => parseHex("zz"), ToolInputError);
  assert.throws(() => parseHex([256]), ToolInputError);
  assert.throws(() => parseHex(null), ToolInputError);
  assert.equal(toHex([0x22, 0xf1, 0x90]), "22 F1 90");
});

test("tables cover all 27 services with clauses", () => {
  const sids = [0x10, 0x11, 0x14, 0x19, 0x22, 0x23, 0x24, 0x27, 0x28, 0x29, 0x2a, 0x2c, 0x2e, 0x2f, 0x31, 0x34, 0x35, 0x36, 0x37, 0x38, 0x3d, 0x3e, 0x83, 0x84, 0x85, 0x86, 0x87];
  assert.equal(sids.length, 27);
  for (const s of sids) {
    assert.ok(SERVICES[s], `sid ${s.toString(16)}`);
    assert.match(SERVICES[s].clause, /^ISO 14229-1 §/);
  }
  assert.equal(SERVICES[0x27].clause, "ISO 14229-1 §10.4");
  assert.equal(Object.keys(SERVICES).length, 27);
});

test("every defined NRC resolves; reserved and manufacturer ranges", () => {
  for (const c of [0x10, 0x11, 0x12, 0x13, 0x14, 0x21, 0x22, 0x24, 0x25, 0x26, 0x31, 0x33, 0x34, 0x35, 0x36, 0x37, 0x50, 0x70, 0x71, 0x72, 0x73, 0x78, 0x7e, 0x7f, 0x81, 0x8e, 0x93]) {
    const n = nrcInfo(c);
    assert.ok(n.name && n.meaning, `nrc ${c.toString(16)}`);
  }
  assert.equal(NRCS[0x78].name, "requestCorrectlyReceivedResponsePending");
  assert.match(nrcInfo(0x99).name, /reserved/i);
  assert.match(nrcInfo(0xf5).name, /manufacturer/i);
  assert.match(nrcInfo(0x45).name, /reserved/i);
});

test("22 F1 90 request", () => {
  const { data } = decodeUds("22 F1 90");
  assert.equal(data.kind, "request");
  assert.equal(data.sid, 0x22);
  assert.equal(data.service, "ReadDataByIdentifier");
  assert.equal(data.fields.dids[0].did, 0xf190);
  assert.match(data.fields.dids[0].name, /VIN/);
});

test("62 F1 90 positive response", () => {
  const { data } = decodeUds("62 F1 90 57 30 4C");
  assert.equal(data.kind, "positive_response");
  assert.equal(data.sid, 0x22);
  assert.equal(data.fields.dids[0].did, 0xf190);
  assert.equal(data.fields.dids[0].data, "57 30 4C");
  assert.equal(data.fields.dids[0].ascii, "W0L");
});

test("7F 22 31", () => {
  const { data } = decodeUds("7F 22 31");
  assert.equal(data.kind, "negative_response");
  assert.equal(data.service, "ReadDataByIdentifier");
  assert.equal(data.nrc.code, 0x31);
  assert.equal(data.nrc.name, "requestOutOfRange");
});

test("7F 34 78 response pending", () => {
  const { text, data } = decodeUds("7F 34 78");
  assert.equal(data.nrc.code, 0x78);
  assert.match(text, /P2\*/);
  assert.match(text, /not an error/);
});

test("unknown SID and NRC still decode", () => {
  const { data, text } = decodeUds("7F BA 99");
  assert.equal(data.kind, "negative_response");
  assert.equal(data.service, "unknown (0xBA)");
  assert.match(data.nrc.name, /reserved/);
  assert.match(text, /reserved/);
  assert.equal(decodeUds("BA 01 02").data.service, "unknown (0xBA)");
  assert.equal(decodeUds("7F").data.kind, "negative_response");
});

test("10 83 session control suppress", () => {
  const { data } = decodeUds("10 83");
  assert.equal(data.subfunction, 3);
  assert.equal(data.subfunctionName, "extendedDiagnosticSession");
  assert.equal(data.suppressPosRsp, true);
});

test("50 03 00 32 01 F4 timing", () => {
  const { data } = decodeUds("50 03 00 32 01 F4");
  assert.equal(data.kind, "positive_response");
  assert.equal(data.fields.p2ServerMs, 50);
  assert.equal(data.fields.p2StarServerMs, 5000);
});

test("27 seed/key", () => {
  const a = decodeUds("27 01").data;
  assert.equal(a.fields.type, "requestSeed");
  assert.equal(a.fields.level, 1);
  const b = decodeUds("27 02 AA BB").data;
  assert.equal(b.fields.type, "sendKey");
  assert.equal(b.fields.level, 2);
  assert.equal(b.fields.key, "AA BB");
  const c = decodeUds("67 01 12 34 56 78").data;
  assert.equal(c.fields.seed, "12 34 56 78");
});

test("3E 80", () => {
  const { data } = decodeUds("3E 80");
  assert.equal(data.suppressPosRsp, true);
  assert.equal(data.subfunction, 0);
});

test("31 01 FF 00 routine", () => {
  const { data } = decodeUds("31 01 FF 00");
  assert.equal(data.subfunctionName, "startRoutine");
  assert.equal(data.fields.rid, 0xff00);
  assert.match(data.fields.ridName, /eraseMemory/);
});

test("34 request download", () => {
  const { data } = decodeUds("34 00 44 08 00 00 00 00 01 00 00");
  assert.equal(data.service, "RequestDownload");
  assert.equal(data.fields.dataFormatIdentifier, 0);
  assert.equal(data.fields.address, 0x08000000);
  assert.equal(data.fields.size, 0x10000);
});

test("74 20 04 02", () => {
  const { data } = decodeUds("74 20 04 02");
  assert.equal(data.kind, "positive_response");
  assert.equal(data.fields.maxNumberOfBlockLength, 1026);
});

test("36 01 DE AD", () => {
  const { data } = decodeUds("36 01 DE AD");
  assert.equal(data.fields.blockSequenceCounter, 1);
  assert.equal(data.fields.dataLength, 2);
  assert.equal(data.fields.data, "DE AD");
});

test("19 02 FF", () => {
  const { data } = decodeUds("19 02 FF");
  assert.equal(data.service, "ReadDTCInformation");
  assert.equal(data.subfunctionName, "reportDTCByStatusMask");
  assert.equal(data.fields.statusMask, 0xff);
});

test("59 02 response lists DTCs", () => {
  const { data } = decodeUds("59 02 FF 01 23 45 09 C0 73 00 08");
  assert.equal(data.fields.dtcs.length, 2);
  assert.equal(data.fields.dtcs[0].dtc, "01 23 45");
  assert.equal(data.fields.dtcs[0].status, 0x09);
});

test("other services decode without throwing", () => {
  for (const h of ["11 01", "14 FF FF FF", "23 24 08 00 00 00 00 10", "28 03 01", "2E F1 90 01", "85 02", "37", "29 00", "86 00", "87 01", "2F F1 90 03 01", "3D 14 00 00 00 10 00 20 AA", "7E 00", "C5 01", "51 01", "71 01 FF 00", "6E F1 90", "77", "76 01", "75 20 10 00", "35 00 44 00 00 00 00 00 00 01 00", "38 01 00 04 61 62 63 64"]) {
    const { data, text } = decodeUds(h);
    assert.ok(data.sid !== undefined && text.length > 0, h);
    assert.notEqual(data.kind, undefined);
  }
});

test("empty throws", () => {
  assert.throws(() => decodeUds(""), ToolInputError);
  assert.throws(() => decodeUds("zz"), ToolInputError);
});

test("build vectors", () => {
  const h = (a) => buildUdsRequest(a).data.hex;
  assert.equal(h({ service: "read_did", dids: ["F190", "F18C"] }), "22 F1 90 F1 8C");
  assert.equal(h({ service: "session", type: 2 }), "10 02");
  assert.equal(h({ service: "tester_present", suppress: true }), "3E 80");
  assert.equal(h({ service: "request_download", address: "0x08000000", size: "0x10000" }), "34 00 44 08 00 00 00 00 01 00 00");
  assert.equal(h({ service: "security_key", level: 1, key: "AABB" }), "27 02 AA BB");
  assert.equal(h({ service: "routine", action: "start", rid: "FF00" }), "31 01 FF 00");
  assert.equal(h({ service: "security_seed", level: 3 }), "27 03");
  assert.throws(() => buildUdsRequest({ service: "security_seed", level: 2 }), ToolInputError);
  assert.equal(h({ service: "ecu_reset", type: 1 }), "11 01");
  assert.equal(h({ service: "write_did", did: "F190", data: "41 42" }), "2E F1 90 41 42");
  assert.equal(h({ service: "transfer_data", counter: 1, data: "DEAD" }), "36 01 DE AD");
  assert.equal(h({ service: "transfer_exit" }), "37");
  assert.equal(h({ service: "clear_dtc" }), "14 FF FF FF");
  assert.equal(h({ service: "read_dtc", subfunction: 2 }), "19 02 FF");
  assert.equal(h({ service: "control_dtc", on: false }), "85 02");
  assert.equal(h({ service: "comm_control", control: 3 }), "28 03 01");
  assert.equal(h({ service: "raw", hex: "0x3e,0x00" }), "3E 00");
  assert.equal(h({ service: "request_download", address: "0x2000", size: "0x400", addressBytes: 2, sizeBytes: 2, dfi: 0x11 }), "34 11 22 20 00 04 00");
  assert.throws(() => buildUdsRequest({ service: "request_download", address: "0x1FFFF", size: 1, addressBytes: 2 }), ToolInputError);
  assert.throws(() => buildUdsRequest({ service: "nope" }), ToolInputError);
  assert.throws(() => buildUdsRequest({}), ToolInputError);
});

test("round trip: built requests decode to same service", () => {
  const cases = [
    [{ service: "session", type: 3 }, 0x10], [{ service: "ecu_reset", type: 1 }, 0x11],
    [{ service: "read_did", dids: ["F190"] }, 0x22], [{ service: "write_did", did: "F190", data: "01" }, 0x2e],
    [{ service: "security_seed", level: 1 }, 0x27], [{ service: "security_key", level: 1, key: "01" }, 0x27],
    [{ service: "tester_present" }, 0x3e], [{ service: "routine", action: "stop", rid: "FF01" }, 0x31],
    [{ service: "request_download", address: 0x1000, size: 0x100 }, 0x34], [{ service: "transfer_data", counter: 2, data: "00" }, 0x36],
    [{ service: "transfer_exit" }, 0x37], [{ service: "clear_dtc" }, 0x14], [{ service: "read_dtc", subfunction: 1 }, 0x19],
    [{ service: "control_dtc", on: true }, 0x85], [{ service: "comm_control", control: 0 }, 0x28],
  ];
  for (const [args, sid] of cases) {
    const r = buildUdsRequest(args);
    const d = decodeUds(r.data.hex).data;
    assert.equal(d.kind, "request", args.service);
    assert.equal(d.sid, sid, args.service);
  }
});

test("tools registered: decode_uds / build_uds_request run via tool API", () => {
  const dec = TOOLS.find((t) => t.name === "decode_uds").run({ hex: "7F 34 78" });
  assert.equal(dec.data.nrc.code, 0x78);
  const bld = TOOLS.find((t) => t.name === "build_uds_request").run({ service: "session", type: 1 });
  assert.equal(bld.data.hex, "10 01");
  assert.throws(() => TOOLS.find((t) => t.name === "decode_uds").run({}), ToolInputError);
});
