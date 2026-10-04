# udslib.com v2 + uds-toolbox MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild udslib.com (FAQ, examples, pricing/sell policy, MCP page, click analytics) and ship a general-purpose UDS/ISO-TP/CAN MCP server as a Cloudflare Worker.

**Architecture:** Two independent deliverables in repo `Artomatica/udslib.com` (clone `~/projects/udslib-website`, branch `feat/site-v2-faq-examples-mcp`). (A) `mcp-worker/` — a dependency-free ES-module Cloudflare Worker speaking MCP Streamable HTTP (stateless JSON-RPC over POST `/mcp`), pure decoder modules + static tables, tested with `node --test`. (B) the static site at repo root — hand-written HTML sharing one `style.css` and one `site.js`, no framework, no build.

**Tech Stack:** Node 20+ `node:test`, Cloudflare Workers (wrangler 4, account `53f45abe9550f62856af4475880e0a77`), plain HTML/CSS/JS, GA4 gtag.

**Spec:** `docs/superpowers/specs/2026-10-04-udslib-site-v2-design.md`

## Global Constraints

- No dependencies in `mcp-worker` runtime code (devDependency `wrangler` only).
- No storage and no logging of tool arguments in the Worker.
- MCP protocol version returned: echo client's `protocolVersion` if it is one of `2025-06-18`, `2025-03-26`, `2024-11-05`; else `2025-06-18`.
- Never copy ISO 14229 text; paraphrase and cite clause numbers only.
- No claims of ISO 26262 / certification, no DoIP support claim, no customer logos, no invented benchmark numbers.
- Price: commercial license 5,000 EUR (perpetual, one legal entity, unlimited products, no royalties, ≤40 h integration, 1 year updates + email support, 2-business-day target); renewal 1,500 EUR/year. Contact andrii@shylenko.com. Seller Andrii Shylenko e.v.
- Free tier: PolyForm Noncommercial 1.0.0. Spec-conformance bug fixes free for everyone; verified student/thesis help at maintainer discretion.
- Keep URLs `/`, `/index.html`, `/whitepaper.html`; keep GA4 tag `G-JXF0DBSEDH`.
- Service list must match `w1ne/udslib` `docs/SERVICE_COMPLIANCE.md` on `develop` (27 services: 0x10 11 14 19 22 23 24 27 28 29 2A 2C 2E 2F 31 34 35 36 37 38 3D 3E 83 84 85 86 87). The old site's 14-service list is stale.
- `_config.yml` excludes `docs`, `README.md`, `mcp-worker`.
- No mention of Claude/AI authorship in commits (user rule); commit as configured git user.

## Review Focus

1. Hex input with spaces, `0x` prefixes, commas, lowercase, or odd nibble count → decoders normalise or return a clear `isError` result, never throw a 500. (Task 2 test `hex normalisation`.)
2. Negative response to an unknown SID or unknown NRC (e.g. `7F BA 99`) → still decoded, labelled "unknown / manufacturer-specific / reserved", not an exception. (Task 2.)
3. ISO-TP traces with frames for multiple CAN IDs interleaved → reassembly per CAN ID, not one global buffer. (Task 3 test `interleaved ids`.)
4. MCP client sends a notification (no `id`) or a JSON-RPC batch array → 202 for notifications; batch handled element-wise. (Task 1.)
5. Phone-width site (360 px): no horizontal page scroll, tables/code scroll inside their container. (Task 6/8 browser check.)

---

### Task 1: MCP Worker skeleton (JSON-RPC + MCP handshake)

**Files:**
- Create: `mcp-worker/package.json`, `mcp-worker/wrangler.jsonc`, `mcp-worker/src/index.mjs`, `mcp-worker/src/mcp.mjs`, `mcp-worker/src/tools.mjs`, `mcp-worker/test/mcp.test.mjs`
- Modify: `_config.yml` (add `mcp-worker` to exclude)

**Interfaces:**
- Produces: `handleRpc(message) -> Promise<object|null>` in `mcp.mjs` (null for notifications). `TOOLS` array in `tools.mjs`: `{ name, description, inputSchema, run(args) -> { text: string, data?: object } }`; `run` may throw `ToolInputError(message)` (exported from `tools.mjs`) → MCP result `{ isError: true }`.
- Worker routes: `POST /mcp` JSON-RPC; `GET /mcp` → 405 with `Allow: POST`; `OPTIONS` → CORS 204; `GET /` → 200 text pointing to https://udslib.com/mcp.html. CORS `Access-Control-Allow-Origin: *`, allow headers `content-type, mcp-protocol-version, mcp-session-id, authorization`.

- [ ] Step 1: `package.json`: `{"name":"udslib-mcp","private":true,"type":"module","scripts":{"test":"node --test test/","dev":"wrangler dev","deploy":"wrangler deploy"},"devDependencies":{"wrangler":"^4"}}`. `wrangler.jsonc`: `{"name":"udslib-mcp","main":"src/index.mjs","account_id":"53f45abe9550f62856af4475880e0a77","compatibility_date":"2026-10-02","workers_dev":true,"preview_urls":false}`.
- [ ] Step 2: write failing tests in `test/mcp.test.mjs`:
  - `initialize` with `protocolVersion:"2025-06-18"` → result has `protocolVersion:"2025-06-18"`, `serverInfo.name:"uds-toolbox"`, `capabilities.tools`, `instructions` string containing `udslib.com`.
  - `initialize` with `protocolVersion:"1999-01-01"` → `"2025-06-18"`.
  - `{"jsonrpc":"2.0","method":"notifications/initialized"}` → `handleRpc` returns `null`.
  - `tools/list` → names exactly `decode_uds, build_uds_request, decode_isotp, decode_dtc, uds_reference, udslib_integration` (later tasks register them; in this task register stubs so the list test passes, each stub throws `ToolInputError("not implemented")`).
  - `tools/call` unknown name → JSON-RPC error `-32602`.
  - `tools/call` tool throwing `ToolInputError` → `result.isError === true`, `content[0].text` = message.
  - unknown method → error `-32601`; `ping` → `{}`.
  - Worker `fetch` (import default from `src/index.mjs`): POST batch `[initialize, notification]` → JSON array of 1 response; POST single notification → status 202 empty body; POST invalid JSON → 400 with JSON-RPC error `-32700`; GET `/mcp` → 405.
- [ ] Step 3: run `cd mcp-worker && npm test` → FAIL (modules missing).
- [ ] Step 4: implement. `tools/call` result shape: `{ content:[{type:"text",text}], structuredContent: data (only if data present), isError? }`. Unexpected (non-ToolInputError) exceptions → `isError:true` with text `"internal error"` (no stack). `instructions`: "General UDS (ISO 14229), ISO-TP (ISO 15765-2) and DTC helpers. Offline, no hardware. Built by UDSLib — https://udslib.com".
- [ ] Step 5: `npm test` → PASS. Commit `feat(mcp): worker skeleton with MCP JSON-RPC handshake`.

### Task 2: UDS tables + `decode_uds` + `build_uds_request`

**Files:**
- Create: `mcp-worker/src/hex.mjs`, `mcp-worker/src/uds-tables.mjs`, `mcp-worker/src/uds.mjs`, `mcp-worker/test/uds.test.mjs`
- Modify: `mcp-worker/src/tools.mjs` (replace two stubs)

**Interfaces:**
- `parseHex(input: string|number[]) -> Uint8Array` throws `ToolInputError` on non-hex or odd nibble count; accepts spaces, commas, `0x` prefixes, mixed case, arrays of ints 0–255.
- `toHex(bytes) -> "22 F1 90"` (uppercase, space-separated).
- `SERVICES: { [sid:number]: { name, hasSubfunction:boolean, subfunctions?: {[n]:string}, clause: string } }` — all 27 SIDs from Global Constraints plus 0x86/0x87 etc.; clause like `"ISO 14229-1 §10.2"` (section numbers for 2020 edition: 0x10 §10.2, 0x11 §10.3, 0x27 §10.4, 0x28 §10.5, 0x29 §10.6, 0x3E §10.7, 0x83 §10.8, 0x84 §10.9, 0x85 §10.10, 0x86 §10.11, 0x87 §10.12, 0x22 §11.2, 0x23 §11.3, 0x24 §11.4, 0x2A §11.5, 0x2C §11.6, 0x2E §11.7, 0x3D §11.8, 0x14 §12.2, 0x19 §12.3, 0x2F §13.2, 0x31 §14.2, 0x34 §15.2, 0x35 §15.3, 0x36 §15.4, 0x37 §15.5, 0x38 §15.6).
- `NRCS: { [code]: { name, meaning, typicalCause } }` — every NRC 0x10–0x93 defined in ISO 14229-1 Annex A (0x10 generalReject, 0x11 serviceNotSupported, 0x12 subFunctionNotSupported, 0x13 incorrectMessageLengthOrInvalidFormat, 0x14 responseTooLong, 0x21 busyRepeatRequest, 0x22 conditionsNotCorrect, 0x24 requestSequenceError, 0x25 noResponseFromSubnetComponent, 0x26 failurePreventsExecutionOfRequestedAction, 0x31 requestOutOfRange, 0x33 securityAccessDenied, 0x34 authenticationRequired, 0x35 invalidKey, 0x36 exceedNumberOfAttempts, 0x37 requiredTimeDelayNotExpired, 0x38–0x4F reserved by extended data link security, 0x50–0x5D authentication NRCs, 0x70 uploadDownloadNotAccepted, 0x71 transferDataSuspended, 0x72 generalProgrammingFailure, 0x73 wrongBlockSequenceCounter, 0x78 requestCorrectlyReceivedResponsePending, 0x7E subFunctionNotSupportedInActiveSession, 0x7F serviceNotSupportedInActiveSession, 0x81–0x93 condition NRCs: rpmTooHigh, rpmTooLow, engineIsRunning, engineIsNotRunning, engineRunTimeTooLow, temperatureTooHigh, temperatureTooLow, vehicleSpeedTooHigh, vehicleSpeedTooLow, throttle/PedalTooHigh, throttle/PedalTooLow, transmissionRangeNotInNeutral, transmissionRangeNotInGear, (0x8E reserved), brakeSwitch(es)NotClosed, shifterLeverNotInPark, torqueConverterClutchLocked, voltageTooHigh, voltageTooLow). Ranges 0x94–0xEF reserved, 0xF0–0xFE manufacturer specific.
- `DIDS`: 0xF180–0xF19F standard identification DIDs (F180 bootSoftwareIdentification … F186 activeDiagnosticSession, F187 sparePartNumber, F18A systemSupplierIdentifier, F18B ECUManufacturingDate, F18C ECUSerialNumber, F190 VIN, F191 vehicleManufacturerECUHardwareNumber, F192 systemSupplierECUHardwareNumber, F194 systemSupplierECUSoftwareNumber, F195 systemSupplierECUSoftwareVersionNumber, F197 systemNameOrEngineType, F198 repairShopCodeOrTesterSerialNumber, F199 programmingDate, F19E ODXFile, etc.) plus `0xFF00 eraseMemory`, `0xFF01 checkProgrammingDependencies` as RIDs in `RIDS`.
- `decodeUds(hex, direction?) -> { text, data }`; `data` = `{ kind: "request"|"positive_response"|"negative_response", sid, service, subfunction?, suppressPosRsp?, fields: {...}, nrc? }`.
- `buildUdsRequest(args) -> { text, data:{ hex } }`; `args.service` one of: `session` (`type`), `ecu_reset` (`type`), `read_did` (`dids: string[]`), `write_did` (`did`, `data` hex), `security_seed` (`level` odd), `security_key` (`level` odd, `key` hex → sends level+1), `tester_present` (`suppress` bool), `routine` (`action` start|stop|results, `rid`, `data?`), `request_download` (`address`, `size`, `addressBytes` default 4, `sizeBytes` default 4, `dfi` default 0), `transfer_data` (`counter`, `data`), `transfer_exit`, `clear_dtc` (`group` default FFFFFF), `read_dtc` (`subfunction`, `mask` default FF), `control_dtc` (`on` bool), `comm_control` (`control`, `commType` default 01), `raw` (`hex`).

- [ ] Step 1: failing tests in `test/uds.test.mjs` (exact vectors):
  - `parseHex("22 f1 90")`, `parseHex("0x22,0xF1,0x90")`, `parseHex([0x22,0xF1,0x90])` all equal `[0x22,0xF1,0x90]`; `parseHex("2")` and `parseHex("zz")` throw `ToolInputError` (**hex normalisation**).
  - `22 F1 90` → request, ReadDataByIdentifier, `fields.dids` = `[{did:0xF190,name:"VIN"...}]` (name contains "VIN").
  - `62 F1 90 57 30 4C` → positive_response for 0x22, did F190, data hex `57 30 4C`, ascii `"W0L"`.
  - `7F 22 31` → negative_response, service ReadDataByIdentifier, nrc `{code:0x31,name:"requestOutOfRange"}`.
  - `7F 34 78` → nrc 0x78; text mentions `P2*` and "not an error".
  - `7F BA 99` → negative_response, service "unknown (0xBA)", nrc name contains "reserved" (**unknown SID/NRC**).
  - `10 83` → session control, subfunction 0x03 `extendedDiagnosticSession`, `suppressPosRsp:true`.
  - `50 03 00 32 01 F4` → positive, P2 = 50 ms, P2* = 5000 ms (P2* raw 0x01F4 × 10 ms).
  - `27 01` → requestSeed level 1; `27 02 AA BB` → sendKey level 2 key `AA BB`.
  - `3E 80` → TesterPresent suppress true.
  - `31 01 FF 00` → RoutineControl startRoutine, rid 0xFF00 eraseMemory.
  - `34 00 44 08 00 00 00 00 01 00 00` → RequestDownload, dfi 0x00, address 0x08000000, size 0x00010000.
  - `74 20 04 02` → positive RequestDownload, maxNumberOfBlockLength 0x0402 = 1026.
  - `36 01 DE AD` → TransferData block counter 1, 2 data bytes.
  - `19 02 FF` → ReadDTCInformation reportDTCByStatusMask mask 0xFF.
  - `""` → throws ToolInputError.
  - build: `{service:"read_did",dids:["F190","F18C"]}` → `22 F1 90 F1 8C`; `{service:"session",type:2}` → `10 02`; `{service:"tester_present",suppress:true}` → `3E 80`; `{service:"request_download",address:"0x08000000",size:"0x10000"}` → `34 00 44 08 00 00 00 00 01 00 00`; `{service:"security_key",level:1,key:"AABB"}` → `27 02 AA BB`; `{service:"routine",action:"start",rid:"FF00"}` → `31 01 FF 00`; `{service:"security_seed",level:2}` throws (even level).
  - round trip: every built request decodes back to the same service.
- [ ] Step 2: `npm test` → FAIL.
- [ ] Step 3: implement tables and decoders; per-SID field decoders for 0x10, 0x11, 0x14, 0x19 (sub-function + mask/DTC), 0x22/0x62, 0x23, 0x27/0x67, 0x28, 0x2E/0x6E, 0x2F, 0x31/0x71, 0x34/0x74, 0x35/0x75, 0x36/0x76, 0x37, 0x3E, 0x85; other SIDs: name + raw payload hex. Text output is a short human-readable multi-line summary.
- [ ] Step 4: `npm test` → PASS. Commit `feat(mcp): decode_uds and build_uds_request`.

### Task 3: `decode_isotp`

**Files:** Create `mcp-worker/src/isotp.mjs`, `mcp-worker/test/isotp.test.mjs`; modify `tools.mjs`.

**Interfaces:**
- Input: `{ frames: [{ id?: string|number, data: string|number[], t?: number /*ms*/ }], padding?: boolean, decodeUds?: boolean /*default true*/ }`. Also accepts `frames` as a candump-style multiline string: lines like `can0  7E0   [8]  02 10 03 AA AA AA AA AA` or `(1690000000.123456) can0 7E0#0210030000000000` (timestamp seconds → ms).
- Output data: `{ pdus: [{ id, bytes:hex, length, firstT?, lastT?, uds?: decodeUds data }], frames: [{ id, type:"SF"|"FF"|"CF"|"FC", ...}], errors: string[], warnings: string[] }`.
- Rules: SF low nibble length (classic) or `00 LL` escape (CAN-FD, len>7); FF 12-bit length, or `10 00` + 32-bit length escape; CF SN 1..15 wrapping to 0; FC status 0 CTS / 1 WAIT / 2 OVFLW, BS, STmin (0x00–0x7F ms, 0xF1–0xF9 = 100–900 µs, others reserved). Trailing bytes beyond length = padding, report padding byte if uniform. Per-ID reassembly buffer. Errors: unexpected CF (no FF), wrong SN (`expected 2 got 3`), new FF/SF interrupting reassembly, FC overflow. Warnings with timestamps: CF gap > 1000 ms (N_Cr), FF→FC gap > 1000 ms (N_Bs), CF gap < STmin.
- Multi-ID: FC frames are sent on a different ID than data; reassembly keys on the data frame's own ID.

- [ ] Step 1: failing tests:
  - SF `03 22 F1 90 AA AA AA AA` → pdu `22 F1 90`, padding `0xAA`, uds service ReadDataByIdentifier.
  - multi-frame (id 7E8): `10 0B 62 F1 90 57 30 4C`, FC on 7E0 `30 00 00`, `21 31 32 33 34 35 36` → one pdu length 11 `62 F1 90 57 30 4C 31 32 33 34 35`, extra CF bytes beyond 11 treated as padding.
  - wrong SN: FF then `22 ...` → error contains `expected SN 1`.
  - CF without FF → error.
  - FC `32 00 00` → error contains `overflow`.
  - FC STmin `30 08 F3` → frame data `{blockSize:8, stMin:"300 µs"}`.
  - CAN-FD SF `00 0C` + 12 bytes → pdu length 12.
  - FF escape `10 00 00 00 00 14` → length 20.
  - timing: FF at t=0, FC t=5, CF t=1500 → warning contains `N_Cr`.
  - **interleaved ids**: FF on 7E8 and FF on 7E9 interleaved with their CFs → two correct pdus.
  - candump string with 3 lines (SF) parses into 1 pdu.
  - empty frames → ToolInputError.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS. Commit `feat(mcp): decode_isotp`.

### Task 4: `decode_dtc` + `uds_reference`

**Files:** Create `mcp-worker/src/dtc.mjs`, `mcp-worker/src/reference.mjs`, `mcp-worker/test/dtc.test.mjs`, `mcp-worker/test/reference.test.mjs`; modify `tools.mjs`.

**Interfaces:**
- `decodeDtc({ dtc: string /*3 bytes hex OR "P0123-45" form*/, status?: string|number })` → data `{ hex, code:"P0123", ftb:"45", system:"Powertrain", status?: { raw, bits:[{bit,name,set}] } }`. Status bit names: 0 testFailed, 1 testFailedThisOperationCycle, 2 pendingDTC, 3 confirmedDTC, 4 testNotCompletedSinceLastClear, 5 testFailedSinceLastClear, 6 testNotCompletedThisOperationCycle, 7 warningIndicatorRequested. Bidirectional: `"U0073-00"` → hex `C0 73 00`.
- `udsReference({ topic })` — topic string, case-insensitive. Resolves: `0x78`/`78`/`nrc 78` → NRC entry; `0x27`/`SecurityAccess` → service entry incl. clause; `F190` → DID; `p2`, `p2*`, `s3`, `timing` → timing note (P2 default 50 ms, P2* default 5000 ms, encoded as P2* /10 in 0x50 response, S3 5000 ms, tester sends 0x3E 80 at ~2 s); `reprogramming_sequence` → the 17-step sequence exactly as in `w1ne/udslib` develop `examples/pro_flash_tool/README.md` (read it; fallback outline: pre-programming: 0x10 03, 0x31 01 FF 02 check preconditions, 0x85 02, 0x28 03 01; programming: 0x10 02, 0x27 seed/key, 0x2E fingerprint, 0x31 01 FF 00 erase, 0x34, 0x36 ×n, 0x37, 0x31 01 FF 01 check dependencies/CRC; post: 0x11 01, 0x10 03, 0x28 00 01, 0x85 01, 0x10 01) marked as "typical OEM pattern, not mandated by ISO 14229"; `security`/`0x27 vs 0x29` → comparison note; `sessions` → default/programming/extended/safety and what each usually gates. Unknown topic → text listing available topic kinds (not an error).
- [ ] Step 1: failing tests: `01 23 45` → `P0123`, ftb `45`; `C0 73 00` → `U0073`; `"U0073-00"` → hex `C0 73 00`; `81 23 00` → 0x81 = bits7-6 `10` (B), bits5-4 `00` (0), bits3-0 `0001` (1), byte1 `23` → `B0123`; status `0x09` → testFailed + confirmedDTC set, others clear; bad input `"XYZ"` → ToolInputError. Reference: `"0x78"` text contains "responsePending"; `"securityaccess"` contains `§10.4`; `"F190"` contains "VIN"; `"reprogramming_sequence"` data.steps length 17; `"banana"` returns help, not error.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS. Commit `feat(mcp): decode_dtc and uds_reference`.

### Task 5: `udslib_integration`

**Files:** Create `mcp-worker/src/udslib.mjs`, `mcp-worker/test/udslib.test.mjs`; modify `tools.mjs`.

**Interfaces:**
- Input `{ target?: string, rtos?: "baremetal"|"freertos"|"zephyr"|"linux", transport?: "can"|"canfd"|"udp-sim", features?: string[] /* dtc, dtc_persist, security, authentication, bootloader, flash_tool, custom_service, periodic, roe */, role?: "server"|"client" }`.
- Output data `{ files:[...], example:{name,url}, extraExamples:[...], configHints:[...], skeleton: string /*C*/, license: { free: "PolyForm Noncommercial 1.0.0 — personal, research, education, evaluation", commercial: "5,000 EUR …", url:"https://udslib.com/pricing.html" } }`.
- Data source (copy from `w1ne/udslib` develop): core files `include/uds/uds_core.h`, `include/uds/uds_config.h`, `src/core/uds_core.c`, `src/services/*.c`, transport `src/transport/uds_tp_isotp.c` + `include/uds/uds_isotp.h` (baremetal/freertos), Zephyr uses native ISO-TP (`CONFIG_ISOTP=y`, `CONFIG_UDS=y`, see `zephyr/` module); client adds `include/uds/uds_client.h`, `src/services/uds_client.c`; dtc adds `include/uds/uds_dtc_store.h`, `src/services/uds_dtc_store.c`. Example mapping: baremetal→`bare_metal`, freertos→`freertos_demo`, zephyr→`zephyr_uds_server`, linux→`host_sim`, target matching /f103|bluepill/i→`f103_cubemx_uds_ecu`, /h5|h563/i→`h5_uds_ecu_full`; features: dtc→`dtc_store`, dtc_persist→`dtc_persist`, security→`security_access_mbedtls`, authentication→`auth_challenge_mbedtls`, bootloader→`h563_uds_bootloader`, flash_tool→`pro_flash_tool`, custom_service→`custom_service`; role client→`client_demo`. URLs `https://github.com/w1ne/udslib/tree/develop/examples/<name>`. Skeleton: the super-loop / FreeRTOS task snippet from `docs/INTEGRATION_GUIDE.md` adapted (`uds_init(&ctx,&cfg)`, `uds_process(&ctx)`, `uds_input_sdu(&ctx,data,len)`, `cfg.fn_mutex_lock`). Config hints: `restrict_sessions` for bootloader, session masks `UDS_SESSION_*`, `UDS_SECURITY_SEED_MAX`.
- [ ] Step 1: failing tests: `{rtos:"zephyr"}` → example `zephyr_uds_server`, configHints contains `CONFIG_ISOTP=y`; `{target:"STM32F103"}` → `f103_cubemx_uds_ecu`; `{rtos:"freertos",features:["dtc","bootloader"]}` → extraExamples include `dtc_store` and `h563_uds_bootloader`, skeleton contains `fn_mutex_lock`; `{role:"client"}` → files include `src/services/uds_client.c`; license.commercial contains `5,000 EUR`; `{features:["doip"]}` → text says DoIP not supported (no throw).
- [ ] Step 2–4 TDD. Commit `feat(mcp): udslib_integration`.

### Task 6: Site shell — `style.css`, `site.js`, new `index.html`

**Files:** Create `style.css`, `site.js`; rewrite `index.html`; delete `assets/` (Spectral), `elements.html`, `generic.html`, `images/pic0*.jpg` (keep `images/banner.jpg` for og:image).

**Interfaces:**
- Shared header markup (copy verbatim to every page): logo "UDSLib" → `/`, nav links Examples `examples.html`, FAQ `faq.html`, Pricing `pricing.html`, MCP `mcp.html`, White paper `whitepaper.html`, GitHub (external). Mobile: `<button class="nav-toggle" aria-expanded>` toggled by `site.js`. Footer: © Andrii Shylenko e.v., links GitHub, email, pricing, MCP; sister site iolinki.com.
- `site.js`: nav toggle; `track(name, params)` wrapper around `gtag` (no-op if absent); delegated click listener: `a[href^="mailto:"]` → `contact_click`; `a[href*="github.com/w1ne/udslib"]` → `github_click` (`{link_url}`); `[data-example]` → `example_click` (`{example}`); `[data-copy]` buttons copy target `<pre>` text to clipboard and fire `mcp_copy` (`{client}`); `pricing_view` fired on load when `location.pathname` ends with `pricing.html`.
- CSS tokens on `:root` (light) — bg `#fbfcfd`, text `#14202b`, muted `#556270`, accent `#1f6feb`, border `#dde3ea`, code bg `#f2f5f8`; system font stack; max width 1080px; 16px side gutter; `.table-wrap{overflow-x:auto}`; `pre{overflow-x:auto}`; visible `:focus-visible` outline; cards grid `repeat(auto-fit,minmax(260px,1fr))`.
- index sections: hero (h1 "Portable ISO 14229 UDS stack for embedded ECUs", one paragraph, CTAs "Browse examples" + "Pricing", small line "Free for noncommercial use · 5,000 EUR commercial"); "What you get" (zero-malloc C99, ISO-TP over CAN/CAN-FD, Zephyr/FreeRTOS/bare metal/POSIX, MISRA-aligned with documented deviations, Wireshark dissector, Python bindings, session dashboard); services grid (all 27 from Global Constraints with names); "Most requested" (5 cards: Full 0x19 → dtc_full_coverage; DTCs in flash → dtc_persist; STM32 bxCAN port → f103_cubemx_uds_ecu; UDS OTA bootloader → h563_uds_bootloader + note "OEM flash sequences are integration work"; SecurityAccess with real crypto → security_access_mbedtls); comparison table UDSLib vs driftregion/iso14229 (rows: license MIT vs PolyForm NC + commercial; size 2 files vs modular; DTC store yes/no-app; reprogramming examples; mbedTLS security examples; Wireshark dissector; Python bindings; paid support with SLA) — state iso14229 facts only as "per its README" and link it; MCP teaser → mcp.html; CTA band.
- [ ] Step 1: write files. Step 2: `python3 -m http.server 8099` in repo root, open `/` at 1280 px and 360 px in the existing Chrome tab via claude-in-chrome; confirm no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`), no console errors. Step 3: commit `feat(site): new shell and homepage`.

### Task 7: `examples.html`, `faq.html`, `pricing.html`, `mcp.html`, whitepaper reskin, SEO files

**Files:** Create `examples.html`, `faq.html`, `pricing.html`, `mcp.html`, `llms.txt`; modify `whitepaper.html` (swap template chrome for shared header/footer; content unchanged), `sitemap.xml` (all pages), `robots.txt`, `README.md`.

- examples: six groups from spec; each card = name, one line (from example README first paragraph in `w1ne/udslib` develop), "View on GitHub" link with `data-example`.
- faq: `<details>` per question, the ~16 from spec; each answer 2–5 sentences, cite the doc/example (e.g. `docs/TIMING_AND_TIMEOUTS.md`, `docs/TRANSPORT.md`, `docs/MISRA.md`) with GitHub link; DoIP answer "not supported today"; ISO 26262 answer "no certification claimed; MISRA deviations documented"; license Qs: thesis = free noncommercial; internal tooling at a company = commercial; evaluation at a company before buying = allowed (noncommercial evaluation, no production). FAQPage JSON-LD in `<script type="application/ld+json">` matching the visible Q/A text.
- pricing: two columns Free / Commercial with the Global Constraints wording; "What counts as paid work" list; "How to buy" 3 steps; order form fields as a copyable block; seller line; link to `COMMERCIAL_LICENSE.md` and `LICENSE` on GitHub.
- mcp: what it is ("general UDS/ISO-TP/DTC toolbox for AI coding agents; offline; no hardware; no data stored"), endpoint `https://udslib-mcp.<sub>.workers.dev/mcp` (fill real URL after Task 8 deploy), tool table (6 tools), config snippets with `data-copy` buttons: Claude Code `claude mcp add --transport http uds-toolbox <url>`; Claude Desktop / Cursor JSON `{"mcpServers":{"uds-toolbox":{"url":"<url>"}}}`; ChatGPT: Settings → Connectors → add custom connector URL; 4 example prompts (decode a candump trace; why do I get 7F 34 78; build a RequestDownload for 0x08000000 64 KiB; plan UDSLib on STM32F103 FreeRTOS with DTC store).
- llms.txt: title, one-paragraph summary, links to every page, GitHub, MCP endpoint.
- [ ] Step 1: write. Step 2: link check — `python3` script: parse every `*.html`, assert every relative href/src exists, every page has `<title>`, one `h1`, meta description, GA tag, shared nav. Save as `scripts/check_site.py` and run it. Step 3: browser check all pages at 1280/360 px, expand a FAQ, click copy button (check `mcp_copy` via console `dataLayer`). Step 4: commit `feat(site): examples, FAQ, pricing, MCP pages`.

### Task 8: Deploy Worker, wire URL, live verification, PR

- [ ] Step 1: `cd mcp-worker && npm test` PASS; `npx wrangler deploy`; record URL.
- [ ] Step 2: live MCP check with curl: initialize, tools/list (6 tools), tools/call decode_uds `7F 34 78`. Then `claude mcp add --transport http uds-toolbox-test <url>` in a scratch dir is optional; curl evidence suffices.
- [ ] Step 3: put the real URL in `mcp.html`, `llms.txt`, index teaser; rerun `scripts/check_site.py`; commit.
- [ ] Step 4: screenshots of every page desktop + mobile saved to scratchpad for user inspection. Push branch, open PR on `Artomatica/udslib.com` (do NOT merge — user must visually inspect first). PR body short, ends with Claude Code attribution line per session config.
- [ ] Step 5: tell the user the one manual GA step: Admin → Events → mark `contact_click` and `mcp_copy` as key events (events appear after first fire).
