"""Lockups: horizontal (symbol + wordmark), stacked (FEED / B-spike-CK), tagline. Text converted to outlines."""
import pathlib
from shapely.ops import unary_union
from shapely import affinity
from shapely.geometry import box
from glyphs import glyph
from symbol_master import to_path
import brand_v2 as B

OUT = B.LOGO / "lockups"
OUT.mkdir(exist_ok=True)

def text_outline(txt, wght=620, wdth=112, tracking=0.18, cap=100):
    x = 0.0; parts = []
    for ch in txt:
        if ch == " ":
            x += 32 + tracking * 100; continue
        g, adv = glyph(ch, wght, wdth)
        parts.append(affinity.translate(g, x, 0)); x += adv + tracking * 100
    g = unary_union(parts)
    return affinity.scale(g, cap / 100, cap / 100, origin=(0, 0)), (x - tracking * 100) * cap / 100

def save(name, geom, pad=0):
    minx, miny, maxx, maxy = geom.bounds
    geom = affinity.translate(geom, -minx + pad, -miny + pad)
    w, h = maxx - minx + 2 * pad, maxy - miny + 2 * pad
    (OUT / name).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.1f} {h:.1f}"><title>FEEDBACK</title><path fill="currentColor" fill-rule="evenodd" d="{to_path(geom.simplify(0.03))}"/></svg>\n')
    print(name, round(w), round(h))

wm, (ww, wh), base = B.wordmark()
sym = B.symbol()

# horizontal: symbol scaled to wordmark height, gap = 0.4 cap
s_h = affinity.scale(sym, 1.55, 1.55, origin=(0, 0))
sminx, sminy, smaxx, smaxy = s_h.bounds
s_h = affinity.translate(s_h, -sminx, (wh / 2) - (sminy + smaxy) / 2)
wm_h = affinity.translate(wm, (smaxx - sminx) + 44, 0)
save("feedback-lockup-horizontal.svg", unary_union([s_h, wm_h]))

# tagline: wordmark over rule + spaced caps
tag, tw = text_outline("MUSIC PEOPLE REPEAT", cap=22, tracking=0.34)
tag = affinity.translate(tag, (ww - tw) / 2, wh + 34)
rule_y = wh + 34 + 11
rules = unary_union([box((ww - tw) / 2 - 150, rule_y - 1.2, (ww - tw) / 2 - 36, rule_y + 1.2), box((ww + tw) / 2 + 36, rule_y - 1.2, (ww + tw) / 2 + 150, rule_y + 1.2)])
save("feedback-lockup-tagline.svg", unary_union([wm, tag, rules]))

# stacked: FEED / B~CK using the wordmark geometry split at the D/B boundary
minx, miny, maxx, maxy = wm.bounds
# find the x where B starts: glyph advances
x = 0.0; cut = None
for ch in "FEED":
    _, adv = glyph(ch); x += adv - 7.0
cut = x - 2
top = wm.intersection(box(minx - 1, miny - 1, cut, maxy + 1))
bottom = wm.intersection(box(cut, miny - 1, maxx + 1, maxy + 1))
bminx = bottom.bounds[0]
bottom = affinity.translate(bottom, -bminx, 0)
tminx, tminy, tmaxx, tmaxy = top.bounds
bw = bottom.bounds[2] - bottom.bounds[0]
top = affinity.translate(top, (bw - (tmaxx - tminx)) / 2 - tminx, -(base) * 0.0)
bottom = affinity.translate(bottom, 0, 150)
save("feedback-lockup-stacked.svg", unary_union([top, bottom]))
