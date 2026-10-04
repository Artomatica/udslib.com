import { handleRpc } from "./mcp.mjs";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id, authorization",
  "access-control-max-age": "86400",
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS, ...extra } });

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/mcp") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST", ...CORS } });
      }
      let body;
      try {
        body = JSON.parse(await request.text());
      } catch {
        return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
      }
      if (Array.isArray(body)) {
        if (body.length === 0) {
          return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
        }
        const out = (await Promise.all(body.map(handleRpc))).filter((r) => r !== null);
        return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
      }
      const res = await handleRpc(body);
      return res === null ? new Response(null, { status: 202, headers: CORS }) : json(res);
    }
    if (url.pathname === "/" && request.method === "GET") {
      return new Response("uds-toolbox MCP server. Endpoint: POST /mcp. Docs: https://udslib.com/mcp.html\n", {
        headers: { "content-type": "text/plain; charset=utf-8", ...CORS },
      });
    }
    return new Response("Not found", { status: 404, headers: CORS });
  },
};
