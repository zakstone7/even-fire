#!/usr/bin/env python3
"""Generate monochrome (greyscale) icon assets for the Fire plugin.

Pure stdlib: builds PNGs by hand (zlib + PNG chunks). Greyscale only (+ alpha
for the foreground), matching Even's greyscale-only rule. The flame is an
explicit cubic-Bezier outline (curled tip + inner lick) filled with a nonzero
crossing test, supersampled for anti-aliasing.
"""
import os, sys, zlib, struct, math

OUT = sys.argv[1] if len(sys.argv) > 1 else "assets"
os.makedirs(OUT, exist_ok=True)
SIZE = 512
SS = 4

def png(path, w, h, raw, color_type):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, color_type, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

def cubic(p0, p1, p2, p3, n=40):
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        a, b, c, d = mt**3, 3*mt*mt*t, 3*mt*t*t, t**3
        pts.append((a*p0[0]+b*p1[0]+c*p2[0]+d*p3[0], a*p0[1]+b*p1[1]+c*p2[1]+d*p3[1]))
    return pts

# Flame outline (y grows downward). Bottom center, up the right side to a
# hooked tip that leans right, an inner concave lick, then down the left side.
SEGS = [
    ((256,414),(300,410),(322,360),(318,316)),   # right base
    ((318,316),(312,250),(360,212),(300,150)),   # right bulge, then inward
    ((300,150),(328,118),(300,90),(250,74)),     # up to sharp hooked tip
    ((250,74),(238,104),(252,150),(214,184)),    # inner-left curl (concavity)
    ((214,184),(174,226),(166,300),(210,346)),   # left side descending
    ((210,346),(224,384),(232,408),(256,414)),   # left base back to bottom
]
POLY = []
for s in SEGS:
    POLY.extend(cubic(*s))

def inside(x, y):
    # crossing-number point-in-polygon
    c = False
    n = len(POLY)
    j = n - 1
    for i in range(n):
        xi, yi = POLY[i]; xj, yj = POLY[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            c = not c
        j = i
    return c

def coverage(x, y):
    acc = 0
    for sx in range(SS):
        for sy in range(SS):
            if inside(x + (sx+0.5)/SS, y + (sy+0.5)/SS):
                acc += 1
    return acc/(SS*SS)

def make_foreground():
    raw = bytearray()
    for y in range(SIZE):
        raw.append(0)
        for x in range(SIZE):
            a = coverage(x, y)
            # Solid, clearly-grey fill with a gentle top(bright)->base(dim) shade.
            t = max(0.0, min(1.0, (y-74)/(414-74)))
            grey = int(225 - 70*t)      # 225 (tip) .. 155 (base) — always visibly grey
            raw.append(grey)
            raw.append(int(round(a*255)))
    png(os.path.join(OUT, "icon-foreground.png"), SIZE, SIZE, bytes(raw), 4)

def make_background():
    cx = cy = SIZE/2
    maxr = math.hypot(cx, cy)
    raw = bytearray()
    for y in range(SIZE):
        raw.append(0)
        for x in range(SIZE):
            d = math.hypot(x-cx, y-cy)/maxr
            raw.append(max(0, min(255, int(24 + 12*d))))
    png(os.path.join(OUT, "icon-background.png"), SIZE, SIZE, bytes(raw), 0)

make_foreground()
make_background()
print("wrote flame icon +", "background")
