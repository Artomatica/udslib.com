// UDS session analysis over parsed CAN frames: ISO-TP reassembly, request/response pairing,
// timing, timeline, security, flash transfer reconstruction and root-cause findings.
// Pure ESM, no Node APIs: runs in the Worker and in the browser.
import { SERVICES, DIDS, RIDS, nrcInfo } from "../uds-tables.mjs";

const RESPONSE_WINDOW_MS = 5000; // P2*server default upper bound used to call a request unanswered
const N_LIMIT_MS = 1000;

const hx = (n, w = 2) => n.toString(16).toUpperCase().padStart(w, "0");
const idText = (id, ext) => hx(id, ext || id > 0x7ff ? 8 : 3);
const hexStr = (bytes) => bytes.map((b) => hx(b)).join(" ");
const isRequestSid = (b) => (b >= 0x10 && b <= 0x3e) || (b >= 0x83 && b <= 0x87);
const isResponseSid = (b) => b === 0x7f || (b >= 0x50 && b <= 0x7e) || (b >= 0xc3 && b <= 0xc7);
const svcName = (sid) => SERVICES[sid]?.name ?? `service 0x${hx(sid)}`;
const subName = (sid, sub) => SERVICES[sid]?.subfunctions?.[sub & 0x7f];
const ascii = (bytes) => (bytes.length && bytes.every((b) => b >= 0x20 && b < 0x7f) ? String.fromCharCode(...bytes) : null);

let CRC_TABLE;
export function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** ISO-TP reassembly per CAN id. Returns { messages, isotpFindings }. */
function reassemble(frames) {
  const messages = [];
  const findings = [];
  const open = new Map();
  const finding = (severity, code, title, detail, refs) => findings.push({ severity, code, title, detail, frameRefs: refs });
  for (const fr of frames) {
    const d = fr.data;
    if (!d.length) continue;
    const key = idText(fr.id, fr.ext);
    const pci = d[0] >> 4;
    const low = d[0] & 0xf;
    if (pci === 0) {
      let len = low, off = 1;
      if (low === 0 && d.length > 8) { len = d[1]; off = 2; }
      if (len === 0 || d.length < off + len || (off === 1 && len > 7)) continue; // not ISO-TP (e.g. other bus traffic)
      if (open.has(key)) {
        const st = open.get(key);
        finding("warning", "isotpInterrupted", `ISO-TP message on ${key} cut short`, `A new single frame arrived after ${st.bytes.length} of ${st.total} bytes; the partial message was dropped.`, [...st.refs, fr.i]);
        open.delete(key);
      }
      messages.push({ id: key, t: fr.t, tEnd: fr.t, bytes: d.slice(off, off + len), refs: [fr.i] });
    } else if (pci === 1) {
      let total = (low << 8) | (d[1] ?? 0), off = 2;
      if (total === 0 && d.length >= 6) { total = ((d[2] * 256 + d[3]) * 256 + d[4]) * 256 + d[5]; off = 6; }
      if (total < 8) continue;
      if (open.has(key)) {
        const st = open.get(key);
        finding("warning", "isotpInterrupted", `ISO-TP message on ${key} cut short`, `A new first frame arrived after ${st.bytes.length} of ${st.total} bytes.`, [...st.refs, fr.i]);
      }
      open.set(key, { id: key, t: fr.t, tEnd: fr.t, total, bytes: d.slice(off, off + total), refs: [fr.i], nextSn: 1, lastT: fr.t });
    } else if (pci === 2) {
      const st = open.get(key);
      if (!st) continue; // stray CF (or non-ISO-TP traffic)
      if (low !== st.nextSn) {
        finding("error", "isotpSequenceError", `ISO-TP sequence error on ${key}`, `Expected consecutive frame SN ${st.nextSn}, got ${low}. The receiver drops the whole message.`, [...st.refs, fr.i]);
        open.delete(key);
        continue;
      }
      if (fr.t - st.lastT > N_LIMIT_MS) finding("warning", "isotpNcrTimeout", `Slow consecutive frame on ${key}`, `${Math.round(fr.t - st.lastT)} ms before CF SN ${low} (N_Cr limit is typically ${N_LIMIT_MS} ms).`, [fr.i]);
      st.nextSn = (st.nextSn + 1) & 0xf;
      st.bytes.push(...d.slice(1, 1 + st.total - st.bytes.length));
      st.refs.push(fr.i);
      st.lastT = st.tEnd = fr.t;
      if (st.bytes.length >= st.total) {
        messages.push({ id: st.id, t: st.t, tEnd: st.tEnd, bytes: st.bytes, refs: st.refs });
        open.delete(key);
      }
    } else if (pci === 3) {
      if (low === 2) finding("error", "isotpOverflow", `Flow control overflow on ${key}`, "The receiver answered a first frame with FC overflow: the message is larger than its buffer.", [fr.i]);
      for (const st of open.values()) if (st.id !== key && st.nextSn === 1) st.lastT = fr.t; // N_Cr counts from the flow control
    }
  }
  for (const st of open.values()) finding("warning", "isotpIncomplete", `Unfinished ISO-TP message on ${st.id}`, `Trace ends after ${st.bytes.length} of ${st.total} bytes.`, st.refs);
  messages.sort((a, b) => a.t - b.t);
  return { messages, isotpFindings: findings };
}

/** Conventional tester id for a response id: 7E8..7EF -> 7E0..7E7, 18DAxxyy -> 18DAyyxx. */
function partnerId(id) {
  const n = parseInt(id, 16);
  if (id.length === 3 && n >= 0x7e8 && n <= 0x7ef) return hx(n - 8, 3);
  if (id.length === 8 && /^18D[AB]/i.test(id)) return id.slice(0, 4) + id.slice(6, 8) + id.slice(4, 6);
  return null;
}

function pairMessages(messages) {
  const pairs = [];
  const open = []; // requests awaiting a final response
  const learned = new Map(); // response id -> request id
  const singles = [];
  for (const m of messages) {
    const b = m.bytes[0];
    if (isRequestSid(b)) {
      const sid = b;
      const sub = SERVICES[sid]?.hasSubfunction ? m.bytes[1] : undefined;
      const suppress = sub !== undefined && (sub & 0x80) !== 0;
      const p = { n: pairs.length, sid, sub: sub === undefined ? undefined : sub & 0x7f, suppress, service: svcName(sid), testerId: m.id, ecuId: null,
        reqT: m.t, request: m.bytes, rsp: null, pending: [], frameRefs: [...m.refs] };
      pairs.push(p);
      open.push(p);
      continue;
    }
    if (!isResponseSid(b)) { singles.push(m); continue; }
    const neg = b === 0x7f;
    const sid = neg ? m.bytes[1] : b - 0x40;
    // Pick the open request for this SID within the response window. Prefer the tester this ECU answered
    // before, then the conventional partner id (7E8 -> 7E0, 18DAF110 -> 18DA10F1), then the newest.
    let best = -1, bestScore = 0;
    const partner = partnerId(m.id);
    for (let k = open.length - 1; k >= 0; k--) {
      const p = open[k];
      if (p.sid !== sid || p.testerId === m.id) continue;
      const since = m.t - (p.pending.length ? p.pending[p.pending.length - 1].t : p.reqT);
      if (since > RESPONSE_WINDOW_MS || since < 0) continue;
      const score = learned.get(m.id) === p.testerId ? 3 : partner === p.testerId ? 2 : 1;
      if (score > bestScore) { best = k; bestScore = score; }
    }
    if (best < 0) { singles.push(m); continue; }
    const p = open[best];
    learned.set(m.id, p.testerId);
    p.ecuId = m.id;
    p.frameRefs.push(...m.refs);
    if (neg && m.bytes[2] === 0x78) { p.pending.push({ t: m.t }); continue; }
    p.rsp = { t: m.t, bytes: m.bytes, negative: neg, nrc: neg ? m.bytes[2] : undefined };
    open.splice(best, 1);
  }
  return { pairs, singles };
}

function summarizePair(p, traceEnd) {
  const out = {
    n: p.n, reqT: p.reqT, service: p.service, sid: p.sid, sub: p.sub, subName: p.sub === undefined ? undefined : subName(p.sid, p.sub),
    testerId: p.testerId, ecuId: p.ecuId, request: hexStr(p.request), pendingCount: p.pending.length, frameRefs: p.frameRefs,
  };
  if (p.rsp) {
    out.rspT = p.rsp.t;
    out.latencyMs = round(p.rsp.t - p.reqT);
    out.p2Ms = round((p.pending.length ? p.pending[0].t : p.rsp.t) - p.reqT);
    if (p.pending.length) out.p2StarMs = round(p.rsp.t - p.pending[p.pending.length - 1].t);
    out.response = hexStr(p.rsp.bytes);
    out.positive = !p.rsp.negative;
    if (p.rsp.negative) { out.nrc = p.rsp.nrc; out.nrcName = nrcInfo(p.rsp.nrc).name; }
    out.status = p.rsp.negative ? "negative" : "positive";
  } else if (p.suppress) out.status = "suppressed";
  else {
    const waited = traceEnd - (p.pending.length ? p.pending[p.pending.length - 1].t : p.reqT);
    out.status = waited >= RESPONSE_WINDOW_MS ? "timeout" : "noResponse";
    out.waitedMs = round(waited);
  }
  return out;
}

const round = (x) => Math.round(x * 1000) / 1000;
const stats = (xs) => {
  if (!xs.length) return { count: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (f) => s[Math.min(s.length - 1, Math.floor(f * s.length))];
  return { count: s.length, p50: round(q(0.5)), p95: round(q(0.95)), max: round(s[s.length - 1]) };
};

const LANE = (sid) => {
  if (sid === 0x10 || sid === 0x11 || sid === 0x3e) return "Session";
  if (sid === 0x27 || sid === 0x29 || sid === 0x84) return "Security";
  if (sid === 0x34 || sid === 0x35 || sid === 0x36 || sid === 0x37 || sid === 0x38) return "Flash";
  return "Other";
};

function pairLabel(p) {
  const r = p.request.split(" ").map((h) => parseInt(h, 16));
  let l = p.service;
  if (p.subName) l += ` ${p.subName}`;
  if (p.sid === 0x31 && r.length >= 4) {
    const rid = r[2] * 256 + r[3];
    l += ` ${RIDS[rid] ?? "0x" + hx(rid, 4)}`;
  }
  if (p.sid === 0x22 && r.length >= 3) {
    const did = r[1] * 256 + r[2];
    l += ` ${DIDS[did]?.name ?? "0x" + hx(did, 4)}`;
  }
  if (p.sid === 0x36) l += ` #${r[1]}`;
  return l;
}

function analyzeFlash(pairs, findings) {
  const flashes = [];
  let cur = null;
  for (const p of pairs) {
    const r = p.request;
    if (p.sid === 0x34) {
      if (!p.rsp || p.rsp.negative) continue;
      const alfid = r[2] ?? 0;
      const aLen = alfid & 0xf, sLen = alfid >> 4;
      const num = (o, n) => r.slice(o, o + n).reduce((v, b) => v * 256 + b, 0);
      const address = num(3, aLen), size = num(3 + aLen, sLen);
      const lfid = p.rsp.bytes[1] >> 4;
      const maxBlockLength = p.rsp.bytes.slice(2, 2 + lfid).reduce((v, b) => v * 256 + b, 0);
      cur = { startPair: p.n, t0: p.reqT, address, size, maxBlockLength, blocks: 0, retransmits: 0, counterErrors: 0, chunks: [], expected: 1, lastCounter: null, lastReqCounter: null, complete: false, endT: p.reqT, lastT: p.reqT };
      flashes.push(cur);
    } else if (p.sid === 0x36 && cur) {
      const counter = r[1];
      const payload = r.slice(2);
      cur.lastT = p.reqT;
      if (counter === cur.lastReqCounter) cur.retransmits++;
      cur.lastReqCounter = counter;
      if (!p.rsp || p.rsp.negative) continue;
      if (counter === cur.lastCounter) { cur.endT = p.rsp.t; continue; } // duplicate of an accepted block
      if (counter !== cur.expected) cur.counterErrors++;
      cur.chunks.push(payload);
      cur.blocks++;
      cur.lastCounter = counter;
      cur.expected = (counter + 1) & 0xff;
      cur.endT = p.rsp.t;
    } else if (p.sid === 0x37 && cur) {
      cur.lastT = p.reqT;
      if (p.rsp && !p.rsp.negative) { cur.exitPositive = true; cur.endT = p.rsp.t; }
      cur = null;
    }
  }
  return flashes.map((f) => {
    const total = f.chunks.reduce((n, c) => n + c.length, 0);
    const image = new Uint8Array(total);
    let o = 0;
    for (const c of f.chunks) { image.set(c, o); o += c.length; }
    const durationMs = round(f.endT - f.t0);
    const complete = !!f.exitPositive && (f.size === 0 || total === f.size);
    if (!complete) {
      findings.push({ severity: "error", code: "flashIncomplete", title: "Flash transfer did not complete",
        detail: `${total} of ${f.size} bytes acknowledged for the download to 0x${hx(f.address, 8)}${f.exitPositive ? "" : "; no positive RequestTransferExit"}.`, frameRefs: [], pairRef: f.startPair, t: f.lastT });
    }
    return {
      address: f.address, size: f.size, bytesTransferred: total, blocks: f.blocks, retransmits: f.retransmits, counterErrors: f.counterErrors,
      maxBlockLength: f.maxBlockLength, durationMs, throughputBps: durationMs > 0 ? Math.round((total * 1000) / durationMs) : null,
      complete, crc32: hx(crc32(image), 8), gaps: f.size && total < f.size ? [{ offset: total, length: f.size - total }] : [], image,
    };
  });
}

/**
 * Analyze parsed frames (from parseTrace). Returns a JSON-friendly object; flash[].image is a Uint8Array
 * (strip it before sending over MCP).
 */
export function analyzeTrace(frames, opts = {}) {
  const { messages, isotpFindings } = reassemble(frames);
  const traceEnd = frames.length ? frames[frames.length - 1].t : 0;
  const { pairs: all } = pairMessages(messages);
  // Ordinary bus traffic can look like ISO-TP or a UDS request by accident. Keep requests only from
  // ids that got at least one response or sit in the usual diagnostic ranges, and ISO-TP findings
  // only for ids that take part in diagnostics.
  const answered = new Set(all.filter((p) => p.rsp || p.pending.length).map((p) => p.testerId));
  const STD = (id) => /^7(DF|E[0-9A-F])$/.test(id) || /^18D[AB]/.test(id);
  const diagId = (id) => answered.has(id) || STD(id);
  const raw = all.filter((p) => diagId(p.testerId));
  raw.forEach((p, k) => (p.n = k));
  const diagIds = new Set(raw.flatMap((p) => [p.testerId, p.ecuId]).filter(Boolean));
  const findings = isotpFindings
    .filter((f) => {
      const fr = frames[f.frameRefs[0]];
      const id = fr && idText(fr.id, fr.ext);
      return id && (diagIds.has(id) || STD(id));
    })
    .map((f) => ({ ...f, t: frames[f.frameRefs[0]]?.t ?? 0 }));
  const pairs = raw.map((p) => summarizePair(p, traceEnd));

  // security
  let invalidKeys = 0;
  for (const p of pairs) {
    if (p.sid !== 0x27) continue;
    const odd = (p.sub ?? 0) % 2 === 1;
    if (p.nrc === 0x35) {
      invalidKeys++;
      findings.push({ severity: "warning", code: "invalidKey", title: "Security access: invalid key", detail: `Key for level ${p.sub} rejected (NRC 0x35 invalidKey). Attempt ${invalidKeys}.`, frameRefs: p.frameRefs, pairRef: p.n, t: p.reqT });
    } else if (p.nrc === 0x36) {
      findings.push({ severity: "error", code: "securityLockout", title: "Security access locked out", detail: `NRC 0x36 exceedNumberOfAttempts after ${invalidKeys} invalid key(s). The ECU now refuses keys until its delay timer expires.`, frameRefs: p.frameRefs, pairRef: p.n, t: p.reqT });
    } else if (p.nrc === 0x37) {
      findings.push({ severity: "error", code: "securityDelay", title: "Security access delay not expired", detail: "NRC 0x37 requiredTimeDelayNotExpired: the tester asked for a seed too soon after a lockout or power-up.", frameRefs: p.frameRefs, pairRef: p.n, t: p.reqT });
    } else if (p.positive && !odd) {
      findings.push({ severity: "info", code: "securityUnlocked", title: `Security level ${p.sub} unlocked`, detail: invalidKeys ? `Unlocked after ${invalidKeys} rejected key(s).` : "Key accepted.", frameRefs: p.frameRefs, pairRef: p.n, t: p.reqT });
    }
  }

  // negative responses and missing responses
  for (const p of pairs) {
    if (p.status === "negative" && p.sid !== 0x27) {
      const later = pairs.find((q) => q.n > p.n && q.sid === p.sid && q.sub === p.sub && q.positive && (p.sid !== 0x36 || q.request === p.request));
      const info = nrcInfo(p.nrc);
      findings.push({ severity: later ? "warning" : "error", code: info.name, title: `${pairLabel(p)} refused: ${info.name}`,
        detail: `ECU ${p.ecuId} answered ${p.response} (NRC 0x${hx(p.nrc)}). ${info.meaning} Typical cause: ${info.typicalCause}${later ? " The tester recovered later." : ""}`,
        frameRefs: p.frameRefs, pairRef: p.n, t: p.reqT });
    }
    if (p.status === "timeout" || p.status === "noResponse") {
      const nextReq = pairs.find((q) => q.n > p.n && q.testerId === p.testerId && q.sid !== 0x3e); // keep-alives are not a new step
      const severity = p.status === "timeout" && !nextReq ? "error" : "warning";
      const gap = nextReq ? round(nextReq.reqT - p.reqT) : null;
      const detail = nextReq
        ? `No response for ${Math.round(gap)} ms${p.pendingCount ? ` after ${p.pendingCount} responsePending` : ""}; the tester then ${nextReq.request === p.request ? "repeated the same request" : `sent ${pairLabel(nextReq)}`}.`
        : p.status === "timeout"
          ? `No final response within ${Math.round(p.waitedMs)} ms${p.pendingCount ? ` after ${p.pendingCount} responsePending` : ""}; the ECU went silent until the end of the trace.`
          : `The trace ends ${Math.round(p.waitedMs)} ms after the request.`;
      findings.push({ severity, code: "timeout", title: `No response to ${pairLabel(p)}`, detail,
        frameRefs: p.frameRefs, pairRef: p.n, t: p.reqT });
    }
  }

  const flash = analyzeFlash(raw, findings);
  for (const p of pairs) if (p.sid === 0x36 && p.nrc === 0x73) {
    const f = findings.find((x) => x.pairRef === p.n && x.code === "wrongBlockSequenceCounter");
    if (f) f.detail += ` Request block counter was 0x${p.request.split(" ")[1]}.`;
  }

  // identification
  const identification = [];
  for (const p of raw) {
    if (p.sid !== 0x22 || !p.rsp || p.rsp.negative || p.request.length !== 3) continue;
    const did = p.request[1] * 256 + p.request[2];
    const data = p.rsp.bytes.slice(3);
    identification.push({ did: hx(did, 4), name: DIDS[did]?.name ?? null, ascii: ascii(data), hex: hexStr(data), ecuId: p.rsp && pairs[p.n].ecuId });
  }

  // timeline (tester present summarized)
  const timeline = pairs.filter((p) => p.sid !== 0x3e).map((p) => ({
    t: p.reqT, tEnd: p.rspT ?? p.reqT, lane: LANE(p.sid), label: pairLabel(p), status: p.status, nrcName: p.nrcName, pending: p.pendingCount, pairRef: p.n,
  }));

  findings.sort((a, b) => a.t - b.t);
  const rootCause = findings.find((f) => f.severity === "error") ?? null;
  const p2 = stats(pairs.filter((p) => p.p2Ms !== undefined).map((p) => p.p2Ms));
  const p2Star = stats(pairs.filter((p) => p.p2StarMs !== undefined).map((p) => p.p2StarMs));
  const ecus = [...new Set(pairs.filter((p) => p.ecuId).map((p) => `${p.testerId}>${p.ecuId}`))].map((s) => ({ tester: s.split(">")[0], ecu: s.split(">")[1] }));
  const sessions = pairs.filter((p) => p.sid === 0x10 && p.positive).map((p) => ({ t: p.reqT, session: p.subName ?? `0x${hx(p.sub)}` }));
  const tp = pairs.filter((p) => p.sid === 0x3e).length;

  return {
    summary: {
      format: opts.format ?? null, frames: frames.length, durationMs: round(traceEnd - (frames[0]?.t ?? 0)), canIds: new Set(frames.map((f) => idText(f.id, f.ext))).size,
      isotpMessages: messages.length, pairs: pairs.length, positive: pairs.filter((p) => p.positive).length, negative: pairs.filter((p) => p.status === "negative").length,
      timeouts: pairs.filter((p) => p.status === "timeout").length, testerPresent: tp, ecus,
    },
    rootCause, findings, pairs, timeline, flash, identification, sessions, timing: { p2, p2Star },
  };
}

/** Plain-text report of an analysis (used for the MCP text content). */
export function analysisText(a, maxLines = 40) {
  const L = [];
  const s = a.summary;
  L.push(`Trace: ${s.frames} frames, ${(s.durationMs / 1000).toFixed(2)} s, ${s.isotpMessages} ISO-TP messages, ${s.pairs} UDS request/response pairs (${s.positive} positive, ${s.negative} negative, ${s.timeouts} timeout${s.timeouts === 1 ? "" : "s"})${s.format ? `, format ${s.format}` : ""}.`);
  if (s.ecus.length) L.push(`Tester/ECU: ${s.ecus.map((e) => `${e.tester} -> ${e.ecu}`).join(", ")}`);
  L.push(a.rootCause ? `ROOT CAUSE: ${a.rootCause.title}. ${a.rootCause.detail} (frames ${a.rootCause.frameRefs.slice(0, 6).join(", ")})` : "No errors found: every request got a final positive answer or was recovered.");
  for (const f of a.flash) L.push(`Flash to 0x${hx(f.address, 8)}: ${f.bytesTransferred}/${f.size} bytes in ${f.blocks} blocks, ${f.retransmits} retransmit(s), ${f.throughputBps ?? "?"} B/s, CRC32 ${f.crc32}, ${f.complete ? "complete" : "INCOMPLETE"}.`);
  for (const id of a.identification) L.push(`${id.name ?? "DID " + id.did}: ${id.ascii ?? id.hex}`);
  if (a.sessions.length) L.push(`Sessions: ${a.sessions.map((x) => x.session).join(" -> ")}`);
  if (a.timing.p2.count) L.push(`P2 (first response) p50 ${a.timing.p2.p50} ms, p95 ${a.timing.p2.p95} ms, max ${a.timing.p2.max} ms${a.timing.p2Star.count ? `; P2* after responsePending max ${a.timing.p2Star.max} ms` : ""}.`);
  const other = a.findings.filter((f) => f !== a.rootCause && f.severity !== "info");
  if (other.length) {
    L.push("Other findings:");
    for (const f of other) L.push(`- [${f.severity}] ${f.title}`);
  }
  return L.slice(0, maxLines).join("\n");
}
