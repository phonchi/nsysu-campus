#!/usr/bin/env python3
"""Screenshot set + render stats for review: desktop (1440x900) day/sunset/night at four views, overview,
mobile (390x844, DPR 3) walk; writes artifacts/v3/T9/screens/*.png and stats.json."""
import asyncio, json, math, os
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/v3/T9/screens'
BASE = os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:5173/')


async def face(page, yaw, pitch=-.08):
    cam = await page.evaluate('window.campusWalk.camera')
    d = math.atan2(math.sin(yaw - cam['yaw']), math.cos(yaw - cam['yaw']))
    await page.mouse.move(640, 600); await page.mouse.down()
    await page.mouse.move(640 - d / .004, 600 + (cam['pitch'] - pitch) / .003, steps=8); await page.mouse.up()


async def open_walk(browser, viewport, scale, quality):
    page = await browser.new_page(viewport=viewport, device_scale_factor=scale, has_touch=scale > 1)
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    await page.goto(f'{BASE}?view=walk&quality={quality}', wait_until='networkidle')
    await page.wait_for_function('window.campusWalk?.navReady', timeout=120000)
    return page, errs


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    stats = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--no-sandbox', '--enable-unsafe-swiftshader'])
        page, errs = await open_walk(b, {'width': 1440, 'height': 900}, 1, 'A')
        await page.wait_for_timeout(3000)
        await page.screenshot(path=str(OUT / 'desktop-overview.png'))
        stats['desktop-overview'] = await page.evaluate('window.campusWalk.renderStats')
        await page.get_by_role('button', name='開始探索 →', exact=True).click(); await page.wait_for_timeout(4000)
        await page.mouse.wheel(0, 700)
        for sky in ['day', 'sunset', 'night']:
            for name, yaw in [('admin', 0), ('arcade', -math.pi / 2), ('south', math.pi)]:
                await face(page, yaw); await page.wait_for_timeout(1800)
                await page.screenshot(path=str(OUT / f'desktop-{sky}-{name}.png'))
                stats[f'desktop-{sky}-{name}'] = await page.evaluate('window.campusWalk.renderStats')
            await page.keyboard.press('n'); await page.wait_for_timeout(2500)
        stats['desktopErrors'] = errs
        await page.close()
        for q in ['B', 'C']:
            page, errs = await open_walk(b, {'width': 390, 'height': 844}, 3, q)
            await page.wait_for_timeout(2000)
            await page.locator('[data-action=start]').first.click(); await page.wait_for_timeout(4000)
            await page.screenshot(path=str(OUT / f'mobile-{q}-walk.png'))
            stats[f'mobile-{q}-walk'] = await page.evaluate('({...window.campusWalk.renderStats, tier: window.campusWalk.mode.tier})')
            stats[f'mobile-{q}-errors'] = errs
            await page.close()
        await b.close()
    (OUT / 'stats.json').write_text(json.dumps(stats, ensure_ascii=False, indent=1) + '\n')
    print(json.dumps(stats, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
