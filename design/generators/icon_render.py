"""Compose FEEDBACK app icons as SVG (texture via filters), render with headless Chromium to PNG masters."""
import pathlib, re, random, subprocess, sys
R = pathlib.Path(__file__).resolve().parents[2]
SHOT = sys.argv[1] if len(sys.argv) > 1 else None
def glyph_path(name):
    t = (R / "brand/logo" / name).read_text(); return re.search(r' d="([^"]+)"', t).group(1)

def scratches(seed, n, size):
    rnd = random.Random(seed); out = []
    for _ in range(n):
        x = rnd.uniform(0, size); y = rnd.uniform(0, size); L = rnd.uniform(20, 260); a = rnd.uniform(-.6, .6) if rnd.random() < .6 else rnd.uniform(0, 3.14)
        import math
        out.append(f'<line x1="{x:.0f}" y1="{y:.0f}" x2="{x + L*math.cos(a):.0f}" y2="{y + L*math.sin(a):.0f}" stroke="#fff" stroke-opacity="{rnd.uniform(.03,.11):.3f}" stroke-width="{rnd.uniform(.6,2.2):.1f}"/>')
    return "".join(out)

def icon_svg(variant="dark", shape="rounded", glyph="feedback-icon-glyph-worn.svg"):
    S = 1024; inset = 0 if shape == "square" else 44; rad = 0 if shape == "square" else 214
    red = variant == "red"
    gcol = "#FF2A3A" if red else "#ECE7DC"
    d = glyph_path(glyph)
    x0, w = inset, S - 2 * inset
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">
<defs>
 <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d1c1c"/><stop offset=".55" stop-color="#0d0d0d"/><stop offset="1" stop-color="#060606"/></linearGradient>
 <radialGradient id="leak" cx="{.92 if not red else .5}" cy="{.06 if not red else .5}" r="{.75 if not red else .6}"><stop offset="0" stop-color="#FF2A3A" stop-opacity="{.30 if not red else .28}"/><stop offset=".45" stop-color="#8B0F1A" stop-opacity="{.10 if not red else .12}"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
 <linearGradient id="bevel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bdbdbd" stop-opacity=".85"/><stop offset=".3" stop-color="#3a3a3a" stop-opacity=".6"/><stop offset=".7" stop-color="#1c1c1c" stop-opacity=".5"/><stop offset="1" stop-color="#7a2a30" stop-opacity=".8"/></linearGradient>
 <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .09 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
 <filter id="wear" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".055" numOctaves="4" seed="9" result="n"/><feOffset in="SourceGraphic" result="worn"/>
   <feGaussianBlur in="SourceAlpha" stdDeviation="{22 if red else 14}" result="b"/><feFlood flood-color="{'#FF2A3A' if red else '#ff6a70'}" flood-opacity="{.75 if red else .16}"/><feComposite in2="b" operator="in" result="glow"/><feMerge><feMergeNode in="glow"/><feMergeNode in="worn"/></feMerge></filter>
 <clipPath id="clip"><rect x="{x0}" y="{x0}" width="{w}" height="{w}" rx="{rad}"/></clipPath>
</defs>
<g clip-path="url(#clip)">
 <rect x="0" y="0" width="{S}" height="{S}" fill="url(#bg)"/>
 <rect x="0" y="0" width="{S}" height="{S}" fill="url(#leak)"/>
 <g>{scratches(21, 70, S)}</g>
 <rect x="0" y="0" width="{S}" height="{S}" fill="#000" filter="url(#grain)"/>
 <g filter="url(#wear)"><path transform="translate({S/2 - 60*6.9:.1f} {S/2 - 60*6.9:.1f}) scale(6.9)" fill="{gcol}" fill-rule="evenodd" d="{d}"/></g>
</g>
{'' if shape == 'square' else f'<rect x="{x0+3}" y="{x0+3}" width="{w-6}" height="{w-6}" rx="{rad-3}" fill="none" stroke="url(#bevel)" stroke-width="6"/><rect x="{x0+12}" y="{x0+12}" width="{w-24}" height="{w-24}" rx="{rad-12}" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="3"/>'}
</svg>'''

out = R / "brand/icons/master"
for variant in ["dark", "red"]:
    for shape in ["rounded", "square"]:
        (out / f"icon-{variant}-{shape}.svg").write_text(icon_svg(variant, shape))
(out / "favicon.svg").write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="26" fill="#0B0B0B"/><path fill="#ECE7DC" d="{glyph_path("feedback-favicon-glyph.svg")}"/></svg>')
print("ok")
