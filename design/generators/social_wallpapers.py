"""Social header, Open Graph image and wallpapers composed from the renders + brand vectors."""
import pathlib, re, subprocess
R = pathlib.Path(__file__).resolve().parents[2]
F = R / ".fontdl/x"
SHOT = "/tmp/claude-0/-home-claude/1d950483-48d9-5797-a898-4a4a65c51f63/scratchpad/tools/shot.mjs"
def svg(p, css):
    t = (R / p).read_text(); vb = re.search(r'viewBox="([^"]+)"', t).group(1); d = re.search(r' d="([^"]+)"', t).group(1)
    return f'<svg viewBox="{vb}" style="{css}"><path fill="currentColor" fill-rule="evenodd" d="{d}"/></svg>'
fonts = f"""@font-face{{font-family:Archivo;src:url(file://{F}/fontsource-variable-archivo-5.3.0/package/files/archivo-latin-wdth-normal.woff2);font-weight:100 900;font-stretch:62% 125%}}
@font-face{{font-family:Hand;src:url(file://{R}/node_modules/@fontsource/covered-by-your-grace/files/covered-by-your-grace-latin-400-normal.woff2)}}"""
base = f"""<!doctype html><meta charset=utf-8><style>{fonts}
body{{margin:0;background:#050505;color:#e6e1d6;overflow:hidden;position:relative;font-family:Archivo}}
.bg{{position:absolute;inset:0;background-size:cover;background-position:center}}
.shade{{position:absolute;inset:0}}
.tex{{position:absolute;inset:0;background:url(file://{R}/brand/textures/scratches-1600.png) center/cover;opacity:.08;mix-blend-mode:screen}}
.lab{{font-stretch:112%;font-weight:600;letter-spacing:.42em;text-transform:uppercase}}
.hand{{font-family:Hand;color:#cfc9bd}}
</style>"""
jobs = []
def job(name, w, h, body):
    p = R / f"design/svg/explorations/_{name.replace(chr(47), chr(95))}.html"; p.write_text(base + f"<style>body{{width:{w}px;height:{h}px}}</style>" + body)
    jobs.append((p, R / name, w, h))

still = f"file://{R}/brand/marketing/renders/stilllife-hero.png"
disc = f"file://{R}/brand/marketing/renders/disc-hero.png"
case = f"file://{R}/brand/marketing/renders/jewelcase-cable.png"

job("brand/social/header-1500x500.png", 1500, 500, f"""<div class=bg style="background-image:url({disc});background-position:70% 40%"></div>
<div class=shade style="background:linear-gradient(90deg,#050505 30%,rgba(5,5,5,.82) 55%,rgba(5,5,5,.55))"></div><div class=tex></div>
<div style="position:absolute;left:80px;top:150px;width:620px">{svg('brand/logo/feedback-wordmark-worn.svg','width:100%;color:#e6e1d6;overflow:visible')}
<div class=lab style="font-size:15px;margin-top:34px">Music people repeat</div></div>""")

job("brand/social/og-1200x630.png", 1200, 630, f"""<div class=bg style="background-image:url({still})"></div>
<div class=shade style="background:linear-gradient(0deg,#050505 30%,rgba(5,5,5,.75) 50%,rgba(5,5,5,.35) 75%,rgba(5,5,5,.6))"></div><div class=tex></div>
<div style="position:absolute;left:0;right:0;bottom:70px;display:flex;flex-direction:column;align-items:center">{svg('brand/logo/feedback-wordmark-worn.svg','width:720px;color:#e6e1d6;overflow:visible')}
<div class=lab style="font-size:14px;margin-top:26px">A player for the music you own</div></div>""")

job("brand/wallpapers/desktop-2560x1440.png", 2560, 1440, f"""<div class=bg style="background-image:url({still})"></div>
<div class=shade style="background:radial-gradient(80% 60% at 50% 40%,transparent,rgba(5,5,5,.7))"></div><div class=tex></div>
<div style="position:absolute;left:120px;bottom:110px;width:460px;opacity:.9">{svg('brand/logo/feedback-wordmark.svg','width:100%;color:#e6e1d6;overflow:visible')}</div>
<div class=hand style="position:absolute;right:140px;bottom:120px;font-size:44px;transform:rotate(-5deg)">louder things last longer.</div>""")

job("brand/wallpapers/phone-1290x2796.png", 1290, 2796, f"""<div class=bg style="background-image:url({disc});background-size:auto 100%;background-position:44% 50%"></div>
<div class=shade style="background:linear-gradient(180deg,rgba(5,5,5,.85),transparent 30%,transparent 60%,#050505 92%)"></div><div class=tex></div>
<div style="position:absolute;left:0;right:0;bottom:330px;display:flex;justify-content:center">{svg('brand/logo/feedback-symbol.svg','width:220px;color:#e6e1d6')}</div>""")

for page, out, w, h in jobs:
    subprocess.run(["node", SHOT, str(page), str(out), str(w), str(h)], check=True)
    page.unlink()
print("ok")
