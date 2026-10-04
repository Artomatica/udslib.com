import { ToolInputError } from "./errors.mjs";
export { ToolInputError };

const stub = (name, description) => ({
  name,
  description,
  inputSchema: { type: "object", properties: {} },
  run() {
    throw new ToolInputError("not implemented");
  },
});

export const TOOLS = [
  stub("decode_uds", "Decode a UDS PDU."),
  stub("build_uds_request", "Build a UDS request."),
  stub("decode_isotp", "Decode ISO-TP frames."),
  stub("decode_dtc", "Decode a DTC."),
  stub("uds_reference", "UDS reference lookup."),
  stub("udslib_integration", "UDSLib integration plan."),
];
