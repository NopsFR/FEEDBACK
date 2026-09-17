"""Extract flattened glyph outlines from Archivo (OFL) at a given instance, as shapely geometry on a 100-unit cap height."""
import pathlib
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.basePen import BasePen
from shapely.geometry import Polygon
from shapely.ops import unary_union
ROOT = pathlib.Path(__file__).resolve().parents[2]
_cache = {}

class FlatPen(BasePen):
    def __init__(self, gs, steps=24):
        super().__init__(gs); self.contours = []; self.cur = []; self.steps = steps
    def _moveTo(self, p): self.cur = [p]
    def _lineTo(self, p): self.cur.append(p)
    def _curveToOne(self, p1, p2, p3):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps; u = 1 - t
            self.cur.append((u**3*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t**3*p3[0], u**3*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t**3*p3[1]))
    def _qCurveToOne(self, p1, p2):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps; u = 1 - t
            self.cur.append((u*u*p0[0] + 2*u*t*p1[0] + t*t*p2[0], u*u*p0[1] + 2*u*t*p1[1] + t*t*p2[1]))
    def _closePath(self):
        if len(self.cur) > 2: self.contours.append(self.cur)
        self.cur = []
    _endPath = _closePath

def font(wght=900, wdth=125):
    key = (wght, wdth)
    if key not in _cache:
        f = TTFont(ROOT / "design/fonts-src/archivo-latin-wdth-normal.woff2")
        _cache[key] = instancer.instantiateVariableFont(f, {"wght": wght, "wdth": wdth})
    return _cache[key]

def glyph(ch, wght=900, wdth=125):
    f = font(wght, wdth)
    cap = f['OS/2'].sCapHeight
    name = f.getBestCmap()[ord(ch)]
    gs = f.getGlyphSet(); pen = FlatPen(gs); gs[name].draw(pen)
    k = 100.0 / cap
    geom = None
    for c in pen.contours:
        poly = Polygon([(x * k, (cap - y) * k) for x, y in c]).buffer(0)
        geom = poly if geom is None else geom.symmetric_difference(poly)
    adv = f['hmtx'][name][0] * k
    return geom, adv

def kern(a, b):
    return 0.0
