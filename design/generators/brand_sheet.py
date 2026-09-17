"""Render the brand sheet (brand/marketing/brand-sheet.png) from real brand sources via headless Chromium."""
import pathlib, re, subprocess, base64
R = pathlib.Path(__file__).resolve().parents[2]
F = R / ".fontdl/x"
def inline(p, w, extra=""):
    t = (R / p).read_text(); vb = re.search(r'viewBox="([^"]+)"', t).group(1); body = re.sub(r'^<svg[^>]*>|</svg>\s*$', '', t.strip())
    return f'<svg viewBox="{vb}" style="width:{w};height:auto;display:block;overflow:visible;{extra}">{body}</svg>'
def png(p): return "data:image/png;base64," + base64.b64encode((R / p).read_bytes()).decode()
fonts = f"""
@font-face{{font-family:Archivo;src:url(file://{F}/fontsource-variable-archivo-5.3.0/package/files/archivo-latin-wdth-normal.woff2);font-weight:100 900;font-stretch:62% 125%}}
@font-face{{font-family:Inter;src:url(file://{F}/fontsource-variable-inter-5.3.0/package/files/inter-latin-wght-normal.woff2);font-weight:100 900}}
@font-face{{font-family:Plex;src:url(file://{F}/fontsource-ibm-plex-mono-5.3.0/package/files/ibm-plex-mono-latin-400-normal.woff2)}}
@font-face{{font-family:Hand;src:url(file://{R}/node_modules/@fontsource/covered-by-your-grace/files/covered-by-your-grace-latin-400-normal.woff2)}}
"""
swatches = [("Charcoal black", "#0B0B0B"), ("Concrete", "#3A3A3A"), ("Worn chrome", "#A7A7A7"), ("Paper", "#E6E1D6"), ("Burgundy", "#8B0F1A"), ("Accent red", "#FF2A3A")]
sw = "".join(f'<div class=sw><div class=chip style="background:{c}"></div><b>{n}</b><span>{c}</span></div>' for n, c in swatches)
html = f"""<!doctype html><meta charset=utf-8><style>{fonts}
*{{box-sizing:border-box}} body{{margin:0;width:1840px;height:1380px;background:#070707;color:#e6e1d6;font-family:Inter;position:relative;overflow:hidden}}
.tex{{position:absolute;inset:0;background:url({png('brand/textures/scratches-1600.png')}) center/cover;opacity:.12;mix-blend-mode:screen}}
.leak{{position:absolute;left:-200px;top:-260px;width:900px;height:600px;background:radial-gradient(closest-side,rgba(255,42,58,.35),transparent);filter:blur(20px)}}
.lab{{font-family:Archivo;font-stretch:112%;font-weight:600;font-size:13px;letter-spacing:.22em;text-transform:uppercase;color:#a9a49a}}
.lab i{{font-style:normal;color:#ff2a3a;font-family:Plex;letter-spacing:0;margin-right:10px}}
.hand{{font-family:Hand;color:#cfc9bd}}
header{{position:absolute;left:0;right:0;top:70px;display:flex;flex-direction:column;align-items:center;gap:26px}}
.corner{{position:absolute;font-family:Archivo;font-stretch:112%;font-size:13px;letter-spacing:.3em;line-height:1.9;font-weight:560}}
.grid{{position:absolute;left:56px;right:56px;top:390px;bottom:56px;display:grid;grid-template-columns:1.05fr 1.1fr 1fr;grid-template-rows:1.25fr 1fr;border:1px solid #2c2c2c}}
.cell{{position:relative;border-right:1px solid #2c2c2c;border-bottom:1px solid #2c2c2c;padding:26px 30px}}
.sw{{display:flex;flex-direction:column;gap:6px;font-size:12px}} .sw b{{font-family:Archivo;font-stretch:112%;letter-spacing:.14em;font-size:11px;text-transform:uppercase}} .sw span{{font-family:Plex;color:#6f6c66}}
.chip{{height:78px;border:1px solid #2c2c2c}}
.center{{display:flex;flex-direction:column;align-items:center;justify-content:center;height:calc(100% - 20px);gap:18px}}
.ico{{width:190px;height:190px;border-radius:40px;box-shadow:0 30px 60px rgba(0,0,0,.6)}}
</style>
<div class=leak></div><div class=tex></div>
<div class=corner style="left:56px;top:62px">MUSIC<br>PEOPLE<br>REPEAT</div>
<div class=corner style="right:56px;top:62px;text-align:right">FEEDBACK<br>IDENTITY<br>V1.0</div>
<div class="hand" style="position:absolute;right:70px;top:190px;font-size:34px;transform:rotate(-8deg);line-height:1">louder things<br>last longer.</div>
<header>{inline('brand/logo/feedback-wordmark-worn.svg','980px')}<div class=lab style="letter-spacing:.5em;color:#e6e1d6">— &nbsp; Music people repeat &nbsp; —</div></header>
<div class=grid>
 <div class=cell style="grid-row:span 2"><div class=lab><i>01</i>Symbol / emblem</div>
   <div class=center>{inline('brand/logo/feedback-emblem.svg','360px')}<div class=lab style="color:#e6e1d6">Feedback</div></div></div>
 <div class=cell><div class=lab><i>02</i>Horizontal lockup</div><div class=center>{inline('brand/logo/lockups/feedback-lockup-horizontal.svg','520px')}</div></div>
 <div class=cell style="border-right:0"><div class=lab><i>04</i>App icons</div>
   <div class=center style="flex-direction:row;gap:36px"><img class=ico src="{png('brand/icons/master/icon-dark-rounded-1024.png')}" style="border-radius:0;box-shadow:none"><img class=ico src="{png('brand/icons/master/icon-red-rounded-1024.png')}" style="border-radius:0;box-shadow:none"></div></div>
 <div class=cell><div class=lab><i>03</i>Stacked lockup</div><div class=center>{inline('brand/logo/lockups/feedback-lockup-stacked.svg','300px')}</div></div>
 <div class=cell style="border-right:0"><div class=lab><i>05</i>Colour</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:22px">{sw}</div>
   <div class=lab style="margin-top:26px"><i>06</i>Type</div>
   <div style="font-family:Archivo;font-stretch:125%;font-weight:900;font-size:34px;margin-top:10px;text-transform:uppercase">Archivo Expanded</div>
   <div style="font-size:18px;margin-top:4px">Inter — readable interface text</div><div style="font-family:Plex;font-size:14px;color:#a9a49a;margin-top:4px">IBM PLEX MONO 03:41 · FLAC 24/44.1</div></div>
</div>"""
out = R / "design/svg/explorations/brand-sheet.html"; out.write_text(html)
subprocess.run(["node", "/tmp/claude-0/-home-claude/1d950483-48d9-5797-a898-4a4a65c51f63/scratchpad/tools/shot.mjs", str(out), str(R / "brand/marketing/brand-sheet.png"), "1840", "1380"], check=True)
print("ok")
