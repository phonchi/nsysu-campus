#!/usr/bin/env python3
"""Real-input side-quest acceptance run. No placement hooks, scripted movement or engine calls.
One page, sequential quests, SwiftShader. Budget several hours for campus-wide walks.
CAMPUS_WALK_URL selects the server; V7_ARTIFACTS selects the shared artifact root.
"""
import math
import asyncio
import json
import os
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('V7_ARTIFACTS', ROOT / 'artifacts/v7')) / 'quests'
BASE = os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:4173/')
parts = urlsplit(BASE)
query = dict(parse_qsl(parts.query))
query.update(view='walk', story='1', quality=os.environ.get('CAMPUS_WALK_QUALITY', query.get('quality', 'C')), qa='1')
URL = urlunsplit(parts._replace(query=urlencode(query)))
QUESTS = json.loads((ROOT / 'public/data/quests.json').read_text())['quests']
CHAPTERS = json.loads((ROOT / 'public/data/chapters.json').read_text())['chapters']
KEYS = ['nsysu-story-v3', 'nsysu-campus-v4', 'nsysu-campus-journal-v5']
FIXTURE = {'nsysu-story-v3': {
    'done': [c['id'] for c in CHAPTERS], 'flags': [],
    'fired': {c['id']: [s['id'] for s in c['steps']] for c in CHAPTERS},
    'sideQuests': [], 'npcAt': {},
}}
STATE = '''() => ({journal: window.campusWalk.journal, quests: window.campusWalk.questList,
 story: window.campusWalk.story, route: window.campusWalk.route.length,
 interaction: window.campusWalk.interaction, talk: window.campusWalk.talk,
 photo: window.campusWalk.photo, position: window.campusWalk.position, npcs: window.campusWalk.npcs})'''


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    report = {'completed': False, 'quests': [], 'fresh_gate': None, 'errors': []}
    params = {'url': URL, 'quality': query['quality'], 'viewport': {'width': 1280, 'height': 800},
              'fixture': FIXTURE, 'fresh_fixture': {}, 'cleared_keys': KEYS,
              'method': 'J journal go/time buttons, G, E, R, 1–4, P and shutter only; no teleports or QA mutation hooks',
              'quest_timeout_seconds': 1800, 'route_timeout_seconds': 900}
    (OUT / 'params.json').write_text(json.dumps(params, ensure_ascii=False, indent=2) + '\n')
    with (OUT / 'run.log').open('w', buffering=1) as logfile:
        def log(event, **values):
            row = {'seconds': round(time.monotonic() - started, 1), 'event': event, **values}
            line = json.dumps(row, ensure_ascii=False)
            print(line, flush=True)
            logfile.write(line + '\n')

        def save():
            report['seconds'] = round(time.monotonic() - started, 1)
            (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')

        async def snapshot(page):
            return await page.evaluate(STATE)

        async def load_save(page, fixture):
            # Only the initial save fixture is injected. Gameplay uses player inputs from here onward.
            await page.evaluate('''({keys, fixture}) => {
                for (const key of keys) localStorage.removeItem(key);
                for (const [key, value] of Object.entries(fixture)) localStorage.setItem(key, JSON.stringify(value));
            }''', {'keys': KEYS, 'fixture': fixture})
            await page.goto(URL, wait_until='networkidle')
            await page.wait_for_function('window.campusWalk?.questList?.length === 12', timeout=180000)
            await page.wait_for_function('window.campusWalk?.npcs?.length > 0 && window.campusWalk.worldReady && window.campusWalk.story', timeout=180000)
            await page.wait_for_timeout(1200)

        async def dismiss_guide(page):
            # The first-run guide is a real modal; a player presses its start button once per browser profile.
            start = page.locator('[data-guide="start"]')
            try:
                await start.wait_for(state='visible', timeout=8000)
            except Exception:
                return False
            await start.click()
            await page.wait_for_timeout(300)
            return True

        async def drain_dialogue(page):
            for _ in range(100):
                st = await snapshot(page)
                if not st.get('story', {}).get('dialogue'):
                    return
                choices = (st.get('talk') or {}).get('choices')
                await page.keyboard.press('1' if choices else 'e')
                await page.wait_for_timeout(300)
            raise RuntimeError('dialogue failed to close')

        async def notebook(page, qid):
            await drain_dialogue(page)
            if not await page.locator('.campus-journal').is_visible():
                await page.keyboard.press('j')
            await page.locator('.campus-journal:not([hidden])').wait_for(timeout=10000)
            await page.locator('[data-journal="tab"][data-id="tasks"]').click()
            await page.locator(f'[data-journal="select"][data-id="{qid}"]').click()

        async def go(page, qid):
            await notebook(page, qid)
            time_action = page.locator(f'[data-journal="time"][data-id="{qid}"]')
            if await time_action.count():
                await time_action.click()
                await page.wait_for_timeout(800)
            await page.locator(f'[data-journal="go"][data-id="{qid}"]').click()
            await page.wait_for_timeout(700)
            # G repeats the same player route after NPC scheduling/async readiness has settled.
            await page.keyboard.press('g')
            t0, last_trace, last_position = time.monotonic(), 0.0, None
            while time.monotonic() - t0 < 900:
                # Random encounters are part of play: decline like a player and keep going.
                skip = page.locator('[data-encounter="skip"]:visible')
                if await skip.count():
                    report['encounters_declined'] = report.get('encounters_declined', 0) + 1
                    await skip.click()
                    await page.wait_for_timeout(300)
                    await page.keyboard.press('g')
                    await page.wait_for_timeout(500)
                st = await snapshot(page)
                if not st['route']:
                    if await skip.count():
                        continue
                    # The game gave up on a blocked route. A player presses G again; count it, never hide it.
                    message = await page.locator('.walk-status').text_content() or ''
                    if '無法前進' in message and report.get('autowalk_stalls', 0) < 20:
                        report['autowalk_stalls'] = report.get('autowalk_stalls', 0) + 1
                        log('autowalk_stopped', quest=qid, position=st['position'], message=message)
                        await page.keyboard.press('g')
                        await page.wait_for_timeout(700)
                        last_position = None
                        continue
                    return st
                # Evidence for a stall while it is happening: picture, steering and real frame rate.
                if last_position and st['position'] and math.dist(last_position, st['position']) < .3 and report.get('stall_samples', 0) < 12:
                    report['stall_samples'] = report.get('stall_samples', 0) + 1
                    await page.screenshot(path=str(OUT / f"stall-{report['stall_samples']:02d}.png"))
                    log('not_moving', quest=qid, position=st['position'], route=st['route'],
                        steering=await page.evaluate('window.campusWalk.steering'),
                        status=await page.locator('.walk-status').text_content(),
                        frames_per_second=await page.evaluate('new Promise(done=>{let n=0;const t=performance.now();const tick=()=>{n++;performance.now()-t<1000?requestAnimationFrame(tick):done(n)};requestAnimationFrame(tick)})'))
                last_position = st['position']
                if time.monotonic() - last_trace > 30:
                    last_trace = time.monotonic()
                    log('walking', quest=qid, position=st['position'], route=st['route'])
                await page.wait_for_timeout(1200)
            raise RuntimeError(f'{qid}: walking timeout')

        async def select_press(page, candidate):
            st = await snapshot(page)
            for _ in range(len(st['interaction']['candidates']) + 1):
                if st['interaction']['selected'] == candidate:
                    await page.keyboard.press('e')
                    await page.wait_for_timeout(400)
                    return
                await page.keyboard.press('r')
                await page.wait_for_timeout(180)
                st = await snapshot(page)
            raise RuntimeError(f'candidate {candidate} unavailable: {st["interaction"]}; pos={st["position"]}')

        browser = None
        page = None
        try:
            async with async_playwright() as playwright:
                try:
                    browser = await playwright.chromium.launch(headless=True, args=[
                        '--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'])
                    page = await browser.new_page(viewport=params['viewport'], accept_downloads=True)
                    page.on('pageerror', lambda e: report['errors'].append(str(e)))
                    await page.goto(BASE, wait_until='networkidle')
                    await load_save(page, {})
                    report['guide_shown_on_fresh_save'] = await dismiss_guide(page)
                    # A fresh player can visit a locked quest giver, but cannot accept even at close range.
                    qid = 'gate-lost'
                    st = await go(page, qid)
                    guard = next(n for n in st['npcs'] if n['id'] == 'guard-chung')
                    distance = sum((a - b) ** 2 for a, b in zip(st['position'], guard['position'])) ** .5
                    assert distance <= 4, f'fresh gate test did not reach guard: {distance}'
                    assert 'c1-gate' not in st['story']['done'], 'fresh gate unexpectedly unlocked'
                    assert not any(c['id'] == f'accept:{qid}' for c in st['interaction']['candidates'])
                    await select_press(page, 'talk:guard-chung')
                    await drain_dialogue(page)
                    st = await snapshot(page)
                    assert qid not in st['journal']['quests'], 'fresh save accepted a gated quest'
                    report['fresh_gate'] = {'passed': True, 'quest': qid, 'distance': distance, 'done': st['story']['done'], 'journal': st['journal']}
                    await page.screenshot(path=str(OUT / 'fresh-gate.png'))
                    log('fresh_gate_passed', distance=distance)
                    await load_save(page, FIXTURE)
                    report['guide_shown_again'] = await dismiss_guide(page)
                    assert report['guide_shown_on_fresh_save'] and not report['guide_shown_again'], 'first-run guide persistence'
                    for q in QUESTS:
                        qid, t0 = q['id'], time.monotonic()
                        log('quest_start', quest=qid)
                        transitions = []
                        while time.monotonic() - t0 < params['quest_timeout_seconds']:
                            await drain_dialogue(page)
                            st = await snapshot(page)
                            state = st['journal']['quests'].get(qid)
                            if state and state['status'] == 'completed':
                                break
                            step = q['steps'][state['step']] if state else None
                            st = await go(page, qid)
                            if step and step.get('kind') == 'photo':
                                await page.keyboard.press('p')
                                await page.locator('.photo-shutter:visible').wait_for(timeout=10000)
                                await page.locator('.photo-shutter:visible').click()
                                # Wait for PNG encoding/storage to commit, not just a white flash.
                                await page.wait_for_function('(id) => window.campusWalk.journal.quests[id].step > ' + str(state['step']), arg=qid, timeout=30000)
                                await page.keyboard.press('p')
                            else:
                                await select_press(page, ('quest:' if state else 'accept:') + qid)
                                await drain_dialogue(page)
                            after = await snapshot(page)
                            new_state = after['journal']['quests'].get(qid)
                            assert new_state and (not state or new_state['step'] > state['step']), f'{qid}: no progress after real input'
                            transitions.append({'step': new_state['step'], 'status': new_state['status'], 'position': after['position']})
                            log('quest_progress', quest=qid, **transitions[-1])
                        else:
                            raise RuntimeError(f'{qid}: quest timeout')
                        st = await snapshot(page)
                        assert st['journal']['quests'][qid]['status'] == 'completed'
                        assert q['reward'] in st['journal']['rewards']
                        await page.screenshot(path=str(OUT / f'{qid}.png'))
                        report['quests'].append({'id': qid, 'completed': True, 'transitions': transitions,
                                                'seconds': round(time.monotonic() - t0, 1)})
                        save()
                        log('quest_completed', quest=qid, count=len(report['quests']))
                    final = await snapshot(page)
                    report['journal'] = final['journal']
                    report['completed'] = len(report['quests']) == 12 and all(
                        final['journal']['quests'].get(q['id'], {}).get('status') == 'completed' for q in QUESTS)
                    await page.screenshot(path=str(OUT / 'quests-final.png'))
                except Exception:
                    if page is not None:
                        try:
                            report['failure_state'] = await snapshot(page)
                            await page.screenshot(path=str(OUT / 'failure.png'))
                        except Exception as capture_error:
                            log('failure_capture_error', error=str(capture_error))
                    raise
                finally:
                    if browser:
                        await browser.close()
        except Exception as error:
            report['errors'].append(f'{type(error).__name__}: {error}')
            log('failed', error=str(error))
        finally:
            save()
            log('finished', completed=report['completed'], count=len(report['quests']), errors=report['errors'])
    if not report['completed'] or report['errors']:
        raise SystemExit(1)


if __name__ == '__main__':
    asyncio.run(main())
