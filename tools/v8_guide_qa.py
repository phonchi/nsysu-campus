#!/usr/bin/env python3
"""Guidance acceptance: the pillar fades on approach (real G walk, same script on any build) and a tracked side quest
takes over every guide. Save fixtures and qaPlace only set the scene. CAMPUS_WALK_URL picks the build; V8_OUT the folder."""
import asyncio
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:4173/')
OUT = Path(os.environ.get('V8_OUT', ROOT / 'artifacts/v8/guide/after'))
PHASES = sys.argv[1:] or ['beacon', 'tracked']
parts = urlsplit(BASE)
query = dict(parse_qsl(parts.query))
query.update(view='walk', story='1', quality='C', qa='1')
URL = urlunsplit(parts._replace(query=urlencode(query)))
CHAPTERS = json.loads((ROOT / 'public/data/chapters.json').read_text())['chapters']
ZONES = json.loads((ROOT / 'public/data/story-zones.json').read_text())['zones']
STORY, QUEST, GUIDE = 'nsysu-story-v3', 'nsysu-campus-journal-v5', 'nsysu-walk-guide-v7'


def story(done):
    ids = [c['id'] for c in CHAPTERS]
    return {'done': ids[:done], 'active': ids[done], 'flags': [], 'fired': {c: [s['id'] for s in CHAPTERS[i]['steps']] for i, c in enumerate(ids[:done])}, 'sideQuests': [], 'npcAt': {}}


def quest(tracked):
    return {'version': 1, 'quests': {'gate-mia': {'status': 'active', 'step': 0, 'choices': {}, 'photoBaseline': 0}}, 'journal': [], 'rewards': [], 'tracked': tracked, 'legacySnapshotTaken': True}


async def open_page(browser, viewport, touch, save):
    context = await browser.new_context(viewport=viewport, has_touch=touch, is_mobile=touch)
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    await page.add_init_script('for (const [k, v] of Object.entries(%s)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));' % json.dumps(save))
    await page.goto(URL, wait_until='load', timeout=180000)
    await page.wait_for_function('window.campusWalk?.worldReady && window.campusWalk.story', timeout=240000)
    await page.wait_for_timeout(4000)
    return context, page, errors


async def close_dialogue(page):
    for _ in range(40):
        if await page.evaluate("document.querySelector('.q-dialog')?.hidden !== false"):
            return
        await page.keyboard.press('e')
        await page.wait_for_timeout(500)


async def state(page):
    return await page.evaluate('''() => {
      const text = s => document.querySelector(s)?.textContent ?? null, shown = s => { const e = document.querySelector(s); return !!e && !e.hidden; };
      return { guide: window.campusWalk.guide ?? null, position: window.campusWalk.position, dist: text('.q-dist'), badge: shown('.q-badge') ? text('.q-badge b') : null,
        badgeDistance: shown('.q-badge') ? text('.q-badge small') : null, pocket: shown('.quest-pocket') ? text('.quest-pocket strong') : null };
    }''')


async def beacon(browser, report):
    # v7 drew no pillar for a tracked side quest, and a chapter zone hands over on entry, so this runs on the tracked zone step.
    save = quest('gate-mia')
    save['quests']['gate-mia']['step'] = 1
    context, page, errors = await open_page(browser, {'width': 1280, 'height': 720}, False, {STORY: story(4), QUEST: save, GUIDE: '1'})
    await close_dialogue(page)
    p = ZONES['admin']['p']
    shots = {}
    for mark in (30, 12, 8, 5, 3):
        await page.evaluate('([x, z, fx, fz]) => window.campusWalk.qaPlace(x, z, undefined, [fx, fz])', [p[0] + mark, p[1], p[0], p[1]])
        await page.wait_for_timeout(3500)
        await close_dialogue(page)
        await page.wait_for_timeout(1000)
        shots[mark] = {'pocket': (await state(page))['pocket'], 'beacon': await page.evaluate('window.campusWalk.guideBeacon')}
        await page.screenshot(path=str(OUT / f'beacon-{mark}m.png'))
    report['beacon'] = {'shots': shots, 'errors': errors}
    await context.close()


async def tracked(browser, report, name, viewport, touch):
    result = {}
    context, page, errors = await open_page(browser, viewport, touch, {STORY: story(4), QUEST: quest('gate-mia'), GUIDE: '1'})
    s = await state(page)
    result['tracked'] = s
    await close_dialogue(page)
    await page.wait_for_timeout(1500)
    await page.screenshot(path=str(OUT / f'{name}-far.png'))
    point = s['guide'] and s['guide']['point']
    if point:
        await close_dialogue(page)
        await page.evaluate('([x, z, fx, fz]) => window.campusWalk.qaPlace(x, z, undefined, [fx, fz])', [point[0] + 14, point[2], point[0], point[2]])
        await page.wait_for_timeout(5000)
        await close_dialogue(page)
        await page.wait_for_timeout(1500)
    result['near'] = await state(page)
    await page.screenshot(path=str(OUT / f'{name}-tracked.png'))
    await context.close()
    errors_all = list(errors)
    context, page, errors = await open_page(browser, viewport, touch, {STORY: story(4), QUEST: quest(None), GUIDE: '1'})
    await close_dialogue(page)
    await page.wait_for_timeout(1500)
    result['untracked'] = await state(page)
    await page.screenshot(path=str(OUT / f'{name}-untracked.png'))
    await context.close()
    result['errors'] = errors_all + errors
    report[name] = result


async def tips(browser, report, name, viewport, touch):
    result = {}
    context = await browser.new_context(viewport=viewport, has_touch=touch, is_mobile=touch)
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    await page.add_init_script('for (const [k, v] of Object.entries(%s)) if (localStorage.getItem(k) === null) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));' % json.dumps({STORY: story(4), GUIDE: '1', QUEST: quest(None) | {'quests': {}}}))
    await page.add_init_script("window.__lines = []; new MutationObserver(() => { const t = document.querySelector('.walk-loading small')?.textContent; if (t && window.__lines.at(-1) !== t) window.__lines.push(t); }).observe(document, { subtree: true, childList: true, characterData: true });")
    await page.goto(URL, wait_until='commit', timeout=180000)
    await page.locator('.walk-loading small').wait_for(state='visible', timeout=60000)
    await page.screenshot(path=str(OUT / f'{name}-loading.png'), timeout=120000)
    await page.wait_for_function('window.campusWalk?.worldReady && window.campusWalk.story', timeout=240000)
    result['loading_lines'] = await page.evaluate('window.__lines')
    await page.wait_for_timeout(3000)
    await close_dialogue(page)
    p = [-55, -29]
    await page.evaluate('([x, z, fx, fz]) => window.campusWalk.qaPlace(x, z, undefined, [fx, fz])', [p[0] + 2, p[1], p[0], p[1]])
    tip = None
    for _ in range(40):
        tip = await page.evaluate("(() => { const e = document.querySelector('.walk-tip'); return e && !e.hidden ? e.textContent : null; })()")
        if tip and '拜託' in tip:
            break
        await page.wait_for_timeout(500)
        await close_dialogue(page)
    result['accept_tip'] = tip
    await page.screenshot(path=str(OUT / f'{name}-tip.png'))
    if not touch:
        before = await page.evaluate('window.campusWalk.position')
        await page.keyboard.down('s')
        await page.wait_for_timeout(1500)
        await page.keyboard.up('s')
        after = await page.evaluate('window.campusWalk.position')
        result['walk_during_tip'] = round(sum((a - b) ** 2 for a, b in zip(before, after)) ** .5, 3)
    await page.reload(wait_until='load')
    await page.wait_for_function('window.campusWalk?.worldReady && window.campusWalk.story', timeout=240000)
    await page.wait_for_timeout(3000)
    await close_dialogue(page)
    await page.evaluate('([x, z, fx, fz]) => window.campusWalk.qaPlace(x, z, undefined, [fx, fz])', [p[0] + 2, p[1], p[0], p[1]])
    await page.wait_for_timeout(5000)
    result['accept_tip_after_reload'] = await page.evaluate("(() => { const e = document.querySelector('.walk-tip'); return e && !e.hidden ? e.textContent : null; })()")
    result['errors'] = errors
    await context.close()
    report[f'tips-{name}'] = result


async def guard(browser, report):
    result = {}
    newer = json.dumps({'saveVersion': 99, 'done': ['future']})
    context, page, errors = await open_page(browser, {'width': 1280, 'height': 720}, False, {STORY: newer, GUIDE: '1'})
    await page.wait_for_timeout(3000)
    print('guard: newer save loaded', flush=True)
    result['newer_save_kept'] = await page.evaluate(f"localStorage.getItem({STORY!r})") == newer
    result['notice'] = await page.evaluate("document.querySelector('.walk-status')?.textContent")
    await page.screenshot(path=str(OUT / 'guard-newer-save.png'))
    result['errors_newer'] = errors
    await context.close()
    print('guard: line banner', flush=True)
    context = await browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari Line/14.0.0')
    page = await context.new_page()
    await page.goto(URL, wait_until='commit', timeout=180000)
    await page.locator('.walk-webview').wait_for(state='visible', timeout=60000)
    await page.screenshot(path=str(OUT / 'guard-line-banner.png'), timeout=120000)
    await page.wait_for_timeout(30000)
    await page.screenshot(path=str(OUT / 'guard-line-banner-over-guide.png'), timeout=120000)
    await page.locator('[data-webview=close]').click(timeout=60000)
    result['line_banner_closes'] = await page.locator('.walk-webview').count() == 0
    await context.close()
    context, page, errors = await open_page(browser, {'width': 1280, 'height': 720}, False, {GUIDE: '1', 'nsysu-walk-sound': 'off'})
    print('guard: sound', flush=True)
    result['no_banner_in_browser'] = await page.locator('.walk-webview').count() == 0
    await close_dialogue(page)
    await page.locator('.walk-hudbar [data-action=sound]').first.click()
    await page.wait_for_timeout(1500)
    result['sound_on'] = await page.evaluate('window.campusWalk.sound.state')
    hide = "(h) => { Object.defineProperty(document, 'hidden', { value: h, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }"
    await page.evaluate(hide, True)
    await page.wait_for_timeout(800)
    result['sound_hidden'] = await page.evaluate('window.campusWalk.sound.state')
    await page.evaluate(hide, False)
    await page.wait_for_timeout(800)
    result['sound_back'] = await page.evaluate('window.campusWalk.sound.state')
    result['errors_sound'] = errors
    await context.close()
    report['guard'] = result


async def campus_map(browser, report, name, viewport, touch):
    result = {}
    context, page, errors = await open_page(browser, viewport, touch, {STORY: story(4), QUEST: quest(None), GUIDE: '1'})
    await close_dialogue(page)
    await page.locator('.walk-hudbar [data-action=menu]').click()
    await page.locator('[data-tab=map]').click()
    await page.wait_for_timeout(1200)
    await page.screenshot(path=str(OUT / f'{name}-map.png'))
    box = await page.locator('.walk-map-canvas').bounding_box()
    frame_target = await page.evaluate("""() => { const q = window.campusWalk.questList.find(v => v.definition.id === 'gate-mia'); return q ? [-55, -29] : null; }""")
    result['canvas'] = box
    view = {'x0': -420, 'z0': -180, 'x1': 180, 'z1': 700}
    scale = min(box['width'] / (view['x1'] - view['x0']), box['height'] / (view['z1'] - view['z0']))
    x0 = view['x0'] - (box['width'] / scale - (view['x1'] - view['x0'])) / 2
    z0 = view['z0'] - (box['height'] / scale - (view['z1'] - view['z0'])) / 2
    tap = (box['x'] + (frame_target[0] - x0) * scale, box['y'] + (frame_target[1] - z0) * scale)
    await page.locator('[data-map-kind=stamp]').click()
    await page.wait_for_timeout(400)
    if touch:
        await page.touchscreen.tap(*tap)
    else:
        await page.mouse.click(*tap)
    await page.wait_for_timeout(600)
    result['picked'] = await page.locator('.walk-map-pick span').inner_text()
    await page.screenshot(path=str(OUT / f'{name}-map-picked.png'))
    start = await page.evaluate('window.campusWalk.position')
    await page.locator('[data-map-go]').click()
    await page.wait_for_timeout(9000)
    result['menu_closed'] = await page.locator('.walk-menu').is_hidden()
    result['walked'] = round(sum((a - b) ** 2 for a, b in zip(start, await page.evaluate('window.campusWalk.position'))) ** .5, 2)
    result['tracked'] = await page.evaluate('window.campusWalk.guide')
    result['status'] = await page.evaluate("document.querySelector('.walk-status')?.textContent")
    await page.screenshot(path=str(OUT / f'{name}-map-go.png'))
    result['errors'] = errors
    await context.close()
    report[f'map-{name}'] = result


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    report = {'url': URL, 'phases': PHASES}
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        if 'beacon' in PHASES:
            await beacon(browser, report)
        if 'tracked' in PHASES:
            await tracked(browser, report, 'desktop', {'width': 1280, 'height': 720}, False)
            await tracked(browser, report, 'mobile', {'width': 390, 'height': 844}, True)
        if 'tips' in PHASES:
            await tips(browser, report, 'desktop', {'width': 1280, 'height': 720}, False)
            await tips(browser, report, 'mobile', {'width': 390, 'height': 844}, True)
        if 'map' in PHASES:
            await campus_map(browser, report, 'desktop', {'width': 1280, 'height': 720}, False)
            await campus_map(browser, report, 'mobile', {'width': 390, 'height': 844}, True)
        if 'guard' in PHASES:
            await guard(browser, report)
        await browser.close()
    (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))


asyncio.run(main())
