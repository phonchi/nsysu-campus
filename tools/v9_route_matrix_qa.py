#!/usr/bin/env python3
"""From every quest stop, can the auto-walk plan a route to every quest target?
Asks the game's own planner (window.campusWalk.plan), so it finds a dead end without walking a two-hour run.
Stops are where a player really stands: beside each person, on each spot's stand. Only the day schedule is covered."""
import asyncio, json, os, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('V9_ROUTES_OUT', ROOT / 'artifacts/v9/route-matrix'))
URL = os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:4180/') + '?view=walk&story=1&quality=C&qa=1'
DATA = json.loads((ROOT / 'public/data/quests.json').read_text())
CHAPTERS = json.loads((ROOT / 'public/data/chapters.json').read_text())['chapters']
FIXTURE = {'done': [c['id'] for c in CHAPTERS], 'flags': [], 'fired': {c['id']: [s['id'] for s in c['steps']] for c in CHAPTERS}, 'sideQuests': [], 'npcAt': {}}
TARGETS = sorted({q['accept']['near'] for q in DATA['quests']} | {s['target'] for q in DATA['quests'] for s in q['steps'] if not s['target'].startswith('dest:')})


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'])
        page = await browser.new_page(viewport={'width': 640, 'height': 360})
        await page.add_init_script("if(!sessionStorage.getItem('f')){localStorage.clear();localStorage.setItem('nsysu-story-v3',%s);localStorage.setItem('nsysu-walk-guide-v7','1');sessionStorage.setItem('f','1')}" % json.dumps(json.dumps(FIXTURE)))
        await page.goto(URL, wait_until='networkidle')
        await page.wait_for_function('window.campusWalk?.questList?.length>=12 && window.campusWalk.worldReady && window.campusWalk.npcs?.length>0', timeout=180000)
        await page.wait_for_timeout(2000)
        npcs = {n['id']: n for n in await page.evaluate('window.campusWalk.npcs')}
        stops = {}
        for target in TARGETS:
            kind, id = target.split(':')
            if kind == 'spot':
                s = DATA['spots'][id]
                stops[target] = [s['stand'][0], s['stand'][1], s.get('y')]
            elif kind == 'npc' and not npcs[id]['absent']:
                x, y, z = npcs[id]['position']
                stops[target] = [x + 1.2, z, y]
        rows, skipped = [], []
        for origin, (x, z, y) in stops.items():
            placed = await page.evaluate('p=>p[2]===null?window.campusWalk.qaPlace(p[0],p[1]):window.campusWalk.qaPlace(p[0],p[1],p[2])', [x, z, y])
            if not placed:
                skipped.append(origin)
                continue
            await page.wait_for_timeout(300)
            found = await page.evaluate('''targets => targets.map(t => { const r = window.campusWalk.plan(t), t0 = performance.now(); return { target: t, plan: r.plan, nav: r.nav, outdoor: r.outdoor, failing: r.failing ?? null, ms: performance.now() - t0 }; })''', [t for t in stops if t != origin])
            rows += [dict(origin=origin, position=await page.evaluate('window.campusWalk.position'), **r) for r in found]
            print(origin, sum(1 for r in found if r['plan'] <= 0), 'dead ends of', len(found), flush=True)
        await browser.close()
    dead = [r for r in rows if r['plan'] <= 0]
    report = {'stops': len(stops), 'pairs': len(rows), 'dead': len(dead), 'skipped': skipped, 'seconds': round(time.monotonic() - started), 'dead_pairs': dead}
    (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
    print(json.dumps({k: report[k] for k in ('stops', 'pairs', 'dead', 'skipped', 'seconds')}))
    for r in dead:
        print(r['origin'], '->', r['target'], 'nav', r['nav'], 'outdoor', r['outdoor'], r['failing'])
    raise SystemExit(1 if dead or skipped else 0)


if __name__ == '__main__':
    asyncio.run(main())
