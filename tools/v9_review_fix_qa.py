#!/usr/bin/env python3
"""Two faults the independent review found, replayed in the browser: tapping the card's 支線 during a main-story dialogue must not
change line, and a person leaving campus mid-walk must end the walk rather than announce an arrival at an empty spot.
CAMPUS_WALK_URL picks the build, V9_REVIEW_OUT the folder."""
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:4180/')
OUT = Path(os.environ.get('V9_REVIEW_OUT', ROOT / 'artifacts/v9/review-fixes'))
parts = urlsplit(BASE)
query = dict(parse_qsl(parts.query))
query.update(view='walk', story='1', quality='C', qa='1', spawn='arcade')
URL = urlunsplit(parts._replace(query=urlencode(query)))
CHAPTERS = json.loads((ROOT / 'public/data/chapters.json').read_text())['chapters']
TIPS = json.dumps(['goal', 'accept', 'switch', 'bike', 'photo', 'line'])


async def open_page(browser, save):
    ctx = await browser.new_context(viewport={'width': 960, 'height': 540})
    await ctx.add_init_script('for (const [k, v] of Object.entries(%s)) localStorage.setItem(k, v);' % json.dumps({'nsysu-walk-guide-v7': '1', 'nsysu-walk-tips-v8': TIPS, **save}))
    page = await ctx.new_page()
    await page.goto(URL)
    await page.wait_for_function('window.campusWalk?.navReady', timeout=240000)
    await page.wait_for_timeout(1500)
    return ctx, page


async def card_during_dialogue(browser):
    ctx, page = await open_page(browser, {})
    await page.evaluate('window.campusWalk.qaSetQuest("gate-lost", 0)')
    await page.wait_for_timeout(500)
    await page.keyboard.press('q')  # back to the main story, the side quest stays open
    await page.wait_for_timeout(800)
    start = await page.evaluate('window.campusWalk.focus.line')
    goal = await page.evaluate('window.campusWalk.story?.goal ?? window.campusWalk.plan().goal')
    await page.evaluate('([x, y, z]) => window.campusWalk.qaPlace(x + 1.5, z + 1.5)', goal)
    for _ in range(12):
        await page.wait_for_timeout(500)
        if await page.evaluate('window.campusWalk.story?.dialogue'):
            break
        await page.keyboard.press('e')
    dialogue = await page.evaluate('!!window.campusWalk.story?.dialogue')
    tapped = await page.evaluate('''() => { const b = [...document.querySelectorAll('.q-objective button')].find(b => b.textContent.includes('支線')); if (!b) return false; b.click(); return true; }''')
    await page.wait_for_timeout(500)
    line = await page.evaluate('window.campusWalk.focus.line')
    await page.screenshot(path=str(OUT / 'card-during-dialogue.png'))
    await ctx.close()
    return {'start': start, 'inDialogue': dialogue, 'tapped': tapped, 'line': line, 'pass': start == 'main' and dialogue and tapped and line == 'main'}


async def person_leaves(browser):
    save = {'nsysu-story-v3': json.dumps({'done': [c['id'] for c in CHAPTERS], 'flags': [], 'fired': {c['id']: [s['id'] for s in c['steps']] for c in CHAPTERS}, 'sideQuests': []})}
    ctx, page = await open_page(browser, save)
    await page.evaluate('window.campusWalk.qaSetQuest("arcade-coffee", 0)')
    await page.wait_for_timeout(800)
    target = await page.evaluate('window.campusWalk.guide?.target')
    await page.evaluate('window.campusWalk.qaPlace(-20, -20)')
    await page.wait_for_timeout(1000)
    await page.keyboard.press('g')
    await page.wait_for_timeout(2000)
    walking = await page.evaluate('window.campusWalk.route.length')
    sky = ''
    for _ in range(3):
        await page.keyboard.press('n')
        await page.wait_for_timeout(1800)
        sky = await page.evaluate('document.querySelector("[data-action=sky]")?.textContent ?? ""')
        if '夜' in sky:
            break
    after = await page.evaluate('({route: window.campusWalk.route.length, follow: window.campusWalk.autoFollow, absent: window.campusWalk.npcs.find(n => n.id === window.campusWalk.guide?.target?.slice(4))?.absent})')
    body = await page.evaluate('document.body.innerText')
    await page.screenshot(path=str(OUT / 'person-leaves.png'))
    await ctx.close()
    return {'target': target, 'walking': walking, 'sky': sky, **after, 'arrivedClaim': '已抵達' in body, 'pass': walking > 0 and after['absent'] is True and after['route'] == 0 and not after['follow'] and '已抵達' not in body}


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
        results = {'card': await card_during_dialogue(browser), 'leaves': await person_leaves(browser)}
        await browser.close()
    (OUT / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=1))
    print(json.dumps(results, ensure_ascii=False))
    raise SystemExit(0 if all(r['pass'] for r in results.values()) else 1)

asyncio.run(main())
