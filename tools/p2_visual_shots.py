"""P2 visual evidence: desktop + mobile screenshots of the redesigned campus (SwiftShader, not GPU perf)."""
import asyncio, json, sys
from pathlib import Path
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5173/'
OUT = Path(__file__).resolve().parents[1]/'artifacts/p2'; OUT.mkdir(parents=True, exist_ok=True)
async def run(p, name, vw, vh, mobile):
    b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = await b.new_context(viewport={'width': vw, 'height': vh}, is_mobile=mobile, has_touch=mobile, device_scale_factor=1)
    pg = await ctx.new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    await pg.goto(URL, timeout=120000); await pg.wait_for_function('!!window.campusWalk', timeout=240000); await pg.wait_for_timeout(4000)
    stats = {}
    async def shot(tag): await pg.screenshot(path=str(OUT/f'{name}-{tag}.png')); stats[tag] = await pg.evaluate('window.campusWalk.renderStats')
    await shot('welcome')
    await pg.locator('[data-action=start]').first.click(); await pg.wait_for_timeout(3000); await shot('walk')
    if not mobile:
        await pg.locator('.walk-toolbar [data-action=overview]').click(); await pg.wait_for_timeout(3000)
        await pg.select_option('[data-floor]', index=2); await pg.wait_for_timeout(3000); await shot('floor-cut')
        await pg.select_option('[data-floor]', 'all'); await pg.wait_for_timeout(1500)
        await pg.keyboard.press('n'); await pg.wait_for_timeout(2500); await shot('sunset')
        await pg.keyboard.press('n'); await pg.wait_for_timeout(2500); await shot('night')
        await pg.keyboard.press('n'); await pg.wait_for_timeout(1500)
        await pg.locator('.walk-label').first.click(); await pg.wait_for_timeout(1200); await shot('info-card')
    (OUT/f'{name}-stats.json').write_text(json.dumps({'stats': stats, 'errors': errors}, ensure_ascii=False, indent=1))
    print(name, stats, 'errors', errors[:5]); await b.close()
async def main():
    async with async_playwright() as p:
        await run(p, 'desktop', 1440, 900, False); await run(p, 'mobile', 390, 844, True)
asyncio.run(main())
