#!/usr/bin/env python3
"""Every door read from the plans, crossed with real keys: stand outside (qaPlace sets the viewpoint only), E, hold W, measure how far past the door the player got.
Then the science-building side quest, G to each step. CAMPUS_WALK_URL picks the build, V91_WALK_OUT the folder."""
import asyncio
import json
import math
import os
import time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('V91_WALK_OUT', ROOT / 'artifacts/v9.1/door-walk'))
URL = os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:4180/') + '?view=walk&story=1&quality=C&qa=1&spawn=arcade'
D = ROOT / 'public/data/walkthrough'
A = json.loads((D / 'access-plan.json').read_text()); C = json.loads((D / 'campus-structure.json').read_text()); P = C['placements']['SC']
CH = json.loads((ROOT / 'public/data/chapters.json').read_text())['chapters']
QUESTS = json.loads((ROOT / 'public/data/quests.json').read_text())['quests']
SAVE = {'nsysu-walk-guide-v7': '1', 'nsysu-walk-tips-v8': json.dumps(['goal', 'accept', 'switch', 'bike', 'photo', 'line']),
        'nsysu-story-v3': json.dumps({'done': [c['id'] for c in CH], 'flags': [], 'fired': {c['id']: [s['id'] for s in c['steps']] for c in CH}, 'sideQuests': []})}
Y = {'SC-B1': -3.62, 'SC-1F': .08, 'SC-2F': 3.78, 'SC-3F': 7.48, 'SC-4F': 11.18, 'SC-RF': 14.88}


def world(x, z):
    c, s, k = math.cos(P['rotation']), math.sin(P['rotation']), P['scale']
    return P['x'] + (x * c + z * s) * k, P['z'] + (-x * s + z * c) * k


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
        ctx = await browser.new_context(viewport={'width': 640, 'height': 360})
        await ctx.add_init_script('for (const [k, v] of Object.entries(%s)) localStorage.setItem(k, v);' % json.dumps(SAVE))
        page = await ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL)
        await page.wait_for_function('window.campusWalk?.navReady', timeout=240000)
        for fid in ('SC-B1', 'SC-2F', 'SC-3F', 'SC-4F'):
            for port in A['floors'][fid]['portals']:
                if port.get('basis') != 'map-derived' or port.get('kind') == 'exterior-entry':
                    continue
                spots = port['clearancePositions']; room = port['roomIds'][0]; other = next(n for n in port['nodeIds'] if n != room)
                if room not in spots or other not in spots:
                    rows.append(dict(door=port['id'], room=room, passed=False, note='no standing spot')); continue
                out, inn = world(*spots[other]), world(*spots[room])
                dx, dz = inn[0] - out[0], inn[1] - out[1]; n = math.hypot(dx, dz); dx, dz = dx / n, dz / n
                # Back off from the door a little, on the way the door faces.
                sx, sz = out[0] - dx * .4, out[1] - dz * .4
                y = Y[fid]
                ok = await page.evaluate('([x, z, y, f]) => window.campusWalk.qaPlace(x, z, y, f)', [sx, sz, y, [sx + dx, sz + dz]])
                if not ok:
                    sx, sz = out; ok = await page.evaluate('([x, z, y, f]) => window.campusWalk.qaPlace(x, z, y, f)', [sx, sz, y, [sx + dx, sz + dz]])
                await page.wait_for_timeout(250)
                await page.keyboard.press('e')
                await page.wait_for_timeout(500)
                await page.keyboard.down('w')
                await page.wait_for_timeout(int(1000 * max(1.3, n / 2.2 + .7)))
                await page.keyboard.up('w')
                pos = await page.evaluate('window.campusWalk.position')
                door = port['position']; dw = world(*door)
                past = (pos[0] - dw[0]) * dx + (pos[2] - dw[1]) * dz
                row = dict(door=port['id'], room=room, other=other, placed=bool(ok), pastDoor=round(past, 2), y=round(pos[1], 2), passed=bool(ok and past > .25 and abs(pos[1] - y) < .6))
                rows.append(row); print(row, flush=True)
                if not row['passed']:
                    await page.screenshot(path=str(OUT / f"{port['id']}-fail.png"))
        await browser.close()
    done = sum(r['passed'] for r in rows)
    (OUT / 'result.json').write_text(json.dumps(dict(passed=done, total=len(rows), errors=errors, doors=rows), ensure_ascii=False, indent=1))
    print('doors', done, '/', len(rows), 'errors', errors)

asyncio.run(main())
