import pathlib, re
R = pathlib.Path(__file__).resolve().parents[2]
def svg(name, w, style=""):
    t = (R/"brand/logo"/name).read_text()
    vb = re.search(r'viewBox="([^"]+)"', t).group(1); body = re.sub(r'^<svg[^>]*>|</svg>\s*$', '', t.strip())
    return f'<svg viewBox="{vb}" style="width:{w}px;height:auto;display:block;overflow:visible;{style}">{body}</svg>'
html = f'''<!doctype html><meta charset=utf-8><style>body{{margin:0;background:#0e0e0e;color:#d9d4c7;padding:50px;font:13px system-ui}}
.row{{display:flex;gap:40px;align-items:center;margin-bottom:44px}}.paper{{background:#d9d4c7;color:#0e0e0e;padding:30px}}
.wine{{background:#691f26;color:#d9d4c7;padding:26px;border-radius:22px}}.dark{{background:#1f1f1f;padding:26px;border-radius:22px}}</style>
<div class=row>{svg("feedback-wordmark.svg",900)}</div>
<div class=row>{svg("feedback-wordmark-worn.svg",900)}</div>
<div class=row>{svg("feedback-emblem.svg",240)}{svg("feedback-symbol.svg",200)}{svg("feedback-symbol-worn.svg",200)}{svg("feedback-symbol.svg",64)}{svg("feedback-symbol-small.svg",48)}{svg("feedback-symbol-small.svg",32)}{svg("feedback-symbol-small.svg",16)}
<div class=wine>{svg("feedback-symbol.svg",90)}</div><div class=dark>{svg("feedback-symbol.svg",90)}</div></div>
<div class="row paper">{svg("feedback-wordmark-worn.svg",440)}{svg("feedback-wordmark.svg",200)}{svg("feedback-wordmark.svg",110)}</div>'''
(R/"design/svg/explorations/logo-review.html").write_text(html)
