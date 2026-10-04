import { ToolInputError } from "../errors.mjs";
import { parseTrace, binaryKind, FORMATS } from "./parse.mjs";
import { analyzeTrace, analysisText } from "./analyze.mjs";

export const MAX_TRACE_BYTES = 10 * 1024 * 1024;
const MAX_PAIRS = 400;
const MAX_TIMELINE = 300;
const MAX_REFS = 40;

async function readFile(file) {
  if (!file || typeof file !== "object" || typeof file.download_url !== "string") throw new ToolInputError('"file" must be an uploaded file object with a download_url.');
  let res;
  try {
    res = await fetch(file.download_url);
  } catch {
    throw new ToolInputError("Could not download the uploaded file.");
  }
  if (!res.ok) throw new ToolInputError(`Could not download the uploaded file (HTTP ${res.status}).`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_TRACE_BYTES) throw new ToolInputError(`Trace is ${(len / 1048576).toFixed(1)} MB; the limit is 10 MB. Cut it to the diagnostic session you care about.`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_TRACE_BYTES) throw new ToolInputError(`Trace is ${(buf.length / 1048576).toFixed(1)} MB; the limit is 10 MB. Cut it to the diagnostic session you care about.`);
  return buf;
}

function textOf(bytes) {
  const kind = binaryKind(bytes);
  if (kind) throw new ToolInputError(`${kind} files are not supported yet. Export the trace as Vector ASC, PEAK TRC, candump log or CSV and try again.`);
  return new TextDecoder("utf-8").decode(bytes);
}

/** Keep structured output small enough for a chat client: drop the image, cap lists. */
export function trimAnalysis(a) {
  let pairs = a.pairs;
  let truncated = false;
  if (pairs.length > MAX_PAIRS) {
    truncated = true;
    const keep = new Set([...pairs.slice(0, 150), ...pairs.slice(-150), ...pairs.filter((p) => p.status !== "positive" && p.status !== "suppressed")].map((p) => p.n));
    for (const f of a.findings) if (f.pairRef !== undefined) keep.add(f.pairRef);
    pairs = pairs.filter((p) => keep.has(p.n)).slice(0, MAX_PAIRS);
  }
  pairs = pairs.map((p) => (p.frameRefs.length > MAX_REFS ? { ...p, frameRefs: p.frameRefs.slice(0, MAX_REFS) } : p));
  let timeline = a.timeline;
  if (timeline.length > MAX_TIMELINE) {
    truncated = true;
    const keep = new Set(pairs.map((p) => p.n));
    timeline = timeline.filter((e) => keep.has(e.pairRef)).slice(0, MAX_TIMELINE);
  }
  const findings = a.findings.map((f) => (f.frameRefs.length > MAX_REFS ? { ...f, frameRefs: f.frameRefs.slice(0, MAX_REFS) } : f));
  const rootCause = a.rootCause && findings[a.findings.indexOf(a.rootCause)];
  const flash = a.flash.map(({ image, ...f }) => f);
  return { ...a, rootCause, findings, pairs, timeline, flash, truncated };
}

export async function analyzeTraceTool(args = {}) {
  const a = args ?? {};
  if (a.format !== undefined && a.format !== "auto" && !FORMATS.includes(a.format)) throw new ToolInputError(`Unknown format "${a.format}". Use auto, ${FORMATS.join(", ")}.`);
  let text;
  if (typeof a.trace === "string" && a.trace.trim()) {
    if (a.trace.length > MAX_TRACE_BYTES) throw new ToolInputError("Pasted trace is over 10 MB; upload a smaller excerpt.");
    text = a.trace;
  } else if (a.file) text = textOf(await readFile(a.file));
  else throw new ToolInputError('Give the trace as "trace" (pasted text) or "file" (an uploaded candump, ASC, TRC or CSV file).');
  let parsed;
  try {
    parsed = parseTrace(text, { format: a.format });
  } catch (e) {
    throw new ToolInputError(e.message);
  }
  if (!parsed.frames.length) throw new ToolInputError(`No CAN frames found in the ${parsed.format} trace.${parsed.warnings.length ? " " + parsed.warnings[0] : ""}`);
  const analysis = analyzeTrace(parsed.frames, { format: parsed.format });
  const data = trimAnalysis(analysis);
  data.parseWarnings = parsed.warnings.slice(0, 20);
  let txt = analysisText(analysis);
  if (parsed.warnings.length) txt += `\n(${parsed.warnings.length} line(s) skipped while parsing.)`;
  return { text: txt, data };
}
