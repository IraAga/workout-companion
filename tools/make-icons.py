#!/usr/bin/env python3
"""Generate the PWA icons with no third-party dependencies.

Draws a barbell glyph on the app's dark background, supersampled for smooth
edges, and writes the PNGs straight to docs/icons/.

    python3 tools/make-icons.py
"""

import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "icons")

BG = (0x0F, 0x16, 0x13)   # app dark background
GLYPH = (0x46, 0xC2, 0x9B)  # app dark-mode accent

SS = 3  # supersampling factor per axis


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def in_rrect(x, y, x0, y0, x1, y1, r):
    """True when (x, y) is inside the rounded rectangle."""
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = clamp(x, x0 + r, x1 - r)
    cy = clamp(y, y0 + r, y1 - r)
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= r * r


# The glyph, in normalised 0..1 coordinates of the icon square.
BAR = (0.14, 0.462, 0.86, 0.538, 0.028)
PARTS = [
    BAR,
    (0.095, 0.275, 0.175, 0.725, 0.030),   # left plate
    (0.175, 0.390, 0.222, 0.610, 0.013),   # left collar
    (0.825, 0.275, 0.905, 0.725, 0.030),   # right plate
    (0.778, 0.390, 0.825, 0.610, 0.013),   # right collar
]


def glyph_at(x, y, scale):
    """Glyph coverage at normalised point, scaled about the centre."""
    gx = (x - 0.5) / scale + 0.5
    gy = (y - 0.5) / scale + 0.5
    for x0, y0, x1, y1, r in PARTS:
        if in_rrect(gx, gy, x0, y0, x1, y1, r):
            return True
    return False


def blend(fg, bg, a):
    return tuple(int(round(f * a + b * (1 - a))) for f, b in zip(fg, bg))


def render(size, maskable=False):
    scale = 0.72 if maskable else 1.0
    radius = 0.0 if maskable else 0.20
    px = bytearray(size * size * 4)
    step = 1.0 / (size * SS)
    samples = SS * SS

    for py in range(size):
        for pxi in range(size):
            bg_cov = 0
            gly_cov = 0
            for sy in range(SS):
                y = (py * SS + sy + 0.5) * step
                for sx in range(SS):
                    x = (pxi * SS + sx + 0.5) * step
                    if maskable or in_rrect(x, y, 0, 0, 1, 1, radius):
                        bg_cov += 1
                        if glyph_at(x, y, scale):
                            gly_cov += 1
            if bg_cov == 0:
                continue
            # Alpha of the whole tile (0 outside the rounded square), then the
            # glyph painted on top of the background.
            tile_a = bg_cov / samples
            gly_a = gly_cov / samples
            r, g, b = blend(GLYPH, BG, gly_a / tile_a if tile_a else 0)
            i = (py * size + pxi) * 4
            px[i:i + 4] = bytes((r, g, b, int(round(tile_a * 255))))
    return px


def write_png(path, size, px):
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # filter type 0
        raw += px[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    targets = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
    ]
    for name, size, maskable in targets:
        path = os.path.join(OUT, name)
        write_png(path, size, render(size, maskable))
        print("%-24s %4dpx  %6d bytes" % (name, size, os.path.getsize(path)))


if __name__ == "__main__":
    main()
