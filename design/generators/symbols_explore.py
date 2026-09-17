"""FEEDBACK symbol explorations. Each returns SVG inner markup in a 0..100 box, fill/stroke = currentColor."""
import math, pathlib
OUT = pathlib.Path(__file__).resolve().parents[1] / "svg" / "explorations"

def pt(cx, cy, r, deg):
    a = math.radians(deg); return (cx + r*math.cos(a), cy + r*math.sin(a))

def arc(cx, cy, r, a0, a1, sweep):
    x0,y0 = pt(cx,cy,r,a0); x1,y1 = pt(cx,cy,r,a1)
    span = (a1-a0) % 360 if sweep else (a0-a1) % 360
    large = 1 if span > 180 else 0
    return f"M{x0:.2f} {y0:.2f} A{r} {r} 0 {large} {1 if sweep else 0} {x1:.2f} {y1:.2f}"

def plug(x, y, deg, w):
    """1/4in TS jack silhouette starting at x,y heading deg. Returns polygon path. w = cable width."""
    ux, uy = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    nx, ny = -uy, ux
    # (distance along, half-width) profile
    prof = [(0, w*0.5), (1.5, w*0.62), (13, w*0.62), (13, w*0.30), (21, w*0.30), (21, w*0.18), (22.5, w*0.18), (22.5, w*0.30), (25, w*0.30), (27, w*0.08), (27.6, 0)]
    left = [(x+ux*d+nx*h, y+uy*d+ny*h) for d,h in prof]
    right = [(x+ux*d-nx*h, y+uy*d-ny*h) for d,h in reversed(prof)]
    pts = left+right
    return "M" + " L".join(f"{a:.2f} {b:.2f}" for a,b in pts) + " Z"

def A_selfpatch():
    W=14; R=31; cx=cy=50
    a_end=78; b_end=8  # plug end at 78deg, cable end at 8deg ; arc goes the long way
    d = arc(cx,cy,R,b_end,a_end,0)  # counter-clockwise long way from b to a
    ax, ay = pt(cx,cy,R,a_end)
    tdeg = a_end - 90 - 0  # tangent direction continuing counter-clockwise? compute
    t = math.degrees(math.atan2(-math.cos(math.radians(a_end)), math.sin(math.radians(a_end))))
    return f'<path d="{d}" fill="none" stroke="currentColor" stroke-width="{W}" stroke-linecap="butt"/><path d="{plug(ax,ay,t,W)}" fill="currentColor"/>'

def B_cone_return():
    # speaker cone: surround ring broken; the break feeds a spiral into the dust cap
    s = []
    s.append(f'<path d="{arc(50,50,40,-50,230,1)}" fill="none" stroke="currentColor" stroke-width="10"/>')
    # inward return: from 230deg on r40 curve to r22
    x0,y0 = pt(50,50,40,230); x1,y1 = pt(50,50,22,300)
    s.append(f'<path d="M{x0:.2f} {y0:.2f} C {x0+6:.2f} {y0-18:.2f} {x1-14:.2f} {y1-6:.2f} {x1:.2f} {y1:.2f}" fill="none" stroke="currentColor" stroke-width="10"/>')
    s.append(f'<path d="{arc(50,50,22,300,210,1)}" fill="none" stroke="currentColor" stroke-width="7"/>')
    s.append('<circle cx="50" cy="50" r="8" fill="currentColor"/>')
    return "".join(s)

def C_coil():
    # roadie over-under coil seen from above + tail with plug
    s=[]
    for i,(cx,cy,r) in enumerate([(44,46,26),(52,50,26),(48,56,24)]):
        s.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#0000" stroke-width="12"/>')
    s.append('<path d="M20 50 C20 22 70 18 76 44 C82 70 40 84 26 64 C14 46 50 26 70 38 C86 50 66 86 44 80" fill="none" stroke="var(--bg,#111)" stroke-width="17" stroke-linecap="round"/>')
    s.append('<path d="M20 50 C20 22 70 18 76 44 C82 70 40 84 26 64 C14 46 50 26 70 38 C86 50 66 86 44 80" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>')
    s.append(f'<path d="{plug(44,80,180,9)}" fill="currentColor"/>')
    return "".join(s)

def D_cable_F():
    # F drawn as one cable: up the stem, right along top, loops back over itself to form the middle arm
    W=13
    d = "M30 94 V14 H76 C88 14 88 40 76 40 H50 C42 40 40 48 40 54 H64"
    return f'<path d="{d}" fill="none" stroke="currentColor" stroke-width="{W}" stroke-linejoin="miter"/>'

def E_gap_ring():
    # heavy ring interrupted twice; one fragment displaced outward: signal leaving and re-entering
    s=[]
    s.append(f'<path d="{arc(50,50,32,20,160,1)}" fill="none" stroke="currentColor" stroke-width="16"/>')
    s.append(f'<path d="{arc(50,50,32,172,348,1)}" fill="none" stroke="currentColor" stroke-width="16" transform="translate(0,-5)"/>')
    s.append('<rect x="45" y="44" width="10" height="10" fill="currentColor"/>')
    return "".join(s)

def F_cone_front():
    # front of a speaker: surround, cone, dust cap; one quadrant of the surround pulled outward (the howl)
    s=[]
    s.append(f'<path d="{arc(50,50,36,-10,260,1)}" fill="none" stroke="currentColor" stroke-width="12"/>')
    s.append(f'<path d="{arc(50,50,43,268,352,1)}" fill="none" stroke="currentColor" stroke-width="12"/>')
    s.append('<circle cx="50" cy="50" r="14" fill="currentColor"/>')
    return "".join(s)

DIRS = [("A · Self-patch", A_selfpatch, "A cable plugged back into itself. The gap is the moment before the howl."),
        ("B · Cone return", B_cone_return, "Speaker surround breaks and spirals back into the dust cap."),
        ("C · Coil", C_coil, "Over-under cable coil, end of the night."),
        ("D · Cable F", D_cable_F, "An F routed like a patch lead."),
        ("E · Split ring", E_gap_ring, "A ring knocked out of registration."),
        ("F · Pushed cone", F_cone_front, "Surround pushed out of the cabinet by the signal.")]

def sheet():
    cells=[]
    for i,(name,fn,note) in enumerate(DIRS):
        inner = fn()
        cells.append(f'''<figure><div class="big"><svg viewBox="0 0 100 100">{inner}</svg></div>
<div class="row"><svg class="s64" viewBox="0 0 100 100">{inner}</svg><svg class="s32" viewBox="0 0 100 100">{inner}</svg><svg class="s16" viewBox="0 0 100 100">{inner}</svg>
<div class="paper"><svg class="s64" viewBox="0 0 100 100">{inner}</svg></div></div>
<figcaption><b>{name}</b><span>{note}</span></figcaption></figure>''')
        (OUT/f"symbol-{name[0].lower()}.svg").write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" color="#e9e6df">{inner}</svg>')
    html = f'''<!doctype html><meta charset=utf-8><style>
body{{margin:0;background:#141312;color:#e9e6df;font:14px system-ui;padding:32px}}
.grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:28px}}
figure{{margin:0;border-top:1px solid #3a3733;padding-top:16px}}
.big svg{{width:260px;height:260px;display:block}} .row{{display:flex;gap:16px;align-items:end;margin-top:12px}}
.s64{{width:64px;height:64px}} .s32{{width:32px;height:32px}} .s16{{width:16px;height:16px}}
.paper{{background:#e6e1d6;color:#161514;padding:6px;--bg:#e6e1d6}}
figcaption{{display:flex;flex-direction:column;gap:4px;margin-top:10px}} figcaption span{{color:#9c968c}}
</style><div class="grid">{"".join(cells)}</div>'''
    (OUT/"sheet.html").write_text(html)
sheet()
