import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleRpc } from "../src/mcp.mjs";

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const call = (args) => handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "analyze_trace", arguments: args } }).then((r) => r.result);

function withFetch(body, headers = {}) {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(body, { headers });
  return () => (globalThis.fetch = orig);
}

test("analyze_trace: pasted text returns root cause text and trimmed structured output", async () => {
  const r = await call({ trace: fx("flash-fail.trc").toString() });
  assert.notEqual(r.isError, true, r.content[0].text);
  assert.match(r.content[0].text, /ROOT CAUSE: TransferData #4 refused: wrongBlockSequenceCounter/);
  const s = r.structuredContent;
  assert.equal(s.rootCause.code, "wrongBlockSequenceCounter");
  assert.equal(s.flash[0].image, undefined, "image bytes are not sent over MCP");
  assert.equal(s.summary.format, "trc");
  assert.equal(s.truncated, false);
});

test("analyze_trace: uploaded file is downloaded and analyzed", async () => {
  const restore = withFetch(fx("flash-ok.savvycan.csv"));
  try {
    const r = await call({ file: { download_url: "https://files.example/x", file_id: "file_1", file_name: "flash-ok.csv" } });
    assert.notEqual(r.isError, true, r.content[0].text);
    assert.equal(r.structuredContent.rootCause, null);
    assert.equal(r.structuredContent.flash[0].complete, true);
  } finally {
    restore();
  }
});

test("analyze_trace: files over 10 MB are rejected", async () => {
  const restore = withFetch("x", { "content-length": String(11 * 1024 * 1024) });
  try {
    const r = await call({ file: { download_url: "https://files.example/big", file_id: "f" } });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /limit is 10 MB/);
  } finally {
    restore();
  }
});

test("analyze_trace: BLF is named and the export hint given", async () => {
  const restore = withFetch(new Uint8Array([0x4c, 0x4f, 0x47, 0x47, 0x90, 0, 0, 0]));
  try {
    const r = await call({ file: { download_url: "https://files.example/t.blf", file_id: "f" } });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Vector BLF files are not supported yet\. Export the trace as Vector ASC/);
  } finally {
    restore();
  }
});

test("analyze_trace: missing input and unknown format are input errors", async () => {
  assert.match((await call({})).content[0].text, /Give the trace/);
  assert.match((await call({ trace: "(0.0) can0 7E0#0210", format: "mf4" })).content[0].text, /Unknown format/);
  assert.match((await call({ trace: "nothing here" })).content[0].text, /Could not recognise/);
});

test("tools/list: only analyze_trace carries the widget template and file params", async () => {
  const { result } = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const withTpl = result.tools.filter((t) => t._meta?.["openai/outputTemplate"]);
  assert.deepEqual(withTpl.map((t) => t.name), ["analyze_trace"]);
  assert.deepEqual(withTpl[0]._meta["openai/fileParams"], ["file"]);
  assert.equal(withTpl[0].annotations.readOnlyHint, true);
});

test("resources: list and read the widget", async () => {
  const init = await handleRpc({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.ok(init.result.capabilities.resources);
  assert.equal(init.result.serverInfo.version, "1.1.0");
  const list = await handleRpc({ jsonrpc: "2.0", id: 4, method: "resources/list" });
  assert.equal(list.result.resources[0].uri, "ui://widget/trace-viewer.html");
  const read = await handleRpc({ jsonrpc: "2.0", id: 5, method: "resources/read", params: { uri: "ui://widget/trace-viewer.html" } });
  const c = read.result.contents[0];
  assert.equal(c.mimeType, "text/html+skybridge");
  assert.match(c.text, /renderAnalysis/);
  assert.ok(c._meta["openai/widgetCSP"]);
  const bad = await handleRpc({ jsonrpc: "2.0", id: 6, method: "resources/read", params: { uri: "ui://nope" } });
  assert.equal(bad.error.code, -32602);
});
