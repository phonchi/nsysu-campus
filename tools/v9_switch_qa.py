#!/usr/bin/env python3
"""Switching between the main story and side quests, on desktop and on a 390x844 phone, with real input: Q or a tap on the
card to switch, G or a tap to walk, E and number keys to play. A save fixture and qaPlace only set the scene.
Checks that the card, guide, marker, distance, minimap, G and E agree on the focus; that the main story waits and resumes;
that G walks on after a dialogue and stops when told; that a stopped auto-walk recovers (the stop is forced by a QA ring of
colliders, since the natural stall could not be reproduced on demand). CAMPUS_WALK_URL picks the build, V9_SWITCH_OUT the folder."""
import asyncio
import json
import math
import os
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:4180/')
OUT = Path(os.environ.get('V9_SWITCH_OUT', ROOT / 'artifacts/v9/switch'))
parts = urlsplit(BASE)
query = dict(parse_qsl(parts.query))
query.update(view='walk', story='1', quality='C', qa='1', spawn='arcade')
URL = urlunsplit(parts._replace(query=urlencode(query)))
CHAPTERS = json.loads((ROOT / 'public/data/chapters.json').read_text())['chapters']
STORY, QUEST, GUIDE, TIPS = 'nsysu-story-v3', 'nsysu-campus-journal-v5', 'nsysu-walk-guide-v7', 'nsysu-walk-tips-v8'
QUIET = json.dumps(['goal', 'accept', 'switch', 'bike', 'photo', 'line'])


def story(done):
    ids = [c['id'] for c in CHAPTERS]
    active = ids[done] if done < len(ids) else None
    return json.dumps({'done': ids[:done], 'active': active, 'flags': [], 'fired': {c: [s['id'] for s in CHAPTERS[i]['steps']] for i, c in enumerate(ids[:done])}, 'sideQuests': [], 'npcAt': {}})


def save(quests, tracked=None):
    return json.dumps({'version': 1, 'quests': {q: {'status': 'active', 'step': s, 'choices': {}, 'photoBaseline': 0} for q, s in quests.items()}, 'journal': [], 'rewards': [], 'tracked': tracked, 'legacySnapshotTaken': True})


class Run:
    def __init__(self, name, touch):
        self.name, self.touch, self.checks = name, touch, []

    def check(self, what, ok, seen=None):
        self.checks.append({'what': what, 'ok': bool(ok), 'seen': seen})
        print(self.name, 'PASS' if ok else 'FAIL', what, '' if ok else seen, flush=True)

    async def open(self, browser, stored):
        viewport = {'width': 390, 'height': 844} if self.touch else {'width': 1280, 'height': 720}
        self.context = await browser.new_context(viewport=viewport, has_touch=self.touch, is_mobile=self.touch)
        self.page = await self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        await self.page.add_init_script('for (const [k, v] of Object.entries(%s)) if (!sessionStorage.seeded) localStorage.setItem(k, v); sessionStorage.seeded = 1;' % json.dumps({GUIDE: '1', TIPS: QUIET, **stored}))
        await self.page.goto(URL, wait_until='load', timeout=180000)
        await self.page.wait_for_function('window.campusWalk?.worldReady && window.campusWalk.story && window.campusWalk.journal', timeout=240000)
        await self.page.wait_for_timeout(5000)
        return self.page

    async def close(self):
        self.check('no page errors', not self.errors, self.errors[:3])
        await self.context.close()

    async def press(self, selector):
        if self.touch:
            await self.page.locator(selector).first.tap()
        else:
            await self.page.locator(selector).first.click()

    async def switch(self, line=None):
        """Q on the keyboard; the card's buttons on a phone (which has no keyboard)."""
        if self.touch:
            await self.press(f'.q-lines [data-line={line or "side"}]')
        else:
            await self.page.keyboard.press('q')
        await self.page.wait_for_timeout(500)

    async def follow(self):
        """G on the keyboard, the card body on a phone."""
        if self.touch:
            await self.press('.q-objective strong')
        else:
            await self.page.keyboard.press('g')
        await self.page.wait_for_timeout(600)

    async def e(self):
        if self.touch:
            await self.press('.walk-actions [data-action=door]')
        else:
            await self.page.keyboard.press('e')
        await self.page.wait_for_timeout(400)

    async def finish_dialogue(self):
        for _ in range(60):
            if not await self.page.evaluate('window.campusWalk.story.dialogue'):
                return
            choices = (await self.page.evaluate('window.campusWalk.talk'))['choices']
            if self.touch:
                await self.page.locator('.q-choices button' if choices else '.q-dialog').first.tap()
            else:
                await self.page.keyboard.press('1' if choices else 'e')
            await self.page.wait_for_timeout(250)

    async def focus(self):
        return await self.page.evaluate('window.campusWalk.focus')

    async def wait_stop(self, seconds=40):
        for _ in range(seconds * 2):
            if not await self.page.evaluate('window.campusWalk.route.length'):
                return True
            await self.page.wait_for_timeout(500)
        return False

    async def gold_on_minimap(self):
        return await self.page.evaluate("""() => { const c = document.querySelector('.walk-minimap'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
          for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 233) < 6 && Math.abs(d[i + 1] - 185) < 6 && Math.abs(d[i + 2] - 73) < 6) n++; return n; }""")


async def lines(run, browser):
    """Main story waits behind a side quest and resumes; every guide follows the focus."""
    page = await run.open(browser, {STORY: story(4), QUEST: save({'gate-lost': 1, 'arcade-club': 1}, 'gate-lost')})
    f = await run.focus()
    run.check('save with a tracked quest opens on that quest', f['line'] == 'side' and f['quest'] == 'gate-lost', f)
    run.check('card speaks for the side quest', '阿忠伯' in f['small'] and '公告板' in f['text'], f)
    run.check('card shows a real distance', f['distance'].endswith(' m'), f)
    run.check('card names the paused line', f['other'].startswith('主線暫停'), f)
    run.check('hint fits the device', f['hint'] == ('點此帶路' if run.touch else 'G 自動前往'), f)
    pocket = await page.evaluate("document.querySelector('[data-pocket-distance]')?.textContent")
    run.check('pocket distance is not blank', bool(pocket), pocket)
    await page.wait_for_timeout(3000)
    st = await page.evaluate('window.campusWalk.story')
    run.check('standing in the next chapter\'s zone fires nothing while side-focused', not st['fired'].get('c5-arcade') and not st['dialogue'], st['fired'].get('c5-arcade'))
    await page.screenshot(path=str(OUT / f'{run.name}-side.png'))
    side_goal = f['goal']
    # Second side quest, then main (a phone taps 支線 again, then 主線).
    await run.switch('side')
    f = await run.focus()
    run.check('switch moves on to the next side quest', f['quest'] == 'arcade-club' and '小婷' not in f['small'] and '社團' in f['small'], f)
    run.check('goal moves with the focus', f['goal'] != side_goal, f['goal'])
    await run.switch('main')
    await page.wait_for_timeout(1500)
    f = await run.focus()
    run.check('switch returns to the main story', f['line'] == 'main' and f['quest'] is None and '章' in f['small'], f)
    run.check('guide is released', await page.evaluate('window.campusWalk.guide') is None)
    # Back on main the chapter's automatic steps run: the zone we were standing in counts now.
    for _ in range(20):
        st = await page.evaluate('window.campusWalk.story')
        if st['fired'].get('c5-arcade'):
            break
        await page.wait_for_timeout(500)
    run.check('main story resumes where it was', bool(st['fired'].get('c5-arcade')), st)
    await run.finish_dialogue()
    await page.wait_for_timeout(800)
    f = await run.focus()
    run.check('card lists what waits on the side', f['other'].startswith('支線：'), f)
    await page.screenshot(path=str(OUT / f'{run.name}-main.png'))
    await run.close()


async def play(run, browser):
    """A whole short quest with real input: G walks on after each dialogue, the object comes and goes, E follows the focus."""
    page = await run.open(browser, {STORY: story(6), QUEST: save({'arcade-coffee': 0, 'arcade-club': 1}, 'arcade-coffee')})
    await page.wait_for_timeout(1000)
    goal = (await run.focus())['goal']
    near = await page.evaluate('window.campusWalk.npcs.find(n => n.id === "coffee-kai").position')
    await page.evaluate('([x, z]) => window.campusWalk.qaPlace(x, z)', [near[0] + 1.5, near[2] + .5])
    await page.wait_for_timeout(1500)
    # Two quests want the same person: E takes the focused one, R reaches the other.
    i = await page.evaluate('window.campusWalk.interaction')
    run.check('E offers the focused quest', i['selected'] == 'quest:arcade-coffee', i)
    run.check('the other line is still there', any(c['id'] == 'quest:arcade-club' for c in i['candidates']), i)
    badge = await page.evaluate("(() => { const b = document.querySelector('.q-badge'); return b && !b.hidden ? b.textContent : null; })()")
    await run.switch('side')
    i = await page.evaluate('window.campusWalk.interaction')
    f = await run.focus()
    run.check('E follows the focus to the other quest', f['quest'] == 'arcade-club' and i['selected'] == 'quest:arcade-club', [f['quest'], i['selected']])
    await run.switch('side') if run.touch else (await run.switch(), await run.switch())
    f = await run.focus()
    if f['quest'] != 'arcade-coffee':  # phone: 支線 walked off the end of the list onto the first again; keyboard: main → first
        await run.switch('side')
    f = await run.focus()
    run.check('back on the first quest', f['quest'] == 'arcade-coffee', f)
    # G away from the person first, so the chain is really running when E is pressed.
    await page.evaluate('([x, z]) => window.campusWalk.qaPlace(x, z)', [near[0] + 8, near[2] + 3])
    await page.wait_for_timeout(1200)
    await run.follow()
    run.check('G starts walking', await page.evaluate('window.campusWalk.route.length') > 0 and await page.evaluate('window.campusWalk.autoFollow'))
    await run.follow()
    run.check('G again stops the walk', not await page.evaluate('window.campusWalk.route.length') and not await page.evaluate('window.campusWalk.autoFollow'))
    await run.follow()
    run.check('and G once more sets off', await page.evaluate('window.campusWalk.route.length') > 0)
    run.check('walk reaches the person', await run.wait_stop())
    d = await page.evaluate('(t) => window.campusWalk.qaTargetView(t)', 'npc:coffee-kai')
    run.check('stops in reach and in frame', d['seen'] and d['distance'] <= 4, d)
    await run.e()
    await run.finish_dialogue()
    await page.wait_for_timeout(300)
    f = await run.focus()
    run.check('card moved on with the step', '取餐桌' in f['text'], f)
    toast = await page.evaluate("document.querySelector('.q-toast')?.textContent")
    run.check('a toast marks the step', bool(toast) and '完成一步' in toast, toast)
    spots = await page.evaluate('window.campusWalk.questSpots')
    run.check('the step\'s object is there now', [s['id'] for s in spots] == ['arcade-drink'], spots)
    await page.wait_for_timeout(800)
    run.check('walk carries on after the dialogue', await page.evaluate('window.campusWalk.route.length') > 0 or await page.evaluate('window.campusWalk.autoFollow'))
    await page.screenshot(path=str(OUT / f'{run.name}-chain.png'))
    run.check('walk reaches the object', await run.wait_stop())
    v = await page.evaluate('(t) => window.campusWalk.qaTargetView(t)', 'spot:arcade-drink')
    run.check('the object is in frame on arrival', v['seen'] and v['distance'] <= 3, v)
    beacon = await page.evaluate('window.campusWalk.guideBeacon')
    await page.screenshot(path=str(OUT / f'{run.name}-spot.png'))
    await run.e()
    await run.finish_dialogue()
    await page.wait_for_timeout(300)
    run.check('the object is gone with its step', not await page.evaluate('window.campusWalk.questSpots'))
    run.check('so is its collider', await page.evaluate('window.campusWalk.questSpots.length') == 0)
    run.check('walk carries on to the last person', await run.wait_stop(60))
    await run.e()
    await run.finish_dialogue()
    await page.wait_for_timeout(600)
    st = await page.evaluate('window.campusWalk.journal')
    run.check('quest complete, reward kept', st['quests']['arcade-coffee']['status'] == 'completed' and any('咖啡訂單' in r for r in st['rewards']), st['rewards'])
    f = await run.focus()
    run.check('completion returns to the main line', f['line'] == 'main' and st.get('tracked') is None, f)
    run.check('and the chain stops', not await page.evaluate('window.campusWalk.autoFollow') and not await page.evaluate('window.campusWalk.route.length'))
    toast = await page.evaluate("[...document.querySelectorAll('.q-toast')].map(e => e.textContent).join('|')")
    await page.screenshot(path=str(OUT / f'{run.name}-done.png'))
    run.checks.append({'what': 'observed', 'ok': True, 'seen': {'badge_near_person': badge, 'beacon_at_spot': beacon, 'toast': toast}})
    await run.close()


async def minimap(run, browser):
    """Near a building the floor map shows; the goal pin must be on it, for the focused line."""
    page = await run.open(browser, {STORY: story(6), QUEST: save({'gate-lost': 1}, 'gate-lost')})
    door = await page.evaluate('window.campusWalk.destinations.find(d => d.label === "SC1005").position')
    await page.evaluate('([x, y, z]) => window.campusWalk.qaPlace(x, z, y)', door)
    await page.wait_for_timeout(2500)
    gold = await run.gold_on_minimap()
    run.check('goal pin on the floor map', gold > 20, gold)
    await page.screenshot(path=str(OUT / f'{run.name}-floor-minimap.png'))
    await run.close()


async def recover(run, browser):
    """An auto-walk that gave up: force it with a ring of QA colliders, lift them, press G."""
    page = await run.open(browser, {STORY: story(6), QUEST: save({'gate-lost': 1}, 'gate-lost')})
    await run.follow()
    run.check('walking', await page.evaluate('window.campusWalk.route.length') > 0)
    await page.wait_for_timeout(1500)
    await page.evaluate('window.campusWalk.qaRing(true)')
    stopped = False
    for _ in range(60):
        status = await page.locator('.walk-status').text_content() or ''
        if not await page.evaluate('window.campusWalk.route.length'):
            stopped = True
            break
        await page.wait_for_timeout(1000)
    run.check('the walk gives up inside the ring', stopped, status)
    run.checks.append({'what': 'status when it stopped', 'ok': True, 'seen': status})
    await page.evaluate('window.campusWalk.qaRing(false)')
    await page.wait_for_timeout(500)
    before = await page.evaluate('window.campusWalk.position')
    await run.follow()
    moved = 0
    for _ in range(25):  # a software-rendered phone viewport draws few frames: give it time, the walk is what counts
        await page.wait_for_timeout(1000)
        moved = math.dist(before, await page.evaluate('window.campusWalk.position'))
        if moved > 3:
            break
    run.check('G recovers once the way is clear', moved > 3 and await page.evaluate('window.campusWalk.route.length') > 0, moved)
    await run.close()


async def nothing_on_the_side(run, browser):
    page = await run.open(browser, {STORY: story(4), QUEST: save({})})
    # Standing in the chapter's zone on the main line: its dialogues play first, and Q waits for them as any key does.
    for _ in range(4):
        await page.wait_for_timeout(1500)
        await run.finish_dialogue()
    await run.switch('side')
    await page.wait_for_timeout(500)
    run.check('nothing on the side: the journal opens', await page.locator('.campus-journal').is_visible())
    locked = await page.evaluate("""() => { const b = [...document.querySelectorAll('[data-journal=select]')]; return b.length; }""")
    run.check('journal lists the quests', locked >= 12, locked)
    tracks = []
    for qid, gated in (('sea-postcard', False), ('gate-lost', False)):
        await page.locator(f'[data-journal="select"][data-id="{qid}"]').click()
        tracks.append([qid, await page.locator(f'[data-journal="track"][data-id="{qid}"]').count()])
    # story(4) has not done c5-arcade: its quests are still locked.
    run.check('a locked quest offers no track button', tracks[0][1] == 0, tracks)
    run.check('an open quest does', tracks[1][1] == 1, tracks)
    await page.locator('[data-journal="track"][data-id="gate-lost"]').click()
    await page.wait_for_timeout(400)
    run.check('tracking turns the button into 切回主線', await page.locator('[data-journal="untrack"][data-id="gate-lost"]').count() == 1)
    await page.locator('[data-journal="untrack"][data-id="gate-lost"]').click()
    await page.wait_for_timeout(400)
    run.check('and back', await page.evaluate('window.campusWalk.journal.tracked') is None)
    await run.close()


async def old_save(run, browser):
    page = await run.open(browser, {STORY: story(0), QUEST: save({}, 'sea-postcard')})
    await page.wait_for_timeout(500)
    run.check('an old save tracking a locked quest starts on main', await page.evaluate('window.campusWalk.journal.tracked') is None, await page.evaluate('window.campusWalk.journal.tracked'))
    await run.close()


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    report = {'url': URL, 'runs': {}}
    phases = sys.argv[1:] or ['lines', 'play', 'minimap', 'recover', 'side', 'old']
    table = {'lines': lines, 'play': play, 'minimap': minimap, 'recover': recover, 'side': nothing_on_the_side, 'old': old_save}
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'])
        for name, touch in (('desktop', False), ('mobile', True)):
            run = Run(name, touch)
            for phase in phases:
                print('---', name, phase, flush=True)
                try:
                    await table[phase](run, browser)
                except Exception as error:
                    run.check(f'{phase} ran to the end', False, f'{type(error).__name__}: {error}')
                    try:
                        await run.page.screenshot(path=str(OUT / f'{name}-{phase}-failure.png'))
                        await run.context.close()
                    except Exception:
                        pass
                report['runs'][name] = run.checks
                (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
        await browser.close()
    total = sum(len(r) for r in report['runs'].values())
    bad = [(n, c['what'], c['seen']) for n, r in report['runs'].items() for c in r if not c['ok']]
    print(f'{total - len(bad)}/{total} checks passed', flush=True)
    for row in bad:
        print('FAIL', row, flush=True)
    sys.exit(bool(bad))


asyncio.run(main())
