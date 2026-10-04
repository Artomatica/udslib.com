import { TOOLS, ToolInputError } from "./tools.mjs";
import WIDGET_HTML from "./generated/widget-html.mjs";

export const SERVER_VERSION = "1.1.0";
const WIDGET_URI = "ui://widget/trace-viewer.html";
const WIDGET = {
  uri: WIDGET_URI,
  name: "UDS trace viewer",
  description: "Timeline of a UDS diagnostic session from a CAN trace",
  mimeType: "text/html+skybridge",
};
const WIDGET_META = {
  "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
  "openai/widgetDescription": "Timeline of a UDS diagnostic session from a CAN trace: root cause, flash progress and decoded request/response pairs.",
  "openai/widgetPrefersBorder": true,
};

const TITLES = {
  analyze_trace: "Analyze CAN trace",
  decode_uds: "Decode UDS message",
  build_uds_request: "Build UDS request",
  decode_isotp: "Decode ISO-TP trace",
  decode_dtc: "Decode DTC",
  uds_reference: "UDS reference",
  udslib_integration: "UDSLib integration plan",
};

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
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: { name: "uds-toolbox", version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: TOOLS.map(({ name, description, inputSchema, _meta }) => ({
          name,
          title: TITLES[name],
          description,
          inputSchema,
          // Every tool computes from its input and static tables (analyze_trace may read the user's own uploaded file):
          // no writes, no other outside calls.
          annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: true },
          ...(_meta ? { _meta } : {}),
        })),
      });
    case "resources/list":
      return ok(id, { resources: [{ ...WIDGET, _meta: WIDGET_META }] });
    case "resources/templates/list":
      return ok(id, { resourceTemplates: [] });
    case "resources/read":
      if (params?.uri !== WIDGET_URI) return err(id, -32602, `Unknown resource: ${params?.uri}`);
      return ok(id, { contents: [{ uri: WIDGET_URI, mimeType: WIDGET.mimeType, text: WIDGET_HTML, _meta: WIDGET_META }] });
    case "tools/call": {
      const r = await callTool(params);
      return r.error ? err(id, r.error[0], r.error[1]) : ok(id, r.result);
    }
    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}
