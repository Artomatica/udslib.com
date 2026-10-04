import { ToolInputError } from "./errors.mjs";

/** Parse hex text ("22 f1 90", "0x22,0xF1", "22F190") or an int array into bytes. */
export function parseHex(input) {
  if (input instanceof Uint8Array) return input;
  if (Array.isArray(input)) {
    for (const b of input) {
      if (!Number.isInteger(b) || b < 0 || b > 255) throw new ToolInputError(`Invalid byte value in array: ${JSON.stringify(b)} (expected integers 0-255)`);
    }
    return Uint8Array.from(input);
  }
  if (typeof input !== "string") throw new ToolInputError("Expected a hex string such as \"22 F1 90\" or an array of byte values.");
  const cleaned = input.replace(/0x/gi, " ").replace(/[\s,;:_-]+/g, "");
  if (!/^[0-9a-fA-F]*$/.test(cleaned)) throw new ToolInputError(`Not valid hex: "${input.slice(0, 60)}". Use hex digits, optionally separated by spaces/commas, with optional 0x prefixes.`);
  if (cleaned.length % 2 !== 0) throw new ToolInputError(`Odd number of hex digits (${cleaned.length}) in "${input.slice(0, 60)}"; each byte needs two digits.`);
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

export const hex8 = (n) => "0x" + n.toString(16).toUpperCase().padStart(2, "0");
export const hex16 = (n) => "0x" + n.toString(16).toUpperCase().padStart(4, "0");

/** Big-endian unsigned integer; returns a Number (safe up to 6 bytes). */
export function beUint(bytes) {
  let v = 0;
  for (const b of bytes) v = v * 256 + b;
  return v;
}
