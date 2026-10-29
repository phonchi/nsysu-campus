"""Smoke: repeated character switching must not grow GPU geometries; exit must be clean."""
import asyncio, json, sys
from pathlib import Path
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5173/'
OUT = Path(__file__).resolve().parents[1]/'artifacts/p2'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 800}); errors = []
        pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        await pg.goto(URL, timeout=120000); await pg.wait_for_function('!!window.campusWalk', timeout=240000); await pg.wait_for_timeout(4000)
        geo = []
        for k in ['f', 'm', 'f', 'm']:
            await pg.locator(f'[data-body={k}]').click(); await pg.wait_for_timeout(1800)
            geo.append((await pg.evaluate('window.campusWalk.renderStats'))['geometries'])
        await pg.locator('[data-action=exit]').first.click(); await pg.wait_for_timeout(2000)
        gone = await pg.evaluate('!window.campusWalk && !document.querySelector(".walkthrough")')
        res = {'geometriesAfterEachSwitch': geo, 'stable': max(geo[2:]) - min(geo[2:]) <= 2, 'exitClean': gone, 'errors': errors}
        (OUT/'lifecycle-check.json').write_text(json.dumps(res, ensure_ascii=False, indent=1)); print(res); await b.close()
asyncio.run(main())
