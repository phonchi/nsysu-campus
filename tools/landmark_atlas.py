"""Procedural albedo/emissive atlas painter for the v3 landmarks (art-direction-v3 §1, §5).

Called by tools/create_landmarks.py (Blender has no Pillow, so painting runs in system Python):
    python3 -I tools/landmark_atlas.py <spec.json>
The spec lists tiles {name, kind, rect:[x,y,w,h] px, params}; writes spec['albedo'] and spec['emissive'] (512 px PNG).
All imagery is flat colour blocks / procedural patterns — never photographs (art-direction §8.8).
"""
import json, random, sys
from PIL import Image, ImageDraw, ImageFont

FONT_SERIF = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc'
FONT_SANS = '/home/phonchi/.local/share/fonts/NotoSansCJKtc-Bold.otf'
LIT = {'lit': (255, 211, 122), 'warm': (255, 177, 92), 'dim': (150, 110, 60), 'off': (0, 0, 0)}


def rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    a, b = rgb(a) if isinstance(a, str) else a, rgb(b) if isinstance(b, str) else b
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def font(size, serif=True):
    try:
        return ImageFont.truetype(FONT_SERIF if serif else FONT_SANS, size, index=2 if serif else 0)  # index 2 = TC in the .ttc
    except Exception:
        return ImageFont.load_default()


class Ctx:
    def __init__(self, al, em, rect, rng):
        self.a, self.e = ImageDraw.Draw(al), ImageDraw.Draw(em); self.x, self.y, self.w, self.h = rect; self.rng = rng

    def R(self, fx0, fy0, fx1, fy1):  # fractional rect (0..1, y down) -> px box
        return [self.x + round(fx0 * self.w), self.y + round(fy0 * self.h), self.x + round(fx1 * self.w) - 1, self.y + round(fy1 * self.h) - 1]

    def fill(self, col, box=None, em=None):
        b = box or [self.x, self.y, self.x + self.w - 1, self.y + self.h - 1]
        self.a.rectangle(b, fill=rgb(col) if isinstance(col, str) else col)
        if em is not None: self.e.rectangle(b, fill=em)


def p_solid(c, color, em=None, **_):
    c.fill(color, em=rgb(em) if em else None)


def p_brick(c, color, mortar='#e6d2c2', course=4, brick=12, shade=None, **_):
    """Running-bond brick: course/brick sizes in px. Mortar ≤ 8 % of area (1 px lines)."""
    c.fill(color)
    base = rgb(color)
    for row, y in enumerate(range(c.y, c.y + c.h, course)):
        off = (brick // 2) * (row % 2)
        for x in range(c.x - off, c.x + c.w, brick):  # subtle per-brick value jitter keeps it hand-painted, not noisy
            j = c.rng.uniform(-.045, .045); col = tuple(max(0, min(255, int(v * (1 + j)))) for v in base)
            c.a.rectangle([max(c.x, x), y, min(c.x + c.w - 1, x + brick - 2), min(c.y + c.h - 1, y + course - 2)], fill=col)
    if shade:  # darker base course (brick.shade painted into the lower part of the tile)
        c.a.rectangle(c.R(0, 1 - shade, 1, 1), fill=mix(color, '#7a3428', .35))
    del mortar


def p_stone(c, color, dark='#8d8677', rows=4, cols=3, **_):
    c.fill(dark)
    rh = c.h / rows
    for r in range(rows):
        off = (c.w / cols / 2) * (r % 2); cw = c.w / cols
        for k in range(-1, cols + 1):
            x0 = c.x + k * cw + off; x1 = x0 + cw - 2
            x0, x1 = max(c.x, x0), min(c.x + c.w - 1, x1)
            if x1 <= x0: continue
            col = mix(color, '#ffffff' if c.rng.random() < .5 else dark, c.rng.uniform(0, .18))
            c.a.rectangle([int(x0), int(c.y + r * rh), int(x1), int(c.y + (r + 1) * rh - 2)], fill=col)


def glass(c, box, top='#dcedf4', bottom='#3e6572', base='#86b7c8', lit='lit', mull=0, frame='#3b3a36', transom=None):
    x0, y0, x1, y1 = box; h = max(1, y1 - y0)
    for i in range(h + 1):  # sky reflection in the top 40 %, dark interior below (art-direction §1.2 glass.day)
        t = i / h; col = mix(top, base, t / .4) if t < .4 else mix(base, bottom, (t - .4) / .6)
        c.a.line([x0, y0 + i, x1, y0 + i], fill=col)
    c.a.polygon([(x0, y1), (x0 + (x1 - x0) * .55, y0), (x0 + (x1 - x0) * .7, y0), (x0 + (x1 - x0) * .15, y1)], fill=mix(top, base, .35))  # diagonal glint
    c.a.rectangle(box, outline=rgb(frame), width=1)
    for k in range(1, mull + 1):
        xm = x0 + (x1 - x0) * k // (mull + 1); c.a.line([xm, y0, xm, y1], fill=rgb(frame))
    if transom: c.a.line([x0, y0 + int(h * transom), x1, y0 + int(h * transom)], fill=rgb(frame))
    ec = LIT.get(lit, (0, 0, 0))
    c.e.rectangle([x0 + 1, y0 + 1, x1 - 1, y1 - 1], fill=ec)
    if lit != 'off':
        for k in range(1, mull + 1):
            xm = x0 + (x1 - x0) * k // (mull + 1); c.e.line([xm, y0, xm, y1], fill=(40, 30, 15))


def wall_bg(c, wall, wall_kind):
    if wall_kind == 'brick': p_brick(c, wall)
    elif wall_kind == 'stone': p_stone(c, wall)
    else: c.fill(wall)


def p_window(c, wall='#c75f4a', wall_kind='brick', win=(.2, .25, .8, .78), lit='lit', mull=1, sill='#f3ebdb', frame='#3b3a36', head=None, transom=None, **_):
    """One bay × one storey: wall + window opening (fractions, y down) + cream sill/head."""
    wall_bg(c, wall, wall_kind)
    x0, y0, x1, y1 = win
    if head: c.fill(head, c.R(x0 - .04, y0 - .07, x1 + .04, y0))
    glass(c, c.R(x0, y0, x1, y1), lit=lit, mull=mull, frame=frame, transom=transom)
    if sill: c.fill(sill, c.R(x0 - .05, y1, x1 + .05, min(1, y1 + .06)))


def p_band(c, stripes, lit='lit', mull=3, frame='#3b3a36', **_):
    """Horizontal stripes [[y0, y1, colour|'glass'|'brick:#hex'], ...] (fractions, y down)."""
    for y0, y1, col in stripes:
        box = c.R(0, y0, 1, y1)
        if col == 'glass': glass(c, box, lit=lit, mull=mull, frame=frame)
        elif col.startswith('brick:'):
            sub = Ctx.__new__(Ctx); sub.a, sub.e, sub.rng = c.a, c.e, c.rng; sub.x, sub.y = box[0], box[1]; sub.w, sub.h = box[2] - box[0] + 1, box[3] - box[1] + 1
            p_brick(sub, col[6:])
        else: c.fill(col, box)


def p_louvre(c, color='#efe6d1', line='#b9ab8f', n=8, vertical=False, **_):
    c.fill(color)
    for k in range(n):
        if vertical: x = c.x + c.w * (k + .5) / n; c.a.line([x, c.y, x, c.y + c.h], fill=rgb(line), width=2)
        else: y = c.y + c.h * (k + .5) / n; c.a.line([c.x, y, c.x + c.w, y], fill=rgb(line), width=2)


def p_text(c, text, bg='#f3ebdb', fg='#1d2a3a', vertical=True, serif=True, em=None, border=None, **_):
    c.fill(bg)
    if border: c.a.rectangle([c.x + 2, c.y + 2, c.x + c.w - 3, c.y + c.h - 3], outline=rgb(border), width=2)
    if vertical:
        step = c.h / (len(text) + .4); f = font(int(min(step * .86, c.w * .86)), serif)
        for i, ch in enumerate(text):
            cx, cy = c.x + c.w / 2, c.y + step * (i + .7)
            c.a.text((cx, cy), ch, font=f, fill=rgb(fg), anchor='mm')
            if em: c.e.text((cx, cy), ch, font=f, fill=rgb(em), anchor='mm')
    else:
        f = font(int(min(c.h * .7, c.w / max(1, len(text)) * .92)), serif)
        c.a.text((c.x + c.w / 2, c.y + c.h / 2), text, font=f, fill=rgb(fg), anchor='mm')
        if em: c.e.text((c.x + c.w / 2, c.y + c.h / 2), text, font=f, fill=rgb(em), anchor='mm')


def p_poster(c, bg='#f3ebdb', frame='#3b3a36', n=3, **_):
    """Board of original club posters: flat colour blocks only (no real logos/text)."""
    c.fill(frame); pal = ['#2a8c99', '#e9b949', '#e04b3a', '#7b4a8f', '#3d7a4a', '#2f5fa8', '#f27a2c', '#fbf6ea']
    for k in range(n):
        x0 = .06 + k * .88 / n; x1 = x0 + .88 / n - .04; col = c.rng.choice(pal)
        c.fill(col, c.R(x0, .1, x1, .9)); c.fill(c.rng.choice(pal), c.R(x0 + .03, .18, x1 - .03, .42))
        c.fill('#fbf6ea', c.R(x0 + .03, .55, x1 - .08, .62)); c.fill('#fbf6ea', c.R(x0 + .03, .68, x1 - .03, .74))


def p_emblem(c, bg='#c75f4a', ring='#d4af37', em=None, **_):
    """Original concentric-ring + 12-ray roundel (NOT the real university emblem; art-direction §5 #6)."""
    import math
    c.fill(bg); cx, cy, r = c.x + c.w / 2, c.y + c.h / 2, min(c.w, c.h) * .46
    c.a.ellipse([cx - r, cy - r, cx + r, cy + r], fill=rgb('#f3ebdb'), outline=rgb(ring), width=3)
    c.a.ellipse([cx - r * .62, cy - r * .62, cx + r * .62, cy + r * .62], outline=rgb(ring), width=2)
    for k in range(12):
        a = k * math.pi / 6; c.a.line([cx + math.cos(a) * r * .25, cy + math.sin(a) * r * .25, cx + math.cos(a) * r * .6, cy + math.sin(a) * r * .6], fill=rgb(ring), width=2)
    c.a.ellipse([cx - r * .22, cy - r * .22, cx + r * .22, cy + r * .22], fill=rgb(ring))
    if em: c.e.ellipse([cx - r, cy - r, cx + r, cy + r], outline=rgb(em), width=3)


def p_foliage(c, base='#4f9a46', dots=('#5fae48', '#3f8343', '#7fc156'), n=40, **_):
    c.fill(base)
    for _ in range(n):
        x, y, r = c.x + c.rng.random() * c.w, c.y + c.rng.random() * c.h, c.rng.uniform(2, 6)
        c.a.ellipse([x - r, y - r, x + r, y + r], fill=rgb(c.rng.choice(dots)))


def p_grid(c, color, line, n=4, **_):
    c.fill(color)
    for k in range(1, n):
        c.a.line([c.x + c.w * k // n, c.y, c.x + c.w * k // n, c.y + c.h], fill=rgb(line))
        c.a.line([c.x, c.y + c.h * k // n, c.x + c.w, c.y + c.h * k // n], fill=rgb(line))


def p_lamp(c, color='#f3ebdb', lamp='#ffd37a', **_):
    """Tunnel lining tile with a warm lamp strip (emissive)."""
    c.fill(color); box = c.R(.1, .08, .9, .2); c.fill(lamp, box, em=rgb(lamp))


def p_stripes(c, colors, vertical=True, **_):
    n = len(colors)
    for k, col in enumerate(colors):
        c.fill(col, c.R(k / n, 0, (k + 1) / n, 1) if vertical else c.R(0, k / n, 1, (k + 1) / n))


def p_sign(c, bg='#2a8c99', fg='#fbf6ea', blocks=3, em='#ffd37a', **_):
    """Original shop sign: colour block with abstract glyph bars (no real brands)."""
    c.fill(bg, em=None)
    for k in range(blocks):
        x0 = .08 + k * .84 / blocks; c.fill(fg, c.R(x0, .3, x0 + .84 / blocks - .06, .7))
        c.e.rectangle(c.R(x0, .3, x0 + .84 / blocks - .06, .7), fill=rgb(em))


def p_arch(c, wall='#c75f4a', wall_kind='brick', box=(.1, .15, .9, .95), shape='segment', lit='lit', rail=None, frame='#3b3a36', **_):
    """Wall with an arched opening (segmental or semicircular) — dark glass / shadow inside."""
    wall_bg(c, wall, wall_kind)
    x0, y0, x1, y1 = c.R(*box); w = x1 - x0
    rise = w * (.5 if shape == 'semi' else .22)
    c.a.rectangle([x0, y0 + rise, x1, y1], fill=rgb('#3e4f58')); c.a.pieslice([x0, y0, x1, y0 + 2 * rise], 180, 360, fill=rgb('#5d7884'))
    c.a.arc([x0, y0, x1, y0 + 2 * rise], 180, 360, fill=rgb('#f3ebdb'), width=2)
    c.e.rectangle([x0 + 2, y0 + rise, x1 - 2, y1 - 2], fill=LIT.get(lit, (0, 0, 0)))
    if rail:
        ry = y1 - (y1 - y0) // 4; c.a.line([x0, ry, x1, ry], fill=rgb(rail), width=2)
        for x in range(x0, x1, 4): c.a.line([x, ry, x, y1], fill=rgb(rail))


def p_tiles(c, color='#6e2f2c', line='#b98a7d', n=6, m=10, **_):
    """Square ceramic facing tiles with light grout (校碑, tunnel lining)."""
    c.fill(color)
    for k in range(1, n): x = c.x + c.w * k // n; c.a.line([x, c.y, x, c.y + c.h], fill=rgb(line))
    for k in range(1, m): y = c.y + c.h * k // m; c.a.line([c.x, y, c.x + c.w, y], fill=rgb(line))


def p_lattice(c, bg='#f3ebdb', bar='#6e2f2c', n=5, **_):
    c.fill(bg)
    for k in range(1, n):
        x = c.x + c.w * k // n; y = c.y + c.h * k // n
        c.a.line([x, c.y, x, c.y + c.h], fill=rgb(bar), width=2); c.a.line([c.x, y, c.x + c.w, y], fill=rgb(bar), width=2)


PAINTERS = {k[2:]: v for k, v in globals().items() if k.startswith('p_')}


def main(path):
    spec = json.load(open(path, encoding='utf-8')); size = spec.get('size', 512)
    al = Image.new('RGB', (size, size), rgb(spec.get('fill', '#efe6d1'))); em = Image.new('RGB', (size, size), (0, 0, 0))
    rng = random.Random(spec.get('seed', 7))
    for t in spec['tiles']:
        PAINTERS[t['kind']](Ctx(al, em, t['rect'], rng), **t.get('params', {}))
    al.save(spec['albedo'], optimize=True); em.save(spec['emissive'], optimize=True)
    print('ATLAS', spec['albedo'], len(spec['tiles']))


if __name__ == '__main__':
    main(sys.argv[1])
