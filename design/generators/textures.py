"""FEEDBACK texture set (all generated, tileable where noted)."""
import numpy as np, pathlib, math, random
from PIL import Image, ImageDraw, ImageFilter
R = pathlib.Path(__file__).resolve().parents[2]
rng = np.random.default_rng(7)

def save(img, *paths):
    for p in paths:
        p = R / p; p.parent.mkdir(parents=True, exist_ok=True); img.save(p, optimize=True)

# 1. grain: tileable white noise with slight clumping, RGBA (white, alpha = noise)
n = rng.normal(0, 1, (256, 256))
n = np.real(np.fft.ifft2(np.fft.fft2(n) * np.exp(-((np.fft.fftfreq(256)[:, None]**2 + np.fft.fftfreq(256)[None, :]**2) * 3000))))  # soft clumps
n = (n - n.min()) / (n.max() - n.min())
fine = rng.random((256, 256))
v = np.clip(0.55 * fine + 0.45 * n, 0, 1)
g = (v * 255).astype(np.uint8)
save(Image.fromarray(np.dstack([np.full_like(g, 255)] * 3 + [g]), "RGBA"), "src/assets/textures/grain.png", "brand/textures/grain-256.png")

# 2. scratches: large transparent overlay of fine scratches (non-tile), 1600x1000
S = (1600, 1000); im = Image.new("L", S, 0); d = ImageDraw.Draw(im); rnd = random.Random(3)
for _ in range(900):
    x, y = rnd.uniform(0, S[0]), rnd.uniform(0, S[1]); L = rnd.expovariate(1 / 60) + 6; a = rnd.gauss(-.25, .5)
    pts = []; cx, cy = x, y
    for i in range(6):
        pts.append((cx, cy)); a += rnd.gauss(0, .08); cx += math.cos(a) * L / 6; cy += math.sin(a) * L / 6
    d.line(pts, fill=rnd.randint(40, 190), width=1)
for _ in range(2500):
    x, y = rnd.uniform(0, S[0]), rnd.uniform(0, S[1]); r = rnd.choice([0.5, 0.8, 1.2])
    d.ellipse([x - r, y - r, x + r, y + r], fill=rnd.randint(60, 200))
im = im.filter(ImageFilter.GaussianBlur(0.35))
a = np.array(im)
save(Image.fromarray(np.dstack([np.full_like(a, 255)] * 3 + [a]), "RGBA"), "src/assets/textures/scratches.png", "brand/textures/scratches-1600.png")

# 3. toner: photocopy speckle on paper-coloured base (for brand sheets / empty states)
T = 1024
base = np.full((T, T, 3), (217, 212, 199), np.float32)
low = np.array(Image.fromarray((rng.random((64, 64)) * 255).astype(np.uint8)).resize((T, T), Image.BICUBIC), np.float32) / 255
spk = rng.random((T, T))
dark = ((spk > 0.985) | ((spk > 0.93) & (low > 0.72))).astype(np.float32)
paper = base * (0.93 + 0.07 * low[..., None]) * (1 - 0.85 * dark[..., None])
save(Image.fromarray(np.clip(paper, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.4)), "brand/textures/paper-toner-1024.png")

# 4. black denim / washed fabric: tileable diagonal twill
W = 512; yy, xx = np.mgrid[0:W, 0:W]
twill = (np.sin((xx + yy) * 2 * math.pi / 6) * 0.5 + 0.5) * 0.35 + rng.random((W, W)) * 0.65
wash = np.array(Image.fromarray((rng.random((16, 16)) * 255).astype(np.uint8)).resize((W, W), Image.BICUBIC), np.float32) / 255
val = 10 + twill * 14 + wash * 10
save(Image.fromarray(np.clip(np.dstack([val, val, val * 1.02]), 0, 255).astype(np.uint8)), "brand/textures/washed-black-512.png", "src/assets/textures/washed-black.png")

# 5. speaker mesh: tileable hex-perforated dark grille, RGBA
M = 96; mesh = Image.new("RGBA", (M, M), (0, 0, 0, 0)); d = ImageDraw.Draw(mesh)
for row in range(-1, 9):
    for col in range(-1, 9):
        cx = col * 12 + (6 if row % 2 else 0); cy = row * 12
        d.ellipse([cx - 3.6, cy - 3.6, cx + 3.6, cy + 3.6], fill=(0, 0, 0, 255))
save(mesh, "brand/textures/speaker-mesh-96.png", "src/assets/textures/speaker-mesh.png")
print("textures ok")
