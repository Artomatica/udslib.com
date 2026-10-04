import { ToolInputError } from "./errors.mjs";
import { parseHex, toHex, hex8, hex16, beUint } from "./hex.mjs";
import { SERVICES, NRCS, nrcInfo, DIDS, RIDS } from "./uds-tables.mjs";

const unknownService = (sid) => `unknown (${hex8(sid)})`;
const printable = (b) => b.length > 0 && b.every((x) => x >= 0x20 && x < 0x7f);
const ascii = (b) => String.fromCharCode(...b);
const num = (b) => (b.length <= 6 ? beUint(b) : toHex(b));

function didEntry(did) {
  const d = DIDS[did];
  const e = { did, didHex: hex16(did), name: d ? d.name : "unknown / manufacturer or supplier specific" };
  return e;
}
function withData(e, bytes) {
  e.data = toHex(bytes);
  if (printable(Array.from(bytes))) e.ascii = ascii(Array.from(bytes));
  return e;
}

/** Parse "ALFID addr size" memory addressing. Returns null if the bytes are too short. */
function parseAlfid(b, off) {
  if (b.length < off + 1) return null;
  const alfid = b[off];
  const sizeLen = alfid >> 4, addrLen = alfid & 0xf;
  if (!sizeLen || !addrLen || b.length < off + 1 + addrLen + sizeLen) return null;
  const a = b.slice(off + 1, off + 1 + addrLen);
  const s = b.slice(off + 1 + addrLen, off + 1 + addrLen + sizeLen);
  return { alfid, addressBytes: addrLen, sizeBytes: sizeLen, address: num(a), size: num(s), next: off + 1 + addrLen + sizeLen };
}

const dtcHex = (b) => toHex(b);

// Each decoder takes the payload after the SID (and after the sub-function if the service has one).
const REQ = {
  0x10: () => ({}),
  0x11: () => ({}),
  0x14: (p) => {
    const f = {};
    if (p.length >= 3) f.groupOfDTC = toHex(p.slice(0, 3)) + (toHex(p.slice(0, 3)) === "FF FF FF" ? " (all DTCs)" : "");
    if (p.length >= 4) f.memorySelection = p[3];
    return f;
  },
  0x19: (p, sub) => {
    const f = {};
    if ([0x01, 0x02, 0x07, 0x08, 0x17].includes(sub) && p.length >= 1) f.statusMask = p[0];
    else if ([0x04, 0x06, 0x18, 0x19].includes(sub) && p.length >= 4) {
      f.dtc = dtcHex(p.slice(0, 3));
      f.recordNumber = p[3];
    } else if (p.length) f.params = toHex(p);
    return f;
  },
  0x22: (p) => {
    if (p.length === 0 || p.length % 2) return { dids: [], warning: "payload is not a list of 2-byte DIDs" };
    const dids = [];
    for (let i = 0; i < p.length; i += 2) dids.push(didEntry((p[i] << 8) | p[i + 1]));
    return { dids };
  },
  0x23: (p) => {
    const m = parseAlfid(p, 0);
    return m ? { addressAndLengthFormatIdentifier: m.alfid, address: m.address, size: m.size } : { raw: toHex(p) };
  },
  0x24: (p) => (p.length >= 2 ? didEntry((p[0] << 8) | p[1]) : {}),
  0x27: (p, sub) => {
    const level = sub;
    const f = { level, securityLevel: (level + (level % 2)) / 2 * 2 - 1 };
    if (level % 2) {
      f.type = "requestSeed";
      if (p.length) f.securityDataRecord = toHex(p);
    } else {
      f.type = "sendKey";
      f.key = toHex(p);
    }
    return f;
  },
  0x28: (p, sub) => {
    const f = {};
    if (p.length >= 1) {
      f.communicationType = p[0];
      f.messageTypes = ["", "normalCommunicationMessages", "networkManagementCommunicationMessages", "normalAndNetworkManagement"][p[0] & 3] || "";
      f.subnet = p[0] >> 4;
    }
    if (p.length > 1) f.nodeIdentificationNumber = toHex(p.slice(1));
    return f;
  },
  0x2a: (p) => ({ transmissionMode: p.length ? ({ 1: "sendAtSlowRate", 2: "sendAtMediumRate", 3: "sendAtFastRate", 4: "stopSending" }[p[0]] ?? hex8(p[0])) : undefined, periodicDataIdentifiers: toHex(p.slice(1)) }),
  0x2e: (p) => (p.length >= 2 ? withData(didEntry((p[0] << 8) | p[1]), p.slice(2)) : {}),
  0x2f: (p) => {
    if (p.length < 3) return { raw: toHex(p) };
    const names = ["returnControlToECU", "resetToDefault", "freezeCurrentState", "shortTermAdjustment"];
    return { ...didEntry((p[0] << 8) | p[1]), controlParameter: names[p[2]] ?? hex8(p[2]), controlState: toHex(p.slice(3)) };
  },
  0x31: (p) => {
    if (p.length < 2) return { raw: toHex(p) };
    const rid = (p[0] << 8) | p[1];
    const f = { rid, ridHex: hex16(rid), ridName: RIDS[rid] ?? "unknown / manufacturer specific" };
    if (p.length > 2) f.optionRecord = toHex(p.slice(2));
    return f;
  },
  0x34: (p) => {
    if (p.length < 2) return { raw: toHex(p) };
    const m = parseAlfid(p, 1);
    const f = { dataFormatIdentifier: p[0], compression: p[0] >> 4, encryption: p[0] & 0xf };
    if (m) Object.assign(f, { addressAndLengthFormatIdentifier: m.alfid, address: m.address, size: m.size, addressHex: typeof m.address === "number" ? "0x" + m.address.toString(16).toUpperCase().padStart(m.addressBytes * 2, "0") : undefined });
    else f.warning = "ALFID/address/size do not fit the payload";
    return f;
  },
  0x36: (p) => ({ blockSequenceCounter: p[0], dataLength: Math.max(0, p.length - 1), data: toHex(p.slice(1)) }),
  0x37: (p) => (p.length ? { transferRequestParameterRecord: toHex(p) } : {}),
  0x38: (p) => {
    const modes = { 1: "addFile", 2: "deleteFile", 3: "replaceFile", 4: "readFile", 5: "readDir" };
    const f = { modeOfOperation: modes[p[0]] ?? hex8(p[0]) };
    if (p.length >= 3) {
      const len = (p[1] << 8) | p[2];
      f.filePathAndNameLength = len;
      f.filePathAndName = ascii(Array.from(p.slice(3, 3 + len)));
      if (p.length > 3 + len) f.rest = toHex(p.slice(3 + len));
    }
    return f;
  },
  0x3d: (p) => {
    const m = parseAlfid(p, 0);
    return m ? { address: m.address, size: m.size, data: toHex(p.slice(m.next)) } : { raw: toHex(p) };
  },
  0x85: (p) => (p.length ? { dtcSettingControlOptionRecord: toHex(p) } : {}),
};

const RSP = {
  0x10: (p) => {
    if (p.length < 4) return p.length ? { raw: toHex(p) } : {};
    const p2 = (p[0] << 8) | p[1], p2s = (p[2] << 8) | p[3];
    return { p2ServerMs: p2, p2StarServerRaw: p2s, p2StarServerMs: p2s * 10 };
  },
  0x11: (p) => (p.length ? { powerDownTimeSeconds: p[0] } : {}),
  0x14: () => ({}),
  0x19: (p, sub) => {
    const f = {};
    if (sub === 0x01 && p.length >= 5) Object.assign(f, { statusAvailabilityMask: p[0], dtcFormatIdentifier: p[1], dtcCount: (p[2] << 8) | p[3] });
    else if ([0x02, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x15, 0x07, 0x08].includes(sub) && p.length >= 1) {
      f.statusAvailabilityMask = p[0];
      const rest = p.slice(1);
      f.dtcs = [];
      for (let i = 0; i + 4 <= rest.length; i += 4) f.dtcs.push({ dtc: dtcHex(rest.slice(i, i + 3)), status: rest[i + 3] });
      if (rest.length % 4) f.warning = "trailing bytes do not form a 4-byte DTC+status record";
    } else if (p.length) f.record = toHex(p);
    return f;
  },
  0x22: (p) => {
    const dids = [];
    let i = 0;
    while (i + 2 <= p.length) {
      const did = (p[i] << 8) | p[i + 1];
      const e = didEntry(did);
      i += 2;
      const len = DIDS[did]?.len;
      const take = len && p.length - i >= len ? len : p.length - i;
      dids.push(withData(e, p.slice(i, i + take)));
      i += take;
    }
    const f = { dids };
    if (dids.length > 1 || p.length < 2) f.note = "multi-DID record boundaries are inferred from known DID lengths; check against your DID definitions";
    return f;
  },
  0x23: (p) => ({ data: toHex(p) }),
  0x24: (p) => (p.length >= 2 ? { ...didEntry((p[0] << 8) | p[1]), scalingRecord: toHex(p.slice(2)) } : {}),
  0x27: (p, sub) => {
    if (sub % 2) {
      const f = { type: "seed", level: sub, seed: toHex(p) };
      if (p.length && p.every((x) => x === 0)) f.note = "all-zero seed: this security level is already unlocked";
      return f;
    }
    return { type: "keyAccepted", level: sub };
  },
  0x28: () => ({}),
  0x2a: (p) => (p.length ? { periodicDataIdentifier: p[0] } : {}),
  0x2e: (p) => (p.length >= 2 ? didEntry((p[0] << 8) | p[1]) : {}),
  0x2f: (p) => (p.length >= 3 ? { ...didEntry((p[0] << 8) | p[1]), controlParameter: p[2], controlStatus: toHex(p.slice(3)) } : { raw: toHex(p) }),
  0x31: (p) => {
    if (p.length < 2) return { raw: toHex(p) };
    const rid = (p[0] << 8) | p[1];
    return { rid, ridHex: hex16(rid), ridName: RIDS[rid] ?? "unknown / manufacturer specific", routineInfoAndStatus: toHex(p.slice(2)) };
  },
  0x34: (p) => {
    if (p.length < 1) return {};
    const n = p[0] >> 4;
    const f = { lengthFormatIdentifier: p[0] };
    if (n && p.length >= 1 + n) f.maxNumberOfBlockLength = beUint(p.slice(1, 1 + n));
    else f.warning = "lengthFormatIdentifier does not match payload length";
    return f;
  },
  0x36: (p) => ({ blockSequenceCounter: p[0], ...(p.length > 1 ? { data: toHex(p.slice(1)) } : {}) }),
  0x37: (p) => (p.length ? { transferResponseParameterRecord: toHex(p) } : {}),
  0x38: (p) => ({ modeOfOperation: p[0], rest: toHex(p.slice(1)) }),
  0x3d: (p) => {
    const m = parseAlfid(p, 0);
    return m ? { address: m.address, size: m.size } : { raw: toHex(p) };
  },
  0x85: () => ({}),
};
RSP[0x35] = RSP[0x34];
REQ[0x35] = REQ[0x34];

const NEG_NOTES = {
  0x78: "This is not an error: the ECU received the request and needs more time. The tester should keep waiting (extended timeout P2* instead of P2) and not resend; the ECU sends the real response when done.",
  0x21: "The ECU is busy; the tester should retry the same request after a short delay.",
  0x35: "Wrong key. Check seed/key algorithm and that the key was computed for the seed of the same security level.",
  0x33: "A security level must be unlocked first (SecurityAccess 0x27), and a session change can re-lock it.",
  0x7f: "The service exists but is not allowed in the current diagnostic session.",
  0x7e: "The sub-function exists but is not allowed in the current diagnostic session.",
};

function lines(...xs) {
  return xs.filter((x) => x !== undefined && x !== null && x !== "").join("\n");
}

function renderFields(f) {
  const out = [];
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      out.push(`  ${k}:`);
      for (const it of v) out.push("    - " + (typeof it === "object" ? Object.entries(it).filter(([, x]) => x !== undefined).map(([a, b]) => `${a}=${typeof b === "number" ? b + (a === "did" ? ` (${hex16(b)})` : "") : b}`).join(" ") : it));
    } else if (typeof v === "number") out.push(`  ${k}: ${v} (0x${v.toString(16).toUpperCase()})`);
    else out.push(`  ${k}: ${v}`);
  }
  return out;
}

/**
 * Decode one UDS PDU (no ISO-TP header). direction: "request" | "response" | undefined.
 */
export function decodeUds(input, direction) {
  const b = Array.from(parseHex(input));
  if (b.length === 0) throw new ToolInputError("Empty PDU: provide at least the service ID byte.");
  const first = b[0];

  if (first === 0x7f) {
    if (b.length < 2) {
      return { text: "Negative response (0x7F) but the PDU is truncated: expected 7F <SID> <NRC>.", data: { kind: "negative_response", sid: undefined, service: "unknown", fields: {}, truncated: true } };
    }
    const sid = b[1];
    const svc = SERVICES[sid];
    const service = svc ? svc.name : unknownService(sid);
    const data = { kind: "negative_response", sid, service, fields: {} };
    if (b.length >= 3) {
      const info = nrcInfo(b[2]);
      data.nrc = { code: b[2], name: info.name, meaning: info.meaning, typicalCause: info.typicalCause };
    } else data.truncated = true;
    const text = lines(
      `Negative response to ${service} (SID ${hex8(sid)})${svc ? ` [${svc.clause}]` : ""}`,
      data.nrc ? `NRC ${hex8(data.nrc.code)} ${data.nrc.name}: ${data.nrc.meaning}` : "NRC byte missing",
      data.nrc ? `Typical cause: ${data.nrc.typicalCause}` : "",
      data.nrc && NEG_NOTES[data.nrc.code] ? NEG_NOTES[data.nrc.code] : "",
      b.length > 3 ? `Extra bytes after NRC: ${toHex(b.slice(3))}` : "",
    );
    return { text, data };
  }

  let kind, sid;
  if (direction === "response" && SERVICES[first - 0x40]) { kind = "positive_response"; sid = first - 0x40; }
  else if (direction !== "response" && SERVICES[first]) { kind = "request"; sid = first; }
  else if (SERVICES[first - 0x40] && first >= 0x40) { kind = "positive_response"; sid = first - 0x40; }
  else if (SERVICES[first]) { kind = "request"; sid = first; }
  else {
    const data = { kind: direction === "response" || (first & 0x40 && first >= 0xc0) ? "positive_response" : "request", sid: first, service: unknownService(first), fields: { payload: toHex(b.slice(1)) } };
    return { text: `Unknown service ID ${hex8(first)} (not in ISO 14229-1 service list; may be manufacturer-specific or not UDS).\nPayload: ${toHex(b.slice(1)) || "(none)"}`, data };
  }

  const svc = SERVICES[sid];
  const data = { kind, sid, service: svc.name, clause: svc.clause, fields: {} };
  let p = b.slice(1);
  let sub;
  if (svc.hasSubfunction) {
    if (p.length === 0) {
      data.fields.warning = "sub-function byte missing";
    } else {
      const raw = p[0];
      sub = kind === "request" ? raw & 0x7f : raw;
      if (kind === "request") data.suppressPosRsp = (raw & 0x80) !== 0;
      data.subfunction = sub;
      data.subfunctionName = svc.subfunctions?.[sub] ?? (sid === 0x27 ? (sub % 2 ? "requestSeed" : "sendKey") : "unknown / manufacturer specific");
      p = p.slice(1);
    }
  }
  const dec = (kind === "request" ? REQ : RSP)[sid];
  try {
    data.fields = { ...data.fields, ...(dec ? dec(p, sub ?? 0) : p.length ? { payload: toHex(p) } : {}) };
  } catch {
    data.fields.payload = toHex(p);
  }
  if (!dec && p.length === 0) delete data.fields.payload;

  const head = `${kind === "request" ? "Request" : "Positive response"}: ${svc.name} (SID ${hex8(sid)}) [${svc.clause}]`;
  const subLine = data.subfunction !== undefined ? `  sub-function: ${hex8(data.subfunction)} ${data.subfunctionName}${data.suppressPosRsp ? " (suppressPosRspMsgIndicationBit set: no positive response expected)" : ""}` : "";
  const text = lines(head, subLine, ...renderFields(data.fields));
  return { text, data };
}

// ---------------------------------------------------------------- builder

const toInt = (v, name, max = 0xffffffff) => {
  let n;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\s*(0x)?[0-9a-fA-F]+\s*$/.test(v)) n = parseInt(v.replace(/^\s*0x/i, ""), 16);
  else throw new ToolInputError(`"${name}" must be a number or hex string.`);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new ToolInputError(`"${name}" out of range (0..${max}).`);
  return n;
};
const be = (n, len) => {
  const out = [];
  for (let i = len - 1; i >= 0; i--) out.push(Math.floor(n / 2 ** (8 * i)) & 0xff);
  return out;
};
const didBytes = (v, name = "did") => be(toInt(v, name, 0xffff), 2);
const optHex = (v) => (v === undefined || v === null || v === "" ? [] : Array.from(parseHex(v)));
const named = (v, map, name, dflt) => {
  if (v === undefined) return dflt;
  if (typeof v === "string" && map[v.toLowerCase()] !== undefined) return map[v.toLowerCase()];
  return toInt(v, name, 0x7f);
};

export function buildUdsRequest(args = {}) {
  const a = args ?? {};
  let bytes;
  switch (a.service) {
    case "session":
      bytes = [0x10, named(a.type, { default: 1, programming: 2, extended: 3, safety: 4 }, "type", 1)];
      break;
    case "ecu_reset":
      bytes = [0x11, named(a.type, { hard: 1, keyoffon: 2, soft: 3 }, "type", 1)];
      break;
    case "read_did": {
      if (!Array.isArray(a.dids) || a.dids.length === 0) throw new ToolInputError('"dids" must be a non-empty array like ["F190"].');
      bytes = [0x22, ...a.dids.flatMap((d) => didBytes(d, "dids[]"))];
      break;
    }
    case "write_did": {
      const data = optHex(a.data);
      if (!data.length) throw new ToolInputError('"data" (hex) is required for write_did.');
      bytes = [0x2e, ...didBytes(a.did), ...data];
      break;
    }
    case "security_seed": {
      const l = toInt(a.level, "level", 0x7f);
      if (l % 2 === 0) throw new ToolInputError("Seed request level must be odd (1, 3, 5, ...). The key is sent with level+1.");
      bytes = [0x27, l];
      break;
    }
    case "security_key": {
      const l = toInt(a.level, "level", 0x7e);
      if (l % 2 === 0) throw new ToolInputError('"level" is the odd seed-request level; the builder sends level+1 for the key.');
      const key = optHex(a.key);
      if (!key.length) throw new ToolInputError('"key" (hex) is required.');
      bytes = [0x27, l + 1, ...key];
      break;
    }
    case "tester_present":
      bytes = [0x3e, a.suppress ? 0x80 : 0x00];
      break;
    case "routine": {
      const act = { start: 1, stop: 2, results: 3 }[a.action];
      if (!act) throw new ToolInputError('"action" must be start, stop or results.');
      bytes = [0x31, act, ...didBytes(a.rid, "rid"), ...optHex(a.data)];
      break;
    }
    case "request_download": {
      const ab = a.addressBytes === undefined ? 4 : toInt(a.addressBytes, "addressBytes", 5);
      const sb = a.sizeBytes === undefined ? 4 : toInt(a.sizeBytes, "sizeBytes", 5);
      if (ab < 1 || sb < 1 || ab > 5 || sb > 5) throw new ToolInputError("addressBytes and sizeBytes must be 1..5.");
      const addr = toInt(a.address, "address", 2 ** (8 * ab) - 1);
      const size = toInt(a.size, "size", 2 ** (8 * sb) - 1);
      const dfi = a.dfi === undefined ? 0 : toInt(a.dfi, "dfi", 0xff);
      bytes = [0x34, dfi, (sb << 4) | ab, ...be(addr, ab), ...be(size, sb)];
      break;
    }
    case "transfer_data": {
      bytes = [0x36, toInt(a.counter, "counter", 0xff), ...optHex(a.data)];
      break;
    }
    case "transfer_exit":
      bytes = [0x37, ...optHex(a.data)];
      break;
    case "clear_dtc": {
      const g = a.group === undefined ? [0xff, 0xff, 0xff] : Array.from(parseHex(a.group));
      if (g.length !== 3) throw new ToolInputError('"group" must be exactly 3 bytes (default FFFFFF = all DTCs).');
      bytes = [0x14, ...g];
      break;
    }
    case "read_dtc": {
      const sub = toInt(a.subfunction, "subfunction", 0x7f);
      bytes = [0x19, sub];
      if ([0x01, 0x02, 0x07, 0x08, 0x17].includes(sub)) bytes.push(a.mask === undefined ? 0xff : toInt(a.mask, "mask", 0xff));
      bytes.push(...optHex(a.data));
      break;
    }
    case "control_dtc":
      bytes = [0x85, a.on === false ? 2 : 1];
      break;
    case "comm_control":
      bytes = [0x28, toInt(a.control, "control", 0x7f), a.commType === undefined ? 0x01 : toInt(a.commType, "commType", 0xff)];
      break;
    case "raw":
      bytes = Array.from(parseHex(a.hex));
      if (!bytes.length) throw new ToolInputError('"hex" must contain at least one byte.');
      break;
    default:
      throw new ToolInputError(`Unknown service "${a.service}". Use one of: session, ecu_reset, read_did, write_did, security_seed, security_key, tester_present, routine, request_download, transfer_data, transfer_exit, clear_dtc, read_dtc, control_dtc, comm_control, raw.`);
  }
  const hex = toHex(bytes);
  const dec = decodeUds(hex);
  return { text: `Request bytes: ${hex}\n\n${dec.text}`, data: { hex, length: bytes.length, decoded: dec.data } };
}
