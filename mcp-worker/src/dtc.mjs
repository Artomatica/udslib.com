import { ToolInputError } from "./errors.mjs";
import { parseHex, toHex } from "./hex.mjs";

const LETTERS = ["P", "C", "B", "U"];
const SYSTEMS = { P: "Powertrain", C: "Chassis", B: "Body", U: "Network" };

export const STATUS_BITS = [
  "testFailed",
  "testFailedThisOperationCycle",
  "pendingDTC",
  "confirmedDTC",
  "testNotCompletedSinceLastClear",
  "testFailedSinceLastClear",
  "testNotCompletedThisOperationCycle",
  "warningIndicatorRequested",
];

const H2 = (n) => n.toString(16).toUpperCase().padStart(2, "0");

function fromBytes(b) {
  const letter = LETTERS[b[0] >> 6];
  const code = `${letter}${(b[0] >> 4) & 3}${(b[0] & 0xf).toString(16).toUpperCase()}${H2(b[1])}`;
  return { code, ftb: H2(b[2]), system: SYSTEMS[letter] };
}

function fromCode(letter, d2, d3, lo, ftb) {
  const l = letter.toUpperCase();
  return Uint8Array.of((LETTERS.indexOf(l) << 6) | (parseInt(d2, 10) << 4) | parseInt(d3, 16), parseInt(lo, 16), parseInt(ftb ?? "00", 16));
}

function parseDtc(input) {
  if (typeof input !== "string" && !Array.isArray(input) && !(input instanceof Uint8Array)) {
    throw new ToolInputError('"dtc" is required: 3 bytes hex ("01 23 45") or a code like "P0123-45".');
  }
  if (typeof input === "string") {
    const s = input.trim();
    let m = s.match(/^([PCBU])([0-3])([0-9A-F])([0-9A-F]{2})\s*-\s*([0-9A-F]{2})$/i);
    if (m) return fromCode(m[1], m[2], m[3], m[4], m[5]);
    m = s.match(/^([PCBU])([0-3])([0-9A-F])([0-9A-F]{2})$/i);
    if (m) return fromCode(m[1], m[2], m[3], m[4], "00");
    try {
      return checkLen(parseHex(s));
    } catch (e) {
      if (/^[PCBU]\d/i.test(s)) {
        throw new ToolInputError(`"${s}" is not a valid DTC code. Expected a letter P/C/B/U, a digit 0-3, three hex digits, and an optional -FTB (e.g. "P0123-45").`);
      }
      throw e;
    }
  }
  return checkLen(parseHex(input));
}

function checkLen(b) {
  if (b.length !== 3) throw new ToolInputError(`A UDS DTC is 3 bytes (high, middle, low = fault type byte); got ${b.length} byte(s).`);
  return b;
}
function parseStatus(v) {
  let n;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\s*(0x)?[0-9a-fA-F]{1,2}\s*$/.test(v)) n = parseInt(v.replace(/^\s*0x/i, ""), 16);
  else throw new ToolInputError('"status" must be one byte: a number 0-255 or hex like "0x09".');
  if (!Number.isInteger(n) || n < 0 || n > 255) throw new ToolInputError('"status" must be in 0..255.');
  return n;
}

export function decodeDtc(args = {}) {
  const a = args ?? {};
  const b = parseDtc(a.dtc);
  const { code, ftb, system } = fromBytes(b);
  const data = { hex: toHex(b), code, ftb, system };
  const lines = [`DTC ${data.hex} = ${code}, failure type byte (FTB) ${ftb}`, `System: ${system}`];
  if (a.status !== undefined && a.status !== null && a.status !== "") {
    const raw = parseStatus(a.status);
    const bits = STATUS_BITS.map((name, bit) => ({ bit, name, set: (raw & (1 << bit)) !== 0 }));
    data.status = { raw, bits };
    lines.push(`Status 0x${H2(raw)}: ${bits.filter((x) => x.set).map((x) => x.name).join(", ") || "no bits set"}`);
    for (const x of bits) lines.push(`  bit ${x.bit} ${x.set ? "[x]" : "[ ]"} ${x.name}`);
  }
  return { text: lines.join("\n"), data };
}
