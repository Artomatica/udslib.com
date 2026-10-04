import { ToolInputError } from "./errors.mjs";
import { decodeUds, buildUdsRequest } from "./uds.mjs";
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
  {
    name: "decode_uds",
    description:
      "Decode a UDS (ISO 14229-1) PDU from hex: request, positive or negative response. Names the service, sub-function (and suppressPosRsp bit), DID/RID/address fields, and for negative responses the NRC with meaning and typical cause. Unknown SIDs and NRCs are labelled, not rejected.",
    inputSchema: {
      type: "object",
      properties: {
        hex: { type: "string", description: 'PDU bytes, e.g. "7F 34 78" or "0x22 0xF1 0x90" (no ISO-TP header).' },
        direction: { type: "string", enum: ["request", "response"], description: "Optional hint to disambiguate." },
      },
      required: ["hex"],
    },
    run: (args) => decodeUds(args.hex, args.direction),
  },
  {
    name: "build_uds_request",
    description:
      "Build a UDS request as hex with an annotated breakdown. Services: session, ecu_reset, read_did, write_did, security_seed, security_key, tester_present, routine, request_download, transfer_data, transfer_exit, clear_dtc, read_dtc, control_dtc, comm_control, raw. Numeric strings are hex.",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", enum: ["session", "ecu_reset", "read_did", "write_did", "security_seed", "security_key", "tester_present", "routine", "request_download", "transfer_data", "transfer_exit", "clear_dtc", "read_dtc", "control_dtc", "comm_control", "raw"] },
        type: { description: "session/ecu_reset sub-function (number, hex string or name)." },
        dids: { type: "array", items: { type: "string" }, description: 'read_did: e.g. ["F190","F18C"].' },
        did: { type: "string" },
        data: { type: "string", description: "Hex payload (write_did, transfer_data, routine option record)." },
        level: { type: "integer", description: "security_seed/security_key: odd seed-request level; the key is sent with level+1." },
        key: { type: "string", description: "security_key: key bytes in hex." },
        suppress: { type: "boolean", description: "tester_present: set suppressPosRspMsgIndicationBit." },
        action: { type: "string", enum: ["start", "stop", "results"] },
        rid: { type: "string", description: 'routine: e.g. "FF00".' },
        address: { type: "string", description: 'request_download: e.g. "0x08000000".' },
        size: { type: "string", description: 'request_download: e.g. "0x10000".' },
        addressBytes: { type: "integer", description: "Default 4." },
        sizeBytes: { type: "integer", description: "Default 4." },
        dfi: { type: "integer", description: "dataFormatIdentifier, default 0." },
        counter: { type: "integer", description: "transfer_data block sequence counter." },
        group: { type: "string", description: "clear_dtc group, default FFFFFF." },
        subfunction: { description: "read_dtc sub-function (e.g. 2 = reportDTCByStatusMask)." },
        mask: { description: "read_dtc status mask, default FF." },
        on: { type: "boolean", description: "control_dtc: true = DTC setting on." },
        control: { description: "comm_control control type." },
        commType: { description: "comm_control communicationType, default 01." },
        hex: { type: "string", description: "raw: bytes to pass through." },
      },
      required: ["service"],
    },
    run: (args) => buildUdsRequest(args),
  },
  stub("decode_isotp", "Decode ISO-TP frames."),
  stub("decode_dtc", "Decode a DTC."),
  stub("uds_reference", "UDS reference lookup."),
  stub("udslib_integration", "UDSLib integration plan."),
];
