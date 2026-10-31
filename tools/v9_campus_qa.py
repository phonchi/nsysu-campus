#!/usr/bin/env python3
"""The campus corrections as a player meets them: the science courtyard (from below, from the 4F rail and from outside, is the
roof open?), the rooms it names, the door of SC2001 walked through from the corridor, the library door, the Louisa label.
qaPlace only sets each viewpoint; the door is crossed with W. CAMPUS_WALK_URL picks the build, V9_CAMPUS_OUT the folder."""
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:4180/')
OUT = Path(os.environ.get('V9_CAMPUS_OUT', ROOT / 'artifacts/v9/campus'))
parts = urlsplit(BASE)
query = dict(parse_qsl(parts.query))
query.update(view='walk', story='1', quality='B', qa='1', spawn='arcade')
URL = urlunsplit(parts._replace(query=urlencode(query)))
CHAPTERS = json.loads((ROOT / 'public/data/chapters.json').read_text())['chapters']
SAVE = {
    'nsysu-walk-guide-v7': '1',
    'nsysu-walk-tips-v8': json.dumps(['goal', 'accept', 'switch', 'bike', 'photo', 'line']),
    'nsysu-story-v3': json.dumps({'done': [c['id'] for c in CHAPTERS], 'flags': [], 'fired': {c['id']: [s['id'] for s in c['steps']] for c in CHAPTERS}, 'sideQuests': []}),
}
results = {}


async def shot(page, name):
    await page.wait_for_timeout(1800)
    await page.screenshot(path=str(OUT / f'{name}.png'))


async def look(page, dx=0, dy=0):
    """Turn the camera as a mouse drag would."""
    await page.mouse.move(480, 270)
    await page.mouse.down()
    await page.mouse.move(480 + dx, 270 + dy, steps=8)
    await page.mouse.up()


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
        ctx = await browser.new_context(viewport={'width': 960, 'height': 540})
        await ctx.add_init_script('for (const [k, v] of Object.entries(%s)) localStorage.setItem(k, v);' % json.dumps(SAVE))
        page = await ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL)
        await page.wait_for_function('window.campusWalk?.navReady', timeout=240000)
        results['trees'] = await page.evaluate('window.campusWalk.qaObstacles(-29, 107, 30).filter(o => /almond/.test(o.id)).map(o => o.center)')
        # Courtyard: from the floor looking up, from the 4F rail looking down, from outside and above.
        await page.evaluate('window.campusWalk.qaPlace(-24, 107, .08, [-34, 107])')
        await shot(page, 'courtyard-1f')
        await look(page, 0, -170)
        await shot(page, 'courtyard-1f-up')
        results['courtyard-up-pick'] = await page.evaluate('window.campusWalk.qaPick(0, .3)')
        for x, z, y in ((-25.6, 121.4, 11.18), (-29, 121, 11.18), (-33, 121, 11.18), (-19.4, 107, 11.18), (-19.4, 100, 11.18), (-25.6, 121.4, 7.48), (-25.6, 121.4, 3.78)):
            if await page.evaluate('([x, z, y]) => window.campusWalk.qaPlace(x, z, y, [-29, 107])', [x, z, y]):
                results['rail'] = [x, z, y]
                break
        await shot(page, 'courtyard-4f')
        await look(page, 0, 90)
        await shot(page, 'courtyard-4f-down')
        results['rail-4f'] = await page.evaluate('window.campusWalk.probe(-1, 0)')
        # From the roof: the walking surface beside the opening, looking into it.
        # Doors, crossed on foot from the corridor: (door x, z), the way in, floor height.
        for name, door_id, x, z, way, y in (
            ('SC2001', 'SC-2F-portal-009', -25.63, 123.43, (0, 1), 3.78),
            ('SC4009', 'SC-4F-portal-003', -4.33, 109.40, (1, 0), 11.18),
            ('SC4010', 'SC-4F-portal-037', -7.57, 119.39, (-1, 0), 11.18),
            ('SC1005', 'SC-1F-portal-007', -4.49, 95.77, (1, 0), .08),
        ):
            sx, sz = x - way[0] * 2, z - way[1] * 2
            await page.evaluate('([x, y, z, fx, fz]) => window.campusWalk.qaPlace(x, z, y, [fx, fz])', [sx, y, sz, x, z])
            await shot(page, f'{name}-corridor')
            sign = await page.evaluate('[...document.querySelectorAll(".door-sign, .walk-door-sign, [class*=door-sign]")].filter(e => e.offsetParent).map(e => e.textContent)')
            results.setdefault('prompts', {})[name] = await page.evaluate('window.campusWalk.interaction')
            await page.keyboard.press('e')
            await page.wait_for_timeout(1200)
            await shot(page, f'{name}-door-open')
            await page.keyboard.down('w')
            await page.wait_for_timeout(1400)
            opened = await page.evaluate('(id) => window.campusWalk.doors.find(d => d.id === id).open', door_id)
            await page.wait_for_timeout(1400)
            await page.keyboard.up('w')
            pos = await page.evaluate('window.campusWalk.position')
            through = (pos[0] - x) * way[0] + (pos[2] - z) * way[1]
            results[name] = {'pos': pos, 'beyondDoor': round(through, 2), 'doorOpen': opened, 'sign': sign, 'passed': through > .4}
            await shot(page, f'{name}-inside')
            print(name, results[name], flush=True)
        # Library door and the main story's person there, by day.
        s3 = await page.evaluate('(() => { const n = window.campusWalk.npcs.find(n => n.id === "s3"); return n; })()')
        results['s3'] = s3
        await page.evaluate('window.campusWalk.qaPlace(-52.5, -50, 0, [-52.5, -62])')
        await shot(page, 'library-door')
        await page.evaluate('window.campusWalk.qaPlace(-50.5, -55, undefined, [-51, -63])')
        await shot(page, 'library-door-close')
        results['library-candidates'] = await page.evaluate('window.campusWalk.interaction')
        # Louisa: walk up to the old hall, then search for it.
        for x, z in ((-160, -88), (-160, -100), (-186, -68), (-186, -116)):
            if await page.evaluate('([x, z]) => window.campusWalk.qaPlace(x, z, undefined, [-182, -90])', [x, z]) and abs((await page.evaluate('window.campusWalk.position'))[0] - x) < 3:
                results['louisa-at'] = [x, z]
                break
        await shot(page, 'louisa')
        results['louisa-interaction'] = await page.evaluate('window.campusWalk.interaction')
        await browser.close()
    results['pageErrors'] = errors
    (OUT / 'probe.json').write_text(json.dumps(results, ensure_ascii=False, indent=1))
    print('errors', errors)

asyncio.run(main())
