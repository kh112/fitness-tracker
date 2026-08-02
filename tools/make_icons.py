#!/usr/bin/env python3
"""Generate the app icons.

    python tools/make_icons.py

Writes PNGs into icons/. Run it only when the mark changes — the output is
committed, so a normal deploy needs nothing from this script. It exists so the
icons are reproducible rather than being binaries of unknown origin.

No dependencies. PNG is written by hand (zlib + a few chunks) and the mark is
drawn from a signed distance field, which gives clean anti-aliased edges at
every size without needing to supersample.

The mark is the app's own chart line: a rising stroke with a dot at its head.
"""

import math
import os
import struct
import zlib

BG = (0x00, 0x00, 0x00)      # --bg
FG = (0x0A, 0x84, 0xFF)      # --accent, iOS dark-mode system blue

# Polyline in unit coordinates, y down. Kept inside the central 80% circle so
# the same art survives Android's maskable crop.
LINE = [(0.245, 0.670), (0.449, 0.483), (0.602, 0.568), (0.772, 0.313)]

STROKE = 0.115               # stroke width, fraction of canvas
HEAD_R = 0.082               # radius of the dot at the head of the line


def seg_dist(px, py, ax, ay, bx, by):
    """Distance from point to line segment."""
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / L2))
    return math.hypot(wx - t * vx, wy - t * vy)


def render(size, scale=1.0):
    """Return PNG row bytes for a size x size icon. `scale` shrinks the mark."""
    pts = [(0.5 + (x - 0.5) * scale, 0.5 + (y - 0.5) * scale) for x, y in LINE]
    pts = [(x * size, y * size) for x, y in pts]
    half = STROKE * scale * size / 2
    head_r = HEAD_R * scale * size
    hx, hy = pts[-1]

    rows = []
    for py in range(size):
        row = bytearray()
        yc = py + 0.5
        for px in range(size):
            xc = px + 0.5

            d = min(seg_dist(xc, yc, *pts[i], *pts[i + 1])
                    for i in range(len(pts) - 1)) - half
            d = min(d, math.hypot(xc - hx, yc - hy) - head_r)

            # Distance field -> coverage. The 0.5px band is the antialiased edge.
            a = max(0.0, min(1.0, 0.5 - d))
            row += bytes(round(BG[c] + (FG[c] - BG[c]) * a) for c in range(3))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body))

    raw = b''.join(b'\x00' + r for r in rows)          # filter type 0 per row
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))

    with open(path, 'wb') as f:
        f.write(png)
    print(f'  {path}  {size}x{size}  {len(png) / 1024:.1f} KB')


# name, pixel size, mark scale
TARGETS = [
    ('icons/icon-192.png',          192, 1.00),
    ('icons/icon-512.png',          512, 1.00),
    # Android crops maskable icons to a shape inscribed in the canvas; the mark
    # goes smaller still so nothing important lands near the crop.
    ('icons/icon-maskable-512.png', 512, 0.78),
    # iOS applies its own rounded-rect mask and never reads the manifest.
    ('icons/apple-touch-icon.png',  180, 1.00),
    ('icons/favicon-32.png',         32, 1.10),
]

if __name__ == '__main__':
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.makedirs(os.path.join(root, 'icons'), exist_ok=True)
    print('\n  Rendering icons\n')
    for name, size, scale in TARGETS:
        write_png(os.path.join(root, name), size, render(size, scale))
    print()
