"""FEEDBACK wordmark — custom heavy condensed capitals drawn on a 100-unit cap height.
Motif: 'the gap' — the K's leg is cut away from its arm, the same break the symbol's plug sits in."""
import pathlib, sys
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from symbol_master import to_path

ROOT = pathlib.Path(__file__).resolve().parents[2]
S = 23.0   # vertical stem
T = 18.0   # horizontal bar
H = 100.0
GAP = 3.2  # the cut

def rbox(x0, y0, x1, y1, r, corners="tr br tl bl"):
    b = box(x0, y0, x1, y1)
    rounded = box(x0 + r, y0 + r, x1 - r, y1 - r).buffer(r, 64, join_style=1)
    parts = [rounded]
    # square off corners not listed
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    if "tl" not in corners: parts.append(box(x0, y0, mx, my))
    if "tr" not in corners: parts.append(box(mx, y0, x1, my))
    if "bl" not in corners: parts.append(box(x0, my, mx, y1))
    if "br" not in corners: parts.append(box(mx, my, x1, y1))
    return unary_union(parts).intersection(b)

def F():
    return unary_union([box(0, 0, S, H), box(0, 0, 50, T), box(0, 41, 45, 41 + T - 1)]), 50
def E():
    return unary_union([box(0, 0, S, H), box(0, 0, 50, T), box(0, 41, 45, 41 + T - 1), box(0, H - T, 50, H)]), 50
def D():
    w = 57
    outer = rbox(0, 0, w, H, 25, "tr br")
    inner = rbox(S, T, w - S + 1, H - T, 7, "tr br")
    return outer.difference(inner), w
def B():
    w = 56
    up = rbox(0, 0, w - 3, 54, 21, "tr br")
    lo = rbox(0, 44, w, H, 24, "tr br")
    c1 = rbox(S, T, w - 3 - S + 2, 54 - 13.5, 6, "tr br")
    c2 = rbox(S, 58, w - S + 1, H - T, 7, "tr br")
    return unary_union([up, lo]).difference(c1).difference(c2), w
def A():
    w = 64; top0, top1 = 18, 46; D = 22.5
    outer = Polygon([(0, H), (top0, 0), (top1, 0), (w, H)])
    sl = top0 / H  # horizontal run per unit y
    li = lambda y: D + top0 * (1 - y / H)
    ri = lambda y: (w - D) - top0 * (1 - y / H)
    apex_y = H * (1 - ((w - 2*D) / (2*top0)))
    apex_y = max(apex_y, T + 2)
    cb0, cb1 = 60, 76
    tri = Polygon([(li(cb0), cb0), (ri(cb0), cb0), (ri(apex_y), apex_y), (li(apex_y), apex_y)])
    legcut = Polygon([(li(cb1), cb1), (ri(cb1), cb1), (ri(H), H + 1), (li(H), H + 1)])
    return outer.difference(tri).difference(legcut), w
def C():
    w = 56
    outer = rbox(0, 0, w, H, 26)
    inner = rbox(S, T, w - S + 2, H - T, 8)
    mouth = box(S + 4, 39, w + 1, 61)
    return outer.difference(inner).difference(mouth), w
def K():
    w = 62
    stem = box(0, 0, S, H)
    arm = Polygon([(S - 1, 44), (37, 0), (w, 0), (S - 1, 80)])
    leg = Polygon([(28, 40), (w, H), (w - 24, H), (14, 64)])
    leg = leg.difference(arm.buffer(GAP, join_style=2)).difference(stem)
    return unary_union([stem, arm, leg]).intersection(box(0, 0, w, H)), w

TRACK = 7.0
def build():
    from shapely import affinity
    x = 0; parts = []
    for fn in [F, E, E, D, B, A, C, K]:
        g, w = fn()
        parts.append(affinity.translate(g, x, 0)); x += w + TRACK
    return unary_union(parts), x - TRACK

if __name__ == "__main__":
    g, width = build()
    d = to_path(g.simplify(0.02))
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} 100"><title>FEEDBACK</title><path fill="currentColor" fill-rule="evenodd" d="{d}"/></svg>\n'
    (ROOT / "brand/logo/feedback-wordmark.svg").write_text(svg)
    print("wordmark width", width)
