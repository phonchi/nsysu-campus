#!/usr/bin/env python3
"""Really walk the two routes that once had no plan: gardener to the library door and back. Journal Go only, no teleport during the walk."""
import asyncio, json, os, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('V9_ROUTE_WALK_OUT', ROOT / 'artifacts/v9/route-walk'))
URL = os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:4180/') + '?view=walk&story=1&quality=C&qa=1'
CHAPTERS = json.loads((ROOT / 'public/data/chapters.json').read_text())['chapters']
FIXTURE = {'done': [c['id'] for c in CHAPTERS], 'flags': [], 'fired': {c['id']: [s['id'] for s in c['steps']] for c in CHAPTERS}, 'sideQuests': [], 'npcAt': {}}
LEGS = [('library-bookmark', 's3', [-80.90379, 89.5706, -.055]), ('admin-garden', 'gardener-hai', [-51.8, -61.5, .07])]


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'])
        page = await browser.new_page(viewport={'width': 1280, 'height': 800})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.add_init_script("if(!sessionStorage.getItem('f')){localStorage.clear();localStorage.setItem('nsysu-story-v3',%s);localStorage.setItem('nsysu-walk-guide-v7','1');sessionStorage.setItem('f','1')}" % json.dumps(json.dumps(FIXTURE)))
        await page.goto(URL, wait_until='networkidle')
        await page.wait_for_function('window.campusWalk?.questList?.length>=12 && window.campusWalk.worldReady && window.campusWalk.npcs?.length>0', timeout=180000)
        await page.wait_for_timeout(2000)
        for quest, person, (x, z, y) in LEGS:
            await page.evaluate('p=>window.campusWalk.qaPlace(p[0],p[1],p[2])', [x, z, y])
            await page.wait_for_timeout(800)
            await page.keyboard.press('j')
            await page.locator('.campus-journal:not([hidden])').wait_for(timeout=10000)
            await page.locator('[data-journal="tab"][data-id="tasks"]').click()
            await page.locator(f'[data-journal="select"][data-id="{quest}"]').click()
            await page.locator(f'[data-journal="go"][data-id="{quest}"]').click()
            t0 = time.monotonic()
            await page.wait_for_timeout(800)
            status = await page.locator('.walk-status').text_content()
            route = await page.evaluate('window.campusWalk.route.length')
            while route and time.monotonic() - t0 < 420:
                await page.wait_for_timeout(1500)
                skip = page.locator('[data-encounter="skip"]:visible')
                if await skip.count():
                    await skip.click()
                route = await page.evaluate('window.campusWalk.route.length')
            pos = await page.evaluate('window.campusWalk.position')
            npc = next(n for n in await page.evaluate('window.campusWalk.npcs') if n['id'] == person)
            distance = sum((a - b) ** 2 for a, b in zip(pos, npc['position'])) ** .5
            interaction = await page.evaluate('window.campusWalk.interaction')
            ok = distance < 4 and any(c['id'] == f'accept:{quest}' for c in interaction['candidates'])
            results.append({'quest': quest, 'person': person, 'passed': ok, 'status': status, 'distance': distance, 'seconds': round(time.monotonic() - t0), 'position': pos, 'candidates': interaction['candidates']})
            await page.screenshot(path=str(OUT / f'{quest}.png'))
            print(json.dumps(results[-1], ensure_ascii=False), flush=True)
        await browser.close()
    (OUT / 'results.json').write_text(json.dumps({'legs': results, 'errors': errors}, ensure_ascii=False, indent=1) + '\n')
    raise SystemExit(0 if all(r['passed'] for r in results) and not errors else 1)


if __name__ == '__main__':
    asyncio.run(main())
