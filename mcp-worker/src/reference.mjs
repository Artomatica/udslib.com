import { SERVICES, NRCS, nrcInfo, DIDS, RIDS } from "./uds-tables.mjs";
import { hex8, hex16 } from "./hex.mjs";

// One-line paraphrased purposes (own words, not standard text).
const PURPOSE = {
  0x10: "Switch the diagnostic session (default, programming, extended, safety). Sessions gate which services are allowed and carry the P2/P2* timing in the response.",
  0x11: "Ask the ECU to reset itself (hard, key off/on, soft).",
  0x14: "Delete stored DTCs, for a DTC group (FFFFFF = all).",
  0x19: "Read fault memory: counts, DTC lists by status mask, snapshot and extended data.",
  0x22: "Read one or more data values by 16-bit data identifier (DID).",
  0x23: "Read raw memory at an address with a given length.",
  0x24: "Read the scaling (unit/format) description of a DID.",
  0x27: "Unlock protected functions with a seed/key challenge-response; odd sub-function requests a seed, the next even one sends the key.",
  0x28: "Switch the ECU's normal and/or network-management message transmission and reception on or off.",
  0x29: "Certificate- or challenge-based tester authentication (2020 edition); an alternative to seed/key.",
  0x2a: "Ask the ECU to send chosen DIDs periodically at a slow, medium or fast rate.",
  0x2c: "Define a dynamic DID that collects other DIDs or memory ranges.",
  0x2e: "Write a data value by DID.",
  0x2f: "Take over or release an input/output (actuator or signal) by DID.",
  0x31: "Start, stop or fetch the result of a routine (erase, self-test, checks) by routine identifier.",
  0x34: "Begin a download to the ECU: announces address, size and data format.",
  0x35: "Begin an upload from the ECU: announces address, size and data format.",
  0x36: "Move one data block of an ongoing download/upload, tagged with a block sequence counter.",
  0x37: "End the current data transfer.",
  0x38: "Transfer files to or from the ECU's file system, or list/delete them.",
  0x3d: "Write raw memory at an address.",
  0x3e: "Keep the current non-default session alive (restarts the S3 timer); with the suppress bit the ECU stays silent.",
  0x83: "Read or change the ECU's active P2/P2* timing parameters.",
  0x84: "Wrap a service request/response in a security envelope (integrity/encryption).",
  0x85: "Switch DTC detection and storage on or off.",
  0x86: "Configure events (DTC change, timer, DID change, comparison) that make the ECU send a response by itself.",
  0x87: "Negotiate and perform a bus baud-rate change.",
};

const SESSION_USE = {
  0x10: "any",
  0x27: "usually extended or programming",
  0x2e: "usually extended (some DIDs default)",
  0x2f: "usually extended",
  0x28: "usually extended or programming",
  0x85: "usually extended or programming",
  0x31: "depends on the routine; erase/check usually programming",
  0x34: "programming (usually after SecurityAccess)",
  0x35: "programming (usually after SecurityAccess)",
  0x36: "programming",
  0x37: "programming",
};

export const REPROGRAMMING_STEPS = [
  { n: 1, request: "10 03", service: "DiagnosticSessionControl → extended", why: "Leave the default session; unlock the maintenance services." },
  { n: 2, request: "85 02", service: "ControlDTCSetting → OFF", why: "Stop the DTC engine so flashing noise is not logged as faults." },
  { n: 3, request: "28 03 01", service: "CommunicationControl → disableRxAndTx", why: "Silence the ECU's periodic application messages on the bus." },
  { n: 4, request: "10 02", service: "DiagnosticSessionControl → programming", why: "Enter the programming session; reprogramming services unlock here." },
  { n: 5, request: "27 01", service: "SecurityAccess → requestSeed", why: "Ask the ECU for a seed." },
  { n: 6, request: "27 02", service: "SecurityAccess → sendKey", why: "Answer with the computed key (demo: key = seed ^ 0xFF)." },
  { n: 7, request: "2E F15A …", service: "WriteDataByIdentifier → fingerprint", why: "Record who is flashing and when, before erasing anything." },
  { n: 8, request: "31 01 FF00", service: "RoutineControl → eraseMemory", why: "Erase the application flash region." },
  { n: 9, request: "34 …", service: "RequestDownload", why: "Announce target address + size; ECU sizes its receive buffer." },
  { n: 10, request: "36 01 …", service: "TransferData #1", why: "First image block." },
  { n: 11, request: "36 02 …", service: "TransferData #2", why: "Next image block (repeat until the image is sent)." },
  { n: 12, request: "37", service: "RequestTransferExit", why: "Tell the ECU the transfer is finished." },
  { n: 13, request: "31 01 0202", service: "RoutineControl → checkMemory", why: "Verify the image (CRC / programming-dependency check)." },
  { n: 14, request: "11 01", service: "ECUReset → hardReset", why: "Reboot into the application just written." },
  { n: 15, request: "10 03", service: "DiagnosticSessionControl → extended", why: "Re-establish a diagnostic session after the reboot." },
  { n: 16, request: "28 00 01", service: "CommunicationControl → enableRxAndTx", why: "Bring the ECU's normal CAN traffic back." },
  { n: 17, request: "85 01", service: "ControlDTCSetting → ON", why: "Resume fault logging." },
];

const TOPICS = ["a service ID or name (0x27, SecurityAccess)", "an NRC (0x78, nrc 78, requestOutOfRange)", "a DID (F190) or RID (FF00)", "timing (p2, p2*, s3)", "sessions", "security (0x27 vs 0x29)", "reprogramming_sequence"];

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9*]/g, "");

function serviceEntry(sid) {
  const s = SERVICES[sid];
  const lines = [
    `${s.name} (SID ${hex8(sid)}, positive response ${hex8(sid + 0x40)}) [${s.clause}]`,
    PURPOSE[sid],
    s.hasSubfunction ? "Has a sub-function byte (bit 7 = suppressPosRspMsgIndicationBit in requests)." : "No sub-function byte.",
  ];
  if (s.subfunctions) lines.push("Sub-functions: " + Object.entries(s.subfunctions).map(([k, v]) => `${hex8(+k)} ${v}`).join(", "));
  if (SESSION_USE[sid]) lines.push(`Typical session: ${SESSION_USE[sid]}.`);
  const data = { kind: "service", sid, name: s.name, clause: s.clause, responseSid: sid + 0x40, hasSubfunction: s.hasSubfunction, purpose: PURPOSE[sid], ...(s.subfunctions ? { subfunctions: s.subfunctions } : {}) };
  return { text: lines.join("\n"), data };
}

function nrcEntry(code) {
  const n = nrcInfo(code);
  const text = [`NRC ${hex8(code)} ${n.name}`, n.meaning, `Typical cause: ${n.typicalCause}`, "Defined in ISO 14229-1 Annex A (negative response codes)."];
  if (code === 0x78) text.push("Often shortened to responsePending (\"request correctly received - response pending\").", "Timing: this is not an error. The ECU has the request and needs longer than P2; the tester then waits up to P2* (default 5000 ms), restarting that wait for every further 0x78, until the real response arrives.");
  return { text: text.join("\n"), data: { kind: "nrc", code, name: n.name, meaning: n.meaning, typicalCause: n.typicalCause } };
}

function didEntry(did) {
  const d = DIDS[did];
  if (d) {
    return { text: `DID ${hex16(did)} ${d.name}\nStandard identification data identifier (range 0xF180-0xF19F, ISO 14229-1 Annex C).`, data: { kind: "did", did, name: d.name } };
  }
  return { text: `DID ${hex16(did)} is not one of the standard identification DIDs (0xF180-0xF19F) known to this tool; it is unknown or manufacturer/supplier specific. Ask the ECU's diagnostic specification (ODX/CDD).`, data: { kind: "did", did, name: null } };
}

const TIMING = {
  text: [
    "UDS timing parameters (ISO 14229-2 session layer; defaults, ECUs may differ)",
    "- P2 (P2server): max time from request to first response. Default 50 ms.",
    "- P2* (P2*server): extended max after an NRC 0x78 (responsePending). Default 5000 ms.",
    "- In the 0x50 session-control response, P2 is sent in 1 ms units and P2* in 10 ms units (raw 0x01F4 = 500 x 10 ms = 5000 ms).",
    "- S3 (S3server): a non-default session falls back to the default session after 5000 ms without a request.",
    "- Keep-alive: the tester sends TesterPresent with suppress bit (3E 80) about every 2 s, well inside S3.",
    "- Tester side: wait P2 (plus margin) for the first reply; after 0x78 wait P2*, restarted on each further 0x78.",
    "- Transport timing (N_Bs, N_Cr, STmin, BS) is separate: see decode_isotp.",
  ].join("\n"),
  data: { kind: "timing", p2Ms: 50, p2StarMs: 5000, s3Ms: 5000, testerPresentIntervalMs: 2000, p2StarEncodingUnitMs: 10, p2EncodingUnitMs: 1 },
};

const SESSIONS_REF = {
  text: [
    "Diagnostic sessions (0x10) [ISO 14229-1 §10.2]",
    "- 0x01 defaultSession: the ECU's state after power-up and after S3 expiry. Basic reads (identification DIDs, DTCs). No S3 timer.",
    "- 0x03 extendedDiagnosticSession: maintenance and test functions: I/O control, routines, DTC setting, communication control, most DID writes.",
    "- 0x02 programmingSession: bootloader-style session for reprogramming (0x34/0x36/0x37, erase/check routines); usually requires SecurityAccess.",
    "- 0x04 safetySystemDiagnosticSession: for safety-related functions (e.g. airbag), OEM specific.",
    "Rules of thumb: a session change usually re-locks security; non-default sessions time out to default after S3 (5000 ms) unless kept alive with TesterPresent.",
    "Which service is allowed in which session is ECU-specific. NRC 0x7F/0x7E report a service/sub-function not allowed in the active session.",
  ].join("\n"),
  data: { kind: "sessions", sessions: { 1: "defaultSession", 2: "programmingSession", 3: "extendedDiagnosticSession", 4: "safetySystemDiagnosticSession" } },
};

const SECURITY = {
  text: [
    "SecurityAccess (0x27) vs Authentication (0x29)",
    "0x27 [ISO 14229-1 §10.4]: seed/key challenge-response with a symmetric, ECU-specific algorithm. Odd sub-function requests a seed, the following even one sends the key; level n and n+1 form a pair. Wrong key: NRC 0x35, too many attempts: 0x36, delay running: 0x37. Missing unlock gives NRC 0x33.",
    "0x29 [ISO 14229-1 §10.6]: authentication introduced in the 2020 edition; certificate-based (asymmetric) and proof-of-ownership challenge, with de-authentication and configuration sub-functions. Missing authentication gives NRC 0x34.",
    "Use 0x27 where a shared-secret gate is enough and tooling is simple; use 0x29 when you need per-tester identity, revocable credentials, or no shared secret in every tool. They can be combined: authenticate first, then unlock.",
    "Whatever you pick, the algorithm and keys are not part of UDS; the standard only defines the message flow.",
  ].join("\n"),
  data: { kind: "security_comparison", services: [0x27, 0x29] },
};

function reprogramming() {
  const text = [
    "Typical OEM reprogramming sequence (17 steps). This is a typical OEM pattern, not mandated by ISO 14229; exact steps, routine IDs and security levels vary per OEM and ECU.",
    "Source: UDSLib examples/pro_flash_tool.",
    ...REPROGRAMMING_STEPS.map((s) => `${String(s.n).padStart(2)}. ${s.request.padEnd(11)} ${s.service}: ${s.why}`),
    "Phases: 1-3 pre-programming, 4-7 unlock and stamp, 8-13 move and verify the image, 14-17 activate and restore normal operation.",
  ].join("\n");
  return { text, data: { kind: "reprogramming_sequence", note: "typical OEM pattern, not mandated by ISO 14229", source: "https://github.com/w1ne/udslib/tree/develop/examples/pro_flash_tool", steps: REPROGRAMMING_STEPS } };
}

function help(topic) {
  const text = `${topic ? `No reference entry matched "${topic}".` : "No topic given."}\nTopics you can ask for:\n` + TOPICS.map((t) => "- " + t).join("\n");
  return { text, data: { kind: "help", topics: TOPICS } };
}

function combine(matches) {
  if (matches.length === 1) return matches[0];
  return { text: matches.map((m) => m.text).join("\n\n---\n\n"), data: { kind: "ambiguous", matches: matches.map((m) => m.data) } };
}

export function udsReference(args = {}) {
  const raw = typeof args?.topic === "string" ? args.topic.trim() : "";
  if (!raw) return help("");
  const t = raw.toLowerCase();
  const n = norm(raw);

  if (n === "reprogrammingsequence" || n === "reprogramming" || n === "flashsequence") return reprogramming();
  if (["p2", "p2*", "p2star", "p2server", "s3", "s3server", "timing", "timeouts"].includes(n)) return TIMING;
  if (n === "sessions" || n === "session") return SESSIONS_REF;
  if (n === "security" || /(0x)?27\s*(vs|versus|or)\s*(0x)?29|(0x)?29\s*(vs|versus|or)\s*(0x)?27/.test(t)) return SECURITY;

  let m = t.match(/^nrc\s*(?:0x)?([0-9a-f]{2})$/);
  if (m) return nrcEntry(parseInt(m[1], 16));
  m = t.match(/^(?:0x)?([0-9a-f]{2})$/);
  if (m) {
    const v = parseInt(m[1], 16);
    const matches = [];
    if (SERVICES[v]) matches.push(serviceEntry(v));
    if (NRCS[v] || v === 0x38) matches.push(nrcEntry(v));
    if (!matches.length) matches.push(nrcEntry(v));
    return combine(matches);
  }
  m = t.match(/^(?:0x)?([0-9a-f]{4})$/);
  if (m) {
    const v = parseInt(m[1], 16);
    if (RIDS[v]) return { text: `RID ${hex16(v)} ${RIDS[v]}\nRoutine identifier used with RoutineControl (0x31) [${SERVICES[0x31].clause}]; ${v === 0xff00 ? "commonly used to erase memory before a download" : v === 0xff01 ? "commonly used to check programming dependencies after a download" : "commonly used to verify memory contents"}.`, data: { kind: "rid", rid: v, name: RIDS[v] } };
    return didEntry(v);
  }

  // name lookup
  if (n.length >= 4) {
    const hits = [];
    for (const [sid, s] of Object.entries(SERVICES)) if (norm(s.name) === n || (n.length >= 6 && norm(s.name).includes(n))) hits.push(serviceEntry(+sid));
    if (hits.length) {
      const exact = hits.find((h) => norm(h.data.name) === n);
      return exact ?? combine(hits.slice(0, 3));
    }
    for (const [code, v] of Object.entries(NRCS)) if (norm(v.name) === n || (n.length >= 6 && norm(v.name).includes(n))) return nrcEntry(+code);
    if (n.includes("responsepending")) return nrcEntry(0x78);
    for (const [did, d] of Object.entries(DIDS)) if (norm(d.name) === n) return didEntry(+did);
    for (const [rid, name] of Object.entries(RIDS)) if (norm(name) === n) return { text: `RID ${hex16(+rid)} ${name}`, data: { kind: "rid", rid: +rid, name } };
  }
  return help(raw);
}
