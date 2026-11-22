#!/usr/bin/env python3
"""Draws what the game builds for SC over each official plan, for side-by-side reading: walk outline (orange), source outline (black),
rooms (blue), portals (red), stair cores with aprons (yellow), lift (magenta). 2x plan pixels; each floor is also cut into 3 crops. Output stays in artifacts/."""
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parents[1]
D = ROOT / 'public/data/walkthrough'; PLANS = ROOT / 'data/official-plans/walkthrough'; OUT = ROOT / 'artifacts/v9.1/research'
S = json.loads((D / 'SC.json').read_text()); A = json.loads((D / 'access-plan.json').read_text()); C = json.loads((D / 'campus-structure.json').read_text())
CLIPPED = C['roomOverrides']
font = ImageFont.load_default(size=16)
OUT.mkdir(parents=True, exist_ok=True)
for f in S['floors']:
    plain = Image.open(PLANS / (f['id'] + '.webp')).convert('RGB')
    t = f['transform']; m = t['metresPerPixel']; ox, oy = t['imageOriginPixels']; k = 2
    img = plain.resize((plain.width * k, plain.height * k), Image.LANCZOS)
    img.save(OUT / f"{f['id']}-plain.png")
    d = ImageDraw.Draw(img)
    px = lambda p: ((p[0] / m + ox) * k, (p[1] / m + oy) * k)
    P = A['floors'][f['id']]
    ring = lambda pts, c, w=2: d.line([px(p) for p in pts + pts[:1]], fill=c, width=w)
    ring(P.get('walkOutline', f['outline']), (255, 130, 0), 3)
    ring(f['outline'], (0, 0, 0), 2)
    for h in f['holes']:
        ring(h, (0, 170, 0))
    for r in f['rooms']:
        ring(CLIPPED.get(f['id'], {}).get(r['id']) or r['polygon'], (30, 90, 255))
    for p in P['portals']:
        a = px(p['position']); d.rectangle([a[0] - 5, a[1] - 5, a[0] + 5, a[1] + 5], fill=(255, 0, 0))
    for core in C['stairCores']['SC']:
        if not any(l['floorId'] == f['id'] for l in core['levels']):
            continue
        ux, uz = math.cos(core['angle']), math.sin(core['angle']); vx, vz = -uz, ux; cx, cz = core['center']; hl, hw = core['length'] / 2, core['width'] / 2
        ring([[cx + a * ux * hl + b * vx * hw, cz + a * uz * hl + b * vz * hw] for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))], (230, 200, 0), 4)
        q = px(core['center']); d.text((q[0] - 40, q[1]), core['id'], fill=(160, 90, 0), font=font)
    for lift in C['lifts']['SC']:
        if any(s['floorId'] == f['id'] for s in lift['stops']):
            cx, cz = lift['center']; h = lift['size'] / 2
            ring([[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h]], (220, 0, 200), 4)
    img.save(OUT / f"{f['id']}-overlay.png")
    for j in range(3):
        img.crop((j * img.width // 3, 0, (j + 1) * img.width // 3, img.height)).save(OUT / f"{f['id']}-overlay-{j}.png")
    print(f['id'], img.size, 'local x=(X/2-%.3f)*%.5f z=(Z/2-%.3f)*%.5f' % (ox, m, oy, m))
