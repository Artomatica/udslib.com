import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRpc } from "../src/mcp.mjs";
import { TOOLS, ToolInputError } from "../src/tools.mjs";
import worker from "../src/index.mjs";

const rpc = (method, params, id = 1) => ({ jsonrpc: "2.0", id, method, params });

test("initialize echoes supported protocol version", async () => {
  const r = await handleRpc(rpc("initialize", { protocolVersion: "2025-06-18" }));
  assert.equal(r.result.protocolVersion, "2025-06-18");
  assert.equal(r.result.serverInfo.name, "uds-toolbox");
  assert.ok(r.result.capabilities.tools);
  assert.match(r.result.instructions, /udslib\.com/);
});

test("initialize falls back for unknown version", async () => {
  const r = await handleRpc(rpc("initialize", { protocolVersion: "1999-01-01" }));
  assert.equal(r.result.protocolVersion, "2025-06-18");
  const o = await handleRpc(rpc("initialize", { protocolVersion: "2024-11-05" }));
  assert.equal(o.result.protocolVersion, "2024-11-05");
});

test("notification returns null", async () => {
  assert.equal(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
});

test("tools/list names", async () => {
  const r = await handleRpc(rpc("tools/list"));
  assert.deepEqual(r.result.tools.map((t) => t.name), [
    "decode_uds", "build_uds_request", "decode_isotp", "decode_dtc", "uds_reference", "udslib_integration",
  ]);
  for (const t of r.result.tools) assert.equal(t.inputSchema.type, "object");
});

test("tools/call unknown name -> -32602", async () => {
  const r = await handleRpc(rpc("tools/call", { name: "nope", arguments: {} }));
  assert.equal(r.error.code, -32602);
});

test("tools/call ToolInputError -> isError", async () => {
  TOOLS.push({ name: "_t_input", description: "", inputSchema: { type: "object" }, run() { throw new ToolInputError("bad input"); } });
  TOOLS.push({ name: "_t_boom", description: "", inputSchema: { type: "object" }, run() { throw new Error("secret stack"); } });
  TOOLS.push({ name: "_t_ok", description: "", inputSchema: { type: "object" }, run() { return { text: "hi", data: { a: 1 } }; } });
  try {
    const r = await handleRpc(rpc("tools/call", { name: "_t_input", arguments: {} }));
    assert.equal(r.result.isError, true);
    assert.equal(r.result.content[0].text, "bad input");
    const b = await handleRpc(rpc("tools/call", { name: "_t_boom", arguments: {} }));
    assert.equal(b.result.isError, true);
    assert.equal(b.result.content[0].text, "internal error");
    const ok = await handleRpc(rpc("tools/call", { name: "_t_ok", arguments: {} }));
    assert.equal(ok.result.content[0].text, "hi");
    assert.deepEqual(ok.result.structuredContent, { a: 1 });
    assert.equal(ok.result.isError, undefined);
  } finally {
    TOOLS.splice(TOOLS.findIndex((t) => t.name === "_t_input"), 3);
  }
});

test("unknown method -> -32601, ping -> {}", async () => {
  assert.equal((await handleRpc(rpc("bogus"))).error.code, -32601);
  assert.deepEqual((await handleRpc(rpc("ping"))).result, {});
});

test("invalid request shape -> -32600", async () => {
  assert.equal((await handleRpc("hello")).error.code, -32600);
  assert.equal((await handleRpc({ jsonrpc: "2.0", id: 3 })).error.code, -32600);
});

const post = (body, path = "/mcp") =>
  worker.fetch(new Request("https://x.test" + path, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));

test("worker: batch with notification -> array of 1", async () => {
  const res = await post([rpc("initialize", { protocolVersion: "2025-06-18" }), { jsonrpc: "2.0", method: "notifications/initialized" }]);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.ok(Array.isArray(j));
  assert.equal(j.length, 1);
});

test("worker: batch of only notifications -> 202", async () => {
  const res = await post([{ jsonrpc: "2.0", method: "notifications/initialized" }]);
  assert.equal(res.status, 202);
});

test("worker: empty batch -> -32600", async () => {
  const res = await post([]);
  assert.equal((await res.json()).error.code, -32600);
});

test("worker: single notification -> 202 empty", async () => {
  const res = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(res.status, 202);
  assert.equal(await res.text(), "");
});

test("worker: invalid JSON -> 400 -32700", async () => {
  const res = await post("{nope");
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, -32700);
});

test("worker: GET /mcp -> 405 with Allow", async () => {
  const res = await worker.fetch(new Request("https://x.test/mcp"));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "POST");
});

test("worker: OPTIONS -> CORS 204", async () => {
  const res = await worker.fetch(new Request("https://x.test/mcp", { method: "OPTIONS" }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match(res.headers.get("access-control-allow-headers"), /mcp-protocol-version/);
});

test("worker: GET / points to mcp page; CORS on responses", async () => {
  const res = await worker.fetch(new Request("https://x.test/"));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /udslib\.com\/mcp\.html/);
  const p = await post({ jsonrpc: "2.0", id: 1, method: "ping" });
  assert.equal(p.headers.get("access-control-allow-origin"), "*");
});
