#!/usr/bin/env python3
"""Build the uds-toolbox plugin archive reproducibly."""
import io, sys, zipfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins/uds-toolbox"
OUT = ROOT / "downloads/uds-toolbox-plugin.zip"

def bundle():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in sorted(SRC.rglob("*")):
            if p.is_file():
                info = zipfile.ZipInfo(p.relative_to(SRC).as_posix(), (1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                z.writestr(info, p.read_bytes())
    return buf.getvalue()

data = bundle()
if "--check" in sys.argv:
    if not OUT.is_file() or OUT.read_bytes() != data:
        raise SystemExit("plugin archive differs from plugins/uds-toolbox")
    print("plugin archive is up to date")
else:
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_bytes(data)
    print(f"wrote {OUT.relative_to(ROOT)} ({len(data)} bytes)")
