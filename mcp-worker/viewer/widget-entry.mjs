// ChatGPT widget: renders the analyze_trace structuredContent passed in window.openai.toolOutput.
import { renderAnalysis } from "./render.mjs";

const root = document.getElementById("root");
let last = null;

function draw() {
  const out = window.openai?.toolOutput;
  if (!out || out === last || !out.summary) {
    if (!out) root.innerHTML = '<p class="muted" style="font:14px system-ui;padding:12px">Waiting for the trace analysis…</p>';
    return;
  }
  last = out;
  const canFull = typeof window.openai?.requestDisplayMode === "function" && window.openai?.displayMode !== "fullscreen";
  renderAnalysis(root, out, {
    toolbar: canFull ? '<button type="button" class="btn small" id="full">Open full screen</button>' : "",
  });
  root.querySelector("#full")?.addEventListener("click", () => window.openai.requestDisplayMode({ mode: "fullscreen" }));
}

window.addEventListener("openai:set_globals", draw, { passive: true });
draw();
