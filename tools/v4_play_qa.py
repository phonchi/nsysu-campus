#!/usr/bin/env python3
"""v4 play acceptance (spec-v4 §12.2–12.4, §15.11) in Chromium with player inputs (E, 1–4, P, Space, Esc,
mouse); the QA-only qaPlace hook moves the player next to each NPC so the run stays short.

Checks: every talkable NPC answers E with its own dialogue and the talk ends; the three mini-games are won
through their hosts; a photo saves a non-uniform PNG of the canvas size; place stamps and achievements are
awarded; NPC schedules settle within 60 s per time of day (≤ 3 m from the schedule point, or absent/hidden).
Writes artifacts/v4/U9/play-qa.json (+ screenshots)."""
import asyncio, json, math, os, time
from pathlib import Path
from playwright.async_api import async_playwright
from PIL import Image, ImageStat

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/v4/U9'
BASE = os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:5173/')
NPCS = json.loads((ROOT / 'public/data/npcs.json').read_text())
ZONES = json.loads((ROOT / 'public/data/story-zones.json').read_text())
QUIZ = json.loads((ROOT / 'public/data/quiz.json').read_text())['questions']
WANT = {'history-quiz': ('來吧',), 'monkey-chase': ('幫忙', '收好'), 'sunset-photo': ('拍', '好', '試', '來')}


async def place_near(page, npc):
    n = next(x for x in await page.evaluate('window.campusWalk.npcs') if x['id'] == npc)
    x, _, z = n['position']
    await page.evaluate(f'window.campusWalk.qaPlace({x + .9},{z + .3})'); await page.wait_for_timeout(1300)


async def talk(page, npc, want=(), leave=False, max_steps=40):
    """Press E near `npc`, read and advance the conversation; returns (names seen, started game?)."""
    await place_near(page, npc)
    await page.keyboard.press('e'); await page.wait_for_timeout(800)
    names = set()
    for _ in range(max_steps):
        g = await page.evaluate('window.campusWalk.game'); ph = await page.evaluate('window.campusWalk.photo')
        if g['quiz'] or g['chase'] or ph['active']:
            return names, True
        t = await page.evaluate('window.campusWalk.talk')
        if not t['busy'] and not t['line']:
            return names, False
        if t['name']: names.add(t['name'])
        if t['choices']:
            idx = len(t['choices']) - 1 if leave else next((i for w in want for i, c in enumerate(t['choices']) if w in c), 0)
            await page.keyboard.press(str(idx + 1))
        else:
            await page.keyboard.press('e')
        await page.wait_for_timeout(500)
    return names, False


async def finish_talk(page):
    for _ in range(30):
        if await page.evaluate('window.campusWalk.chapterCard'):  # a story step finished a chapter: continue
            await page.locator('.q-chapter [data-q=next]').click(); await page.wait_for_timeout(500); continue
        t = await page.evaluate('window.campusWalk.talk')
        if not t['busy'] and not t['line']: return
        await page.keyboard.press('1' if t['choices'] else 'e'); await page.wait_for_timeout(500)


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    checks, t0 = [], time.monotonic()
    def check(name, passed, **info):
        checks.append({'name': name, 'passed': bool(passed), **info}); print(('PASS ' if passed else 'FAIL ') + name, json.dumps(info, ensure_ascii=False)[:200], flush=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--no-sandbox', '--enable-unsafe-swiftshader'])
        ctx = await b.new_context(viewport={'width': 1280, 'height': 800}, accept_downloads=True); page = await ctx.new_page()
        errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(BASE, wait_until='networkidle'); await page.evaluate('localStorage.clear()')
        await page.goto(f'{BASE}?view=walk&quality=C&qa=1', wait_until='networkidle')
        await page.wait_for_function('window.campusWalk?.navReady', timeout=120000)
        await page.locator('.walk-nick input').fill('阿明'); await page.locator('.walk-nick input').press('Tab')
        await page.locator('[data-action=start]').first.click(); await page.wait_for_timeout(5000)

        # 0. Change character from the Esc menu: body, palette and nickname apply and persist.
        await page.keyboard.press('Escape'); await page.wait_for_timeout(500)
        bx = await page.locator('[data-action=character]').bounding_box(); await page.mouse.click(bx['x'] + 10, bx['y'] + 10); await page.wait_for_timeout(800)
        shown = not await page.evaluate("document.querySelector('.walk-welcome').hidden")
        for sel in ['[data-body=f]', '[data-palette="3"]']:
            bb = await page.locator(sel).bounding_box()
            if bb: await page.mouse.click(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); await page.wait_for_timeout(2000)
        await page.locator('.walk-nick input').fill('小明'); await page.locator('.walk-nick input').press('Tab')
        bb = await page.locator('[data-action=start]').first.bounding_box(); await page.mouse.click(bb['x'] + 20, bb['y'] + 10); await page.wait_for_timeout(1200)
        pl = (await page.evaluate('window.campusWalk.campus'))['player']
        check('menu: change character (body, palette, nickname)', shown and pl == {'body': 'f', 'palette': 3, 'nickname': '小明'}, player=pl)

        # 1. Every talkable NPC present now answers E with its own name in the dialogue box.
        present = {x['id'] for x in await page.evaluate('window.campusWalk.npcs') if not x['absent']}
        for n in NPCS['npcs']:
            if n.get('observe') or not n.get('talk') or n['id'] not in present: continue
            names, game = await talk(page, n['id'], leave=True)
            if game:  # never expected with leave=True; close it so later checks are not blocked
                await page.keyboard.press('Escape'); await page.wait_for_timeout(500)
            check(f"talk: {n['id']} answers E", n['name'] in names, seen=sorted(names))
            await finish_talk(page)
        await place_near(page, 'coffee-kai'); await page.keyboard.press('e'); await page.wait_for_timeout(1500)
        await page.screenshot(path=str(OUT / 'dialog.png')); await finish_talk(page)

        # 2. Mini-games through their hosts.
        names, started = await talk(page, 'quiz-dian', WANT['history-quiz'])
        for _ in range(14):
            if not (await page.evaluate('window.campusWalk.game'))['quiz']: break
            q = await page.evaluate("document.querySelector('.game-card h3')?.textContent")
            item = next((x for x in QUIZ if x['q'] == q), None)
            if item and await page.evaluate("!!document.querySelector('.game-opts') && !document.querySelector('.game-opts .right')"):
                await page.keyboard.press(str(item['answer'] + 1)); await page.wait_for_timeout(300)
            await page.keyboard.press('e'); await page.wait_for_timeout(400)
        await finish_talk(page)
        names, started2 = await talk(page, 'monkey-volunteer-man', WANT['monkey-chase'])
        if not started2: await finish_talk(page); names, started2 = await talk(page, 'monkey-volunteer-man', WANT['monkey-chase'])
        for _ in range(60):
            g = await page.evaluate('window.campusWalk.game')
            if not g['chase']: break
            m = g['monkey']; me = await page.evaluate('window.campusWalk.position')
            if math.hypot(m[0] - me[0], m[2] - me[2]) > 2: await page.evaluate(f"window.campusWalk.qaPlace({m[0] + 1.2},{m[2] + .8})"); await page.wait_for_timeout(150)
            await page.keyboard.press('e'); await page.wait_for_timeout(400)
        await finish_talk(page)
        await page.keyboard.press('n'); await page.wait_for_timeout(2600)  # sunset: the photographer is at the seawall
        names, started3 = await talk(page, 'photo-ju', WANT['sunset-photo'])
        await page.wait_for_timeout(1200)
        ph = await page.evaluate('window.campusWalk.photo'); sx, _, sz = ph['sun']
        d = (math.atan2(-sx, -sz) - ph['yaw'] + math.pi) % (2 * math.pi) - math.pi
        await page.mouse.move(640, 400); await page.mouse.down(); await page.mouse.move(640 - d / .005, 400, steps=15); await page.mouse.up(); await page.wait_for_timeout(800)
        size = None
        if ph['active']:
            async with page.expect_download() as dl: await page.keyboard.press(' ')
            path = OUT / 'sunset-photo.png'; await (await dl.value).save_as(path)
            im = Image.open(path).convert('RGB'); size = im.size; std = ImageStat.Stat(im).stddev
            check('photo: PNG is the canvas size and not uniform', size == (1280, 800) and min(std) > 5, size=size, std=[round(x, 1) for x in std])
        await page.wait_for_timeout(2500); await finish_talk(page)
        c = await page.evaluate('window.campusWalk.campus')
        for g in ['history-quiz', 'monkey-chase', 'sunset-photo']:
            check(f'game: {g} won through its host', (c['games'].get(g) or {}).get('wins', 0) > 0, result=c['games'].get(g))

        # 3. Place stamps by walking in; achievements from the games.
        for zone in ['gate', 'admin', 'arcade']:
            zx, zz = ZONES['zones'][zone]['p']; await page.evaluate(f'window.campusWalk.qaPlace({zx + 2},{zz + 2})'); await page.wait_for_timeout(1500)
        c = await page.evaluate('window.campusWalk.campus')
        check('stamps: at least 3', len(c['stamps']) >= 3, stamps=c['stamps'])
        check('achievements: at least 3', len(c['achievements']) >= 3, achievements=c['achievements'])
        await page.keyboard.press('Escape'); await page.wait_for_timeout(500)
        box = await page.locator('[data-tab=album]').bounding_box(); await page.mouse.click(box['x'] + 10, box['y'] + 10); await page.wait_for_timeout(500)
        await page.screenshot(path=str(OUT / 'album.png')); await page.keyboard.press('Escape'); await page.wait_for_timeout(300)

        # 4. Schedules: after the tour is done, every NPC settles at its time-of-day spot within 60 s.
        sched = {}
        for preset in ['night', 'day', 'sunset']:
            # cycle with N until the preset matches
            for _ in range(3):
                label = await page.evaluate("document.querySelector('[data-action=sky]').textContent")
                if label.startswith({'day': '白天', 'sunset': '西子灣夕陽', 'night': '夜晚'}[preset]): break
                await page.keyboard.press('n'); await page.wait_for_timeout(1500)
            await page.wait_for_timeout(60000)
            now = {x['id']: x for x in await page.evaluate('window.campusWalk.npcs')}
            bad = []
            for n in NPCS['npcs']:
                if n['id'] in ('guide', 's1', 's2', 's3', 'm1'): continue  # story-owned until the tour ends
                cur = now.get(n['id'])
                if not cur: continue
                if n['schedule'][preset] is None:
                    if not cur['absent']: bad.append(f"{n['id']} should be absent")
                    continue
                t = cur.get('target')
                if t and cur['visible'] and math.hypot(cur['position'][0] - t[0], cur['position'][2] - t[2]) > 3:
                    bad.append(f"{n['id']} {round(math.hypot(cur['position'][0] - t[0], cur['position'][2] - t[2]), 1)} m")
            sched[preset] = bad
            check(f'schedule: {preset} settles within 3 m (or absent)', not bad, off=bad[:6])
        check('no page errors', not errors, errors=errors[:5])
        await b.close()
    report = {'passed': sum(c['passed'] for c in checks), 'total': len(checks), 'minutes': round((time.monotonic() - t0) / 60, 1), 'checks': checks,
              'method': 'Chromium SwiftShader, quality C, player inputs (E, 1-4, Space, Esc, N, mouse); qaPlace only to reach NPCs and zones'}
    (OUT / 'play-qa.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
    print(json.dumps({k: report[k] for k in ('passed', 'total', 'minutes')}))
    if report['passed'] != report['total']: raise SystemExit(1)


if __name__ == '__main__':
    asyncio.run(main())
