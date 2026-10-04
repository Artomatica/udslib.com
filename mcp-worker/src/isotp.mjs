import { ToolInputError } from "./errors.mjs";
import { parseHex, toHex, hex8 } from "./hex.mjs";
import { decodeUds } from "./uds.mjs";

const N_LIMIT_MS = 1000; // default N_Bs / N_Cr timeout used for warnings

function normId(id) {
  if (id === undefined || id === null || id === "") return "-";
  let n;
  if (typeof id === "number") n = id;
  else if (typeof id === "string" && /^\s*(0x)?[0-9a-fA-F]+\s*$/.test(id)) n = parseInt(id.replace(/^\s*0x/i, ""), 16);
  else throw new ToolInputError(`Invalid CAN id: ${JSON.stringify(id)}`);
  if (!Number.isInteger(n) || n < 0 || n > 0x1fffffff) throw new ToolInputError(`CAN id out of range: ${JSON.stringify(id)}`);
  return n.toString(16).toUpperCase().padStart(n > 0x7ff ? 8 : 3, "0");
}

const DUMP_RE_PREFIX = /^\s*(?:\((\d+(?:\.\d+)?)\)\s*)?/;

function parseCandump(text, warnings) {
  const frames = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const m = line.match(DUMP_RE_PREFIX);
    const t = m[1] !== undefined ? Math.round(parseFloat(m[1]) * 1e6) / 1e3 : undefined;
    const rest = line.slice(m[0].length);
    let mm;
    // "can0 7E0#0210..." or "can0 7E0##1 0210..." (candump -L)
    if ((mm = rest.match(/^(?:\S+\s+)?([0-9A-Fa-f]{3,8})(##[0-9A-Fa-f]\s*|#)([0-9A-Fa-f.\s]*)$/)) && mm[3].replace(/[.\s]/g, "").length % 2 === 0) {
      frames.push({ id: mm[1], data: mm[3].replace(/[.\s]/g, ""), t });
      return;
    }
    // "can0  7E0   [8]  02 10 03 AA ..."  (optionally trailing ascii in quotes)
    if ((mm = rest.match(/^(?:\S+\s+)?([0-9A-Fa-f]{3,8})\s+\[\d+\]\s*((?:[0-9A-Fa-f]{2}\s*)*)/))) {
      frames.push({ id: mm[1], data: mm[2].trim(), t });
      return;
    }
    warnings.push(`skipped unparseable line ${i + 1}: "${line.slice(0, 50)}"`);
  });
  return frames;
}

function normalizeFrames(input, warnings) {
  let list;
  if (typeof input === "string") list = parseCandump(input, warnings);
  else if (Array.isArray(input)) {
    list = [];
    const strings = input.filter((x) => typeof x === "string");
    if (strings.length === input.length && input.length) list = parseCandump(input.join("\n"), warnings);
    else list = input;
  } else throw new ToolInputError('"frames" must be an array of {id,data,t} or a candump-style string.');
  if (!list.length) throw new ToolInputError("No CAN frames to decode.");
  return list.map((fr, i) => {
    if (fr === null || typeof fr !== "object" || fr.data === undefined) throw new ToolInputError(`Frame ${i}: missing "data".`);
    const data = parseHex(fr.data);
    if (data.length === 0) throw new ToolInputError(`Frame ${i}: empty data.`);
    const t = fr.t === undefined || fr.t === null ? undefined : Number(fr.t);
    if (t !== undefined && !Number.isFinite(t)) throw new ToolInputError(`Frame ${i}: "t" must be a number (ms).`);
    return { id: normId(fr.id), data, t };
  });
}

export function stMinText(v) {
  if (v <= 0x7f) return `${v} ms`;
  if (v >= 0xf1 && v <= 0xf9) return `${(v - 0xf0) * 100} µs`;
  return `reserved (${hex8(v)})`;
}
const stMinMs = (v) => (v <= 0x7f ? v : v >= 0xf1 && v <= 0xf9 ? (v - 0xf0) / 10 : 0);

function uniformPadding(extra) {
  if (!extra.length) return {};
  return extra.every((b) => b === extra[0]) ? { paddingByte: extra[0], paddingBytes: extra.length } : { paddingBytes: extra.length, paddingUniform: false };
}

export function decodeIsotp(args = {}) {
  const a = args ?? {};
  if (a.frames === undefined || a.frames === null) throw new ToolInputError('"frames" is required.');
  const warnings = [];
  const errors = [];
  const frames = normalizeFrames(a.frames, warnings);
  const wantUds = a.decodeUds !== false;
  const out = { pdus: [], frames: [], errors, warnings };
  const active = new Map(); // data id -> reassembly state
  let seq = 0;

  const finish = (st, extra) => {
    const bytes = st.buf.slice(0, st.total);
    const pdu = { id: st.id, bytes: toHex(bytes), length: bytes.length, ...uniformPadding(extra) };
    if (st.firstT !== undefined) pdu.firstT = st.firstT;
    if (st.lastT !== undefined) pdu.lastT = st.lastT;
    attachUds(pdu, bytes);
    out.pdus.push(pdu);
  };
  const attachUds = (pdu, bytes) => {
    if (!wantUds) return;
    try {
      pdu.uds = decodeUds(Uint8Array.from(bytes)).data;
    } catch {
      /* not decodable as UDS: leave out */
    }
  };
  const emitSingle = (id, bytes, extra, t) => {
    const pdu = { id, bytes: toHex(bytes), length: bytes.length, ...uniformPadding(extra) };
    if (t !== undefined) pdu.firstT = pdu.lastT = t;
    attachUds(pdu, bytes);
    out.pdus.push(pdu);
  };
  const interrupt = (id, why) => {
    const st = active.get(id);
    if (st) {
      errors.push(`${why} on ${id} interrupted an unfinished reassembly (${st.buf.length} of ${st.total} bytes received); the partial message was discarded`);
      active.delete(id);
    }
  };

  for (const fr of frames) {
    const { id, data, t } = fr;
    const rec = { id, data: toHex(data), ...(t !== undefined ? { t } : {}) };
    const pci = data[0] >> 4;
    const low = data[0] & 0xf;
    if (a.padding === true && data.length < 8) warnings.push(`frame on ${id} has ${data.length} bytes; padding was expected (classic CAN frames padded to 8)`);

    if (pci === 0) {
      let len = low, off = 1;
      if (low === 0) {
        if (data.length > 8 && data.length >= 2) {
          len = data[1];
          off = 2;
        } else {
          rec.type = "SF";
          out.frames.push(rec);
          errors.push(`SF on ${id} has length 0 (invalid; CAN-FD escape needs a frame longer than 8 bytes)`);
          continue;
        }
      }
      rec.type = "SF";
      rec.length = len;
      out.frames.push(rec);
      interrupt(id, "SF");
      if (len === 0 || data.length < off + len) {
        errors.push(`SF on ${id} declares ${len} bytes but the frame has only ${Math.max(0, data.length - off)} after the PCI`);
        continue;
      }
      if (off === 1 && len > 7) {
        errors.push(`SF on ${id} has length ${len} (> 7, invalid for classic CAN)`);
        continue;
      }
      const extra = Array.from(data.slice(off + len));
      if (a.padding === false && extra.length) warnings.push(`SF on ${id} carries ${extra.length} padding byte(s) but padding was declared off`);
      emitSingle(id, Array.from(data.slice(off, off + len)), extra, t);
    } else if (pci === 1) {
      let total = ((low << 8) | (data[1] ?? 0)), off = 2;
      rec.type = "FF";
      if (total === 0) {
        if (data.length < 6) {
          out.frames.push(rec);
          errors.push(`FF on ${id} uses the 32-bit length escape but is shorter than 6 bytes`);
          continue;
        }
        total = ((data[2] * 256 + data[3]) * 256 + data[4]) * 256 + data[5];
        off = 6;
        if (total < 4096) warnings.push(`FF on ${id}: escape length ${total} is below 4096 (should use the 12-bit form)`);
      } else if (total < 8) {
        out.frames.push({ ...rec, totalLength: total });
        errors.push(`FF on ${id} declares length ${total}; a first frame must announce more than 7 bytes`);
        continue;
      }
      rec.totalLength = total;
      out.frames.push(rec);
      interrupt(id, "FF");
      const st = {
        id, total, buf: Array.from(data.slice(off, off + total)), nextSn: 1, firstT: t, lastT: t, awaitingFc: true,
        fcT: undefined, lastEventT: t, bs: 0, left: 0, stMs: 0, lastCfT: undefined, order: seq++,
      };
      active.set(id, st);
    } else if (pci === 2) {
      rec.type = "CF";
      rec.sn = low;
      out.frames.push(rec);
      const st = active.get(id);
      if (!st) {
        errors.push(`unexpected CF on ${id} without a preceding FF (SN ${low})`);
        continue;
      }
      if (low !== st.nextSn) {
        errors.push(`wrong SN on ${id}: expected SN ${st.nextSn} got ${low}; reassembly discarded (${st.buf.length} of ${st.total} bytes)`);
        active.delete(id);
        continue;
      }
      if (t !== undefined && st.lastEventT !== undefined) {
        const gap = t - st.lastEventT;
        if (gap > N_LIMIT_MS) warnings.push(`N_Cr: ${gap} ms between ${st.lastCfT === undefined ? "flow control/FF" : "consecutive frames"} and CF SN ${low} on ${id} (typical limit ${N_LIMIT_MS} ms)`);
        if (st.lastCfT !== undefined && st.stMs > 0 && t - st.lastCfT < st.stMs) warnings.push(`STmin violated on ${id}: CF SN ${low} arrived ${t - st.lastCfT} ms after the previous CF, STmin was ${stMinText(st.stRaw)}`);
      }
      st.awaitingFc = false;
      st.nextSn = (st.nextSn + 1) & 0xf;
      const need = st.total - st.buf.length;
      const chunk = Array.from(data.slice(1, 1 + need));
      st.buf.push(...chunk);
      if (t !== undefined) st.lastT = t;
      st.lastCfT = t;
      st.lastEventT = t;
      if (st.buf.length >= st.total) {
        finish(st, Array.from(data.slice(1 + need)));
        active.delete(id);
      } else if (st.bs > 0 && --st.left === 0) {
        st.awaitingFc = true;
      }
    } else if (pci === 3) {
      const status = low;
      rec.type = "FC";
      rec.status = ["CTS", "WAIT", "OVFLW"][status] ?? `reserved (${low})`;
      if (data.length >= 3) {
        rec.blockSize = data[1];
        rec.stMin = stMinText(data[2]);
      }
      out.frames.push(rec);
      if (data.length < 3 && status === 0) {
        errors.push(`FC on ${id} is shorter than 3 bytes (needs status, BS, STmin)`);
        continue;
      }
      if (status > 2) {
        errors.push(`FC on ${id} has reserved flow status ${status}`);
        continue;
      }
      // Match to a pending reassembly: reverse-id pair convention first, then single/oldest awaiting.
      const awaiting = [...active.values()].filter((s) => s.awaitingFc);
      const idNum = parseInt(id, 16);
      let st = awaiting.find((s) => { const d = parseInt(s.id, 16); return d === idNum + 8 || d === idNum - 8 || d === idNum + 1 || d === idNum - 1; });
      if (!st && awaiting.length === 1) st = awaiting[0];
      if (!st && awaiting.length > 1) {
        st = awaiting.sort((x, y) => x.order - y.order)[0];
        warnings.push(`FC on ${id} could not be matched unambiguously to one of ${awaiting.length} pending messages; assumed the oldest (${st.id})`);
      }
      if (status === 2) {
        errors.push(`flow control overflow (OVFLW) on ${id}: receiver cannot take the announced message${st ? ` from ${st.id}` : ""}; sender should abort`);
        if (st) active.delete(st.id);
        continue;
      }
      if (!st) {
        warnings.push(`FC on ${id} without a matching pending first frame in this trace (capture may be partial)`);
        continue;
      }
      if (t !== undefined && st.lastEventT !== undefined && t - st.lastEventT > N_LIMIT_MS) {
        warnings.push(`N_Bs: FC on ${id} arrived ${t - st.lastEventT} ms after the ${st.lastCfT === undefined ? "FF" : "last CF of the block"} on ${st.id} (typical limit ${N_LIMIT_MS} ms)`);
      }
      if (t !== undefined) st.lastEventT = t;
      if (status === 1) continue; // WAIT: keep waiting for a CTS
      st.awaitingFc = false;
      st.bs = data[1];
      st.left = data[1];
      st.stRaw = data[2];
      st.stMs = stMinMs(data[2]);
      st.lastCfT = undefined; // STmin applies between CFs of the same block
    } else {
      rec.type = "?";
      out.frames.push(rec);
      errors.push(`frame on ${id} has reserved PCI type ${pci} (first byte ${hex8(data[0])})`);
    }
  }
  for (const st of active.values()) warnings.push(`trace ends with an incomplete message on ${st.id}: ${st.buf.length} of ${st.total} bytes received`);

  const lines = [`${frames.length} CAN frame(s), ${out.pdus.length} complete ISO-TP message(s).`];
  for (const p of out.pdus) {
    lines.push(`- id ${p.id}: ${p.length} bytes: ${p.bytes}${p.uds ? `  => ${p.uds.kind} ${p.uds.service}${p.uds.nrc ? " " + p.uds.nrc.name : ""}` : ""}`);
  }
  for (const e of errors) lines.push(`ERROR: ${e}`);
  for (const w of warnings) lines.push(`WARN: ${w}`);
  return { text: lines.join("\n"), data: out };
}
