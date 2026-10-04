// CAN trace parsers: candump (-L and plain), Vector ASC, PEAK TRC (1.x, 2.x), CSV (SavvyCAN/GVRET, python-can).
// Pure ESM, no Node APIs: runs in the Worker and in the browser.
// Output frame: { i, t (ms, relative to first frame), id (number), ext (bool), dir ('rx'|'tx'|undefined), data (number[]), fd (bool) }

export const FORMATS = ["candump", "asc", "trc", "csv"];

const hexBytes = (s) => {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  const out = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
};
const byteList = (tokens) => tokens.map((x) => parseInt(x, 16));
const isHexByte = (x) => /^[0-9a-fA-F]{2}$/.test(x);
const dirOf = (s) => (/^tx$/i.test(s) ? "tx" : /^rx$/i.test(s) ? "rx" : undefined);
// CAN FD DLC code -> byte length
const FD_LEN = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64];

export function detectFormat(text) {
  const head = text.slice(0, 4000);
  if (/^\s*;\s*\$FILEVERSION/m.test(head) || /^\s*;.*PCAN/im.test(head) || /^\s*\d+\)\s+\d+(\.\d+)?\s+(Rx|Tx)\s/m.test(head)) return "trc";
  if (/^\s*(date |base (hex|dec)|internal events|Begin Triggerblock)/im.test(head)) return "asc";
  if (/^\s*(Time Stamp,ID|timestamp,arbitration_id)/im.test(head)) return "csv";
  if (/^\s*\(\d+(\.\d+)?\)\s+\S+\s+[0-9A-Fa-f]{3,8}#/m.test(head) || /^\s*\S+\s+[0-9A-Fa-f]{3,8}\s+\[\d+\]/m.test(head)) return "candump";
  if (/^\s*\d+\.\d+\s+\d+\s+[0-9A-Fa-f]{1,8}x?\s+(Rx|Tx)\s+d\s+\d/im.test(head)) return "asc";
  return null;
}

function parseCandump(lines, frames, warnings) {
  lines.forEach((raw, n) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    let m;
    // (1696412345.123456) can0 7E0#0210..   or   7E0##1<hex> (FD)
    if ((m = line.match(/^(?:\((\d+(?:\.\d+)?)\)\s+)?(?:(\S+)\s+)?([0-9A-Fa-f]{3,8})(##([0-9A-Fa-f])|#)([0-9A-Fa-f]*)\s*(?:[RT])?$/))) {
      frames.push({ ts: m[1] !== undefined ? parseFloat(m[1]) * 1000 : undefined, idText: m[3], data: hexBytes(m[6]), fd: !!m[5] });
      return;
    }
    // plain candump: [ (ts) ] can0  7E0   [8]  02 10 03 ...
    if ((m = line.match(/^(?:\((\d+(?:\.\d+)?)\)\s+)?(?:\S+\s+)?([0-9A-Fa-f]{3,8})\s+\[(\d+)\]\s+((?:[0-9A-Fa-f]{2}\s*)*)/))) {
      frames.push({ ts: m[1] !== undefined ? parseFloat(m[1]) * 1000 : undefined, idText: m[2], data: hexBytes(m[4]).slice(0, +m[3]), fd: +m[3] > 8 });
      return;
    }
    warnings.push(`line ${n + 1}: not a candump frame, skipped`);
  });
}

function parseAsc(lines, frames, warnings) {
  let decIds = false;
  lines.forEach((raw, n) => {
    const line = raw.trim();
    if (!line || line.startsWith("//")) return;
    if (/^base\s+dec/i.test(line)) decIds = true;
    if (/^base\s+hex/i.test(line)) decIds = false;
    if (/^(date|base|internal|no internal|Begin|End|version|\/\/)/i.test(line)) return;
    const tok = line.split(/\s+/);
    if (!/^\d+(\.\d+)?$/.test(tok[0])) {
      warnings.push(`line ${n + 1}: unrecognised ASC line, skipped`);
      return;
    }
    const ts = parseFloat(tok[0]) * 1000;
    if (/^CANFD$/i.test(tok[1])) {
      // <t> CANFD <ch> <Rx|Tx> <id> [symbolic] <brs> <esi> <dlc> <len> <bytes...>
      let k = 4;
      const idTok = tok[k++];
      if (!/^[0-9A-Fa-f]+x?$/.test(idTok)) return warnings.push(`line ${n + 1}: CANFD line without id, skipped`);
      // optional symbolic name: skip until we find brs esi dlc len as single-digit/number tokens
      while (k < tok.length && !(/^[01]$/.test(tok[k]) && /^[01]$/.test(tok[k + 1]) && /^[0-9a-fA-F]$/.test(tok[k + 2]))) k++;
      if (k >= tok.length) return warnings.push(`line ${n + 1}: CANFD line not understood, skipped`);
      const len = parseInt(tok[k + 3], 10);
      const bytes = tok.slice(k + 4, k + 4 + len);
      if (!Number.isFinite(len) || bytes.length !== len || !bytes.every(isHexByte)) return warnings.push(`line ${n + 1}: CANFD data not understood, skipped`);
      frames.push({ ts, idText: idTok, dec: decIds, dir: dirOf(tok[3]), data: byteList(bytes), fd: true });
      return;
    }
    // <t> <ch> <id>[x] <Rx|Tx> d <dlc> <bytes...> [Length = ...]
    if (/^\d+$/.test(tok[1]) && /^[0-9A-Fa-f]+x?$/.test(tok[2]) && /^(Rx|Tx)$/i.test(tok[3]) && /^d$/i.test(tok[4])) {
      const dlc = parseInt(tok[5], 16);
      const len = dlc <= 8 ? dlc : FD_LEN[dlc] ?? dlc;
      const bytes = tok.slice(6, 6 + len);
      if (bytes.length !== len || !bytes.every(isHexByte)) return warnings.push(`line ${n + 1}: data bytes not understood, skipped`);
      frames.push({ ts, idText: tok[2], dec: decIds, dir: dirOf(tok[3]), data: byteList(bytes), fd: false });
      return;
    }
    if (/ErrorFrame|Statistic|Status|SV:|J1939|LIN|Event|Start of measurement/i.test(line)) return;
    warnings.push(`line ${n + 1}: unrecognised ASC line, skipped`);
  });
}

function parseTrc(lines, frames, warnings) {
  let version = 1.1;
  let columns = null;
  lines.forEach((raw, n) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith(";")) {
      let m;
      if ((m = line.match(/\$FILEVERSION\s*=\s*([\d.]+)/i))) version = parseFloat(m[1]);
      if ((m = line.match(/\$COLUMNS\s*=\s*([A-Za-z,]+)/i))) columns = m[1].split(",");
      return;
    }
    const tok = line.split(/\s+/);
    if (version < 2) {
      // 1.0:  1)   1234.5  0x07E0  8  02 ..      1.1+:  1)  1234.5  Rx   07E0  8  02 ...
      if (!/^\d+\)$/.test(tok[0])) return warnings.push(`line ${n + 1}: not a TRC 1.x frame, skipped`);
      let k = 2;
      let dir;
      if (/^(Rx|Tx)$/i.test(tok[k])) dir = dirOf(tok[k++]);
      if (/^(Error|Warng|Status)$/i.test(tok[k])) return;
      const idText = tok[k++].replace(/^0x/i, "");
      const len = parseInt(tok[k++], 10);
      if (/^RTR$/i.test(tok[k])) return;
      const bytes = tok.slice(k, k + len);
      if (!/^[0-9A-Fa-f]+$/.test(idText) || bytes.length !== len || !bytes.every(isHexByte)) return warnings.push(`line ${n + 1}: TRC 1.x frame not understood, skipped`);
      frames.push({ ts: parseFloat(tok[1]), idText, dir, data: byteList(bytes), fd: false });
      return;
    }
    // 2.x: column layout from $COLUMNS (default N,O,T,I,d,l,D for 2.0; N,O,T,B,I,d,R,L,D for 2.1)
    const cols = columns ?? (version >= 2.1 ? ["N", "O", "T", "B", "I", "d", "R", "L", "D"] : ["N", "O", "T", "I", "d", "l", "D"]);
    const at = (c) => cols.indexOf(c);
    const type = tok[at("T")];
    if (type && !/^(DT|FD|FB|FE|BI)$/i.test(type)) return; // skip RR/ST/EC/ER etc.
    const iD = at("D");
    const lenIdx = at("L") >= 0 ? at("L") : at("l");
    const idText = tok[at("I")];
    let bytes;
    let len;
    if (lenIdx >= 0) {
      const raw = parseInt(tok[lenIdx], 10);
      len = at("L") >= 0 ? raw : raw <= 8 ? raw : FD_LEN[raw] ?? raw; // 'l' is the DLC code
      bytes = tok.slice(iD, iD + len);
    } else bytes = tok.slice(iD).filter(isHexByte);
    if (!idText || !/^[0-9A-Fa-f]+$/.test(idText) || !bytes.every(isHexByte) || (len !== undefined && bytes.length !== len)) {
      return warnings.push(`line ${n + 1}: TRC 2.x frame not understood, skipped`);
    }
    frames.push({ ts: parseFloat(tok[at("O")]), idText, dir: dirOf(tok[at("d")]), data: byteList(bytes), fd: /^F/i.test(type ?? "") });
  });
}

function splitCsv(line) {
  return line.split(/[,;]/).map((s) => s.trim().replace(/^"|"$/g, ""));
}

function parseCsv(lines, frames, warnings) {
  const header = splitCsv(lines[0] ?? "").map((h) => h.toLowerCase());
  const col = (name) => header.indexOf(name);
  if (col("time stamp") >= 0 && col("id") >= 0) {
    // SavvyCAN / GVRET: Time Stamp(us),ID(hex),Extended,Dir,Bus,LEN,D1..D8
    const dataStart = header.findIndex((h) => h === "d1");
    for (let n = 1; n < lines.length; n++) {
      const f = splitCsv(lines[n]);
      if (f.length < 3 || !f[0]) continue;
      const len = parseInt(f[col("len")], 10);
      const bytes = f.slice(dataStart, dataStart + len);
      if (!Number.isFinite(len) || !bytes.every(isHexByte)) {
        warnings.push(`line ${n + 1}: CSV row not understood, skipped`);
        continue;
      }
      frames.push({ ts: parseFloat(f[col("time stamp")]) / 1000, idText: f[col("id")].replace(/^0x/i, ""), ext: /^(true|1)$/i.test(f[col("extended")]), dir: dirOf(f[col("dir")]), data: byteList(bytes), fd: len > 8 });
    }
    return;
  }
  if (col("timestamp") >= 0 && col("arbitration_id") >= 0) {
    // python-can CSVWriter: timestamp(s),arbitration_id(hex 0x..),extended,remote,error,dlc,data(base64 or hex)
    for (let n = 1; n < lines.length; n++) {
      const f = splitCsv(lines[n]);
      if (f.length < 2 || !f[0]) continue;
      if (/^(1|true)$/i.test(f[col("remote")]) || /^(1|true)$/i.test(f[col("error")])) continue;
      const idRaw = f[col("arbitration_id")];
      const dataRaw = f[col("data")] ?? "";
      let data;
      if (/^[0-9a-fA-F\s]*$/.test(dataRaw) && dataRaw.replace(/\s/g, "").length % 2 === 0) data = hexBytes(dataRaw);
      else {
        try {
          data = Array.from(atob(dataRaw), (c) => c.charCodeAt(0));
        } catch {
          warnings.push(`line ${n + 1}: CSV data not understood, skipped`);
          continue;
        }
      }
      const id = /^0x/i.test(idRaw) ? parseInt(idRaw, 16) : parseInt(idRaw, 10);
      frames.push({ ts: parseFloat(f[col("timestamp")]) * 1000, idNum: id, ext: /^(1|true)$/i.test(f[col("extended")]), data, fd: data.length > 8 });
    }
    return;
  }
  warnings.push("CSV header not recognised (expected SavvyCAN 'Time Stamp,ID,...' or python-can 'timestamp,arbitration_id,...')");
}

const PARSERS = { candump: parseCandump, asc: parseAsc, trc: parseTrc, csv: parseCsv };

export function parseTrace(text, opts = {}) {
  if (typeof text !== "string") throw new TypeError("trace text must be a string");
  const warnings = [];
  const format = opts.format && opts.format !== "auto" ? opts.format : detectFormat(text);
  if (!format) throw new Error("Could not recognise the trace format. Supported: candump, Vector ASC, PEAK TRC, SavvyCAN or python-can CSV as text; Vector BLF, pcap/pcapng (SocketCAN) and ASAM MF4 as uploaded files.");
  if (!PARSERS[format]) throw new Error(`Unknown format "${format}". Supported: ${FORMATS.join(", ")}.`);
  const lines = text.split(/\r?\n/);
  const raw = [];
  PARSERS[format](lines, raw, warnings);
  const t0 = raw.find((f) => f.ts !== undefined)?.ts ?? 0;
  const frames = raw.map((f, i) => {
    let id = f.idNum;
    let ext = f.ext ?? false;
    if (id === undefined) {
      const x = /x$/i.test(f.idText);
      const txt = f.idText.replace(/x$/i, "");
      id = f.dec ? parseInt(txt, 10) : parseInt(txt, 16);
      ext = ext || x || id > 0x7ff;
    }
    return { i, t: f.ts === undefined ? i : Math.round((f.ts - t0) * 1000) / 1000, id, ext, dir: f.dir, data: f.data, fd: !!f.fd };
  });
  if (warnings.length > 50) warnings.splice(50, warnings.length - 50, `…and more skipped lines`);
  return { format, frames, warnings };
}
