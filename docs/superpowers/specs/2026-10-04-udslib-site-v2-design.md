# udslib.com v2 — FAQ, examples, sell policy, UDS MCP

Date: 2026-10-04. Repo: `Artomatica/udslib.com` (GitHub Pages, `main` → udslib.com).

## Goal

Turn udslib.com from a one-page template into a site that answers what people
actually ask, shows the examples, states plainly what is free and what is paid,
and gives engineers a general UDS/CAN MCP server that is useful even if they
never use UDSLib (and quietly points them at it).

Success: a visitor can find an example for their target, get a FAQ answer, see
the price and the free/paid line without emailing; GA4 records conversion
clicks; the MCP server answers real UDS questions from Claude/ChatGPT/Cursor.

## Baseline (2026-10-04)

- GA4 `G-JXF0DBSEDH`, last 28 days: 27 users, 30 sessions; 25 of 28 views on
  `/`; whitepaper 1 view. Germany 13, US 6, China 2. Direct 19, search 4,
  referral 4, AI assistant 2 (≈3 min engaged). **0 key events** — no click is
  tracked.
- GitHub (14 days): 113 unique cloners, 39 unique visitors, 8 stars.
- Issue themes: 0x19 sub-functions, DTC persistence in flash, snapshot/extended
  data, STM32 bxCAN + ISO-TP porting, UDS OTA bootloader.

## Site

Static HTML/CSS/minimal JS, no framework, no build step. Replace the Spectral
template (jQuery, Font Awesome, banner photos) with one shared `style.css`:
light, readable, blue accent, sentence-case headings, mobile nav, visible
focus, contained horizontal scroll for code/tables. Keep URLs `/`,
`/index.html`, `/whitepaper.html`. Keep GA4 tag.

Pages:

1. **`index.html`** — headline + one paragraph; two CTAs (Examples, Pricing).
   Supported services grid (14 services, existing list). Platforms (Zephyr,
   FreeRTOS, bare metal, POSIX host sim; STM32F1/H5 examples). Tooling
   (Wireshark dissector, Python bindings, session dashboard). "Most
   requested" section built from the issue themes, each linking to the
   example that answers it. Honest comparison table vs
   `driftregion/iso14229` (MIT, 2 files) — where they win (license, size,
   stars) and where we do (DTC store, OTA/bootloader examples, mbedTLS
   security, dissector, Python, support contract). MCP teaser.
2. **`examples.html`** — the 19 examples from `w1ne/udslib/examples`, grouped:
   Start (host_sim, client_demo, bare_metal, custom_service), Platforms
   (zephyr_uds_server, freertos_demo, f103_cubemx_uds_ecu, h5_uds_ecu_full,
   h5_uds_tester), DTC (dtc_store, dtc_persist, dtc_clear, dtc_full_coverage),
   Security (auth_challenge, auth_challenge_mbedtls, security_access_mbedtls),
   Reprogramming (pro_flash_tool 17-step, h563_uds_bootloader), Testing
   (generated_tests). One-line description from each README + GitHub link.
3. **`faq.html`** — native `<details>` items, ~16 questions: P2/P2* and NRC
   0x78; S3 + TesterPresent; ISO-TP timeouts, STmin, block size; CAN-FD;
   0x27 vs 0x29; DTC storage (udslib doesn't write flash — app hook);
   all 0x19 sub-functions; OTA flow; porting to a new MCU/CAN driver;
   RAM/ROM; malloc; MISRA (aligned, deviations documented; **no ISO 26262 /
   certification claim**); DoIP (not supported — say so); ODX/CDD/CANoe;
   license questions (is my thesis free? is internal tooling commercial?);
   what support covers. FAQPage JSON-LD.
4. **`pricing.html`** — the sell policy:
   - Free (PolyForm Noncommercial 1.0.0): personal, research, education,
     evaluation; spec-conformance bug fixes for everyone; help for verified
     student/thesis projects at maintainer discretion.
   - Paid: any production or for-profit use; new features; OEM/application
     integration (bootloader flash sequences, board ports, AUTOSAR glue);
     priority fixes.
   - Commercial license 5,000 EUR: perpetual, one legal entity, unlimited
     products, no royalties, up to 40 h integration, 1 year updates + email
     support (2 business-day target). Renewal 1,500 EUR/year. Extra
     integration hours: quoted.
   - How to buy (email → agreement → invoice) + the order form fields from
     `COMMERCIAL_LICENSE.md`. Seller: Andrii Shylenko e.v., contact
     andrii@shylenko.com. No online checkout.
5. **`mcp.html`** — what the MCP does, endpoint, copy-paste config for Claude
   Code / Claude Desktop / Cursor / ChatGPT connectors, example prompts.
6. `whitepaper.html` re-skinned (content unchanged). `llms.txt`,
   `sitemap.xml`, `robots.txt` updated. `_config.yml` excludes `docs/`.

Analytics: `gtag('event', ...)` on clicks — `contact_click` (mailto),
`pricing_view`, `github_click`, `example_click`, `mcp_copy`. User marks
`contact_click` + `mcp_copy` as key events in GA4 admin (one manual step).

## MCP server: `uds-toolbox`

General UDS/ISO-TP/CAN helper, no hardware, no account. Cloudflare Worker on
account `53f45abe…` at `udslib-mcp.<sub>.workers.dev/mcp`, MCP Streamable
HTTP (stateless JSON-RPC). Pure functions over static tables in the Worker;
no storage, no logging of tool arguments (privacy) — only a per-tool call
counter via Workers Analytics/console counts.

Tools:

| tool | input | output |
|---|---|---|
| `decode_uds` | hex PDU, optional direction | service name, sub-function (+ suppressPosRsp bit), DID/RID/DTC fields, NRC name + meaning + typical cause, response match check |
| `build_uds_request` | service + params (e.g. `read_did F190`, `session 0x02`, `request_download addr size alfid`) | hex bytes + annotated breakdown |
| `decode_isotp` | list of CAN frames (id, data hex, optional timestamp ms) | reassembled PDUs, frame types, flow-control params, sequence/timing errors (N_Bs/N_Cr vs given timestamps), padding |
| `decode_dtc` | 3-byte DTC + optional status byte | SAE J2012 code (P/C/B/U + digits + FTB), status bits explained |
| `uds_reference` | topic: service ID, NRC, DID (0xF180–0xF19F), timing (P2/P2*/S3), session/security rules, `reprogramming_sequence` | concise reference text with ISO 14229-1 clause pointers (paraphrased, no standard text copied) |
| `udslib_integration` | target, rtos, transport, features | which UDSLib files, config macros, init skeleton and matching example; license note (free noncommercial / commercial 5,000 EUR) with pricing link |

All tool outputs end with no ads except `udslib_integration` and a single
"Built by UDSLib — udslib.com" line in the server `instructions`.

Testing: `node --test` unit tests for every decoder against known vectors
(positive/negative responses, every NRC, multi-frame ISO-TP incl. FC WAIT/
overflow, bad SN, DTC examples); an MCP-level test doing `initialize`,
`tools/list`, `tools/call` against `wrangler dev`; then live check from
Claude Code via `claude mcp add --transport http`.

## Out of scope

No UDSLib library changes. No online payment. No custom domain for the
Worker (needs Namecheap DNS → later). No DoIP/J1939 tools in v1.

## Release

PR on `Artomatica/udslib.com` → user visually inspects locally (screenshots
desktop + mobile) **before** merge (rule: no deploy without user visual
inspection). Worker deployed with `wrangler deploy` after its tests pass.
