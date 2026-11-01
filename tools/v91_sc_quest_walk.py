#!/usr/bin/env python3
"""The door the diagonal walk missed, crossed square on; then the science building's side quest, G to each step and E there. Real keys; qaSetQuest only picks the step."""
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
A = json.loads((D / 'access-plan.json').read_text()); P = json.loads((D / 'campus-structure.json').read_text())['placements']['SC']
CH = json.loads((ROOT / 'public/data/chapters.json').read_text())['chapters']
QUESTS = json.loads((ROOT / 'public/data/quests.json').read_text())['quests']
SAVE = {'nsysu-walk-guide-v7': '1', 'nsysu-walk-tips-v8': json.dumps(['goal', 'accept', 'switch', 'bike', 'photo', 'line']),
        'nsysu-story-v3': json.dumps({'done': [c['id'] for c in CH], 'flags': [], 'fired': {c['id']: [s['id'] for s in c['steps']] for c in CH}, 'sideQuests': []})}


def world(x, z):
    c, s, k = math.cos(P['rotation']), math.sin(P['rotation']), P['scale']
    return P['x'] + (x * c + z * s) * k, P['z'] + (-x * s + z * c) * k


async def main():
    res = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
        ctx = await browser.new_context(viewport={'width': 960, 'height': 540})
        await ctx.add_init_script('for (const [k, v] of Object.entries(%s)) localStorage.setItem(k, v);' % json.dumps(SAVE))
        page = await ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL)
        await page.wait_for_function('window.campusWalk?.navReady && window.campusWalk.questList?.length', timeout=240000)
        port = next(x for x in A['floors']['SC-B1']['portals'] if x['id'] == 'SC-B1-portal-029')
        tx, tz = port['tangent']
        for sign in (-1, 1):
            nx, nz = -tz * sign, tx * sign  # local normal
            a, b = world(port['position'][0] - nx * .9, port['position'][1] - nz * .9), world(port['position'][0] + nx * .9, port['position'][1] + nz * .9)
            ok = await page.evaluate('([x, z, f]) => window.campusWalk.qaPlace(x, z, -3.62, f)', [a[0], a[1], list(b)])
            await page.wait_for_timeout(300); await page.keyboard.press('e'); await page.wait_for_timeout(500)
            await page.keyboard.down('w'); await page.wait_for_timeout(1600); await page.keyboard.up('w')
            pos = await page.evaluate('window.campusWalk.position')
            dw = world(*port['position']); d = (b[0] - a[0], b[1] - a[1]); n = math.hypot(*d)
            res[f'door029 side {sign}'] = dict(placed=ok, past=round(((pos[0] - dw[0]) * d[0] + (pos[2] - dw[1]) * d[1]) / n, 2))
            print(res[f'door029 side {sign}'], flush=True)
        q = next(q for q in QUESTS if any('SC4009' in str(s.get('target')) for s in q['steps']))
        print('quest', q['id'], [s.get('target') for s in q['steps']], flush=True)
        for i, s in enumerate(q['steps']):
            await page.evaluate('([id, i]) => window.campusWalk.qaSetQuest(id, i)', [q['id'], i])
            await page.wait_for_timeout(600)
            t0 = time.time(); await page.keyboard.press('g'); await page.wait_for_timeout(2000)
            while time.time() - t0 < 170:
                if not await page.evaluate('window.campusWalk.autoFollow'):
                    break
                await page.wait_for_timeout(1500)
            pos = await page.evaluate('window.campusWalk.position'); inter = await page.evaluate('window.campusWalk.interaction')
            await page.screenshot(path=str(OUT / f'quest-{i}.png'))
            res[f'step {i}'] = dict(target=s.get('target'), seconds=round(time.time() - t0), pos=[round(v, 1) for v in pos], interaction=str(inter)[:120])
            print(res[f'step {i}'], flush=True)
        await browser.close()
    res['errors'] = errs
    (OUT / 'quest.json').write_text(json.dumps(res, ensure_ascii=False, indent=1))

asyncio.run(main())
