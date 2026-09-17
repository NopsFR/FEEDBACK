"""Textures for the Blender scenes: disc label print, jewel-case insert, scratch map. Rendered from brand vectors."""
import pathlib, re, subprocess, base64
R = pathlib.Path(__file__).resolve().parents[2]
T = R / "design/blender/textures"
SHOT = "/tmp/claude-0/-home-claude/1d950483-48d9-5797-a898-4a4a65c51f63/scratchpad/tools/shot.mjs"
def inline(p, css):
    t = (R / p).read_text(); vb = re.search(r'viewBox="([^"]+)"', t).group(1); body = re.sub(r'^<svg[^>]*>|</svg>\s*$', '', t.strip())
    return f'<svg viewBox="{vb}" style="{css}">{body}</svg>'
def png(p): return "data:image/png;base64," + base64.b64encode((R / p).read_bytes()).decode()
fontdir = R / ".fontdl/x"
fonts = f"@font-face{{font-family:Archivo;src:url(file://{fontdir}/fontsource-variable-archivo-5.3.0/package/files/archivo-latin-wdth-normal.woff2);font-weight:100 900;font-stretch:62% 125%}}"

# Disc label: printed top face, 2048 square, disc centred. Black ink on silver would be lost; use printed black face with paper ink.
ring_text = "MUSIC PEOPLE REPEAT · LOUDER THINGS LAST LONGER · " * 2
label = f"""<!doctype html><meta charset=utf-8><style>{fonts} body{{margin:0;width:2048px;height:2048px;background:#0b0b0b;position:relative;overflow:hidden}}
.tex{{position:absolute;inset:0;background:url({png('brand/textures/scratches-1600.png')}) center/140%;opacity:.12;mix-blend-mode:screen}}
.grain{{position:absolute;inset:0;background:url({png('brand/textures/grain-256.png')});opacity:.05}}
.c{{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}}
svg text{{font-family:Archivo;font-stretch:125%;font-weight:700;letter-spacing:10px;fill:#e6e1d6}}
</style>
<div class="c" style="width:1100px;top:30%">{inline('brand/logo/feedback-wordmark-worn.svg','width:100%;color:#e6e1d6;overflow:visible')}</div>
<div class="c" style="width:520px;top:73%">{inline('brand/logo/feedback-symbol-worn.svg','width:100%;color:#ff2a3a')}</div>
<svg class="c" width="2048" height="2048" viewBox="0 0 2048 2048"><defs><path id="p" d="M1024,1024 m-860,0 a860,860 0 1,1 1720,0 a860,860 0 1,1 -1720,0"/></defs>
<circle cx="1024" cy="1024" r="905" fill="none" stroke="#e6e1d6" stroke-width="3" opacity=".5"/><circle cx="1024" cy="1024" r="330" fill="none" stroke="#e6e1d6" stroke-width="2" opacity=".35"/>
<text font-size="46"><textPath href="#p">{ring_text}</textPath></text></svg>
<div class="tex"></div><div class="grain"></div>"""
(T / "_label.html").write_text(label)
# Insert: 1600 square front insert
insert = f"""<!doctype html><meta charset=utf-8><style>{fonts} body{{margin:0;width:1600px;height:1600px;background:#0a0a0a;position:relative;overflow:hidden;font-family:Archivo;color:#e6e1d6}}
.tex{{position:absolute;inset:0;background:url({png('brand/textures/scratches-1600.png')}) center/cover;opacity:.45;mix-blend-mode:screen}}
.leak{{position:absolute;right:-300px;top:-300px;width:1100px;height:900px;background:radial-gradient(closest-side,rgba(255,42,58,.4),transparent)}}
.lab{{font-stretch:112%;font-weight:600;letter-spacing:.5em;font-size:30px;text-transform:uppercase}}
</style><div class=leak></div>
<div style="position:absolute;left:50%;top:32%;transform:translate(-50%,-50%);width:520px">{inline('brand/logo/feedback-emblem.svg','width:100%;color:#e6e1d6')}</div>
<div style="position:absolute;left:50%;top:66%;transform:translate(-50%,-50%);width:1280px">{inline('brand/logo/feedback-wordmark-worn.svg','width:100%;color:#e6e1d6;overflow:visible')}</div>
<div class=lab style="position:absolute;left:0;right:0;top:79%;text-align:center">— Music people repeat —</div>
<div class=tex></div>"""
(T / "_insert.html").write_text(insert)
subprocess.run(["node", SHOT, str(T / "_label.html"), str(T / "disc-label.png"), "2048", "2048"], check=True)
subprocess.run(["node", SHOT, str(T / "_insert.html"), str(T / "insert-front.png"), "1600", "1600"], check=True)
from PIL import Image
Image.open(R / "brand/textures/scratches-1600.png").convert("RGBA").split()[3].save(T / "scratch-mask.png")
for f in ["_label.html", "_insert.html"]: (T / f).unlink()
print("ok")
