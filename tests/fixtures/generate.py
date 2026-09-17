"""Generate a small dev/test library: synthesized audio (original, generated here), tagged, with generated cover art.
All band/album names are invented for testing. Output: tests/fixtures/library (git-ignored)."""
import math, pathlib, random, subprocess, shutil
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops

ROOT = pathlib.Path(__file__).parent / "library"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
random.seed(42)

ALBUMS = [
    ("Velvet Tinnitus", "Rooms We Left Loud", 2004, "Post-Hardcore", ["Carpet Burn", "Static on the Stairs", "Letters to a Broken Amp", "Oxbow", "Every Light in the House", "Paper Crown", "Southbound Choir", "Rust Belt Lullaby"], (139, 15, 26), "mp3"),
    ("Hollow Arcade", "Nightbus Hymns", 2007, "Emo", ["Last Stop Before Morning", "Coin Slot Heart", "Neon Tetra", "Cassette Weather", "We Were the Fire Drill", "Heatsink"], (60, 80, 140), "flac"),
    ("Kerosene Bloom", "Weight of Chrome", 2011, "Metal", ["Forge Lung", "Iron Psalm", "Coldwater", "The Long Hum", "Ashfall"], (160, 160, 160), "m4a"),
    ("Marrow & Moth", "Soft Teeth", 2016, "Indie", ["Porch Light", "Moth Year", "Blue Hour Bicycle", "Soft Teeth", "Kitchen Radio", "Handwriting", "Goodnight, Mercury"], (200, 170, 120), "ogg"),
    ("Low Tide Choir", "Undertow EP", 2019, "Shoegaze", ["Undertow", "Salt in the Speaker", "Pier Lights", "Drowned Cathedral"], (90, 40, 110), "opus"),
    ("Velvet Tinnitus", "Feedback Loops (Live at the Basement)", 2009, "Post-Hardcore", ["Intro / Hum", "Static on the Stairs (Live)", "Oxbow (Live)", "Carpet Burn (Live)"], (120, 20, 20), "mp3"),
    ("Saint Static", "Transmitter", 2022, "Alternative", ["Transmitter", "Antenna Saint", "Channel 9 Prayer", "White Noise Wedding", "Dial Tone"], (220, 40, 50), "alac"),
]

def cover(path, band, album, color, seed):
    rnd = random.Random(seed); S = 1000
    im = Image.new("RGB", (S, S), (14, 14, 14)); d = ImageDraw.Draw(im)
    style = seed % 4
    if style == 0:  # big halftone circle
        for y in range(0, S, 18):
            for x in range(0, S, 18):
                dist = math.hypot(x - S * .55, y - S * .45) / (S * .5)
                r = max(0, 9 * (1 - dist)) + rnd.uniform(-.8, .8)
                if r > .6: d.ellipse([x - r, y - r, x + r, y + r], fill=color)
    elif style == 1:  # torn stripes
        for i in range(14):
            y = rnd.randint(0, S); h = rnd.randint(8, 90)
            d.rectangle([0, y, S, y + h], fill=tuple(min(255, int(c * rnd.uniform(.4, 1.1))) for c in color))
    elif style == 2:  # photocopied blob figure
        for i in range(40):
            x, y = rnd.gauss(S / 2, 140), rnd.gauss(S / 2, 200); r = rnd.randint(20, 120)
            d.ellipse([x - r, y - r, x + r, y + r], fill=(200, 196, 186))
        im = im.filter(ImageFilter.GaussianBlur(6)); d = ImageDraw.Draw(im)
        d.rectangle([0, int(S * .72), S, S], fill=color)
    else:  # concentric grooves
        for r in range(480, 20, -14):
            c = tuple(int(v * (0.3 + 0.7 * (r / 480))) for v in color)
            d.ellipse([S/2 - r, S/2 - r, S/2 + r, S/2 + r], outline=c, width=6)
    noise = Image.effect_noise((S, S), 60).convert("RGB")
    im = ImageChops.overlay(im, noise.point(lambda v: 128 + (v - 128) // 3))
    d = ImageDraw.Draw(im)
    f1 = ImageFont.truetype(FONT, 64); f2 = ImageFont.truetype(FONT, 34)
    d.text((56, 56), band.upper(), font=f1, fill=(236, 231, 220))
    d.text((60, 140), album, font=f2, fill=(236, 231, 220))
    im.save(path, quality=90)

def synth(out, seconds, seed, fmt, tags, cover_path, lrc=None):
    rnd = random.Random(seed)
    root = rnd.choice([55, 61.7, 65.4, 73.4, 82.4, 98])
    notes = [root * r for r in rnd.choice([(1, 1.5, 2, 3), (1, 1.2, 1.5, 2), (1, 1.335, 1.5, 2.67)])]
    bpm = rnd.choice([92, 110, 128, 146, 168]); beat = 60 / bpm
    inputs = []
    for i, n in enumerate(notes):
        inputs += ["-f", "lavfi", "-i", f"sine=frequency={n:.2f}:duration={seconds}:sample_rate=44100"]
    inputs += ["-f", "lavfi", "-i", f"anoisesrc=color=pink:amplitude=0.25:duration={seconds}:sample_rate=44100"]
    k = len(notes)
    fc = "".join(f"[{i}]volume={0.5/(i+1):.2f},tremolo=f={1/beat*(i%2+1):.2f}:d={0.3+0.15*i:.2f}[s{i}];" for i in range(k))
    fc += f"[{k}]highpass=f=4000,volume=0.6,tremolo=f={2/beat:.2f}:d=0.95[hat];"
    fc += "".join(f"[s{i}]" for i in range(k)) + f"[hat]amix=inputs={k+1}:normalize=0,acrusher=bits=10:mix=0.25,aecho=0.7:0.5:{int(beat*1000)}:0.25,"
    fc += f"volume=0.9,afade=t=in:d=1.5,afade=t=out:st={seconds-3}:d=3,alimiter=limit=0.9[a]"
    codec = {"mp3": ["-c:a", "libmp3lame", "-b:a", "192k"], "flac": ["-c:a", "flac"], "m4a": ["-c:a", "aac", "-b:a", "192k"],
             "ogg": ["-c:a", "libvorbis", "-q:a", "5"], "opus": ["-c:a", "libopus", "-b:a", "128k"], "alac": ["-c:a", "alac"], "wav": ["-c:a", "pcm_s16le"]}[fmt]
    ext = {"alac": "m4a"}.get(fmt, fmt)
    out = out.with_suffix("." + ext)
    meta = []
    for key, v in tags.items():
        if v is not None: meta += ["-metadata", f"{key}={v}"]
    cmd = ["ffmpeg", "-y", "-loglevel", "error", *inputs]
    art_ok = cover_path and fmt in ("mp3", "flac", "m4a", "alac")
    if art_ok:
        cmd += ["-i", str(cover_path)]
    cmd += ["-filter_complex", fc, "-map", "[a]"]
    if art_ok:
        cmd += ["-map", f"{k+1}:v", "-c:v", "mjpeg" if fmt != "flac" else "mjpeg", "-disposition:v", "attached_pic"]
        if fmt == "mp3": cmd += ["-id3v2_version", "3"]
    cmd += [*codec, *meta, str(out)]
    subprocess.run(cmd, check=True)
    if lrc:
        out.with_suffix(".lrc").write_text(lrc)
    return out

def main():
    if ROOT.exists(): shutil.rmtree(ROOT)
    ROOT.mkdir(parents=True)
    seed = 1
    for band, album, year, genre, titles, color, fmt in ALBUMS:
        adir = ROOT / band / f"{year} - {album}"; adir.mkdir(parents=True)
        cov = adir / "cover.jpg"; cover(cov, band, album, color, seed)
        for i, t in enumerate(titles, 1):
            secs = random.choice([48, 62, 75, 90]) if fmt not in ("flac", "alac") else random.choice([30, 36])
            lrc = None
            if band == "Hollow Arcade" and i == 1:
                lines = ["Headlights on the ceiling", "counting stops in the dark", "the driver hums a chorus", "that nobody remembers", "last stop before morning", "and we're still awake"]
                lrc = "[ti:%s]\n[ar:%s]\n" % (t, band) + "\n".join(f"[{(4+j*7)//60:02d}:{(4+j*7)%60:02d}.00]{l}" for j, l in enumerate(lines)) + "\n"
            synth(adir / f"{i:02d} - {t.replace('/', '-')}", secs, seed * 100 + i, fmt,
                  {"title": t, "artist": band, "album": album, "album_artist": band, "track": f"{i}/{len(titles)}", "date": year, "genre": genre, "disc": "1/1"},
                  cov if fmt != "ogg" and fmt != "opus" else cov, lrc)
        if fmt in ("ogg", "opus"):
            pass  # folder cover.jpg fallback is tested with these
        seed += 1
    # compilation with album artist + one track per artist
    comp = ROOT / "Compilations" / "2013 - Basement Tapes Vol. 1"; comp.mkdir(parents=True)
    cover(comp / "folder.jpg", "Various Artists", "Basement Tapes Vol. 1", (180, 180, 170), 99)
    for i, (a, t) in enumerate([("Hollow Arcade", "Pay Phone Song"), ("Kerosene Bloom", "Anvil Waltz"), ("Marrow & Moth", "Backseat Atlas"), ("Low Tide Choir", "Tidal Radio")], 1):
        synth(comp / f"{i:02d} - {a} - {t}", 55, 900 + i, "mp3", {"title": t, "artist": a, "album": "Basement Tapes Vol. 1", "album_artist": "Various Artists", "track": i, "date": 2013, "genre": "Alternative"}, comp / "folder.jpg")
    # untagged file in artist/album folders
    raw = ROOT / "Unsorted Demos" / "Garage Session"; raw.mkdir(parents=True)
    synth(raw / "03 - untitled riff", 40, 7777, "wav", {}, None)
    # music video (generated pattern + audio)
    vids = ROOT / "Videos"; vids.mkdir()
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=854x480:rate=24:duration=20", "-f", "lavfi", "-i", "sine=frequency=110:duration=20",
                    "-vf", "hue=s=0.15,eq=contrast=1.3:brightness=-0.12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "32", "-c:a", "aac", "-b:a", "128k",
                    "-metadata", "title=Static on the Stairs (Official Video)", "-metadata", "artist=Velvet Tinnitus", str(vids / "Velvet Tinnitus - Static on the Stairs (Official Video).mp4")], check=True)
    total = sum(p.stat().st_size for p in ROOT.rglob("*") if p.is_file())
    print("files", sum(1 for _ in ROOT.rglob("*.*")), "MB", round(total / 1e6, 1))

if __name__ == "__main__":
    main()
