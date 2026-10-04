import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseBinaryTrace, binaryFormat } from "../src/trace/binary.mjs";
import { analyzeTrace } from "../src/trace/analyze.mjs";
import { flashOk } from "./scenario.mjs";

// Fixtures written by python-can (BLF, MF4) and scapy (pcap, pcapng): scripts/make-binary-fixtures.py
const fx = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

for (const ext of ["blf", "mf4", "pcap", "pcapng"]) {
  test(`${ext}: python-can/scapy file parses to the scenario frames`, async () => {
    const bytes = fx(`flash-ok.${ext}`);
    assert.equal(binaryFormat(bytes), ext);
    const { frames, format } = await parseBinaryTrace(bytes);
    assert.equal(format, ext);
    const want = flashOk();
    assert.equal(frames.length, want.length);
    for (let i = 0; i < want.length; i++) {
      assert.equal(frames[i].id, want[i].id, `frame ${i} id`);
      assert.equal(frames[i].ext, false, `frame ${i} ext`);
      assert.deepEqual(frames[i].data, want[i].data, `frame ${i} data`);
      assert.ok(Math.abs(frames[i].t - want[i].t) < 0.06, `frame ${i} t ${frames[i].t} vs ${want[i].t}`);
    }
  });
  test(`${ext}: failed flash gives the same root cause`, async () => {
    const { frames } = await parseBinaryTrace(fx(`flash-fail.${ext}`));
    assert.equal(analyzeTrace(frames).rootCause.code, "wrongBlockSequenceCounter");
  });
}

for (const ext of ["blf", "mf4", "pcap"]) {
  test(`${ext}: extended ids, CAN FD and direction`, async () => {
    const { frames } = await parseBinaryTrace(fx(`mixed.${ext}`));
    assert.equal(frames.length, 4);
    assert.deepEqual(frames.map((f) => [f.id, f.ext]), [[0x18da10f1, true], [0x18daf110, true], [0x7e0, false], [0x123, false]]);
    assert.equal(frames[2].fd, true);
    assert.equal(frames[2].data.length, 12);
    assert.deepEqual(frames[2].data.slice(0, 5), [0x00, 0x0a, 0x22, 0xf1, 0x90]);
    assert.deepEqual(frames[3].data, [0x11, 0x22]);
    if (ext !== "pcap") assert.deepEqual(frames.map((f) => f.dir), ["tx", "rx", "tx", "rx"]);
    assert.ok(Math.abs(frames[3].t - 20) < 0.01, String(frames[3].t));
  });
}

test("garbage and wrong link types are rejected with a reason", async () => {
  await assert.rejects(parseBinaryTrace(new TextEncoder().encode("hello")), /Not a BLF/);
  const eth = new Uint8Array(24);
  new DataView(eth.buffer).setUint32(0, 0xa1b2c3d4, true);
  new DataView(eth.buffer).setUint32(20, 1, true);
  await assert.rejects(parseBinaryTrace(eth), /link type 1/);
});

for (const z of [1, 2]) {
  test(`mf4 compressed by asammdf (level ${z}: ${z === 1 ? "deflate" : "transposed deflate"})`, async () => {
    const { frames } = await parseBinaryTrace(fx(`flash-ok.z${z}.mf4`));
    const want = flashOk();
    assert.equal(frames.length, want.length);
    assert.deepEqual(frames.map((f) => f.data), want.map((f) => f.data));
  });
}
