// Trace viewer UI, shared by the ChatGPT widget and udslib.com/viewer.html.
// renderAnalysis(container, analysis) draws everything from an analyzeTrace() result (or its MCP-trimmed form).
import { decodeUds } from "../src/uds.mjs";

const LANES = ["Session", "Security", "Flash", "Other"];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ms = (x) => (x === undefined || x === null ? "–" : x >= 1000 ? `${(x / 1000).toFixed(2)} s` : `${Math.round(x * 10) / 10} ms`);
const hex8 = (n) => "0x" + n.toString(16).toUpperCase().padStart(8, "0");
const bytesTxt = (n) => (n >= 1024 * 1024 ? `${(n / 1048576).toFixed(2)} MiB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${n} B`);
const STATUS_LABEL = { positive: "OK", negative: "NRC", timeout: "timeout", noResponse: "no response", suppressed: "suppressed" };

function decodeText(hex) {
  try {
    return decodeUds(hex).text;
  } catch (e) {
    return String(e.message ?? e);
  }
}

function timelineSvg(a) {
  const ev = a.timeline;
  const dur = Math.max(1, a.summary.durationMs);
  const W = 1000, lane = 34, top = 8, left = 76, H = top + LANES.length * lane + 26;
  const x = (t) => left + ((W - left - 10) * t) / dur;
  let s = `<svg class="tl" viewBox="0 0 ${W} ${H}" role="img" aria-label="Session timeline"><g class="lanes">`;
  LANES.forEach((l, i) => {
    const y = top + i * lane;
    s += `<rect class="lane-bg" x="${left}" y="${y}" width="${W - left - 10}" height="${lane - 6}" rx="4"/><text class="lane-label" x="${left - 8}" y="${y + lane / 2}" text-anchor="end">${l}</text>`;
  });
  s += `</g><g class="marks">`;
  for (const e of ev) {
    const i = LANES.indexOf(e.lane);
    const y = top + i * lane + 3;
    const x0 = x(e.t), w = Math.max(4, x(e.tEnd) - x0);
    const cls = e.status === "negative" ? "m-neg" : e.status === "timeout" || e.status === "noResponse" ? "m-to" : e.pending ? "m-pend" : "m-ok";
    s += `<rect class="mark ${cls}" data-pair="${e.pairRef}" x="${x0.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${lane - 12}" rx="2" tabindex="0"><title>${esc(ms(e.t))} ${esc(e.label)}${e.nrcName ? " — " + esc(e.nrcName) : ""}${e.pending ? ` (${e.pending}× pending)` : ""}</title></rect>`;
  }
  s += `</g><g class="axis">`;
  for (let k = 0; k <= 5; k++) {
    const t = (dur * k) / 5;
    s += `<text x="${x(t).toFixed(1)}" y="${H - 6}" text-anchor="${k === 0 ? "start" : k === 5 ? "end" : "middle"}">${esc(ms(t))}</text>`;
  }
  return s + `</g></svg>`;
}

function flashHtml(f) {
  const pct = f.size ? Math.min(100, (100 * f.bytesTransferred) / f.size) : 100;
  return `<div class="flash ${f.complete ? "ok" : "bad"}">
    <div class="flash-head"><strong>Download to ${hex8(f.address)}</strong><span>${f.complete ? "complete" : "incomplete"}</span></div>
    <div class="bar" role="progressbar" aria-valuenow="${pct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct.toFixed(1)}%"></span></div>
    <dl>
      <div><dt>Transferred</dt><dd>${bytesTxt(f.bytesTransferred)} of ${bytesTxt(f.size)}</dd></div>
      <div><dt>Blocks</dt><dd>${f.blocks} (max ${f.maxBlockLength} B)</dd></div>
      <div><dt>Retransmits</dt><dd>${f.retransmits}</dd></div>
      <div><dt>Counter errors</dt><dd>${f.counterErrors}</dd></div>
      <div><dt>Throughput</dt><dd>${f.throughputBps ? bytesTxt(f.throughputBps) + "/s" : "–"}</dd></div>
      <div><dt>Duration</dt><dd>${ms(f.durationMs)}</dd></div>
      <div><dt>Image CRC32</dt><dd><code>${f.crc32}</code></dd></div>
    </dl>
    ${f.image ? `<button type="button" class="btn small" data-download-image="${f.address}">Download image (.bin)</button>` : ""}
  </div>`;
}

function pairsTable(pairs, filter) {
  const keep = (p) =>
    filter === "all" || (filter === "problems" && p.status !== "positive" && p.status !== "suppressed") ||
    (filter === "flash" && [0x31, 0x34, 0x35, 0x36, 0x37].includes(p.sid)) || (filter === "security" && [0x27, 0x29].includes(p.sid));
  const rows = pairs.filter(keep).map((p) => `<tr data-pair="${p.n}" class="st-${p.status}" tabindex="0">
      <td>${esc(ms(p.reqT))}</td><td>${esc(p.service)}${p.subName ? ` <span class="muted">${esc(p.subName)}</span>` : ""}</td>
      <td><code>${esc(p.request.length > 17 ? p.request.slice(0, 17) + "…" : p.request)}</code></td>
      <td><code>${esc((p.response ?? "").length > 14 ? p.response.slice(0, 14) + "…" : p.response ?? "")}</code></td>
      <td>${p.status === "negative" ? `<span class="tag neg">${esc(p.nrcName)}</span>` : `<span class="tag ${p.status}">${STATUS_LABEL[p.status]}</span>`}${p.pendingCount ? ` <span class="tag pend">${p.pendingCount}× 0x78</span>` : ""}</td>
      <td>${esc(ms(p.latencyMs))}</td></tr>`);
  return `<div class="table-scroll"><table class="pairs"><thead><tr><th>Time</th><th>Service</th><th>Request</th><th>Response</th><th>Result</th><th>Latency</th></tr></thead><tbody>${rows.join("") || `<tr><td colspan="6" class="muted">Nothing matches this filter.</td></tr>`}</tbody></table></div>`;
}

function detailHtml(p) {
  if (!p) return `<p class="muted">Select a request on the timeline or in the table to see it decoded.</p>`;
  return `<h3>#${p.n} ${esc(p.service)}${p.subName ? " " + esc(p.subName) : ""}</h3>
    <p class="muted">${esc(p.testerId)} → ${esc(p.ecuId ?? "?")} at ${esc(ms(p.reqT))}${p.p2Ms !== undefined ? ` · P2 ${esc(ms(p.p2Ms))}` : ""}${p.p2StarMs !== undefined ? ` · P2* ${esc(ms(p.p2StarMs))}` : ""} · frames ${esc(p.frameRefs.slice(0, 12).join(", "))}${p.frameRefs.length > 12 ? "…" : ""}</p>
    <h4>Request</h4><pre>${esc(decodeText(p.request))}</pre>
    ${p.response ? `<h4>Response</h4><pre>${esc(decodeText(p.response))}</pre>` : `<p class="tag ${p.status}">${esc(STATUS_LABEL[p.status])}${p.waitedMs ? ` after ${esc(ms(p.waitedMs))}` : ""}</p>`}`;
}

export function renderAnalysis(root, a, opts = {}) {
  const st = { filter: a.rootCause ? "problems" : "all", selected: a.rootCause?.pairRef ?? null };
  const s = a.summary;
  const byN = new Map(a.pairs.map((p) => [p.n, p]));
  const other = a.findings.filter((f) => f !== a.rootCause && f.code !== a.rootCause?.code && f.severity !== "info");
  const info = a.findings.filter((f) => f.severity === "info");
  root.classList.add("udsv");
  root.innerHTML = `
    <header class="udsv-head">
      <div class="chips">
        <span class="chip">${s.frames.toLocaleString()} frames</span><span class="chip">${esc(ms(s.durationMs))}</span>
        <span class="chip">${s.pairs} requests</span><span class="chip ${s.negative ? "bad" : ""}">${s.negative} negative</span>
        <span class="chip ${s.timeouts ? "bad" : ""}">${s.timeouts} timeouts</span>${s.format ? `<span class="chip">${esc(s.format)}</span>` : ""}
        ${s.ecus.map((e) => `<span class="chip">${esc(e.tester)} → ${esc(e.ecu)}</span>`).join("")}
      </div>
      ${opts.toolbar ?? ""}
    </header>
    ${a.rootCause
      ? `<section class="cause bad"><h2>Root cause: ${esc(a.rootCause.title)}</h2><p>${esc(a.rootCause.detail)}</p>${a.rootCause.pairRef !== undefined ? `<button type="button" class="btn small" data-pair="${a.rootCause.pairRef}">Show the request</button>` : ""}</section>`
      : `<section class="cause ok"><h2>No errors found</h2><p>Every request got a final positive answer or was recovered${a.flash.length ? ", and the flash transfer completed" : ""}.</p></section>`}
    ${other.length ? `<ul class="findings">${other.map((f) => `<li class="${f.severity}"><strong>${esc(f.title)}</strong> ${esc(f.detail)}${f.pairRef !== undefined ? ` <a href="#" data-pair="${f.pairRef}">show</a>` : ""}</li>`).join("")}</ul>` : ""}
    <section><h2 class="sec">Timeline</h2>${timelineSvg(a)}
      <p class="legend"><span class="key m-ok"></span>positive <span class="key m-pend"></span>after 0x78 pending <span class="key m-neg"></span>negative <span class="key m-to"></span>no response${s.testerPresent ? ` · ${s.testerPresent} TesterPresent not drawn` : ""}</p></section>
    ${a.flash.length ? `<section><h2 class="sec">Flash</h2>${a.flash.map(flashHtml).join("")}</section>` : ""}
    ${a.identification.length || info.length || a.timing.p2.count ? `<section class="facts">
      ${a.identification.length ? `<div><h2 class="sec">Identification</h2><dl>${a.identification.map((d) => `<div><dt>${esc(d.name ?? "DID " + d.did)}</dt><dd><code>${esc(d.ascii ?? d.hex)}</code></dd></div>`).join("")}</dl></div>` : ""}
      ${a.timing.p2.count ? `<div><h2 class="sec">Timing</h2><dl><div><dt>P2 p50 / p95 / max</dt><dd>${ms(a.timing.p2.p50)} / ${ms(a.timing.p2.p95)} / ${ms(a.timing.p2.max)}</dd></div>${a.timing.p2Star.count ? `<div><dt>P2* max</dt><dd>${ms(a.timing.p2Star.max)}</dd></div>` : ""}${a.sessions.length ? `<div><dt>Sessions</dt><dd>${a.sessions.map((x) => esc(x.session)).join(" → ")}</dd></div>` : ""}</dl></div>` : ""}
      ${info.length ? `<div><h2 class="sec">Notes</h2><ul class="plain">${info.map((f) => `<li>${esc(f.title)}. ${esc(f.detail)}</li>`).join("")}</ul></div>` : ""}
    </section>` : ""}
    <section class="split">
      <div class="pairs-wrap"><div class="filters" role="tablist">${["problems", "all", "flash", "security"].map((f) => `<button type="button" role="tab" data-filter="${f}">${f === "problems" ? "Problems" : f[0].toUpperCase() + f.slice(1)}</button>`).join("")}</div><div class="pairs-host"></div>
        ${a.truncated ? `<p class="muted small">Large trace: only part of the request list is shown here. Open the trace in the browser viewer at udslib.com/viewer.html for all of it.</p>` : ""}</div>
      <aside class="detail" aria-live="polite"></aside>
    </section>`;

  const draw = () => {
    root.querySelector(".pairs-host").innerHTML = pairsTable(a.pairs, st.filter);
    root.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.filter === st.filter)));
    root.querySelector(".detail").innerHTML = detailHtml(byN.get(st.selected));
    root.querySelectorAll("[data-pair]").forEach((el) => el.classList.toggle("sel", Number(el.dataset.pair) === st.selected));
  };
  const select = (n) => {
    st.selected = n;
    draw();
    root.querySelector(".detail")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  };
  root.addEventListener("click", (ev) => {
    const f = ev.target.closest("[data-filter]");
    if (f) { st.filter = f.dataset.filter; draw(); return; }
    const dl = ev.target.closest("[data-download-image]");
    if (dl) { opts.onDownloadImage?.(a.flash.find((x) => String(x.address) === dl.dataset.downloadImage)); return; }
    const p = ev.target.closest("[data-pair]");
    if (p) { ev.preventDefault(); select(Number(p.dataset.pair)); }
  });
  root.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    const p = ev.target.closest?.("[data-pair]");
    if (p) { ev.preventDefault(); select(Number(p.dataset.pair)); }
  });
  draw();
}
