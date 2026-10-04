// udslib.com/viewer.html: parse and analyze traces locally in the browser.
import { parseTrace, binaryKind } from "../src/trace/parse.mjs";
import { analyzeTrace } from "../src/trace/analyze.mjs";
import { renderAnalysis } from "./render.mjs";

const $ = (s) => document.querySelector(s);
const out = $("#viewer-output");
const status = $("#viewer-status");
const track = (name, params) => { try { window.gtag?.("event", name, params); } catch { /* analytics optional */ } };

function show(text, name) {
  status.textContent = "";
  let parsed;
  try {
    parsed = parseTrace(text);
  } catch (e) {
    status.textContent = e.message;
    out.innerHTML = "";
    return;
  }
  if (!parsed.frames.length) {
    status.textContent = `No CAN frames found in this ${parsed.format} file.`;
    return;
  }
  const t0 = performance.now();
  const a = analyzeTrace(parsed.frames, { format: parsed.format });
  status.textContent = `${name ? name + ": " : ""}${parsed.format}, ${parsed.frames.length.toLocaleString()} frames analyzed in ${Math.round(performance.now() - t0)} ms${parsed.warnings.length ? `, ${parsed.warnings.length} line(s) skipped` : ""}.`;
  track("trace_analyzed", { format: parsed.format, frames: parsed.frames.length, root_cause: a.rootCause?.code ?? "none" });
  renderAnalysis(out, a, {
    onDownloadImage(f) {
      const blob = new Blob([f.image], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement("a"), { href: url, download: `image-0x${f.address.toString(16).toUpperCase().padStart(8, "0")}.bin` });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  out.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function openFile(file) {
  if (file.size > 50 * 1024 * 1024) {
    status.textContent = "This file is over 50 MB. Cut it to the diagnostic session you care about.";
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = binaryKind(bytes);
  if (kind) {
    status.textContent = `${kind} files are not supported yet. Export the trace as Vector ASC, PEAK TRC, candump log or CSV.`;
    return;
  }
  show(new TextDecoder().decode(bytes), file.name);
}

const drop = $("#viewer-drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const f = e.dataTransfer.files[0];
  if (f) openFile(f);
});
$("#viewer-file").addEventListener("change", (e) => e.target.files[0] && openFile(e.target.files[0]));
$("#viewer-paste-go").addEventListener("click", () => {
  const t = $("#viewer-paste").value;
  if (t.trim()) show(t, "pasted trace");
});
document.querySelectorAll("[data-example]").forEach((b) =>
  b.addEventListener("click", async () => {
    const res = await fetch(b.dataset.example);
    show(await res.text(), b.dataset.example.split("/").pop());
    track("example_trace", { example: b.dataset.example });
  }),
);
