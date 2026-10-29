#!/usr/bin/env python3
"""Campus map acceptance: renders, filters, building cards, search, and the hand-off into the 3D walk.
Writes artifacts/v3/T7/campus-map-qa.json and screenshots (desktop + 390x844 mobile)."""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/v3/T7'
URL = os.environ.get('CAMPUS_URL', 'http://127.0.0.1:5173/')


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    checks, errors = [], []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox', '--enable-unsafe-swiftshader'])
        for label, vp in [('desktop', {'width': 1440, 'height': 900}), ('mobile', {'width': 390, 'height': 844})]:
            page = await browser.new_page(viewport=vp, device_scale_factor=2 if label == 'mobile' else 1)
            page.on('pageerror', lambda e: errors.append(str(e)))
            await page.goto(URL, wait_until='networkidle')
            await page.wait_for_selector('.cm-b')
            n = await page.locator('.cm-b').count()
            checks.append({'name': f'{label}: buildings drawn', 'value': n, 'passed': n >= 20})
            overflow = await page.evaluate('document.documentElement.scrollWidth > innerWidth')
            checks.append({'name': f'{label}: no horizontal overflow', 'value': overflow, 'passed': not overflow})
            await page.screenshot(path=str(OUT / f'map-{label}.png'))
            # Click the library on the map.
            await page.locator('.cm-b[data-id="IL"] path').first.click(force=True)
            title = await page.locator('.cm-card h2').inner_text()
            checks.append({'name': f'{label}: clicking a building opens its card', 'value': title, 'passed': '圖資' in title})
            await page.screenshot(path=str(OUT / f'map-{label}-card.png'))
            # Filter teaching off.
            await page.locator('.cm-chip[data-kind="teaching"]').click()
            off = await page.locator('.cm-b.is-off').count()
            checks.append({'name': f'{label}: category filter dims buildings', 'value': off, 'passed': off >= 5})
            await page.locator('.cm-chip[data-kind="teaching"]').click()
            # Search.
            await page.fill('.cm-search input', '逸仙')
            hit = await page.locator('.cm-results [data-pick]').count()
            checks.append({'name': f'{label}: search finds 逸仙館', 'value': hit, 'passed': hit >= 1})
            await page.locator('.cm-results [data-pick]').first.click()
            checks.append({'name': f'{label}: search selects and zooms', 'value': await page.locator('.cm-card h2').inner_text(), 'passed': '逸仙' in await page.locator('.cm-card h2').inner_text()})
            if label == 'desktop':
                await page.locator('[data-zoom="0"]').click()
                # SC is a long L-shaped footprint whose bbox centre lies on the lawn: select it from the keyboard.
                await page.locator('.cm-b[data-id="SC"]').focus()
                await page.keyboard.press('Enter')
                await page.get_by_role('button', name='在 3D 帶我去 →').click()
                await page.wait_for_function('window.campusWalk?.navReady', timeout=90000)
                await page.wait_for_function('window.campusWalk.route.length > 0', timeout=30000)
                mode = await page.evaluate('window.campusWalk.mode')
                checks.append({'name': 'desktop: "take me there" opens 3D walking with a route', 'value': mode, 'passed': not mode['overview'] and mode['walking']})
                checks.append({'name': 'desktop: URL carries the target', 'value': page.url, 'passed': 'target=SC' in page.url})
                # v4: the toolbar is in the Esc menu (the first Esc stops the active auto-walk, the next opens the menu).
                for _ in range(2):
                    if await page.evaluate("!document.querySelector('.walk-menu').hidden"): break
                    await page.keyboard.press('Escape'); await page.wait_for_timeout(400)
                await page.get_by_role('button', name='校園地圖 ↗').click()
                await page.wait_for_selector('.walkthrough', state='detached')
                checks.append({'name': 'desktop: exit returns to the map', 'value': page.url, 'passed': 'view=walk' not in page.url and await page.locator('.cm-b').count() >= 20})
            await page.close()
        await browser.close()
    checks.append({'name': 'no JavaScript errors', 'value': errors[:3], 'passed': not errors})
    report = {'checks': checks, 'passed': sum(c['passed'] for c in checks), 'total': len(checks)}
    (OUT / 'campus-map-qa.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
    for c in checks:
        print(('PASS ' if c['passed'] else 'FAIL ') + c['name'], c['value'])
    print(f"{report['passed']}/{report['total']}")
    if report['passed'] != report['total']:
        raise SystemExit(1)


if __name__ == '__main__':
    asyncio.run(main())
