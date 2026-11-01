#!/usr/bin/env python3
"""Science building as drawn on the plans: every stair flight walked by the navmesh between its own landings; floor outside the real walls; voids; scenes.
Needs a preview build on CAMPUS_WALK_URL; V91_QA_OUT picks the folder."""
import asyncio
import json
import math
import os
from pathlib import Path
from playwright.async_api import async_playwright
from shapely.geometry import Point, Polygon

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('V91_QA_OUT', ROOT / 'artifacts/v9.1/qa'))
URL = os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:4180/') + '?view=walk&story=1&quality=B&qa=1&spawn=arcade'
D = ROOT / 'public/data/walkthrough'
SC = json.loads((D / 'SC.json').read_text()); C = json.loads((D / 'campus-structure.json').read_text()); A = json.loads((D / 'access-plan.json').read_text())
P = C['placements']['SC']
HEIGHT = C['floorHeight']
CH = json.loads((ROOT / 'public/data/chapters.json').read_text())['chapters']
SAVE = {'nsysu-walk-guide-v7': '1', 'nsysu-walk-tips-v8': json.dumps(['goal', 'accept', 'switch', 'bike', 'photo', 'line']),
        'nsysu-story-v3': json.dumps({'done': [c['id'] for c in CH], 'flags': [], 'fired': {c['id']: [s['id'] for s in c['steps']] for c in CH}, 'sideQuests': []})}
Y = {-1: -3.62, 1: .08, 2: 3.78, 3: 7.48, 4: 11.18, 5: 14.88}


def world(x, z):
    c, s = math.cos(P['rotation']), math.sin(P['rotation'])
    k = P['scale']
    return P['x'] + (x * c + z * s) * k, P['z'] + (-x * s + z * c) * k


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    out = {'stairs': [], 'outside': {}, 'voids': {}, 'errors': []}
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
        ctx = await browser.new_context(viewport={'width': 960, 'height': 540})
        await ctx.add_init_script('for (const [k, v] of Object.entries(%s)) localStorage.setItem(k, v);' % json.dumps(SAVE))
        page = await ctx.new_page()
        page.on('pageerror', lambda e: out['errors'].append(str(e)))
        await page.goto(URL)
        await page.wait_for_function('window.campusWalk?.navReady', timeout=240000)

        async def support(x, z, y):
            wx, wz = world(x, z)
            s = await page.evaluate('([x, z, y]) => window.campusWalk.surfaceAt(x, z, y)?.support', [wx, wz, y])
            return s

        # Each flight: from the lower landing to the upper one; it must stay beside this stair, not detour round another.
        for core in C['stairCores']['SC']:
            ux, uz = math.cos(core['angle']), math.sin(core['angle'])
            d = core['length'] / 2 + core['apron'] * .5
            lx, lz = core['center'][0] - ux * d, core['center'][1] - uz * d
            wx, wz = world(lx, lz); cx, cz = world(*core['center'])
            levels = sorted(core['levels'], key=lambda l: l['storey'])
            for a, b in zip(levels, levels[1:]):
                path = await page.evaluate('([a, b]) => window.campusWalk.qaNavPath(a, b)', [[wx, Y[a['storey']], wz], [wx, Y[b['storey']], wz]])
                far = max((math.hypot(q[0] - cx, q[2] - cz) for q in path), default=-1)
                ends = path and abs(path[0][1] - Y[a['storey']]) < .6 and abs(path[-1][1] - Y[b['storey']]) < .6
                length = sum(math.dist(q, r) for q, r in zip(path, path[1:]))
                row = dict(stair=core['id'], fromFloor=a['floorId'], toFloor=b['floorId'], points=len(path), length=round(length, 1), farFromStair=round(far, 1), passed=bool(ends and far < core['length'] * 1.4 + 4))
                out['stairs'].append(row); print(row, flush=True)
        # Floor where the old gallery ran: a metre outside the real wall on the upper floors must hold nothing.
        for f in SC['floors']:
            if f['level'] not in (2, 3, 4):
                continue
            shape = Polygon(f['outline']).buffer(0); stubs = Polygon(A['floors'][f['id']]['walkOutline']).buffer(0)
            rows = hits = 0
            ring = shape.exterior
            for i in range(0, int(ring.length), 2):
                q = ring.interpolate(i)
                for dx, dz in ((.7, 0), (-.7, 0), (0, .7), (0, -.7)):
                    t = Point(q.x + dx, q.y + dz)
                    if shape.buffer(.05).contains(t) or stubs.buffer(.2).contains(t):
                        continue
                    y = Y[f['level']]
                    s = await support(t.x, t.y, y)
                    rows += 1
                    if s is not None and abs(s - y) < .15:
                        hits += 1
                        out.setdefault('outsideHits', []).append([f['id'], round(t.x, 2), round(t.y, 2)])
            out['outside'][f['id']] = dict(samples=rows, floorFound=hits)
            print(f['id'], out['outside'][f['id']], flush=True)
        # Voids: the plan's X areas hold no floor.
        for f in SC['floors']:
            if f['level'] not in (2, 3, 4):
                continue
            rows = []
            for h in f['holes']:
                poly = Polygon(h); c = poly.representative_point()
                s = await support(c.x, c.y, Y[f['level']])
                rows.append(dict(at=[round(c.x, 1), round(c.y, 1)], support=s))
            out['voids'][f['id']] = rows
            print(f['id'], rows, flush=True)

        async def shot(name, lx, lz, y, fx, fz):
            a, t = world(lx, lz), world(fx, fz)
            ok = await page.evaluate('([x, z, y, f]) => window.campusWalk.qaPlace(x, z, y, f)', [a[0], a[1], y, list(t)])
            await page.wait_for_timeout(1800)
            await page.screenshot(path=str(OUT / f'{name}.png'))
            out.setdefault('shots', {})[name] = ok

        for core in C['stairCores']['SC']:
            ux, uz = math.cos(core['angle']), math.sin(core['angle'])
            d = core['length'] / 2 + core['apron'] * .5
            for l in core['levels']:
                if l['storey'] in (1, 3):
                    x, z = core['center'][0] - ux * (d + .5), core['center'][1] - uz * (d + .5)
                    await shot(f"{core['id']}-{l['floorId']}", x, z, Y[l['storey']], x + ux * .6, z + uz * .6)
        await shot('void-3F', -22.3, -1, 7.48, -22.3, 1)
        await shot('void-4F', -22.3, -1, 11.18, -22.3, 1)
        await shot('courtyard-2F', -14, 15, 3.78, -2, 15)
        await shot('courtyard-1F', -2, 15, .08, -6, 18)
        await shot('sc2001', 7.5, 14, 3.78, 9.2, 15)
        await shot('sc3002-west', 6.9, 3, 7.48, 8.5, 3)
        await shot('corridor-3F-west', -60, 22.3, 7.48, -40, 22.3)
        await browser.close()
    (OUT / 'probe.json').write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print('stairs', sum(r['passed'] for r in out['stairs']), '/', len(out['stairs']), 'errors', out['errors'])

asyncio.run(main())
