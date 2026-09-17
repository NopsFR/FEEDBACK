"""FEEDBACK identity v2 — wordmark with waveform A + signal line, ringed spike symbol.
Letterforms: Archivo (SIL OFL) at wght 900 / wdth 125, modified. Everything else drawn here."""
import math, pathlib, random
from shapely.geometry import LineString, Polygon, Point, box
from shapely.ops import unary_union
from shapely import affinity
from glyphs import glyph
from symbol_master import to_path

ROOT = pathlib.Path(__file__).resolve().parents[2]
LOGO = ROOT / "brand/logo"

def wave_line(x0, y0, W, amp, pts):
    """pts: list of (u in 0..1, a in -1..1 relative amplitude). Baseline y0, up is negative."""
    return [(x0 + u * W, y0 - a * amp) for u, a in pts]

WAVE = [(0, 0), (.08, 0), (.14, .18), (.19, -.14), (.25, .42), (.31, -.36), (.38, .95), (.45, -.78), (.51, 1.45), (.57, -1.18),
        (.63, .62), (.69, -.52), (.75, .30), (.81, -.22), (.87, .10), (.92, 0), (1, 0)]

def taper_line(p0, p1, w0, w1):
    (x0, y0), (x1, y1) = p0, p1
    L = math.hypot(x1 - x0, y1 - y0); nx, ny = -(y1 - y0) / L, (x1 - x0) / L
    return Polygon([(x0 + nx * w0 / 2, y0 + ny * w0 / 2), (x1 + nx * w1 / 2, y1 + ny * w1 / 2), (x1 - nx * w1 / 2, y1 - ny * w1 / 2), (x0 - nx * w0 / 2, y0 - ny * w0 / 2)])

def wordmark(track=-7.0, line_y=63.0, rise=-0.012, cut=3.4, stroke=3.0):
    x = 0.0; letters = []; spike_slot = None
    for ch in "FEEDB*CK":
        if ch == "*":
            spike_slot = (x + 6, 104.0); x += 104.0 + track; continue
        g, adv = glyph(ch)
        letters.append((ch, affinity.translate(g, x, 0)))
        x += adv + track
    width = x - track
    ly = lambda X: line_y + rise * X
    sx, sw = spike_slot
    # waveform replaces the A
    ccx = sx + sw / 2
    wave = spikes(ccx, ly(ccx), sw * .9, [4, 11, 7, 22, 15, 38, 94, 34, 46, 17, 26, 8, 4], [4, 8, 13, 17, 27, 31, 70, 46, 22, 30, 12, 10, 4], 11.0, line=(10, 10, 3.4), core=3.4)
    # left of the spike: signal cuts through the letters (starts inside the D)
    d_left = [g for c, g in letters if c == "D"][0].bounds[0] + 26
    cut_band = taper_line((d_left, ly(d_left)), (sx + 2, ly(sx + 2)), 0.2, cut)
    # right of the spike: the signal carries on as a line through C and K and trails off
    tail_end = width + 58
    line_r = taper_line((sx + sw - 2, ly(sx + sw)), (tail_end, ly(tail_end)), stroke, 0.0)
    body = unary_union([g for _, g in letters]).difference(cut_band)
    mark = unary_union([body, wave, line_r])
    minx, miny, maxx, maxy = mark.bounds
    mark = affinity.translate(mark, -minx, -miny)
    return mark, (maxx - minx, maxy - miny), -miny

def distress(geom, seed=7, density=1.0):
    rnd = random.Random(seed); minx, miny, maxx, maxy = geom.bounds
    holes = []; area = (maxx - minx) * (maxy - miny)
    def speck(x, y, r):
        n = rnd.randint(5, 7)
        return Polygon([(x + r * rnd.uniform(.45, 1.35) * math.cos(2 * math.pi * k / n), y + r * rnd.uniform(.45, 1.35) * math.sin(2 * math.pi * k / n)) for k in range(n)])
    for _ in range(int(area / 1400 * density)):          # worn patches: clusters of specks
        cx, cy = rnd.uniform(minx, maxx), rnd.uniform(miny, maxy); spread = rnd.uniform(3, 12)
        for _ in range(rnd.randint(8, 40)):
            holes.append(speck(rnd.gauss(cx, spread), rnd.gauss(cy, spread * .6), rnd.uniform(.2, 1.1)))
    for _ in range(int(area / 160 * density)):            # sparse toner dropout
        holes.append(speck(rnd.uniform(minx, maxx), rnd.uniform(miny, maxy), rnd.uniform(.15, .45)))
    for _ in range(int(area / 2600 * density)):           # scratches
        x = rnd.uniform(minx, maxx); y = rnd.uniform(miny, maxy); a = rnd.uniform(-.35, .35)
        L = rnd.uniform(10, 45)
        holes.append(taper_line((x, y), (x + L * math.cos(a), y + L * math.sin(a)), rnd.uniform(.3, .7), 0.05))
    edge = geom.boundary
    for _ in range(int(edge.length / 16 * density)):      # chipped edges
        p = edge.interpolate(rnd.uniform(0, edge.length)); r = rnd.uniform(.35, 1.1)
        holes.append(Point(p.x, p.y).buffer(r, 3))
    return geom.difference(unary_union(holes)).simplify(0.12)

# ---------- burst: the shared waveform element ----------
def spikes(cx, cy, span, ups, downs, w, line=(0, 0, 3.0), core=0.0):
    """Explicit waveform: ups/downs are absolute spike heights from the carrier line."""
    n = len(ups); parts = []
    for i in range(n):
        u = i / (n - 1); x = cx - span / 2 + u * span
        ww = w * (0.7 + 0.3 * min(1, (ups[i] + downs[i]) / max(max(ups) + max(downs), 1) * 2))
        parts.append(Polygon([(x - ww / 2, cy), (x, cy - ups[i]), (x + ww / 2, cy), (x, cy + downs[i])]))
    if core: parts.append(taper_line((cx - span / 2, cy), (cx + span / 2, cy), core, core))
    L, R, t = line
    if L: parts.append(taper_line((cx - span / 2 + 1, cy), (cx - span / 2 - L, cy), t, 0))
    if R: parts.append(taper_line((cx + span / 2 - 1, cy), (cx + span / 2 + R, cy), t, 0))
    return unary_union(parts).buffer(0)

def burst(cx, cy, span, amp, n=15, w=5.6, up=None, down=None, line=(0, 0, 3.0), sigma=0.26, seed=11):
    """Symmetric-ish spike burst. span = width covered by spikes; amp = max spike height.
    line = (left extent, right extent, thickness) of the carrier line beyond the spikes."""
    rnd = random.Random(seed); parts = []
    jitter = [1.0, .62, .88, .55, .95, .7, .82, .6, 1.0, .66, .9, .58, .85, .72, .93, .64, .8]
    for i in range(n):
        u = i / (n - 1); x = cx - span / 2 + u * span
        env = math.exp(-((u - .5) / sigma) ** 2)
        j = jitter[i % len(jitter)]
        hu = amp * env * j * (up[i] if up else 1.0) + 2.0
        hd = amp * env * (jitter[(i + 3) % len(jitter)] * .9 + .1) * (down[i] if down else 1.0) + 2.0
        ww = w * (0.65 + 0.35 * env)
        parts.append(Polygon([(x - ww / 2, cy), (x, cy - hu), (x + ww / 2, cy), (x, cy + hd)]))
    L, R, t = line
    if L: parts.append(taper_line((cx - span / 2 + 1, cy), (cx - span / 2 - L, cy), t, 0))
    if R: parts.append(taper_line((cx + span / 2 - 1, cy), (cx + span / 2 + R, cy), t, 0))
    return unary_union(parts).buffer(0)

# ---------- symbol ----------
def brush_arc(cx, cy, r, a0, a1, w, taper=0.35, steps=120):
    """annular sector with tapered ends (brush stroke)."""
    outer, inner = [], []
    for i in range(steps + 1):
        t = i / steps; a = math.radians(a0 + (a1 - a0) * t)
        e = min(1.0, min(t, 1 - t) / taper) if taper > 0 else 1.0
        ww = w * (0.25 + 0.75 * math.sin(e * math.pi / 2))
        outer.append((cx + (r + ww / 2) * math.cos(a), cy + (r + ww / 2) * math.sin(a)))
        inner.append((cx + (r - ww / 2) * math.cos(a), cy + (r - ww / 2) * math.sin(a)))
    return Polygon(outer + inner[::-1]).buffer(0)

SYM_WAVE = [(0, 0), (.1, 0), (.16, .10), (.21, -.12), (.27, .22), (.32, -.30), (.37, .16), (.42, -.55), (.47, 1.0), (.52, -1.0),
            (.57, .48), (.62, -.34), (.67, .40), (.72, -.20), (.78, .12), (.84, -.06), (.9, 0), (1, 0)]

def symbol(simple=False, disc=False):
    C = 60.0; s = []
    if simple:
        s.append(spikes(C, C, 76, [7, 16, 26, 52, 30, 20, 8], [6, 14, 30, 46, 34, 16, 7], 12.5, line=(20, 20, 6.0), core=5.0))
    else:
        s.append(spikes(C, C, 70, [5, 9, 7, 17, 13, 29, 21, 50, 25, 33, 15, 19, 9, 10, 4], [4, 8, 11, 13, 20, 23, 33, 43, 30, 25, 21, 11, 12, 6, 5], 7.2, line=(22, 22, 3.6), core=3.0))
    if disc:
        s = [affinity.scale(g, .78, .78, origin=(C, C)) for g in s]
        s.append(Point(C, C).buffer(57, 256).difference(Point(C, C).buffer(54.6, 256)))
        s.append(Point(C, C).buffer(49, 256).difference(Point(C, C).buffer(48.3, 256)))
    return unary_union(s)

def write(name, geom, w, h, pad=0):
    d = to_path(geom.simplify(0.03))
    (LOGO / name).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad:.1f} {-pad:.1f} {w + 2*pad:.1f} {h + 2*pad:.1f}"><title>FEEDBACK</title><path fill="currentColor" fill-rule="evenodd" d="{d}"/></svg>\n')
    return len(d)

if __name__ == "__main__":
    LOGO.mkdir(parents=True, exist_ok=True)
    wm, (w, h), base = wordmark()
    print("wordmark", round(w), round(h), "clean", write("feedback-wordmark.svg", wm, w, h))
    print("worn", write("feedback-wordmark-worn.svg", distress(wm), w, h))
    sym = symbol(); print("symbol", write("feedback-symbol.svg", sym, 120, 120))
    print("symbol worn", write("feedback-symbol-worn.svg", distress(sym, seed=3, density=.7), 120, 120))
    print("symbol small", write("feedback-symbol-small.svg", symbol(simple=True), 120, 120))
    ic = spikes(60, 60, 74, [6, 13, 22, 34, 54, 30, 38, 18, 8], [5, 12, 26, 30, 46, 36, 24, 16, 7], 11.5, line=(14, 14, 4.6), core=4.2)
    print("icon glyph", write("feedback-icon-glyph.svg", ic, 120, 120))
    print("icon glyph worn", write("feedback-icon-glyph-worn.svg", distress(ic, seed=5, density=.22), 120, 120))
    fav = spikes(60, 60, 84, [10, 26, 56, 34, 14], [9, 30, 48, 38, 12], 19, line=(0, 0, 0), core=8)
    print("favicon glyph", write("feedback-favicon-glyph.svg", fav, 120, 120))
    print("emblem", write("feedback-emblem.svg", symbol(disc=True), 120, 120))
