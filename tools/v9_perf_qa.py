#!/usr/bin/env python3
"""Frame-time probe for the quest guidance: same script on any build, so before/after compare like with like.
Scenarios: far tracked target standing still, beside a person with the E hint up, during a dialogue. Frame deltas come
from a requestAnimationFrame sampler in the page; layout and script cost come from CDP Performance.getMetrics, which
SwiftShader's slow raster cannot hide. SwiftShader numbers are relative only, never what a phone would do.
A save fixture and qaPlace only set the scene. CAMPUS_WALK_URL picks the build, V9_PERF_OUT the folder."""
import asyncio
import json
import os
import statistics
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:4180/')
OUT = Path(os.environ.get('V9_PERF_OUT', ROOT / 'artifacts/v9/perf/after'))
SECONDS = float(os.environ.get('V9_PERF_SECONDS', '20'))
RUNS = int(os.environ.get('V9_PERF_RUNS', '2'))
VIEWPORT = {'width': 640, 'height': 360}  # small on purpose: less raster noise over the main-thread cost under test
parts = urlsplit(BASE)
query = dict(parse_qsl(parts.query))
query.update(view='walk', story='1', quality='C', qa='1', spawn='arcade')
URL = urlunsplit(parts._replace(query=urlencode(query)))
CHAPTERS = json.loads((ROOT / 'public/data/chapters.json').read_text())['chapters']
SAVE = {
    'nsysu-walk-guide-v7': '1',
    'nsysu-walk-tips-v8': json.dumps(['goal', 'accept', 'switch', 'bike', 'photo']),
    # Tour finished: nothing in the main story can interrupt the sample.
    'nsysu-story-v3': json.dumps({'done': [c['id'] for c in CHAPTERS], 'flags': [], 'fired': {c['id']: [s['id'] for s in c['steps']] for c in CHAPTERS}, 'sideQuests': [], 'npcAt': {}}),
    # 阿忠伯 at the gate is about 480 m from the spawn at the arcade.
    'nsysu-campus-journal-v5': json.dumps({'version': 1, 'quests': {'gate-lost': {'status': 'active', 'step': 0, 'choices': {}, 'photoBaseline': 0}}, 'journal': [], 'rewards': [], 'tracked': 'gate-lost', 'legacySnapshotTaken': True}),
}
SAMPLE = '''(ms) => new Promise(done => { const deltas = []; let last = performance.now(); const start = last;
  const tick = t => { const now = performance.now(); deltas.push(now - last); last = now; if (now - start < ms) requestAnimationFrame(tick); else done(deltas.slice(1)); };
  requestAnimationFrame(tick); })'''
METRICS = ('LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration')


def percentile(values, share):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * share))]


async def metrics(cdp):
    rows = (await cdp.send('Performance.getMetrics'))['metrics']
    return {m['name']: m['value'] for m in rows if m['name'] in METRICS}


async def sample(page, cdp):
    before = await metrics(cdp)
    deltas = await page.evaluate(SAMPLE, SECONDS * 1000)
    after = await metrics(cdp)
    frames = len(deltas)
    row = {'frames': frames, 'p50_ms': round(statistics.median(deltas), 1), 'p95_ms': round(percentile(deltas, .95), 1), 'max_ms': round(max(deltas), 1)}
    for name in METRICS:
        value = after[name] - before[name]
        row[f'{name}_per_frame' if 'Count' in name else f'{name}_ms_per_frame'] = round(value / max(1, frames) * (1 if 'Count' in name else 1000), 2)
    return row


async def place(page, x, z):
    await page.evaluate('([x, z]) => window.campusWalk.qaPlace(x, z)', [x, z])
    await page.wait_for_timeout(2500)


async def run(browser, number):
    context = await browser.new_context(viewport=VIEWPORT)
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    await page.add_init_script('for (const [k, v] of Object.entries(%s)) localStorage.setItem(k, v);' % json.dumps(SAVE))
    await page.goto(URL, wait_until='load', timeout=180000)
    await page.wait_for_function('window.campusWalk?.worldReady && window.campusWalk.story && window.campusWalk.journal', timeout=240000)
    await page.wait_for_timeout(8000)
    cdp = await context.new_cdp_session(page)
    await cdp.send('Performance.enable')
    result = {}
    # 1. Far tracked target, standing still.
    assert (await page.evaluate('window.campusWalk.guide?.target')) == 'npc:guard-chung', 'tracked fixture lost'
    result['far_tracked'] = await sample(page, cdp)
    result['far_tracked']['position'] = await page.evaluate('window.campusWalk.position')
    # 2. Beside a person with no quest of their own, E hint up (the tracked target stays far).
    person = await page.evaluate("window.campusWalk.npcs.find(n => n.id === 'monkey-volunteer-man').position")
    await place(page, person[0] + 1.6, person[2])
    hint = await page.evaluate("(() => { const e = document.querySelector('.q-hint'); return e && !e.hidden ? e.textContent : null; })()")
    assert hint and '阿滿' in hint, f'no E hint: {hint}'
    result['near_hint'] = await sample(page, cdp)
    result['near_hint']['hint'] = hint
    # 3. During a dialogue: the line is fully typed and left open.
    await page.keyboard.press('e')
    await page.wait_for_function('window.campusWalk.story.dialogue', timeout=10000)
    await page.wait_for_timeout(4000)
    result['dialogue'] = await sample(page, cdp)
    result['dialogue']['still_open'] = await page.evaluate('window.campusWalk.story.dialogue')
    await page.screenshot(path=str(OUT / f'run{number}-dialogue.png'))
    result['errors'] = errors
    result['render'] = await page.evaluate('window.campusWalk.renderStats')
    await context.close()
    return result


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    report = {'url': URL, 'viewport': VIEWPORT, 'seconds_each': SECONDS, 'runs': []}
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'])
        for number in range(RUNS):
            row = await run(browser, number + 1)
            report['runs'].append(row)
            print(json.dumps(row, ensure_ascii=False), flush=True)
            (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        await browser.close()
    if any(r['errors'] for r in report['runs']):
        sys.exit(1)


asyncio.run(main())
