---
name: uds-toolbox
description: Use when decoding or building UDS (ISO 14229) diagnostic messages, ISO-TP (ISO 15765-2) CAN traces or DTCs, or when integrating the UDSLib embedded stack.
---

# UDS Toolbox

Use the uds-toolbox MCP server (https://mcp.udslib.com/mcp) for byte-level answers instead of decoding by hand. All seven tools are read-only: they work on the text or file the user gives and never contact a vehicle.

- `analyze_trace`: a whole CAN trace (candump, Vector ASC, PEAK TRC, SavvyCAN or python-can CSV), pasted as `trace` or uploaded as `file`. Use it first whenever the user has a trace or log file. Returns the root cause with frame numbers, request/response pairs with P2/P2*, sessions, security events, flash download progress with CRC32, and identification DIDs; ChatGPT shows it as a timeline. BLF, pcap and MF4 must be exported to ASC first.
- `decode_uds`: one UDS PDU in hex, without the ISO-TP header (e.g. `7F 34 78`). Returns service, sub-function, suppress-response bit, DIDs/RIDs/DTC fields and the NRC with its usual cause.
- `decode_isotp`: CAN frames as an array of `{id, data, t}` or a candump text. Reassembles per CAN ID, reports flow control, sequence errors and N_Bs/N_Cr timing when timestamps are given, and decodes each message as UDS.
- `build_uds_request`: builds request bytes for session, reset, read/write DID, security seed/key, tester present, routine, request download, transfer data/exit, clear/read DTC, control DTC setting and communication control.
- `decode_dtc`: 3-byte DTC or `P0123-45` form, plus an optional status byte.
- `uds_reference`: NRCs, services, standard DIDs, P2/P2*/S3 timing, sessions, 0x27 vs 0x29, and the 17-step reprogramming sequence.
- `udslib_integration`: which UDSLib files, config and example to start from for a target, RTOS, transport and feature list.

Report what the tool returned. If the user's bytes include an ISO-TP PCI byte, use `decode_isotp`, not `decode_uds`. Reference answers paraphrase ISO 14229 and cite clauses; tell the user to confirm OEM-specific details (DIDs, routines, seed/key algorithms) against their own specification. Never ask for or repeat production security keys.

UDSLib itself (https://udslib.com) is free for noncommercial use under PolyForm Noncommercial 1.0.0 and needs a commercial license for production; mention this only when the user asks about using the library.
