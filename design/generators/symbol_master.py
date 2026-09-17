"""FEEDBACK master symbol — 'Self-Patch': a cable loop whose jack plug points back into its own cut end.
Generates a single compound outline (fill only) so it can be cut as a sticker, embroidered, or exported to icons."""
import math, pathlib
from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union
from shapely import affinity

ROOT = pathlib.Path(__file__).resolve().parents[2]
C = 60.0; RO = 45.0; RI = 29.0

def plug_poly(x0, yc, segs, tip_len):
    """segs: list of (length, height). Tip: taper from last height to point over tip_len."""
    top, bot = [], []
    x = x0
    for L, h in segs:
        top += [(x, yc - h/2), (x + L, yc - h/2)]
        bot += [(x, yc + h/2), (x + L, yc + h/2)]
        x += L
    h = segs[-1][1]
    top.append((x + tip_len, yc)); 
    pts = top + list(reversed(bot))
    return Polygon(pts), x + tip_len

def build(detail=True, shape="circle"):
    RC = (RO + RI) / 2
    if shape == "circle":
        ring = Point(C, C).buffer(RO, 256).difference(Point(C, C).buffer(RI, 256))
    else:  # rounded square loop
        k = 17
        ring = box(C-RO+k, C-RO+k, C+RO-k, C+RO-k).buffer(k, 64).difference(box(C-RI+k-8, C-RI+k-8, C+RI-k+8, C+RI-k+8).buffer(k-8, 64))
    if detail:
        segs = [(15, 23), (2.6, 14), (12.5, 9.5), (2.2, 6.0), (4.4, 9.5)]; tip = 4.0; tipgap = 3.4
    else:
        segs = [(14, 26), (15, 14)]; tip = 7.0; tipgap = 5.0
    plen = sum(L for L, _ in segs) + tip
    gap = plen + tipgap
    yc = C + RC
    if shape == "circle":
        import math
        # choose gap endpoints on the ring centreline at y = C + RC*cos(phi)... solve half-chord = gap/2 around bottom
        half = gap / 2
        ang = math.degrees(math.asin(min(half / RC, 0.99)))
        # radial wedge cut between 90-ang and 90+ang
        wedge = Polygon([(C, C)] + [(C + 80*math.cos(math.radians(a)), C + 80*math.sin(math.radians(a))) for a in [90-ang + i*(2*ang)/32 for i in range(33)]])
        ring = ring.difference(wedge)
        xl = C - half; yc = C + RC*math.cos(math.radians(ang))
        # boot: taper from the tilted ring end into the plug sleeve
        boot = Polygon([(xl - 5, yc - 8.5), (xl + 4, yc - 11.5), (xl + 4, yc + 11.5), (xl - 3, yc + 8.5)])
    else:
        xl = C - gap/2
        ring = ring.difference(box(xl, C, C + gap/2, 130))
        boot = Polygon()
    plug, _ = plug_poly(xl + 1.5, yc, segs, tip)
    shape_g = unary_union([ring, plug, boot]).buffer(0)
    return shape_g, (xl, yc)

def to_path(geom):
    polys = [geom] if geom.geom_type == 'Polygon' else list(geom.geoms)
    out = []
    for p in polys:
        for ring in [p.exterior, *p.interiors]:
            coords = list(ring.coords)
            out.append("M" + " L".join(f"{x:.2f} {y:.2f}" for x, y in coords[:-1]) + "Z")
    return "".join(out)

def simplify_arcs(path):
    return path

if __name__ == "__main__":
    for name, detail, shp in [("feedback-symbol", True, "circle"), ("feedback-symbol-small", False, "circle"), ("x-symbol-square", True, "square")]:
        g, meta = build(detail, shp)
        g = g.simplify(0.02, preserve_topology=True)
        d = to_path(g)
        svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><title>FEEDBACK</title><path fill="currentColor" fill-rule="evenodd" d="{d}"/></svg>\n'
        (ROOT / "brand/logo" / f"{name}.svg").write_text(svg)
        print(name, len(svg), "bytes", meta)
