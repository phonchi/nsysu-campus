#!/usr/bin/env python3
"""v4 screenshot set + render stats (spec-v4 §12, §15.11).

Same views as tools/v3_screens.py (desktop 1440x900 at the spawn: admin / arcade / south x day / sunset / night,
overview; mobile 390x844 DPR 3 at tiers B and C) plus v4 views: gate, tunnel, seawall (sunset), a dialogue with
choices, the Esc menu and album, and a mobile dialogue. Writes artifacts/v4/screens/*.png + stats.json, and
side-by-side v3 | v4 pairs to artifacts/v4/comparison/. Placement uses the QA-only qaPlace hook (?qa=1)."""
import asyncio, json, math, os
from pathlib import Path
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/v4/screens'
CMP = ROOT / 'artifacts/v4/comparison'
V3 = ROOT / 'artifacts/v3/T9/screens'
BASE = os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:5173/')
STATS = '({...window.campusWalk.renderStats, tier: window.campusWalk.mode.tier})'


async def face(page, yaw, pitch=-.08):
    cam = await page.evaluate('window.campusWalk.camera')
    d = math.atan2(math.sin(yaw - cam['yaw']), math.cos(yaw - cam['yaw']))
    await page.mouse.move(640, 600); await page.mouse.down()
    await page.mouse.move(640 - d / .004, 600 + (cam['pitch'] - pitch) / .003, steps=8); await page.mouse.up()


async def open_walk(browser, viewport, scale, quality):
    page = await browser.new_page(viewport=viewport, device_scale_factor=scale, has_touch=scale > 1)
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    await page.goto(BASE, wait_until='networkidle'); await page.evaluate('localStorage.clear()')
    await page.goto(f'{BASE}?view=walk&quality={quality}&qa=1&spawn=arcade', wait_until='networkidle')
    await page.wait_for_function('window.campusWalk?.navReady', timeout=120000)
    return page, errs


async def tap(page, selector, touch=False):
    box = await page.locator(selector).first.bounding_box()
    if not box: return False
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    if touch: await page.touchscreen.tap(x, y)
    else: await page.mouse.click(x, y)
    return True


async def talk_to(page, npc, touch=False):
    """Open `npc`'s conversation and advance to its first choices (keyboard E, or taps on mobile)."""
    name = None
    for _ in range(4):  # the NPC may still be walking to its spot: re-aim until the hint names them
        n = next(x for x in await page.evaluate('window.campusWalk.npcs') if x['id'] == npc)
        x, _, z = n['position']
        await page.evaluate(f'window.campusWalk.qaPlace({x + .9},{z + .3})'); await page.wait_for_timeout(1500)
        name = await page.evaluate("document.querySelector('.q-hint:not([hidden])')?.textContent")
        if name: break
    if touch:
        await page.touchscreen.tap(200, 300); await page.wait_for_timeout(300)  # first touch reveals the touch controls
        await tap(page, '.walk-actions [data-action=door]', True)
    else: await page.keyboard.press('e')
    for _ in range(20):
        await page.wait_for_timeout(700)
        t = await page.evaluate('window.campusWalk.talk')
        if t['choices']: return True
        if touch: await tap(page, '.q-dialog .text', True)
        else: await page.keyboard.press('e')
    return False


async def main():
    OUT.mkdir(parents=True, exist_ok=True); CMP.mkdir(parents=True, exist_ok=True)
    for old in [*OUT.glob('*.png'), *CMP.glob('*.png')]: old.unlink()  # no stale image can pass for this run
    stats = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--no-sandbox', '--enable-unsafe-swiftshader'])
        page, errs = await open_walk(b, {'width': 1440, 'height': 900}, 1, 'A')
        await page.wait_for_timeout(3000)
        await page.screenshot(path=str(OUT / 'desktop-overview.png')); stats['desktop-overview'] = await page.evaluate(STATS)
        await page.locator('[data-action=start]').first.click(); await page.wait_for_timeout(4000)
        spawn = await page.evaluate('window.campusWalk.position')
        if await talk_to(page, 'coffee-kai'):
            await page.wait_for_timeout(600); await page.screenshot(path=str(OUT / 'desktop-dialog.png')); stats['desktop-dialog'] = await page.evaluate(STATS)
            for _ in range(15):
                t = await page.evaluate('window.campusWalk.talk')
                if not t['busy']: break
                await page.keyboard.press('1' if t['choices'] else 'e'); await page.wait_for_timeout(600)
        await page.keyboard.press('Escape'); await page.wait_for_timeout(800)
        await page.screenshot(path=str(OUT / 'desktop-esc.png'))
        box = await page.locator('[data-tab=album]').bounding_box(); await page.mouse.click(box['x'] + 10, box['y'] + 10); await page.wait_for_timeout(600)
        await page.screenshot(path=str(OUT / 'desktop-album.png'))
        await page.keyboard.press('Escape')
        await page.evaluate(f'window.campusWalk.qaPlace({spawn[0]},{spawn[2]})'); await page.wait_for_timeout(1500)
        await page.mouse.wheel(0, 700)
        for sky in ['day', 'sunset', 'night']:
            for name, yaw in [('admin', 0), ('arcade', -math.pi / 2), ('south', math.pi)]:
                await face(page, yaw); await page.wait_for_timeout(2200)
                await page.screenshot(path=str(OUT / f'desktop-{sky}-{name}.png')); stats[f'desktop-{sky}-{name}'] = await page.evaluate(STATS)
            await page.keyboard.press('n'); await page.wait_for_timeout(2600)
        # v4 places (day, then the seawall at sunset).
        # Each place: stand at (x, z) and look at (tx, tz) (yaw convention of the camera rig: forward = (-sin, -cos)).
        for name, x, z, tx, tz in [('gate', -66, 616, -84, 596), ('tunnel', 4, 145, 20, 149), ('library', -63, -10, -63, -40), ('seawall', -296, 470, -400, 455)]:
            if name == 'seawall': await page.keyboard.press('n'); await page.wait_for_timeout(2600)
            await page.evaluate(f'window.campusWalk.qaPlace({x},{z})'); await page.wait_for_timeout(1500)
            await face(page, math.atan2(-(tx - x), -(tz - z))); await page.wait_for_timeout(2500)
            key = f"desktop-{'sunset' if name == 'seawall' else 'day'}-{name}"
            await page.screenshot(path=str(OUT / f'{key}.png')); stats[key] = await page.evaluate(STATS)
        stats['desktopErrors'] = errs; stats['spawn'] = spawn
        await page.close()
        for q in ['B', 'C']:
            page, errs = await open_walk(b, {'width': 390, 'height': 844}, 3, q)
            await page.wait_for_timeout(2000)
            await page.locator('[data-action=start]').first.click(); await page.wait_for_timeout(4000)
            await page.screenshot(path=str(OUT / f'mobile-{q}-walk.png')); stats[f'mobile-{q}-walk'] = await page.evaluate(STATS)
            if q == 'B' and await talk_to(page, 'coffee-kai', touch=True):
                await page.wait_for_timeout(600); await page.screenshot(path=str(OUT / 'mobile-dialog.png'))
                await tap(page, '.q-choices button', True)  # choices are tappable
                stats['mobile-dialog-choice-tapped'] = not bool((await page.evaluate('window.campusWalk.talk'))['choices'])
            stats[f'mobile-{q}-errors'] = errs
            await page.close()
        await b.close()
    (OUT / 'stats.json').write_text(json.dumps(stats, ensure_ascii=False, indent=1) + '\n')
    # v3 | v4 pairs for every view both versions have.
    font = None
    for f in ['data/sources/fonts/NotoSansTC-VF.ttf']:
        try: font = ImageFont.truetype(str(ROOT / f), 28)
        except OSError: pass
    for v4 in sorted(OUT.glob('*.png')):
        v3 = V3 / v4.name
        if not v3.exists(): continue
        a, c = Image.open(v3).convert('RGB'), Image.open(v4).convert('RGB')
        h = 450; a = a.resize((round(a.width * h / a.height), h)); c = c.resize((round(c.width * h / c.height), h))
        out = Image.new('RGB', (a.width + c.width + 12, h + 44), '#fbf6ea'); out.paste(a, (0, 44)); out.paste(c, (a.width + 12, 44))
        d = ImageDraw.Draw(out); d.text((8, 6), 'v3', fill='#1d2a3a', font=font); d.text((a.width + 20, 6), 'v4', fill='#1d2a3a', font=font)
        out.save(CMP / v4.name)
    print(json.dumps({k: v for k, v in stats.items() if isinstance(v, dict)}, ensure_ascii=False))
    required = ['desktop-overview', *[f'desktop-{s}-{v}' for s in ('day', 'sunset', 'night') for v in ('admin', 'arcade', 'south')],
                'desktop-day-gate', 'desktop-day-tunnel', 'desktop-day-library', 'desktop-sunset-seawall', 'desktop-dialog', 'desktop-esc', 'desktop-album',
                'mobile-B-walk', 'mobile-C-walk', 'mobile-dialog']
    missing = [r for r in required if not (OUT / f'{r}.png').exists()]
    errors = stats.get('desktopErrors', []) + stats.get('mobile-B-errors', []) + stats.get('mobile-C-errors', [])
    if missing or errors or not stats.get('mobile-dialog-choice-tapped'):
        print(json.dumps({'missing': missing, 'errors': errors[:5], 'mobileChoiceTapped': stats.get('mobile-dialog-choice-tapped')}, ensure_ascii=False))
        raise SystemExit(1)


if __name__ == '__main__':
    asyncio.run(main())
