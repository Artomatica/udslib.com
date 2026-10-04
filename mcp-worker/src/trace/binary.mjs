// Binary CAN trace parsers: Vector BLF, pcap / pcapng (SocketCAN), ASAM MDF4 bus logging (CAN_DataFrame).
// Pure ESM; decompression uses the platform DecompressionStream (Workers, browsers, Node 18+).
// Output matches parseTrace(): { format, frames: [{ i, t, id, ext, dir, data, fd }], warnings }.

const td = new TextDecoder("latin1");
const ascii = (b, o, n) => td.decode(b.subarray(o, o + n));

async function inflate(bytes, raw = false) {
  const ds = new DecompressionStream(raw ? "deflate-raw" : "deflate");
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}

const FD_LEN = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64];
const dlcLen = (dlc) => (dlc <= 8 ? dlc : FD_LEN[dlc] ?? dlc);

function finish(format, raw, warnings) {
  raw.sort((a, b) => a.ts - b.ts);
  const t0 = raw.length ? raw[0].ts : 0;
  const frames = raw.map((f, i) => ({ i, t: Math.round((f.ts - t0) * 1000) / 1000, id: f.id, ext: f.ext, dir: f.dir, data: f.data, fd: f.fd }));
  if (warnings.length > 50) warnings.splice(50, warnings.length - 50, "…and more");
  return { format, frames, warnings };
}

// ---------------------------------------------------------------- BLF
async function parseBlf(b, warnings) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const headerSize = dv.getUint32(4, true);
  // 1) collect the object stream: top-level objects plus decompressed LOG_CONTAINER contents
  const chunks = [];
  let pos = headerSize;
  while (pos + 16 <= b.length) {
    if (ascii(b, pos, 4) !== "LOBJ") {
      const next = indexOf(b, "LOBJ", pos, pos + 8);
      if (next < 0) { warnings.push(`BLF: lost object sync at byte ${pos}`); break; }
      pos = next;
      continue;
    }
    const objSize = dv.getUint32(pos + 8, true);
    const objType = dv.getUint32(pos + 12, true);
    if (objSize < 16 || pos + objSize > b.length) { warnings.push(`BLF: truncated object at byte ${pos}`); break; }
    if (objType === 10) {
      const method = dv.getUint16(pos + 16, true);
      const body = b.subarray(pos + 32, pos + objSize);
      if (method === 0) chunks.push(body);
      else if (method === 2) chunks.push(await inflate(body));
      else warnings.push(`BLF: unsupported container compression ${method}`);
    } else chunks.push(b.subarray(pos, pos + objSize)); // uncompressed top-level object
    pos += objSize + (objSize % 4);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const s = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { s.set(c, o); o += c.length; }
  const sv = new DataView(s.buffer);
  // 2) parse CAN objects
  const raw = [];
  let p = 0;
  let skipped = 0;
  while (p + 16 <= s.length) {
    const at = indexOf(s, "LOBJ", p, p + 8);
    if (at < 0) break;
    p = at;
    const headerSz = sv.getUint16(p + 4, true);
    const ver = sv.getUint16(p + 6, true);
    const objSize = sv.getUint32(p + 8, true);
    const type = sv.getUint32(p + 12, true);
    if (objSize < 16 || p + objSize > s.length) break;
    let q = p + 16;
    let flags, ts;
    if (ver === 1) { flags = sv.getUint32(q, true); ts = Number(sv.getBigUint64(q + 8, true)); q += 16; }
    else if (ver === 2) { flags = sv.getUint32(q, true); ts = Number(sv.getBigUint64(q + 8, true)); q += 24; }
    else { p += objSize; continue; }
    const tsMs = flags & 1 ? ts / 100 : ts / 1e6; // 10 µs units or ns
    q = p + headerSz;
    if (type === 1 || type === 86) {
      // CAN_MESSAGE / CAN_MESSAGE2: channel u16, flags u8, dlc u8, id u32, data[8]
      const f = s[q + 2], dlc = s[q + 3], id = sv.getUint32(q + 4, true);
      if (!(f & 0x80)) raw.push({ ts: tsMs, id: id & 0x1fffffff, ext: !!(id & 0x80000000), dir: f & 1 ? "tx" : "rx", data: Array.from(s.subarray(q + 8, q + 8 + Math.min(8, dlc))), fd: false });
    } else if (type === 100) {
      // CAN_FD_MESSAGE: channel u16, flags u8, dlc u8, id u32, frameLength u32, arbBitCount u8, fdFlags u8, validBytes u8, 5x, data[64]
      const f = s[q + 2], id = sv.getUint32(q + 4, true), fdFlags = s[q + 13], valid = s[q + 14];
      if (!(f & 0x80)) raw.push({ ts: tsMs, id: id & 0x1fffffff, ext: !!(id & 0x80000000), dir: f & 1 ? "tx" : "rx", data: Array.from(s.subarray(q + 20, q + 20 + Math.min(64, valid))), fd: !!(fdFlags & 1) });
    } else if (type === 101) {
      // CAN_FD_MESSAGE_64: channel u8, dlc u8, validBytes u8, txCount u8, id u32, frameLength u32, flags u32, btrArb u32, btrData u32,
      // offBrs u32, offCrc u32, bitCount u16, dir u8, extDataOffset u8, crc u32, data[...]
      const valid = s[q + 2], id = sv.getUint32(q + 4, true), fdFlags = sv.getUint32(q + 12, true), dir = s[q + 34], ext = s[q + 35];
      const start = q + 40;
      const avail = (ext ? p + ext : p + objSize) - start;
      const data = Array.from(s.subarray(start, start + Math.max(0, Math.min(valid, avail))));
      while (data.length < valid) data.push(0);
      if (!(fdFlags & 0x10)) raw.push({ ts: tsMs, id: id & 0x1fffffff, ext: !!(id & 0x80000000), dir: dir ? "tx" : "rx", data, fd: !!(fdFlags & 0x1000) });
    } else skipped++;
    p += objSize;
  }
  if (skipped) warnings.push(`BLF: ${skipped} non-CAN object(s) skipped (LIN, Ethernet, events, errors…)`);
  return finish("blf", raw, warnings);
}

function indexOf(b, sig, from, to) {
  const c0 = sig.charCodeAt(0), c1 = sig.charCodeAt(1), c2 = sig.charCodeAt(2), c3 = sig.charCodeAt(3);
  for (let i = from; i <= Math.min(to, b.length - 4); i++) if (b[i] === c0 && b[i + 1] === c1 && b[i + 2] === c2 && b[i + 3] === c3) return i;
  return -1;
}

// ---------------------------------------------------------------- pcap / pcapng
// LINKTYPE_CAN_SOCKETCAN (227): can_id big-endian, len u8, fd flags u8, res0, len8_dlc, data.
// LINKTYPE_LINUX_SLL (113) with protocol 0x000C/0x000D: 16-byte cooked header, then a SocketCAN frame (can_id host order, little-endian assumed).
function socketCanFrame(pkt, linktype, ts, raw, warnings) {
  let o = 0, le = false;
  if (linktype === 113) {
    if (pkt.length < 16) return;
    const proto = (pkt[14] << 8) | pkt[15];
    if (proto !== 0x000c && proto !== 0x000d) return;
    o = 16;
    le = true;
  } else if (linktype === 276) {
    if (pkt.length < 20) return; // LINUX_SLL2: protocol at 0, header 20 bytes
    const proto = (pkt[0] << 8) | pkt[1];
    if (proto !== 0x000c && proto !== 0x000d) return;
    o = 20;
    le = true;
  } else if (linktype !== 227) return;
  if (pkt.length < o + 8) return;
  const dv = new DataView(pkt.buffer, pkt.byteOffset + o, pkt.length - o);
  const cid = dv.getUint32(0, le);
  if (cid & 0x60000000) return; // RTR or error frame
  const len = pkt[o + 4];
  const fdf = (pkt[o + 5] & 0x04) !== 0 || len > 8 || pkt.length - o > 16;
  raw.push({ ts, id: cid & (cid & 0x80000000 ? 0x1fffffff : 0x7ff), ext: !!(cid & 0x80000000), dir: undefined, data: Array.from(pkt.subarray(o + 8, o + 8 + len)), fd: fdf });
}

function parsePcap(b, warnings) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const magicLE = dv.getUint32(0, true);
  const le = magicLE === 0xa1b2c3d4 || magicLE === 0xa1b23c4d;
  const nano = (le ? magicLE : dv.getUint32(0, false)) === 0xa1b23c4d;
  const linktype = dv.getUint32(20, le) & 0xffff;
  if (![227, 113, 276].includes(linktype)) throw new Error(`pcap link type ${linktype} has no CAN frames (expected SocketCAN, link type 227).`);
  const raw = [];
  let p = 24;
  while (p + 16 <= b.length) {
    const sec = dv.getUint32(p, le), frac = dv.getUint32(p + 4, le), incl = dv.getUint32(p + 8, le);
    if (p + 16 + incl > b.length) { warnings.push("pcap: truncated last packet"); break; }
    socketCanFrame(b.subarray(p + 16, p + 16 + incl), linktype, sec * 1000 + (nano ? frac / 1e6 : frac / 1e3), raw, warnings);
    p += 16 + incl;
  }
  return finish("pcap", raw, warnings);
}

function parsePcapng(b, warnings) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let le = true;
  const ifaces = [];
  const raw = [];
  let p = 0;
  while (p + 12 <= b.length) {
    let type = dv.getUint32(p, le);
    if (type === 0x0a0d0d0a) {
      le = dv.getUint32(p + 8, true) === 0x1a2b3c4d;
      type = 0x0a0d0d0a;
      ifaces.length = 0;
    }
    const len = dv.getUint32(p + 4, le);
    if (len < 12 || p + len > b.length) { warnings.push("pcapng: truncated block"); break; }
    if (type === 1) {
      const linktype = dv.getUint16(p + 8, le);
      let res = 1e-6;
      let o = p + 16;
      while (o + 4 <= p + len - 4) {
        const code = dv.getUint16(o, le), olen = dv.getUint16(o + 2, le);
        if (code === 0) break;
        if (code === 9 && olen >= 1) { const v = b[o + 4]; res = v & 0x80 ? 2 ** -(v & 0x7f) : 10 ** -v; }
        o += 4 + Math.ceil(olen / 4) * 4;
      }
      ifaces.push({ linktype, res });
    } else if (type === 6) {
      const ifc = ifaces[dv.getUint32(p + 8, le)];
      const ts = (dv.getUint32(p + 12, le) * 2 ** 32 + dv.getUint32(p + 16, le)) * (ifc?.res ?? 1e-6) * 1000;
      const cap = dv.getUint32(p + 20, le);
      if (ifc) socketCanFrame(b.subarray(p + 28, p + 28 + cap), ifc.linktype, ts, raw, warnings);
    } else if (type === 3) {
      const ifc = ifaces[0];
      const orig = dv.getUint32(p + 8, le);
      if (ifc) socketCanFrame(b.subarray(p + 12, p + 12 + Math.min(orig, len - 16)), ifc.linktype, raw.length, raw, warnings);
    }
    p += len;
  }
  if (!ifaces.some((i) => [227, 113, 276].includes(i.linktype))) throw new Error("pcapng file has no SocketCAN interface (link type 227).");
  return finish("pcapng", raw, warnings);
}

// ---------------------------------------------------------------- MDF4 (ASAM bus logging)
async function parseMf4(b, warnings) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u64 = (o) => Number(dv.getBigUint64(o, true));
  const block = (at) => {
    if (!at || at + 24 > b.length) return null;
    const id = ascii(b, at, 4);
    if (id.slice(0, 2) !== "##") return null;
    const len = u64(at + 8), nl = u64(at + 16);
    const links = [];
    for (let i = 0; i < nl; i++) links.push(u64(at + 24 + i * 8));
    return { id, at, len, links, data: at + 24 + nl * 8 };
  };
  const text = (at) => {
    const blk = block(at);
    if (!blk) return "";
    const s = b.subarray(blk.data, blk.at + blk.len);
    const z = s.indexOf(0);
    return new TextDecoder().decode(z >= 0 ? s.subarray(0, z) : s).trim();
  };
  // Read a data block chain (DT, DZ, DL, HL, SD) into one byte array.
  const readData = async (at) => {
    const parts = [];
    const walk = async (a) => {
      const blk = block(a);
      if (!blk) return;
      if (blk.id === "##DT" || blk.id === "##SD" || blk.id === "##RD") parts.push(b.subarray(blk.data, blk.at + blk.len));
      else if (blk.id === "##DZ") {
        const zipType = b[blk.data + 2], param = dv.getUint32(blk.data + 4, true), orgLen = u64(blk.data + 8), zLen = u64(blk.data + 16);
        let out = await inflate(b.subarray(blk.data + 24, blk.data + 24 + zLen));
        if (zipType === 1) {
          const cols = param, rows = Math.floor(orgLen / cols), t = new Uint8Array(out.length);
          for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) t[r * cols + c] = out[c * rows + r];
          t.set(out.subarray(rows * cols), rows * cols);
          out = t;
        }
        parts.push(out.subarray(0, orgLen));
      } else if (blk.id === "##DL") {
        let dl = blk;
        while (dl) {
          for (const l of dl.links.slice(1)) await walk(l);
          dl = block(dl.links[0]);
        }
      } else if (blk.id === "##HL") await walk(blk.links[0]);
    };
    await walk(at);
    const n = parts.reduce((s, x) => s + x.length, 0);
    const out = new Uint8Array(n);
    let o = 0;
    for (const x of parts) { out.set(x, o); o += x.length; }
    return out;
  };
  const hd = block(64);
  if (!hd || hd.id !== "##HD") throw new Error("MF4: no header block; not an MDF 4 file?");
  const raw = [];
  let found = false;
  for (let dg = block(hd.links[0]); dg; dg = block(dg.links[0])) {
    const recIdSize = b[dg.data];
    const cgs = [];
    for (let cg = block(dg.links[1]); cg; cg = block(cg.links[0])) {
      const cgFlags = dv.getUint16(cg.data + 16, true);
      const c = { blk: cg, recId: u64(cg.data), name: text(cg.links[2]), vlsd: !!(cgFlags & 1), dataBytes: dv.getUint32(cg.data + 24, true), invalBytes: dv.getUint32(cg.data + 28, true), chans: {} };
      // collect channels (with compositions) by last name segment
      const walkCn = (at, depth = 0) => {
        for (let cn = block(at); cn && depth < 4; cn = block(cn.links[0])) {
          const name = text(cn.links[2]);
          const ch = { name, type: b[cn.data], dataType: b[cn.data + 2], bitOff: b[cn.data + 3], byteOff: dv.getUint32(cn.data + 4, true), bits: dv.getUint32(cn.data + 8, true), dataLink: cn.links[5] };
          const key = name.split(".").pop();
          if (ch.type === 2 || ch.type === 3) c.chans.time ??= ch; // master
          else c.chans[key] ??= ch;
          if (cn.links[1]) walkCn(cn.links[1], depth + 1);
        }
      };
      walkCn(cg.links[1]);
      cgs.push(c);
    }
    const frameCg = cgs.find((c) => /CAN_DataFrame/.test(Object.values(c.chans).map((x) => x.name).join(" ")) || /CAN_DataFrame/.test(c.name));
    if (!frameCg) continue;
    found = true;
    const data = await readData(dg.links[2]);
    // split records (sorted: one CG; unsorted: record ids)
    const recs = [];
    const vlsdById = new Map();
    if (recIdSize === 0) {
      const size = frameCg.dataBytes + frameCg.invalBytes;
      for (let o = 0; o + size <= data.length; o += size) recs.push(o);
    } else {
      const byId = new Map(cgs.map((c) => [c.recId, c]));
      let o = 0;
      const rid = (at) => (recIdSize === 1 ? data[at] : recIdSize === 2 ? data[at] | (data[at + 1] << 8) : recIdSize === 4 ? new DataView(data.buffer, data.byteOffset).getUint32(at, true) : Number(new DataView(data.buffer, data.byteOffset).getBigUint64(at, true)));
      while (o + recIdSize <= data.length) {
        const c = byId.get(rid(o));
        if (!c) { warnings.push("MF4: unknown record id; stopped reading"); break; }
        o += recIdSize;
        if (c.vlsd) {
          const n = new DataView(data.buffer, data.byteOffset).getUint32(o, true);
          if (!vlsdById.has(c.recId)) vlsdById.set(c.recId, []);
          vlsdById.get(c.recId).push(data.subarray(o + 4, o + 4 + n));
          o += 4 + n;
        } else {
          if (c === frameCg) recs.push(o);
          o += c.dataBytes + c.invalBytes;
        }
      }
    }
    const rv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const ch = frameCg.chans;
    const uint = (c, o) => {
      if (!c) return undefined;
      const at = o + c.byteOff;
      let v = 0;
      const nb = Math.ceil((c.bitOff + c.bits) / 8);
      for (let k = nb - 1; k >= 0; k--) v = v * 256 + data[at + k];
      return Math.floor(v / 2 ** c.bitOff) % 2 ** c.bits;
    };
    const time = (o) => {
      const c = ch.time;
      if (!c) return 0;
      if (c.dataType === 4 || c.dataType === 5) return c.bits === 64 ? rv.getFloat64(o + c.byteOff, c.dataType === 4) : rv.getFloat32(o + c.byteOff, c.dataType === 4);
      return uint(c, o);
    };
    // VLSD DataBytes: either an SD block (offset in record) or a VLSD channel group (running index)
    let sd = null;
    if (ch.DataBytes?.type === 1 && ch.DataBytes.dataLink) {
      const target = block(ch.DataBytes.dataLink);
      if (target && target.id !== "##CG") sd = await readData(ch.DataBytes.dataLink);
    }
    const vlsdCg = ch.DataBytes?.type === 1 && !sd ? [...vlsdById.values()][0] : null;
    let vi = 0;
    for (const o of recs) {
      const len = uint(ch.DataLength, o) ?? dlcLen(uint(ch.DLC, o) ?? 0);
      let bytes;
      if (ch.DataBytes?.type === 1) {
        if (sd) {
          const off = uint(ch.DataBytes, o);
          const n = new DataView(sd.buffer, sd.byteOffset).getUint32(off, true);
          bytes = sd.subarray(off + 4, off + 4 + n);
        } else bytes = vlsdCg?.[vi++] ?? new Uint8Array();
      } else bytes = data.subarray(o + (ch.DataBytes?.byteOff ?? 0), o + (ch.DataBytes?.byteOff ?? 0) + len);
      const id = uint(ch.ID, o) ?? 0;
      const ide = uint(ch.IDE, o);
      const dir = uint(ch.Dir, o);
      raw.push({ ts: time(o) * 1000, id: id & 0x1fffffff, ext: ide !== undefined ? !!ide : id > 0x7ff || !!(id & 0x80000000), dir: dir === undefined ? undefined : dir ? "tx" : "rx", data: Array.from(bytes.subarray(0, len)), fd: !!uint(ch.EDL, o) || len > 8 });
    }
  }
  if (!found) throw new Error("MF4 file has no CAN_DataFrame channel group (ASAM bus logging). Signal-only MF4 files carry no raw frames.");
  return finish("mf4", raw, warnings);
}

/** Identify a binary trace by its magic bytes. */
export function binaryFormat(b) {
  if (b.length >= 4 && ascii(b, 0, 4) === "LOGG") return "blf";
  if (b.length >= 8 && ascii(b, 0, 3) === "MDF") return "mf4";
  if (b.length >= 4 && b[0] === 0x0a && b[1] === 0x0d && b[2] === 0x0d && b[3] === 0x0a) return "pcapng";
  if (b.length >= 4) {
    const m = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
    if ([0xa1b2c3d4, 0xd4c3b2a1, 0xa1b23c4d, 0x4d3cb2a1].includes(m >>> 0)) return "pcap";
  }
  return null;
}

/** Parse a binary trace (BLF, pcap, pcapng, MF4). Async because compressed blocks use DecompressionStream. */
export async function parseBinaryTrace(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const fmt = binaryFormat(b);
  const warnings = [];
  if (fmt === "blf") return parseBlf(b, warnings);
  if (fmt === "pcap") return parsePcap(b, warnings);
  if (fmt === "pcapng") return parsePcapng(b, warnings);
  if (fmt === "mf4") {
    if (ascii(b, 8, 1) < "4") throw new Error("MDF 3 files are not supported; convert to MF4 (MDF 4.x) or ASC.");
    return parseMf4(b, warnings);
  }
  throw new Error("Not a BLF, pcap, pcapng or MF4 file.");
}
