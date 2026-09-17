import math, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from symbols_explore import pt, arc, plug, OUT

def chord_plug_ring(R=31, W=14, gap=56, center_gap=40, socket=False, plug_scale=1.0, tipgap=2.5):
    cx=cy=50
    a = center_gap + gap/2   # plug end (clockwise side)
    b = center_gap - gap/2   # cable end
    ring = arc(cx,cy,R,b,a,0)
    ax,ay = pt(cx,cy,R,a); bx,by = pt(cx,cy,R,b)
    deg = math.degrees(math.atan2(by-ay, bx-ax))
    L = math.hypot(bx-ax, by-ay)
    s = []
    s.append(f'<path d="{ring}" fill="none" stroke="currentColor" stroke-width="{W}"/>')
    # scale plug profile to fit chord minus tip gap
    k = (L - tipgap - (6 if socket else 0)) / 27.6
    ux,uy = math.cos(math.radians(deg)), math.sin(math.radians(deg)); nx,ny=-uy,ux
    prof = [(0, .50), (1.5, .64), (13, .64), (13, .30), (21, .30), (21, .17), (22.6, .17), (22.6, .30), (25, .30), (27, .08), (27.6, 0)]
    left=[(ax+ux*d*k+nx*h*W, ay+uy*d*k+ny*h*W) for d,h in prof]
    right=[(ax+ux*d*k-nx*h*W, ay+uy*d*k-ny*h*W) for d,h in reversed(prof)]
    # boot: fill the kink between ring end and plug so it reads as one moulded piece
    tx,ty = math.cos(math.radians(a))*0, 0
    s.append('<path d="M' + " L".join(f"{p:.2f} {q:.2f}" for p,q in left+right) + ' Z" fill="currentColor"/>')
    s.append(f'<circle cx="{ax:.2f}" cy="{ay:.2f}" r="{W/2:.2f}" fill="currentColor"/>')
    if socket:
        # female barrel on the cable end, pointing back at the plug
        d2 = deg+180; vx,vy=math.cos(math.radians(d2)),math.sin(math.radians(d2)); mx,my=-vy,vx
        sp=[(0,.5),(0,.62),(7,.62),(7,0)]
        l2=[(bx+vx*d+mx*h*W, by+vy*d+my*h*W) for d,h in sp]; r2=[(bx+vx*d-mx*h*W, by+vy*d-my*h*W) for d,h in reversed(sp)]
        s.append('<path d="M' + " L".join(f"{p:.2f} {q:.2f}" for p,q in l2+r2) + ' Z" fill="currentColor"/>')
        s.append(f'<circle cx="{bx:.2f}" cy="{by:.2f}" r="{W/2:.2f}" fill="currentColor"/>')
    return "".join(s)

V = [
 ("A1 · gap lower-right", lambda: chord_plug_ring(gap=58, center_gap=40)),
 ("A2 · gap right", lambda: chord_plug_ring(gap=58, center_gap=0)),
 ("A3 · gap top-right, heavy", lambda: chord_plug_ring(W=17, R=30, gap=64, center_gap=-45)),
 ("A4 · with socket", lambda: chord_plug_ring(gap=70, center_gap=40, socket=True)),
 ("A5 · gap bottom", lambda: chord_plug_ring(W=16, R=30, gap=62, center_gap=90)),
 ("A6 · tight gap, heavy", lambda: chord_plug_ring(W=18, R=29, gap=50, center_gap=35, tipgap=1.5)),
]
cells=[]
for name,fn in V:
    inner=fn()
    cells.append(f'''<figure><div class="big"><svg viewBox="0 0 100 100">{inner}</svg></div>
<div class="row"><svg class="s64" viewBox="0 0 100 100">{inner}</svg><svg class="s32" viewBox="0 0 100 100">{inner}</svg><svg class="s16" viewBox="0 0 100 100">{inner}</svg>
<div class="paper"><svg class="s64" viewBox="0 0 100 100">{inner}</svg></div><div class="wine"><svg class="s48" viewBox="0 0 100 100">{inner}</svg></div></div><figcaption><b>{name}</b></figcaption></figure>''')
html=f'''<!doctype html><meta charset=utf-8><style>body{{margin:0;background:#141312;color:#e9e6df;font:14px system-ui;padding:32px}}
.grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:28px}}figure{{margin:0;border-top:1px solid #3a3733;padding-top:16px}}
.big svg{{width:240px;height:240px;display:block}}.row{{display:flex;gap:14px;align-items:end;margin-top:12px}}
.s64{{width:64px;height:64px}}.s48{{width:48px;height:48px}}.s32{{width:32px;height:32px}}.s16{{width:16px;height:16px}}
.paper{{background:#e6e1d6;color:#161514;padding:6px}}.wine{{background:#4a1822;color:#efe9e1;padding:8px;border-radius:12px}}</style><div class="grid">{"".join(cells)}</div>'''
(OUT/"sheet-refine.html").write_text(html)
