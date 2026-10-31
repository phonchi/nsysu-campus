#!/usr/bin/env python3
"""Can the player see what each quest step is about? For every step of every quest: start a short way off, press G as a
player would, and at the end of the walk assert that the object or person is in frame and is the first thing a ray from the
camera meets, that E offers this step, and that only this step's object exists. A screenshot of each step goes into a montage
meant to be looked at. qaPlace and qaSetQuest only set the scene (the full walks are tools/v7_quests_qa.py).
CAMPUS_WALK_URL picks the build, V9_VISIBILITY_OUT the folder; arguments limit the run to these quest ids."""
import asyncio
import json
import math
import os
import sys
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from PIL import Image, ImageDraw, ImageFont
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:4180/')
OUT = Path(os.environ.get('V9_VISIBILITY_OUT', ROOT / 'artifacts/v9/visibility'))
VIEWPORT = {'width': 960, 'height': 540}
parts = urlsplit(BASE)
query = dict(parse_qsl(parts.query))
query.update(view='walk', story='1', quality='B', qa='1', spawn='arcade')
URL = urlunsplit(parts._replace(query=urlencode(query)))
DATA = json.loads((ROOT / 'public/data/quests.json').read_text())
NPCS = {n['id']: n for n in json.loads((ROOT / 'public/data/npcs.json').read_text())['npcs']}
CHAPTERS = json.loads((ROOT / 'public/data/chapters.json').read_text())['chapters']
FONT = next((p for p in ('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc', '/mnt/c/Windows/Fonts/msjh.ttc') if Path(p).exists()), None)
SAVE = {
    'nsysu-walk-guide-v7': '1',
    'nsysu-walk-tips-v8': json.dumps(['goal', 'accept', 'switch', 'bike', 'photo', 'line']),
    'nsysu-story-v3': json.dumps({'done': [c['id'] for c in CHAPTERS], 'flags': [], 'fired': {c['id']: [s['id'] for s in c['steps']] for c in CHAPTERS}, 'sideQuests': [], 'npcAt': {}}),
}
LABEL = {'day': '白天', 'sunset': '夕陽', 'night': '夜晚'}


def preset_for(step, quest):
    """The time this step can happen in: its own, else the first in which its person is on campus."""
    if step.get('when'):
        return step['when']
    kind, _, name = step['target'].partition(':')
    if kind == 'npc':
        return next(t for t in ('day', 'sunset', 'night') if NPCS[name]['schedule'].get(t))
    return 'day'


async def set_time(page, preset):
    for _ in range(3):
        if LABEL[preset] in await page.evaluate('document.querySelector("[data-action=sky]")?.textContent ?? ""'):
            return
        await page.keyboard.press('n')
        await page.wait_for_timeout(1500)
    raise RuntimeError(f'time of day not reached: {preset}')


async def clear_modal(page):
    for _ in range(40):
        if not await page.evaluate('window.campusWalk.story?.dialogue'):
            break
        await page.keyboard.press('e')
        await page.wait_for_timeout(300)
    skip = page.locator('[data-encounter="skip"]:visible')
    if await skip.count():
        await skip.click()
        await page.wait_for_timeout(200)


async def walk(page, seconds=45):
    """Press G and wait for the auto-walk to end, however it ends. Returns the status text it left."""
    await page.keyboard.press('g')
    await page.wait_for_timeout(600)
    start = time.monotonic()
    while time.monotonic() - start < seconds:
        await clear_modal(page)
        if not await page.evaluate('window.campusWalk.route.length'):
            return await page.locator('.walk-status').text_content()
        await page.wait_for_timeout(500)
    return 'TIMEOUT: ' + (await page.locator('.walk-status').text_content() or '')


async def check_step(page, quest, index, step, shots, report):
    qid, target = quest['id'], step['target']
    tag = f'{qid}-{index + 1}-{step["id"]}'
    row = {'quest': qid, 'step': step['id'], 'target': target, 'kind': step.get('kind', 'interact'), 'problems': []}
    report['steps'].append(row)
    kind, _, name = target.partition(':')
    await set_time(page, preset_for(step, quest))
    await page.evaluate('([id, step]) => window.campusWalk.qaSetQuest(id, step)', [qid, index])
    await page.wait_for_timeout(1500)
    guide = await page.evaluate('window.campusWalk.guide')
    point = guide and guide.get('point')
    if not point:
        row['problems'].append('no goal point')
        return
    row['time'] = preset_for(step, quest)
    # Start a little way off, on the side the object faces, and let G do the last stretch.
    if kind == 'spot':
        s = DATA['spots'][name]
        facing = math.atan2(s['stand'][0] - s['at'][0], s['stand'][1] - s['at'][1])
    else:
        facing = 0
    # The side it faces first, then round the compass: somewhere off a building or a bench with a route to the goal.
    for turn in (0, 1, -1, 2, -2, 3, -3, 4):
        a = facing + turn * math.pi / 4
        reference = DATA['spots'][name].get('at') if kind == 'spot' else [point[0], point[2]]
        x, z = reference[0] + math.sin(a) * 9, reference[1] + math.cos(a) * 9
        row['placed'] = await page.evaluate('([x, y, z]) => window.campusWalk.qaPlace(x, z, y + .1) || window.campusWalk.qaPlace(x, z)', [x, point[1], z])
        await page.wait_for_timeout(600)
        await clear_modal(page)
        row['plan'] = (await page.evaluate('(t) => window.campusWalk.plan(t)', target)).get('plan')
        if row['placed'] and row['plan']:
            break
    await page.wait_for_timeout(1600)
    await clear_modal(page)
    row['from'] = await page.evaluate('window.campusWalk.position')
    row['status'] = await walk(page)
    await page.wait_for_timeout(1400)
    row['position'] = await page.evaluate('window.campusWalk.position')
    view = await page.evaluate('(t) => window.campusWalk.qaTargetView(t)', target)
    row['view'] = view
    row['interaction'] = await page.evaluate('window.campusWalk.interaction')
    row['spots'] = [s['id'] for s in await page.evaluate('window.campusWalk.questSpots')]
    row['focus'] = await page.evaluate('window.campusWalk.focus')
    path = OUT / f'{tag}.png'
    await page.screenshot(path=str(path))
    shots.append((tag, path, f'{quest["title"]} {index + 1}/{len(quest["steps"])}：{step["text"]}'))
    if not (view and view.get('inFrame')):
        row['problems'].append('not in frame')
    elif not view.get('seen'):
        row['problems'].append('blocked: ' + ' / '.join(r['first'] or '(sky)' for r in view['rays']))
    if view and view.get('distance', 99) > step.get('radius', 4):
        row['problems'].append(f"stopped {view['distance']} m away, reach {step.get('radius', 4)}")
    if step.get('kind') != 'photo' and row['interaction']['selected'] != f'quest:{qid}':
        row['problems'].append(f"E offers {row['interaction']['selected']}")
    expected = [name] if kind == 'spot' else []
    if kind == 'spot' and DATA['spots'][name].get('y') is None:
        soil = await page.evaluate('([x, z]) => window.campusWalk.surfaceAt(x, z, 0).soil.height', DATA['spots'][name]['at'])
        if abs(soil - point[1]) > .3:
            row['problems'].append(f'object stands {point[1] - soil:.2f} m above the ground: on something else')
    if row['spots'] != expected:
        row['problems'].append(f"spots on show {row['spots']}, expected {expected}")
    if row['status'] and ('無法前進' in row['status'] or 'TIMEOUT' in row['status'] or '找不到' in row['status']):
        row['problems'].append('walk: ' + row['status'])
    # A photo step must really accept the shot from the viewpoint it marks: P, then the shutter.
    if step.get('kind') == 'photo':
        await page.keyboard.press('p')
        await page.locator('.photo-shutter:visible').wait_for(timeout=10000)
        await page.locator('.photo-shutter:visible').click()
        try:
            await page.wait_for_function('([id, n]) => window.campusWalk.journal.quests[id].step > n', arg=[qid, index], timeout=30000)
            row['shot_accepted'] = True
        except Exception:
            row['problems'].append('the shutter at the viewpoint did not complete the step')
        await page.keyboard.press('p')
        await page.wait_for_timeout(600)
    print(tag, 'OK' if not row['problems'] else row['problems'], flush=True)


def montage(shots, name):
    if not shots:
        return
    columns, width, height, band = 4, 400, 225, 44
    rows = math.ceil(len(shots) / columns)
    sheet = Image.new('RGB', (columns * width, rows * (height + band)), '#ffffff')
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype(FONT, 13) if FONT else ImageFont.load_default()
    for i, (tag, path, text) in enumerate(shots):
        x, y = i % columns * width, i // columns * (height + band)
        sheet.paste(Image.open(path).convert('RGB').resize((width, height)), (x, y + band))
        draw.text((x + 3, y + 1), tag, fill='#000', font=font)
        draw.text((x + 3, y + 21), text[:30], fill='#333', font=font)
    sheet.save(OUT / name)


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])
    report = {'url': URL, 'viewport': VIEWPORT, 'steps': [], 'errors': []}
    shots = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'])
        context = await browser.new_context(viewport=VIEWPORT, accept_downloads=True)
        page = await context.new_page()
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        await page.add_init_script('for (const [k, v] of Object.entries(%s)) localStorage.setItem(k, v);' % json.dumps(SAVE))
        await page.goto(URL, wait_until='load', timeout=180000)
        await page.wait_for_function('window.campusWalk?.worldReady && window.campusWalk.story && window.campusWalk.journal && window.campusWalk.questList', timeout=240000)
        await page.wait_for_timeout(6000)
        for quest in DATA['quests']:
            if only and quest['id'] not in only:
                continue
            for index, step in enumerate(quest['steps']):
                try:
                    await check_step(page, quest, index, step, shots, report)
                except Exception as error:
                    report['steps'].append({'quest': quest['id'], 'step': step['id'], 'problems': [f'{type(error).__name__}: {error}']})
                    print(quest['id'], step['id'], 'EXCEPTION', error, flush=True)
                (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
        await browser.close()
    montage(shots, 'montage.png')
    bad = [s for s in report['steps'] if s['problems']]
    report['summary'] = {'steps': len(report['steps']), 'failed': len(bad)}
    (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
    print(json.dumps(report['summary']), report['errors'][:3], flush=True)
    for row in bad:
        print(row['quest'], row['step'], row['problems'], flush=True)
    if bad or report['errors']:
        sys.exit(1)


asyncio.run(main())
