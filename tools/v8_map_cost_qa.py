#!/usr/bin/env python3
"""Cost of the 2D map tab: draw calls and Chromium RSS with the menu closed, on another tab, then on the map. V8_OUT picks the folder."""
import asyncio
import json
import os
from pathlib import Path
import psutil
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('V8_OUT', ROOT / 'artifacts/v8/map-cost'))
URL = os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:4173/') + '?view=walk&story=1&quality=C&qa=1'


def rss():
    total = 0
    for proc in psutil.process_iter(['cmdline', 'memory_info']):
        try:
            if any('--enable-unsafe-swiftshader' in arg for arg in proc.info['cmdline'] or []):
                total += proc.info['memory_info'].rss
        except psutil.Error:
            pass
    return round(total / 1e6, 1)


async def sample(page, label, report):
    await page.wait_for_timeout(5000)
    report[label] = {'render': await page.evaluate('window.campusWalk.renderStats'), 'rssMB': rss()}
    print(label, report[label], flush=True)


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    report, errors = {'url': URL}, []
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        page = await (await browser.new_context(viewport={'width': 1280, 'height': 720})).new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.add_init_script('localStorage.setItem("nsysu-walk-guide-v7", "1")')
        await page.goto(URL, wait_until='load', timeout=180000)
        await page.wait_for_function('window.campusWalk?.worldReady && window.campusWalk.story', timeout=240000)
        await page.wait_for_timeout(15000)
        await sample(page, 'walking', report)
        await page.locator('.walk-hudbar [data-action=menu]').click()
        await sample(page, 'menu-other-tab', report)
        await page.locator('[data-tab=map]').click()
        await sample(page, 'map-open', report)
        for kind in ('stamp', 'bike', 'quest'):
            await page.locator(f'[data-map-kind={kind}]').click()
        await sample(page, 'map-toggled', report)
        await page.keyboard.press('Escape')
        await sample(page, 'closed-again', report)
        await browser.close()
    report['errors'] = errors
    (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=1))


asyncio.run(main())
