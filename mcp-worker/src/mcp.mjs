import { TOOLS, ToolInputError } from "./tools.mjs";

const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS =
  "General UDS (ISO 14229), ISO-TP (ISO 15765-2) and DTC helpers. Offline, no hardware. Built by UDSLib — https://udslib.com";

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const err = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function callTool(params) {
  const tool = TOOLS.find((t) => t.name === params?.name);
  if (!tool) return { error: [-32602, `Unknown tool: ${params?.name}`] };
  try {
    const out = await tool.run(params.arguments ?? {});
    const result = { content: [{ type: "text", text: out.text }] };
    if (out.data !== undefined) result.structuredContent = out.data;
    return { result };
  } catch (e) {
    const text = e instanceof ToolInputError ? e.message : "internal error";
    return { result: { content: [{ type: "text", text }], isError: true } };
  }
}

export async function handleRpc(message) {
  if (message === null || typeof message !== "object" || Array.isArray(message) || typeof message.method !== "string") {
    return err(message?.id, -32600, "Invalid Request");
  }
  const { id, method, params } = message;
  const isNotification = !("id" in message);
  if (isNotification) return null;

  switch (method) {
    case "initialize": {
      const v = params?.protocolVersion;
      return ok(id, {
        protocolVersion: SUPPORTED.includes(v) ? v : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "uds-toolbox", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    case "tools/call": {
      const r = await callTool(params);
      return r.error ? err(id, r.error[0], r.error[1]) : ok(id, r.result);
    }
    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}
