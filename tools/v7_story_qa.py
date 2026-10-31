#!/usr/bin/env python3
"""Play the six-chapter freshman tour from a fresh save with player inputs only:
G (auto-walk to the quest goal, the same feature players use), E / Space, and the chapter-card button.
No teleports beyond the tour's own start at the school gate. Writes artifacts/v7/story/story-playthrough.json
and a screenshot per chapter card. Slow under software rendering; budget ~60 min."""
import asyncio, json, os, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/v7/story'
URL = os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:4173/') + '?view=walk&story=1&quality=C&qa=1'
STATE = '({s:window.campusWalk.story,card:window.campusWalk.chapterCard,route:window.campusWalk.route.length,p:window.campusWalk.position})'


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    log, errors = [], []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox', '--enable-unsafe-swiftshader'])
        page = await browser.new_page(viewport={'width': 1280, 'height': 800});await page.add_init_script("try{localStorage.setItem('nsysu-walk-guide-v7','1')}catch(e){}")
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL.replace('?view=walk&story=1&quality=C&qa=1', ''), wait_until='networkidle')
        await page.evaluate("localStorage.removeItem('nsysu-story-v3'); localStorage.removeItem('nsysu-campus-v4'); localStorage.removeItem('nsysu-campus-journal-v5')")
        await page.goto(URL, wait_until='networkidle')
        await page.wait_for_function('window.campusWalk?.story?.active', timeout=120000)
        t0, last_progress, last_key, last_trace, chatted = time.monotonic(), time.monotonic(), None, 0.0, None
        while time.monotonic() - t0 < 3600:
            st = await page.evaluate(STATE)
            s = st['s']
            key = (s['active'], tuple(s['done']), tuple(s['flags']))
            if key != last_key:
                last_key, last_progress = key, time.monotonic()
                log.append({'t': round(time.monotonic() - t0, 1), 'active': s['active'], 'done': s['done'], 'flags': s['flags'], 'pos': [round(v, 1) for v in st['p']]})
                print(json.dumps(log[-1], ensure_ascii=False), flush=True)
                (OUT / 'progress.json').write_text(json.dumps(log, ensure_ascii=False, indent=2))
            if time.monotonic() - last_trace > 60:
                last_trace = time.monotonic()
                print(json.dumps({'trace': round(time.monotonic() - t0), 'pos': [round(v, 1) for v in st['p']], 'route': st['route'], 'plan': await page.evaluate('window.campusWalk.plan()'), 'status': await page.locator('.walk-status').text_content()}), flush=True)
            if len(s['done']) == 6 and not st['card']:
                break
            if st['card']:
                await page.screenshot(path=str(OUT / f"chapter-{len(s['done'])}.png"))
                bus = page.locator('.q-chapter [data-q=bus]')
                await (bus if await bus.count() else page.locator('.q-chapter [data-q=next]')).click()
                await page.wait_for_timeout(600)
                continue
            if s['dialogue']:
                # Story dialogue or NPC small talk (v4): advance, picking the first choice when offered.
                talk = await page.evaluate('window.campusWalk.talk')
                await page.keyboard.press('1' if talk and talk['choices'] else 'e'); await page.wait_for_timeout(350)
                continue
            if time.monotonic() - last_progress > 600:
                errors.append(f'no progress for 10 min at {st}')
                break
            if st['route'] > 0:
                await page.wait_for_timeout(1500)
                continue
            # Arrived (or idle): talk if someone is in reach, otherwise ask to be walked to the goal.
            # An E that only opened NPC small talk (no story progress) is not repeated at this step.
            if chatted != key:
                await page.keyboard.press('e'); await page.wait_for_timeout(500)
                st2 = await page.evaluate(STATE)
                if (await page.evaluate('window.campusWalk.talk') or {}).get('busy'):
                    chatted = key
                    continue
                if st2['s']['dialogue'] or st2['s']['flags'] != s['flags']:
                    continue
            await page.keyboard.press('g'); await page.wait_for_timeout(1200)
            chatted = None  # after walking on, E may reach the story NPC this time
            if time.monotonic() - last_progress > 600:
                errors.append(f'no progress for 10 min at {st}')
                break
        final = await page.evaluate(STATE)
        await page.screenshot(path=str(OUT / 'story-final.png'))
        await browser.close()
    report = {'completed': len(final['s']['done']) == 6, 'done': final['s']['done'], 'minutes': round((time.monotonic() - t0) / 60, 1),
              'log': log, 'errors': errors[:10], 'method': 'player inputs only: G auto-walk, E/Space, chapter-card bus/next buttons; Chromium SwiftShader, quality C, qa=1 (frame cap 0.25 s, physics 1/120 s sub-steps)'}
    (OUT / 'story-playthrough.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
    print(json.dumps({k: report[k] for k in ('completed', 'done', 'minutes', 'errors')}, ensure_ascii=False))
    if not report['completed'] or errors:
        raise SystemExit(1)


if __name__ == '__main__':
    asyncio.run(main())
