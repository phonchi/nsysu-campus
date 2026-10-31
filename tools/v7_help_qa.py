#!/usr/bin/env python3
"""Desktop and 390x844 acceptance of the first-run guide and the permanent help entry, real input only."""
import asyncio
import json
import os
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('V7_ARTIFACTS', ROOT / 'artifacts/v7')) / 'help'
BASE = os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:4173/')
parts = urlsplit(BASE)
query = dict(parse_qsl(parts.query))
query.update(view='walk', story='1', quality='C', qa='1')
URL = urlunsplit(parts._replace(query=urlencode(query)))
PROFILES = [
    {'name': 'desktop', 'viewport': {'width': 1280, 'height': 800}, 'touch': False},
    {'name': 'mobile', 'viewport': {'width': 390, 'height': 844}, 'touch': True},
]


async def run(browser, profile, log):
    context = await browser.new_context(viewport=profile['viewport'], has_touch=profile['touch'], is_mobile=profile['touch'], device_scale_factor=1)
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    name = profile['name']
    result = {'name': name}

    async def ready():
        await page.goto(URL, wait_until='networkidle')
        await page.wait_for_function('window.campusWalk?.worldReady && window.campusWalk.story', timeout=180000)

    await ready()
    start = page.locator('[data-guide="start"]')
    await start.wait_for(state='visible', timeout=15000)
    result['guide_first_visit'] = True
    await page.screenshot(path=str(OUT / f'{name}-guide.png'))
    await start.click()
    await page.wait_for_timeout(400)
    result['guide_closed'] = not await start.is_visible()
    await page.screenshot(path=str(OUT / f'{name}-after-guide.png'))

    await ready()
    await page.wait_for_timeout(4000)
    result['guide_after_reload'] = await start.is_visible()

    button = page.locator('.walk-hudbar button', has_text='?')
    result['help_button_visible'] = await button.is_visible()
    await button.click()
    await page.wait_for_timeout(500)
    await page.screenshot(path=str(OUT / f'{name}-help-button.png'))
    result['help_text_from_button'] = (await page.locator('.walkthrough').inner_text()).count('自動前往') > 0
    await page.keyboard.press('Escape')
    await page.wait_for_timeout(400)

    if not profile['touch']:
        await page.keyboard.press('h')
        await page.wait_for_timeout(500)
        await page.screenshot(path=str(OUT / f'{name}-help-key.png'))
        result['help_panel_from_key'] = await page.locator('.walk-menu:visible, .walk-tabs:visible').count() > 0
        await page.keyboard.press('h')
        await page.wait_for_timeout(400)
        before = await page.evaluate('window.campusWalk.position')
        await page.keyboard.down('w')
        await page.wait_for_timeout(1500)
        await page.keyboard.up('w')
        after = await page.evaluate('window.campusWalk.position')
        result['walk_distance_after_help'] = round(sum((a - b) ** 2 for a, b in zip(before, after)) ** .5, 3)
    result['page_errors'] = errors
    await context.close()
    log(result)
    return result


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'params.json').write_text(json.dumps({'url': URL, 'profiles': PROFILES}, ensure_ascii=False, indent=2) + '\n')
    started = time.monotonic()
    with (OUT / 'run.log').open('w', buffering=1) as file:
        def log(value):
            line = json.dumps({'seconds': round(time.monotonic() - started, 1), **value}, ensure_ascii=False)
            print(line, flush=True)
            file.write(line + '\n')
        results = []
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True, args=['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'])
            try:
                for profile in PROFILES:
                    try:
                        results.append(await run(browser, profile, log))
                    except Exception as error:
                        log({'name': profile['name'], 'failed': str(error)})
                        results.append({'name': profile['name'], 'failed': str(error)})
            finally:
                await browser.close()
    (OUT / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')


asyncio.run(main())
