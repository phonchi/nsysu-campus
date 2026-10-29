#!/usr/bin/env python3
"""Real-input feel check: hold keys along the arcade wall and columns, sample every animation frame.

Measures what the player sees: avatar height noise on flat ground, grounded state, animation state,
camera arm stability and the L lock. Writes artifacts/v3/T1/walk-feel.json and screenshots.
"""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/v3/T1'
SAMPLER = """(ms)=>new Promise(res=>{const out=[];const t0=performance.now();const tick=()=>{const w=window.campusWalk;
out.push({t:performance.now()-t0,p:w.position,g:w.onGround,a:w.animState,y:w.avatarY,arm:w.camera.arm,cam:w.camera.position,yaw:w.camera.yaw});
if(performance.now()-t0<ms)requestAnimationFrame(tick);else res(out);};requestAnimationFrame(tick);})"""


def flat_noise(samples):
    """Height jitter: up/down reversals (> 0.5 mm) that reverse again within the next two samples, i.e. a
    bounce. Terrain undulation (a single hollow or hump over metres) and kerbs are not oscillations."""
    ys = [s['y'] for s in samples]
    flips = [i for i in range(2, len(ys)) if abs(ys[i] - ys[i - 1]) > 5e-4 and abs(ys[i - 1] - ys[i - 2]) > 5e-4 and (ys[i] > ys[i - 1]) != (ys[i - 1] > ys[i - 2])]
    return sum(1 for a, b in zip(flips, flips[1:]) if b - a <= 2)


def reversals(values, eps=1e-4):
    n = 0
    for i in range(2, len(values)):
        a, b = values[i] - values[i - 1], values[i - 1] - values[i - 2]
        if abs(a) > eps and abs(b) > eps and (a > 0) != (b > 0):
            n += 1
    return n


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    checks, errors, traces = [], [], {}
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox', '--enable-unsafe-swiftshader'])
        page = await browser.new_page(viewport={'width': 1440, 'height': 900})
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:5173/?view=walk&spawn=arcade'), wait_until='networkidle')
        await page.wait_for_function('window.campusWalk?.navReady', timeout=60000)
        await page.get_by_role('button', name='開始探索 →', exact=True).click()
        await page.wait_for_timeout(800)

        async def hold(keys, ms, label):
            for k in keys:
                await page.keyboard.down(k)
            samples = await page.evaluate(SAMPLER, ms)
            for k in keys:
                await page.keyboard.up(k)
            traces[label] = samples
            arm = min(x['arm'] for x in samples)
            print(json.dumps({'phase': label, 'frames': len(samples), 'from': samples[0]['p'], 'to': samples[-1]['p'], 'minArm': arm}), flush=True)
            return samples

        # 1. Idle: nothing may move.
        idle = await hold([], 1500, 'idle')
        checks.append({'name': 'idle: avatar height never bounces', 'value': flat_noise(idle), 'passed': flat_noise(idle) == 0})
        # 2. Walk forward along the arcade, then diagonally into the wall/columns.
        fwd = await hold(['w'], 30000, 'forward')
        diag = await hold(['w', 'a'], 15000, 'diagonal-into-wall')
        diag2 = await hold(['w', 'd'], 15000, 'diagonal-other-side')
        for label, s in [('forward', fwd), ('diagonal A', diag), ('diagonal D', diag2)]:
            moved = sum((s[-1]['p'][i] - s[0]['p'][i]) ** 2 for i in (0, 2)) ** .5
            states = sorted({x['a'] for x in s[5:]})
            # Airborne for more than 3 consecutive frames (each frame simulates ≤ 0.065 s, so > ~0.2 s of physics).
            # Wall time is meaningless here: software rendering draws ~3 frames per second.
            airborne, run = 0, 0
            for x in s:
                run = 0 if x['g'] else run + 1
                if run > 3: airborne += 1
            checks.append({'name': f'{label}: moved', 'value': round(moved, 2), 'passed': moved > .8})
            checks.append({'name': f'{label}: avatar height never bounces (oscillation > 0.5 mm)', 'value': flat_noise(s), 'passed': flat_noise(s) <= 1})
            checks.append({'name': f'{label}: never airborne > 3 frames', 'value': airborne, 'passed': airborne == 0})
            checks.append({'name': f'{label}: no jump/fall animation', 'value': states, 'passed': not {'jump', 'fall'} & set(states)})
            arms = [x['arm'] for x in s]
            checks.append({'name': f'{label}: camera arm reversals bounded', 'value': reversals(arms), 'passed': reversals(arms) <= 6})
            yaws = [x['yaw'] for x in s]
            checks.append({'name': f'{label}: camera never turns by itself', 'value': max(yaws) - min(yaws), 'passed': max(yaws) - min(yaws) < 1e-6})
        await page.screenshot(path=str(OUT / 'walk-follow.png'))
        # 3. Lock: drags and wheel must not change the view parameters.
        await page.keyboard.press('l')
        before = await page.evaluate('window.campusWalk.camera')
        await page.mouse.move(900, 500); await page.mouse.down(); await page.mouse.move(1100, 560, steps=8); await page.mouse.up()
        await page.mouse.wheel(0, 600)
        await page.wait_for_timeout(300)
        after = await page.evaluate('window.campusWalk.camera')
        same = all(abs(before[k] - after[k]) < 1e-9 for k in ('yaw', 'pitch', 'distance'))
        checks.append({'name': 'L lock freezes yaw/pitch/distance', 'value': [before['yaw'], after['yaw']], 'passed': same and after['locked']})
        locked_walk = await hold(['w'], 2000, 'locked-walk')
        yaws = [x['yaw'] for x in locked_walk]
        checks.append({'name': 'locked: walking keeps the angle', 'value': max(yaws) - min(yaws), 'passed': max(yaws) - min(yaws) < 1e-9})
        await page.screenshot(path=str(OUT / 'walk-locked.png'))
        await page.keyboard.press('l')
        # 4. Unlocked drag rotates.
        y0 = (await page.evaluate('window.campusWalk.camera'))['yaw']
        await page.mouse.move(700, 500); await page.mouse.down(); await page.mouse.move(820, 500, steps=8); await page.mouse.up()
        y1 = (await page.evaluate('window.campusWalk.camera'))['yaw']
        checks.append({'name': 'unlocked drag rotates the view', 'value': y1 - y0, 'passed': abs(y1 - y0) > .1})
        # 5. Jump plays once and lands.
        await page.keyboard.press(' ')
        jump = await page.evaluate(SAMPLER, 6000)
        traces['jump'] = jump
        states = [x['a'] for x in jump]
        checks.append({'name': 'jump: jump state appears and returns to idle', 'value': sorted(set(states)), 'passed': 'jump' in states and states[-1] in ('idle', 'land')})
        checks.append({'name': 'no JavaScript errors', 'value': errors[:3], 'passed': not errors})
        stats = await page.evaluate('({render:window.campusWalk.renderStats,physics:window.campusWalk.physicsStats})')
        await browser.close()
    report = {'checks': checks, 'passed': sum(c['passed'] for c in checks), 'total': len(checks), 'stats': stats,
              'note': 'Chromium SwiftShader software rendering; frame times are not representative of real GPUs.'}
    (OUT / 'walk-feel.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
    (OUT / 'walk-feel-traces.json').write_text(json.dumps(traces) + '\n')
    for c in checks:
        print(('PASS ' if c['passed'] else 'FAIL ') + c['name'], c['value'])
    print(f"{report['passed']}/{report['total']}")
    if report['passed'] != report['total']:
        raise SystemExit(1)


if __name__ == '__main__':
    asyncio.run(main())
