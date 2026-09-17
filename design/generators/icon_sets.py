"""Platform icon sets beyond `tauri icon`: small-size ICO frames with the favicon glyph, PWA icons, favicon, social avatar."""
import pathlib, subprocess, io
from PIL import Image
R = pathlib.Path(__file__).resolve().parents[2]
M = R / "brand/icons/master"
SHOT = "/tmp/claude-0/-home-claude/1d950483-48d9-5797-a898-4a4a65c51f63/scratchpad/tools/svgpng.mjs"
import re
glyph_small = re.search(r' d="([^"]+)"', (R / "brand/logo/feedback-favicon-glyph.svg").read_text()).group(1)
glyph_icon = re.search(r' d="([^"]+)"', (R / "brand/logo/feedback-icon-glyph.svg").read_text()).group(1)

def tile(d, radius, pad_scale=1.0, bg="#0B0B0B", fg="#ECE7DC", border=True):
    g = 120 * pad_scale
    off = (120 - g) / 2
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1c1c1c"/><stop offset="1" stop-color="{bg}"/></linearGradient></defs>
<rect x="2" y="2" width="116" height="116" rx="{radius}" fill="url(#g)"/>{'<rect x="2.75" y="2.75" width="114.5" height="114.5" rx="%s" fill="none" stroke="#3a3a3a" stroke-width="1.5"/>' % (radius - .75) if border else ''}
<path transform="translate({off} {off}) scale({pad_scale})" fill="{fg}" d="{d}"/></svg>'''

tmp = R / "design/svg/explorations/_icons"; tmp.mkdir(parents=True, exist_ok=True)
(tmp / "small.svg").write_text(tile(glyph_small, 22, 0.92))
(tmp / "maskable.svg").write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#0B0B0B"/><path transform="translate(24 24) scale(.6)" fill="#ECE7DC" d="{glyph_icon}"/></svg>')
(tmp / "adaptive-fg.svg").write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path transform="translate(27 27) scale(.55)" fill="#ECE7DC" d="{glyph_icon}"/></svg>')
jobs = [(tmp / "small.svg", tmp / "small-256.png", 256), (tmp / "maskable.svg", tmp / "maskable-512.png", 512), (tmp / "adaptive-fg.svg", tmp / "adaptive-fg-432.png", 432)]
subprocess.run(["node", SHOT, *[f"{a}::{b}::{s}" for a, b, s in jobs]], check=True)

small = Image.open(tmp / "small-256.png").convert("RGBA")
big = Image.open(M / "icon-dark-rounded-1024.png").convert("RGBA")
def frame(s):
    src = small if s <= 32 else big
    return src.resize((s, s), Image.LANCZOS)
out_tauri = R / "src-tauri/icons"
frames = [frame(s) for s in (16, 20, 24, 32, 40, 48, 64, 128, 256)]
frames[-1].save(out_tauri / "icon.ico", format="ICO", sizes=[(f.width, f.height) for f in frames], append_images=frames[:-1])
for s, name in [(32, "32x32.png"), (64, "64x64.png"), (128, "128x128.png"), (256, "128x128@2x.png"), (512, "icon.png")]:
    frame(s).save(out_tauri / name)

pub = R / "public"; (pub / "icons").mkdir(parents=True, exist_ok=True)
for s in (192, 512):
    big.resize((s, s), Image.LANCZOS).save(pub / f"icons/icon-{s}.png")
mask = Image.open(tmp / "maskable-512.png").convert("RGB")
mask.save(pub / "icons/maskable-512.png"); mask.resize((192, 192), Image.LANCZOS).save(pub / "icons/maskable-192.png")
sq = Image.open(M / "icon-dark-square-1024.png").convert("RGB")
sq.resize((180, 180), Image.LANCZOS).save(pub / "icons/apple-touch-icon.png")
frame(32).save(pub / "favicon-32.png")
(R / "brand/icons/android").mkdir(parents=True, exist_ok=True)
Image.open(tmp / "adaptive-fg-432.png").save(R / "brand/icons/android/ic_launcher_foreground.png")
Image.new("RGB", (432, 432), (11, 11, 11)).save(R / "brand/icons/android/ic_launcher_background.png")
(R / "brand/social").mkdir(parents=True, exist_ok=True)
sq.resize((800, 800), Image.LANCZOS).save(R / "brand/social/avatar-800.png")
print("icons ok")
