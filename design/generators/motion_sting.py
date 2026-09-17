"""Motion logo sting (3.2 s): carrier line → spikes swell → misregistered wordmark snaps into register → hold.
Rendered frame-by-frame in headless Chromium (Web Animations seeked per frame), encoded with ffmpeg."""
import pathlib, re, subprocess, json
R = pathlib.Path(__file__).resolve().parents[2]
F = R / ".fontdl/x"
def inner(p):
    t = (R / p).read_text(); vb = re.search(r'viewBox="([^"]+)"', t).group(1); d = re.search(r' d="([^"]+)"', t).group(1); return vb, d
wvb, wd = inner("brand/logo/feedback-wordmark-worn.svg")
UPS = [6, 13, 22, 34, 54, 30, 38, 18, 8]; DOWNS = [5, 12, 26, 30, 46, 36, 24, 16, 7]
spikes = []
for i, u in enumerate(UPS):
    x = 60 - 37 + i / 8 * 74; ww = 11.5 * (0.7 + 0.3 * min(1, (u + DOWNS[i]) / 100 * 2))
    spikes.append(f'<polygon class="sp" data-i="{i}" points="{x-ww/2},60 {x},{60-u} {x+ww/2},60 {x},{60+DOWNS[i]}"/>')
html = f"""<!doctype html><meta charset=utf-8><style>
body{{margin:0;width:1920px;height:1080px;background:#050505;overflow:hidden;position:relative}}
.tex{{position:absolute;inset:0;background:url(file://{R}/brand/textures/scratches-1600.png) center/cover;opacity:.08;mix-blend-mode:screen}}
.leak{{position:absolute;left:-300px;top:-400px;width:1300px;height:1000px;background:radial-gradient(closest-side,rgba(255,42,58,.28),transparent)}}
.c{{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:54px}}
svg.b{{width:260px;height:260px;overflow:visible}} .sp,.car{{fill:#e6e1d6;transform-box:fill-box;transform-origin:center}}
.car{{transform-origin:60px 60px}}
.m{{position:relative;width:1080px;aspect-ratio:{wvb.split()[2]}/{wvb.split()[3]}}} .m svg{{position:absolute;inset:0;width:100%;height:100%;overflow:visible}}
</style><div class=leak></div>
<div class=c><svg class=b viewBox="0 0 120 120"><rect class="car" x="0" y="58.2" width="120" height="3.6"></rect>{''.join(spikes)}</svg>
<div class=m><svg id=red viewBox="{wvb}" style="color:#ff2a3a;mix-blend-mode:screen"><path fill="currentColor" d="{wd}"/></svg><svg id=paper viewBox="{wvb}" style="color:#e6e1d6"><path fill="currentColor" d="{wd}"/></svg></div></div>
<div class=tex></div>
<script>
const E='cubic-bezier(.3,1.4,.4,1)';
document.querySelector('.car').animate([{{transform:'scaleX(0)',opacity:.2}},{{transform:'scaleX(1.3)',opacity:1,offset:.6}},{{transform:'scaleX(1)',opacity:1}}],{{duration:520,fill:'both',easing:'cubic-bezier(.2,.8,.2,1)'}});
document.querySelectorAll('.sp').forEach(s=>{{const i=+s.dataset.i; s.animate([{{transform:'scaleY(0)'}},{{transform:'scaleY(1.35)',offset:.55}},{{transform:'scaleY(.88)',offset:.75}},{{transform:'scaleY(1)'}}],{{duration:620,delay:260+Math.abs(i-4)*70,fill:'both',easing:E}});}});
for (const [id,dx,dy,delay,fade] of [['red',-14,6,1150,true],['paper',10,-4,1230,false]]) {{
  const el=document.getElementById(id);
  el.animate([{{clipPath:'inset(0 100% 0 0)'}},{{clipPath:'inset(0 0 0 0)'}}],{{duration:560,delay,fill:'both',easing:'cubic-bezier(.7,0,.2,1)'}});
  el.animate([{{transform:`translate(${{dx}}px,${{dy}}px)`,opacity:1}},{{transform:`translate(${{dx/3}}px,${{dy/3}}px)`,opacity:1,offset:.7}},{{transform:'translate(0,0)',opacity:fade?0:1}}],{{duration:1000,delay,fill:'both',easing:'cubic-bezier(.2,.8,.2,1)'}});
}}
document.getAnimations().forEach(a=>a.pause());
window.seek=(t)=>document.getAnimations().forEach(a=>a.currentTime=t);
</script>"""
page = R / "design/motion/logo-sting.html"; page.write_text(html)
frames = pathlib.Path("/tmp/sting"); frames.mkdir(exist_ok=True)
for f in frames.glob("*.png"): f.unlink()
js = f"""
import {{ chromium }} from 'playwright-core';
const b = await chromium.launch({{ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }});
const p = await b.newPage({{ viewport: {{ width: 1920, height: 1080 }} }});
await p.goto('file://{page}'); await p.waitForTimeout(500);
for (let i = 0; i < 96; i++) {{ await p.evaluate((t) => window.seek(t), i * 1000 / 30); await p.screenshot({{ path: '/tmp/sting/f' + String(i).padStart(4, '0') + '.png' }}); }}
await b.close();
"""
tool = pathlib.Path("/tmp/claude-0/-home-claude/1d950483-48d9-5797-a898-4a4a65c51f63/scratchpad/tools/sting.mjs"); tool.write_text(js)
subprocess.run(["node", str(tool)], check=True)
out = R / "brand/motion"
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "30", "-i", "/tmp/sting/f%04d.png", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", str(out / "feedback-sting-1080p.mp4")], check=True)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "30", "-i", "/tmp/sting/f%04d.png", "-vf", "scale=960:-1", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", str(out / "feedback-sting-960.webm")], check=False)
subprocess.run(["cp", "/tmp/sting/f0095.png", str(out / "feedback-sting-endframe.png")], check=True)
print("sting ok")
