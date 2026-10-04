#!/usr/bin/env python3
"""Run the plugin review test cases against the live MCP server and render an honest walkthrough video."""
import json, subprocess, tempfile, urllib.request, datetime
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
URL = "https://mcp.udslib.com/mcp"
OUT = ROOT / "review"
PLUGIN = json.loads((ROOT / "plugins/uds-toolbox/plugin.json").read_text())
CASES = PLUGIN["extensions"]["com.openai"]["review"]["test_cases"]
# Arguments a client would send for each scenario, in order (positive then negative).
CALLS = [
    ("decode_uds", {"hex": "7F 34 78"}),
    ("decode_isotp", {"frames": "can0 7E8 [8] 10 0B 62 F1 90 57 30 4C\ncan0 7E0 [3] 30 00 00\ncan0 7E8 [8] 21 31 32 33 34 35 36"}),
    ("build_uds_request", {"service": "request_download", "address": "0x08000000", "size": "0x10000"}),
    ("decode_dtc", {"dtc": "C0 73 00", "status": "0x2F"}),
    ("uds_reference", {"topic": "reprogramming_sequence"}),
    ("decode_uds", {"hex": "ZZ 12"}),
    ("build_uds_request", {"service": "security_seed", "level": 2}),
    ("decode_isotp", {"frames": []}),
]

def rpc(method, params, i):
    req = urllib.request.Request(URL, json.dumps({"jsonrpc": "2.0", "id": i, "method": method, "params": params}).encode(),
                                 {"content-type": "application/json", "accept": "application/json, text/event-stream", "user-agent": "udslib-review/1.0"})
    return json.load(urllib.request.urlopen(req, timeout=20))

def main():
    init = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "review", "version": "1"}}, 0)
    version = init["result"]["serverInfo"]["version"]
    scenarios = [("POSITIVE", c) for c in CASES["positive"]] + [("NEGATIVE", c) for c in CASES["negative"]]
    results = []
    for n, ((kind, case), (tool, args)) in enumerate(zip(scenarios, CALLS), 1):
        r = rpc("tools/call", {"name": tool, "arguments": args}, n)["result"]
        text = r["content"][0]["text"]
        passed = bool(r.get("isError")) == (kind == "NEGATIVE")
        results.append({"kind": kind, "description": case["description"], "prompt": case["prompt"], "tool": tool,
                        "arguments": args, "isError": bool(r.get("isError")), "pass": passed, "output": text})
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    OUT.mkdir(exist_ok=True)
    (OUT / "results.json").write_text(json.dumps({"server": URL, "version": version, "executed": stamp, "results": results}, indent=2) + "\n")
    render(results, version, stamp)
    bad = [r["description"] for r in results if not r["pass"]]
    print(f"{len(results) - len(bad)}/{len(results)} pass" + (f"; FAIL: {bad}" if bad else ""))
    if bad:
        raise SystemExit(1)

def render(results, version, stamp):
    font = lambda s: ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", s)
    mono = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 20)
    with tempfile.TemporaryDirectory() as tmp:
        for i, r in enumerate(results):
            im = Image.new("RGB", (1440, 900), "#101827"); d = ImageDraw.Draw(im)
            d.text((60, 45), "UDS Toolbox • hosted MCP review walkthrough", font=font(44), fill="white")
            d.text((60, 112), "Real MCP results from the live server • ChatGPT interface is not recorded", font=font(24), fill="#93b4ff")
            d.text((60, 160), f"{URL} • server {version}", font=font(20), fill="#c8ccd4")
            colour = "#6ee7a8" if r["pass"] else "#ff7b7b"
            label = "PASS" if r["pass"] else "FAIL"
            d.text((60, 215), f"{r['kind']}-{i + 1}  {label}: {r['description']}", font=font(26), fill=colour)
            d.text((60, 270), "Prompt", font=font(24), fill="#93b4ff")
            d.text((60, 302), r["prompt"][:110], font=font(20), fill="white")
            d.text((60, 350), f"Tool: {r['tool']}   arguments: {json.dumps(r['arguments'])[:80]}", font=font(20), fill="#c8ccd4")
            d.text((60, 400), "Server output" + ("  (rejected as expected)" if r["kind"] == "NEGATIVE" else ""), font=font(24), fill="#93b4ff")
            y = 435
            for line in r["output"].splitlines()[:16]:
                d.text((60, y), line[:118], font=mono, fill="white"); y += 24
            d.text((60, 840), f"Executed {stamp} • offline decoding only, no vehicle access, no certification claim", font=font(20), fill="#c8ccd4")
            im.save(f"{tmp}/{i:02d}.png")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "1/12", "-i", f"{tmp}/%02d.png",
                        "-c:v", "libx264", "-r", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                        str(OUT / "walkthrough.mp4")], check=True)

if __name__ == "__main__":
    main()
