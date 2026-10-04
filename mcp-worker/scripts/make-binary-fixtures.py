#!/usr/bin/env python3
"""Write binary trace fixtures with independent implementations (python-can for BLF and MF4, scapy for pcap/pcapng)
from the candump fixtures, so the JS parsers are tested against files they did not produce."""
import sys
from pathlib import Path
import can
from scapy.layers.can import CAN
from scapy.utils import PcapWriter, PcapNgWriter

FIX = Path(__file__).resolve().parent.parent / "test" / "fixtures"

def messages(name):
    return list(can.LogReader(str(FIX / f"{name}.log")))

for name in ("flash-ok", "flash-fail"):
    msgs = messages(name)
    for m in msgs:
        m.is_rx = m.arbitration_id != 0x7E0
    with can.BLFWriter(str(FIX / f"{name}.blf")) as w:
        for m in msgs:
            w.on_message_received(m)
    with can.Logger(str(FIX / f"{name}.mf4")) as w:
        for m in msgs:
            w.on_message_received(m)
    pkts = []
    for m in msgs:
        p = CAN(identifier=m.arbitration_id, length=m.dlc, data=bytes(m.data))
        p.time = m.timestamp
        pkts.append(p)
    PcapWriter(str(FIX / f"{name}.pcap"), linktype=227, sync=True).write(pkts)
    PcapNgWriter(str(FIX / f"{name}.pcapng")).write(pkts)
print("binary fixtures written")

# Mixed fixture: extended id, CAN FD (12 data bytes), standard id, a TX frame.
mixed = [
    can.Message(timestamp=1000.000, arbitration_id=0x18DA10F1, is_extended_id=True, data=bytes([0x02, 0x10, 0x03, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA]), is_rx=False),
    can.Message(timestamp=1000.005, arbitration_id=0x18DAF110, is_extended_id=True, data=bytes([0x06, 0x50, 0x03, 0x00, 0x32, 0x01, 0xF4, 0xAA]), is_rx=True),
    can.Message(timestamp=1000.010, arbitration_id=0x7E0, is_extended_id=False, is_fd=True, bitrate_switch=True, data=bytes([0x00, 0x0A, 0x22, 0xF1, 0x90, 0xF1, 0x8C, 0xF1, 0x87, 0xF1, 0x95, 0xAA]), is_rx=False),
    can.Message(timestamp=1000.020, arbitration_id=0x123, is_extended_id=False, data=bytes([0x11, 0x22]), is_rx=True),
]
with can.BLFWriter(str(FIX / "mixed.blf")) as w:
    for m in mixed:
        w.on_message_received(m)
with can.Logger(str(FIX / "mixed.mf4")) as w:
    for m in mixed:
        w.on_message_received(m)
from scapy.layers.can import CANFD
pk = []
for m in mixed:
    if m.is_fd:
        p = CANFD(identifier=m.arbitration_id, length=len(m.data), fd_flags=0x01, data=bytes(m.data))
    else:
        p = CAN(identifier=m.arbitration_id, flags="extended" if m.is_extended_id else 0, length=m.dlc, data=bytes(m.data))
    p.time = m.timestamp
    pk.append(p)
PcapWriter(str(FIX / "mixed.pcap"), linktype=227, sync=True).write(pk)
print("mixed fixtures written")

# Compressed MF4 variants re-saved by asammdf: 1 = deflate (DZ), 2 = transposed deflate.
from asammdf import MDF
for level in (1, 2):
    MDF(str(FIX / "flash-ok.mf4")).save(str(FIX / f"flash-ok.z{level}.mf4"), compression=level, overwrite=True)
print("compressed mf4 written")
