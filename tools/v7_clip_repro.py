#!/usr/bin/env python3
"""v7 lane D: reproduce visual clipping on real frames in the running game (BEFORE/AFTER fixes).

Same cameras, positions, presets and bodies each run so BEFORE and AFTER frames are comparable.
  V7_CLIP_PHASE=before|after   (or --phase) picks the output sub-folder <out>/<class>/<phase>/
  V7_CLIP_OUT=<dir>            default /home/phonchi/habbit/artifacts/v7/clip
  V7_CLIP_CASES=1,2,...        (or --cases) subset of case numbers
  CAMPUS_WALK_URL=http://127.0.0.1:4311/   the dev server base; started here with `npx vite` unless
  V7_CLIP_NO_SERVER=1          (an external server is already up)
  V7_CLIP_ROOT=<worktree>      the checkout whose dev server is launched (default: this file's repo)

Exactly one Chromium (SwiftShader) and one page at a time, viewport 1280x800, quality=C, qa=1.
qaPlace (?qa=1 diagnostics) is used only to position the player; motion afterwards is real key input.
Physics (Rapier world) is NOT exposed read-only through window.campusWalk, so capsule-vs-static
overlap of NPCs is not measured; NPC foot/support offsets, camera-to-NPC distances, camera arm,
player probe contacts and ride wheel errors are the numbers collected.
Writes <out>/run.log (append), <out>/params.json, <out>/results.json (keyed by phase).
"""
import argparse, asyncio, json, math, os, signal, socket, subprocess, threading, time
from pathlib import Path

HERE = Path(__file__).resolve()
ROOT = Path(os.environ.get('V7_CLIP_ROOT', HERE.parents[1]))
ap = argparse.ArgumentParser()
ap.add_argument('--phase', default=os.environ.get('V7_CLIP_PHASE', 'before'))
ap.add_argument('--out', default=os.environ.get('V7_CLIP_OUT', '/home/phonchi/habbit/artifacts/v7/clip'))
ap.add_argument('--cases', default=os.environ.get('V7_CLIP_CASES', ''))
ap.add_argument('--no-server', action='store_true', default=os.environ.get('V7_CLIP_NO_SERVER') == '1')
ap.add_argument('--port', type=int, default=4311)
ARGS = ap.parse_args()
PHASE = ARGS.phase; OUT = Path(ARGS.out); OUT.mkdir(parents=True, exist_ok=True)
CASES = {int(c) for c in ARGS.cases.split(',') if c.strip()} if ARGS.cases else None
BASE = os.environ.get('CAMPUS_WALK_URL', f'http://127.0.0.1:{ARGS.port}/')
URL = BASE + '?view=walk&quality=C&qa=1'
LOG = OUT / 'run.log'
SEA_LEVEL = -0.6 - 0.055  # public/data/terrain/terrain.json seaLevel + GROUND_Y (src/world/terrain.ts)
NPC_R, NPC_H = .32, 1.7
PLAYER_R = .28

# ---- fixed parameters: BEFORE and AFTER use exactly these -------------------------------------
PARAMS = {
    'viewport': [1280, 800], 'quality': 'C', 'url': URL, 'chromium_args': ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
    'camera': {'default': {'pitch': -.18, 'dist': 4.6}, 'low': {'pitch': .42, 'dist': 3.2}, 'close': {'pitch': -.18, 'dist': 2.2}},
    'cases': {
        '1': {'class': 'npc', 'title': 'camera pushed through nearby NPC (controller ignores actors)',
              'npc': 's2', 'preset': 'day', 'stand_gap': 1.6, 'back_up_s': 2.5},
        '2': {'class': 'npc', 'title': 'NPC feet on slopes (no foot IK)',
              'targets': [{'npc': 'gardener-hai', 'preset': 'sunset'}, {'npc': 'jogger-po', 'preset': 'day'}, {'npc': 'jogger-po', 'preset': 'sunset'}]},
        '3': {'class': 'npc', 'title': 'NPC placement vs walls/props, all NPCs x day/sunset/night',
              'clusters': ['gate', 'admin', 'library', 'arcade', 'seawall', 'IL', 'ACTIVITY', 'tunnel-west', [82, 62], [-67, -27]]},
        '4': {'class': 'scene', 'title': 'player through shrubs / tree crowns',
              'walks': [{'name': 'hillside', 'x': 75, 'z': 164, 'yaw': 0, 'seconds': 4}, {'name': 'library-front', 'x': -92, 'z': -72, 'yaw': -math.pi / 2, 'seconds': 4}]},
        '5': {'class': 'scene', 'title': 'landmark visual beyond collision (library pavilion, school gate)',
              'walks': [{'name': 'library-pavilion', 'x': -80.4, 'z': -40, 'yaw': 0, 'seconds': 5}, {'name': 'gate', 'x': -84.2, 'z': 604, 'yaw': 0, 'seconds': 5}]},
        '6': {'class': 'scene', 'title': 'loaded props: parked bicycles, cones, macaques',
              'spots': [{'name': 'cones', 'x': -224, 'z': 176, 'yaw': 0.4}, {'name': 'macaque', 'x': 96.6, 'z': 44, 'yaw': 0}, {'name': 'macaque-2', 'x': 101.6, 'z': 66, 'yaw': 0}]},
        '7': {'class': 'body', 'title': 'player arm/skirt against a wall (admin facade), m and f',
              'x': -70, 'z': 95, 'yaw': 0, 'seconds': 4},
        '8': {'class': 'body', 'title': 'bike opaque while rider fades; wheels at kerbs',
              'wall': {'x': -70, 'z': 93, 'yaw': math.pi, 'seconds': 3}, 'kerb': {'x': -90.41, 'z': -150.88, 'yaw': 0, 'seconds': 3}},
        '9': {'class': 'camera', 'title': 'photo mode camera into wall/prop', 'x': -70, 'z': 95, 'yaw': 0, 'seconds': 9},
        '10': {'class': 'camera', 'title': 'camera below sea near the seawall', 'x': -160, 'z': 511.5, 'yaw': 0},
    },
}

results = {'phase': PHASE, 'started': time.strftime('%Y-%m-%d %H:%M:%S'), 'cases': {}, 'errors': [], 'peakRssMB': 0}
_prev = (OUT / 'results.json'); _prev = json.loads(_prev.read_text()).get(PHASE) if _prev.exists() else None
if _prev and CASES: results['cases'] = {k: v for k, v in _prev.get('cases', {}).items() if int(k.rstrip('mf')) not in CASES}; results['previousRuns'] = _prev.get('previousRuns', []) + [_prev.get('started')]
# SIGTERM (e.g. `timeout`) must still run the finally blocks that close the browser and stop vite.
signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt('SIGTERM')))
peak = {'rss': 0, 'stop': False}


def log(msg):
    line = f'[{time.strftime("%H:%M:%S")}] [{PHASE}] {msg}'
    print(line, flush=True)
    with LOG.open('a') as f: f.write(line + '\n')


def save():
    p = OUT / 'results.json'
    all_ = json.loads(p.read_text()) if p.exists() else {}
    results['peakRssMB'] = round(peak['rss'] / 1e6, 1)
    all_[PHASE] = results
    p.write_text(json.dumps(all_, ensure_ascii=False, indent=1) + '\n')


def rss_watch():
    import psutil
    while not peak['stop']:
        total = 0
        for pr in psutil.process_iter(['cmdline', 'memory_info']):
            try:
                cl = pr.info['cmdline'] or []
                if any('--enable-unsafe-swiftshader' in a for a in cl): total += pr.info['memory_info'].rss
            except Exception: pass
        peak['rss'] = max(peak['rss'], total)
        time.sleep(2)


def port_open(port):
    with socket.socket() as s:
        s.settimeout(.5)
        return s.connect_ex(('127.0.0.1', port)) == 0


class Game:
    def __init__(self, page, body): self.page, self.body = page, body
    async def ev(self, js, arg=None): return await self.page.evaluate(js, arg)
    async def dismiss(self):
        """Random encounter offers (monkey chase etc.) would steer the run; decline them."""
        try:
            b = self.page.locator('[data-encounter=skip]')
            if await b.count() and await b.first.is_visible(): await b.first.click(timeout=3000); await self.page.wait_for_timeout(300); log('encounter offer declined')
        except Exception as e: log(f'dismiss: {e!r}')
    async def shot(self, cls, name):
        await self.dismiss()
        d = OUT / cls / PHASE; d.mkdir(parents=True, exist_ok=True)
        p = d / f'{name}.png'; await self.page.screenshot(path=str(p)); log(f'shot {p}'); return str(p)
    async def place(self, x, z, y=None):
        r = await self.ev('''([x,z,y])=>{const s=campusWalk.surfaceAt(x,z,y??0);const ref=y??s?.soil?.height??0;const placed=campusWalk.qaPlace(x,z,ref);return {requested:[x,ref,z],placed,position:campusWalk.position,soil:s?.soil,support:s?.support};}''', [x, z, y])
        await self.page.wait_for_timeout(900)
        r['position'] = await self.ev('campusWalk.position')
        r['displacement'] = round(math.hypot(r['position'][0] - x, r['position'][2] - z), 3)
        log(f'place ({x},{z}) -> placed={r["placed"]} at {[round(v,2) for v in r["position"]]} displacement={r["displacement"]}')
        return r
    async def camera(self): return await self.ev('campusWalk.camera')
    async def set_camera(self, yaw, pitch, dist):
        c = await self.camera()
        if c['locked']: await self.page.keyboard.press('l')
        c = await self.camera()
        dyaw = math.atan2(math.sin(c['yaw'] - yaw), math.cos(c['yaw'] - yaw))
        dx, dy = dyaw / .004, (c['pitch'] - pitch) / .003
        await self.page.mouse.move(640, 400); await self.page.mouse.down(); await self.page.mouse.move(640 + dx, 400 + dy, steps=3); await self.page.mouse.up()
        if abs(dist - c['distance']) > .01: await self.page.mouse.wheel(0, math.log(dist / c['distance']) * 1000)
        await self.page.wait_for_timeout(600)
        c = await self.camera(); log(f'camera want yaw={yaw:.2f} pitch={pitch:.2f} dist={dist} -> yaw={c["yaw"]:.2f} pitch={c["pitch"]:.2f} dist={c["distance"]:.2f} arm={c["arm"]:.2f}')
        return c
    async def npcs(self): return await self.ev('campusWalk.npcs')
    async def npc(self, id_):
        for n in await self.npcs():
            if n['id'] == id_: return n
    async def set_sky(self, preset):
        order = ['day', 'sunset', 'night']
        for _ in range(3):
            label = await self.ev('document.querySelector("[data-action=sky]").textContent')
            # PRESET_LABEL (src/walk-sky.ts): day '白天', sunset '西子灣夕陽', night '夜晚'
            cur = {'白天': 'day', '西子': 'sunset', '夜晚': 'night'}.get(label.strip()[:2], None)
            if cur == preset: break
            await self.page.keyboard.press('n'); await self.page.wait_for_timeout(600)  # the toolbar button can be hidden; N is the same cycleSky
        await self.page.wait_for_timeout(1800)
        label = await self.ev('document.querySelector("[data-action=sky]").textContent'); log(f'sky -> {preset} (button: {label.strip()})')
        return label
    async def walk(self, key, seconds, sample=None, stop_when_still=True):
        """Hold a key; return position trace (every .3 s) and stop early when stuck for 1 s (photo mode moves the camera, not the player)."""
        trace, last, still = [], None, 0
        await self.page.keyboard.down(key); t0 = time.monotonic()
        try:
            while time.monotonic() - t0 < seconds:
                await self.page.wait_for_timeout(300)
                p = await self.ev('campusWalk.position'); extra = await self.ev(sample) if sample else None
                trace.append({'t': round(time.monotonic() - t0, 2), 'p': [round(v, 3) for v in p], 'x': extra})
                if last and math.hypot(p[0] - last[0], p[2] - last[2]) < .01: still += 1
                else: still = 0
                last = p
                if stop_when_still and still >= 4 and time.monotonic() - t0 > 1.5: break
        finally: await self.page.keyboard.up(key)
        await self.page.wait_for_timeout(300)
        return trace
    async def probe(self, yaw, d=.12):
        return await self.ev('([dx,dz])=>campusWalk.probe(dx,dz)', [-math.sin(yaw) * d, -math.cos(yaw) * d])


def dist2(a, b): return math.hypot(a[0] - b[0], a[2] - b[2])


async def case1(g):
    P = PARAMS['cases']['1']; rec = {'npc': P['npc'], 'frames': []}
    await g.set_sky(P['preset'])
    n = await g.npc(P['npc'])
    if not n or n['absent'] or not n['position']: rec['covered'] = False; rec['reason'] = f'npc {P["npc"]} absent'; return rec
    nx, ny, nz = n['position']
    # Player stands north of the NPC (toward the admin facade), facing north; the NPC is behind the player
    # on the camera side, so the camera arm (which ignores actor capsules) passes through the NPC.
    yaw = 0.0
    # Camera forward is (-sin yaw, -cos yaw): the player goes that way from the NPC so the camera (behind) crosses it.
    px, pz = nx - math.sin(yaw) * P['stand_gap'], nz - math.cos(yaw) * P['stand_gap']
    pl = await g.place(px, pz); rec['placement'] = pl
    if not pl['placed']: rec['covered'] = False; rec['reason'] = 'placement failed'; return rec
    n = await g.npc(P['npc']); rec['npcPosition'] = n['position']; rec['npcVisible'] = n['visible']
    worst = {'camNpcHorizontal': 9, 'inside': False}
    def measure(c, n):
        h = dist2(c['position'], n['position']); inside = h < NPC_R and n['position'][1] <= c['position'][1] <= n['position'][1] + NPC_H
        if h < worst['camNpcHorizontal']: worst.update({'camNpcHorizontal': round(h, 3), 'inside': inside, 'arm': c['arm'], 'cameraY': c['position'][1], 'npcY': n['position'][1]})
        return {'camNpcHorizontal': round(h, 3), 'inside': inside, 'arm': round(c['arm'], 3)}
    for angle in ['default', 'close']:
        cp = PARAMS['camera'][angle]; c = await g.set_camera(yaw, cp['pitch'], cp['dist']); n = await g.npc(P['npc'])
        rec['frames'].append({'angle': angle, 'camera': c, 'npc': n['position'], **measure(c, n), 'shot': await g.shot('npc', f'case1-{angle}')})
    # Real input: back up (S) into the NPC at the default distance; the actor capsule blocks the player, not the camera.
    await g.set_camera(yaw, -.18, 4.6)
    trace = await g.walk('s', P['back_up_s'], sample='({c:campusWalk.camera,n:campusWalk.npcs.find(n=>n.id==="' + P['npc'] + '")})')
    for t in trace:
        if t['x'] and t['x']['n']['position']: t['m'] = measure(t['x']['c'], t['x']['n']); t['x'] = {'cam': t['x']['c']['position'], 'arm': t['x']['c']['arm'], 'npc': t['x']['n']['position']}
    rec['backUpTrace'] = trace
    c = await g.camera(); n = await g.npc(P['npc'])
    rec['frames'].append({'angle': 'after-backup', 'camera': c, 'npc': n['position'], **measure(c, n), 'shot': await g.shot('npc', 'case1-after-backup')})
    rec['low'] = {'camera': await g.set_camera(yaw, .42, 3.2), 'shot': await g.shot('npc', 'case1-low')}
    rec['worst'] = worst; rec['covered'] = True
    return rec


async def slope_at(g, x, z, y):
    return await g.ev('''([x,z,y])=>{const s=(dx,dz)=>campusWalk.surfaceAt(x+dx,z+dz,y)?.support;const c=s(0,0);return {support:c,dx:[s(-.3,0),s(.3,0)],dz:[s(0,-.3),s(0,.3)]};}''', [x, z, y])


def slope_summary(s, y):
    vals = [v for v in s['dx'] + s['dz'] if v is not None]
    tilt = 0
    if None not in s['dx']: tilt = max(tilt, abs(s['dx'][1] - s['dx'][0]) / .6)
    if None not in s['dz']: tilt = max(tilt, abs(s['dz'][1] - s['dz'][0]) / .6)
    return {'footMinusSupport': round(y - s['support'], 3) if s['support'] is not None else None, 'slope': round(tilt, 3), 'slopeDeg': round(math.degrees(math.atan(tilt)), 1),
            'heelToeGap': round(tilt * .25, 3), 'spread': round(max(vals) - min(vals), 3) if vals else None}


async def case2(g):
    P = PARAMS['cases']['2']; rec = {'targets': []}
    for t in P['targets']:
        await g.set_sky(t['preset']); n = await g.npc(t['npc'])
        item = {'npc': t['npc'], 'preset': t['preset'], 'npcState': n}
        if not n or n['absent'] or not n['position']: item['covered'] = False; item['reason'] = 'absent'; rec['targets'].append(item); continue
        nx, ny, nz = n['position']; item['slope'] = slope_summary(await slope_at(g, nx, nz, ny), ny)
        yaw = 1.2  # stand west-south of the NPC, look at it side-on
        pl = await g.place(nx + math.sin(yaw) * 2.4, nz + math.cos(yaw) * 2.4); item['placement'] = pl
        if not pl['placed']: item['covered'] = False; item['reason'] = 'placement failed'; rec['targets'].append(item); continue
        n = await g.npc(t['npc']); nx, ny, nz = n['position']; item['npcPosition'] = n['position']; item['npcVisible'] = n['visible']
        item['slope'] = slope_summary(await slope_at(g, nx, nz, ny), ny)
        item['frames'] = []
        for angle in ['default', 'low']:
            cp = PARAMS['camera'][angle]; c = await g.set_camera(yaw, cp['pitch'], cp['dist'])
            item['frames'].append({'angle': angle, 'camera': c, 'shot': await g.shot('npc', f'case2-{t["npc"]}-{t["preset"]}-{angle}')})
        item['covered'] = True; rec['targets'].append(item); save()
    return rec


async def case3(g):
    P = PARAMS['cases']['3']; rec = {'physicsExposed': False, 'note': 'Rapier world is not reachable read-only from window.campusWalk; capsule overlap vs static colliders not measured. Numbers: foot y minus support (surfaceAt) per NPC per preset.', 'presets': {}}
    zones = await g.ev('fetch("data/story-zones.json").then(r=>r.json()).then(z=>z.zones)')
    for preset in ['day', 'sunset', 'night']:
        await g.set_sky(preset); rows = []
        for n in await g.npcs():
            row = {'id': n['id'], 'absent': n['absent'], 'visible': n['visible'], 'position': n['position'], 'target': n['target']}
            if n['position'] and not n['absent']:
                s = await slope_at(g, n['position'][0], n['position'][2], n['position'][1]); row['support'] = s['support']
                row['footMinusSupport'] = round(n['position'][1] - s['support'], 3) if s['support'] is not None else None
                row['slopeDeg'] = slope_summary(s, n['position'][1])['slopeDeg']
            rows.append(row)
        rec['presets'][preset] = {'npcs': rows, 'frames': []}
        for cl in P['clusters']:
            key = cl if isinstance(cl, str) else f'{cl[0]}_{cl[1]}'
            if isinstance(cl, str):
                z = zones.get(cl); anchor = [z['p'][0], z['p'][1]] if z else None
                if anchor is None: anchor = await g.ev('id=>{const d=campusWalk.destinations.find(d=>d.id===id+"-1F-entrance"||d.label===id);return d?[d.position.x,d.position.z]:null}', cl)
            else: anchor = cl
            if not anchor: rec['presets'][preset]['frames'].append({'cluster': key, 'covered': False, 'reason': 'anchor unknown'}); continue
            present = [r for r in rows if r['position'] and not r['absent'] and dist2(r['position'], [anchor[0], 0, anchor[1]]) < 20]
            if not present: rec['presets'][preset]['frames'].append({'cluster': key, 'covered': False, 'reason': 'no NPC scheduled within 20 m'}); continue
            cx = sum(r['position'][0] for r in present) / len(present); cz = sum(r['position'][2] for r in present) / len(present)
            pl = await g.place(cx + 3, cz + 4)
            if not pl['placed']: rec['presets'][preset]['frames'].append({'cluster': key, 'covered': False, 'reason': 'placement failed', 'placement': pl}); continue
            p = pl['position']; yaw = math.atan2(-(cx - p[0]), -(cz - p[2]))
            c = await g.set_camera(yaw, -.05, 6.5); after = [r for r in await g.npcs() if r['id'] in {x['id'] for x in present}]
            rec['presets'][preset]['frames'].append({'cluster': key, 'npcs': [a['id'] for a in after], 'visible': [a['id'] for a in after if a['visible']], 'player': p, 'camera': c, 'shot': await g.shot('npc', f'case3-{preset}-{key}')})
            save()
    return rec


async def walk_case(g, cls, tag, w, extra_sample=None):
    item = {'name': w['name'], 'placement': await g.place(w['x'], w['z'])}
    if not item['placement']['placed']: item['covered'] = False; item['reason'] = 'placement failed'; return item
    c0 = await g.set_camera(w['yaw'], -.18, 4.6); item['frames'] = [{'angle': 'default-before', 'camera': c0, 'shot': await g.shot(cls, f'{tag}-{w["name"]}-start')}]
    trace = await g.walk('w', w['seconds'], sample=extra_sample); item['trace'] = trace
    item['end'] = await g.ev('campusWalk.position'); item['probeForward'] = await g.probe(w['yaw'])
    item['frames'].append({'angle': 'default-end', 'camera': await g.camera(), 'shot': await g.shot(cls, f'{tag}-{w["name"]}-end')})
    side = w['yaw'] + math.pi / 2
    item['frames'].append({'angle': 'side', 'camera': await g.set_camera(side, .05, 3.2), 'shot': await g.shot(cls, f'{tag}-{w["name"]}-side')})
    item['frames'].append({'angle': 'low', 'camera': await g.set_camera(w['yaw'] + 2.6, .42, 3.2), 'shot': await g.shot(cls, f'{tag}-{w["name"]}-low')})
    item['travelled'] = round(dist2(item['placement']['position'], item['end']), 3); item['covered'] = True
    return item


async def case4(g):
    await g.set_sky('day'); rec = {'walks': []}
    for w in PARAMS['cases']['4']['walks']:
        item = {'name': w['name'], 'placement': await g.place(w['x'], w['z'])}
        if not item['placement']['placed']: item['covered'] = False; rec['walks'].append(item); continue
        c = await g.set_camera(w['yaw'], -.18, 4.6); item['frames'] = []
        t0 = time.monotonic(); await g.page.keyboard.down('w'); k = 0
        try:
            while time.monotonic() - t0 < w['seconds']:
                await g.page.wait_for_timeout(700); k += 1
                item['frames'].append({'t': round(time.monotonic() - t0, 2), 'p': await g.ev('campusWalk.position'), 'camera': await g.camera(), 'shot': await g.shot('scene', f'case4-{w["name"]}-walk{k}')})
        finally: await g.page.keyboard.up('w')
        item['frames'].append({'angle': 'low', 'camera': await g.set_camera(w['yaw'] + 2.6, .42, 3.2), 'shot': await g.shot('scene', f'case4-{w["name"]}-low')})
        item['end'] = await g.ev('campusWalk.position'); item['covered'] = True; rec['walks'].append(item); save()
    return rec


async def case5(g):
    await g.set_sky('day'); rec = {'walks': []}
    for w in PARAMS['cases']['5']['walks']:
        rec['walks'].append(await walk_case(g, 'scene', 'case5', w)); save()
    return rec


async def case6(g):
    await g.set_sky('day')
    groups = await g.ev('campusWalk.drawBreakdown()'); names = [k for k, _ in groups]
    rec = {'drawGroupsTop40': names, 'presentInTop40DrawGroups': {n: (n in names) for n in ['Parked bicycles', 'Traffic cones', 'Formosan macaques']}, 'note': 'drawBreakdown lists only the 40 busiest groups; absence here is not absence in the scene', 'spots': []}
    for s in PARAMS['cases']['6']['spots']:
        item = {'name': s['name'], 'placement': await g.place(s['x'], s['z'])}
        if not item['placement']['placed']: item['covered'] = False; rec['spots'].append(item); continue
        item['frames'] = [{'angle': 'default', 'camera': await g.set_camera(s['yaw'], -.18, 4.6), 'shot': await g.shot('scene', f'case6-{s["name"]}-start')}]
        trace = await g.walk('w', 3); item['trace'] = trace; item['end'] = await g.ev('campusWalk.position'); item['probeForward'] = await g.probe(s['yaw'])
        item['frames'].append({'angle': 'default-end', 'camera': await g.camera(), 'shot': await g.shot('scene', f'case6-{s["name"]}-end')})
        item['frames'].append({'angle': 'low', 'camera': await g.set_camera(s['yaw'] + 2.4, .42, 3.0), 'shot': await g.shot('scene', f'case6-{s["name"]}-low')})
        item['covered'] = True; rec['spots'].append(item); save()
    return rec


async def case7(g):
    await g.set_sky('day'); P = PARAMS['cases']['7']
    item = await walk_case(g, 'body', f'case7-{g.body}', {'name': 'admin-wall', 'x': P['x'], 'z': P['z'], 'yaw': P['yaw'], 'seconds': P['seconds']})
    if item.get('covered'):
        item['frames'].append({'angle': 'close', 'camera': await g.set_camera(P['yaw'], -.05, 2.2), 'shot': await g.shot('body', f'case7-{g.body}-admin-wall-close')})
        # Side-on against the wall: strafe along it (D) so the shoulder/arm sweeps the facade.
        await g.set_camera(P['yaw'] + math.pi / 2, .05, 2.6); item['strafeTrace'] = await g.walk('a', 1.2)
        item['frames'].append({'angle': 'side-strafe', 'camera': await g.camera(), 'shot': await g.shot('body', f'case7-{g.body}-admin-wall-side-strafe')})
        con = [c for c in item['probeForward']['contacts'] if abs(c['normal'][1]) < .5]  # wall contacts only, not the ground
        item['wallWitnessGap'] = min((dist2(item['end'], c['at']) for c in con), default=None)
    return {'body': g.body, **item}


async def case8(g):
    await g.set_sky('day'); P = PARAMS['cases']['8']; rec = {}
    w = P['wall']
    pl = await g.place(w['x'], w['z']); rec['wallPlacement'] = pl
    if pl['placed']:
        await g.set_camera(w['yaw'], -.18, 4.6)
        await g.page.keyboard.press('b'); await g.page.wait_for_timeout(1500)
        st = await g.ev('({anim:campusWalk.animState,ready:campusWalk.rideContact?.ready})'); rec['mountWall'] = st
        if st['anim'] == 'ride':
            # Back into the admin facade: the camera arm is squeezed below 1.2 m so the rider fades while the bike stays opaque.
            trace = await g.walk('s', w['seconds'], sample='({arm:campusWalk.camera.arm,anim:campusWalk.animState})'); rec['backTrace'] = trace
            rec['minArm'] = min((t['x']['arm'] for t in trace if t['x']), default=None)
            rec['frames'] = [{'angle': 'default-after-backing', 'camera': await g.camera(), 'shot': await g.shot('body', 'case8-wall-backed')}]
            c = await g.set_camera(w['yaw'], -.18, 2.2); rec['frames'].append({'angle': 'close', 'camera': c, 'shot': await g.shot('body', 'case8-wall-close')})
            rec['closeArm'] = c['arm']; rec['avatarOpacityEstimate'] = round(min(1, max(0, (c['arm'] - .6) / .6)), 3)
            rec['frames'].append({'angle': 'low', 'camera': await g.set_camera(w['yaw'] + .8, .42, 2.6), 'shot': await g.shot('body', 'case8-wall-low')})
            await g.page.keyboard.press('b'); await g.page.wait_for_timeout(800)
        else: rec['wallCovered'] = False
    k = P['kerb']; pl = await g.place(k['x'], k['z']); rec['kerbPlacement'] = pl
    if pl['placed']:
        await g.set_camera(k['yaw'], .3, 3.4)
        await g.page.keyboard.press('b'); await g.page.wait_for_timeout(1500)
        st = await g.ev('({anim:campusWalk.animState,ready:campusWalk.rideContact?.ready})'); rec['mountKerb'] = st
        if st['anim'] == 'ride':
            trace = await g.walk('w', k['seconds'], sample='(r=>r?{wheels:r.wheels.map(w=>w.error),pedals:r.pedals.map(w=>w.error)}:null)(campusWalk.rideContact)')
            rec['kerbTrace'] = trace; rec['maxWheelError'] = max((max(t['x']['wheels']) for t in trace if t['x']), default=None)
            rec['kerbFrames'] = [{'angle': 'low-follow', 'camera': await g.camera(), 'shot': await g.shot('body', 'case8-kerb-low')}]
            rec['kerbFrames'].append({'angle': 'side', 'camera': await g.set_camera(k['yaw'] + math.pi / 2, .25, 3.0), 'shot': await g.shot('body', 'case8-kerb-side')})
            await g.page.keyboard.press('b'); await g.page.wait_for_timeout(800)
        else: rec['kerbCovered'] = False
    rec['covered'] = bool(rec.get('mountWall', {}).get('anim') == 'ride' or rec.get('mountKerb', {}).get('anim') == 'ride')
    return rec


async def case9(g):
    await g.set_sky('day'); P = PARAMS['cases']['9']; rec = {}
    pl = await g.place(P['x'], P['z']); rec['placement'] = pl
    if not pl['placed']: rec['covered'] = False; return rec
    await g.set_camera(P['yaw'], -.18, 4.6)
    await g.page.keyboard.press('p'); await g.page.wait_for_timeout(1200)
    ph = await g.ev('campusWalk.photo'); rec['photoEntered'] = ph['active']
    if not ph['active']: rec['covered'] = False; rec['reason'] = 'photo mode did not open'; return rec
    rec['frames'] = [{'angle': 'photo-start', 'camera': await g.camera(), 'shot': await g.shot('camera', 'case9-photo-start')}]
    trace = await g.walk('w', P['seconds'], sample='campusWalk.camera.position', stop_when_still=False); rec['pushTrace'] = trace
    rec['frames'].append({'angle': 'photo-pushed', 'camera': await g.camera(), 'player': await g.ev('campusWalk.position'), 'shot': await g.shot('camera', 'case9-photo-pushed')})
    # Swing the photo camera round so it looks back through the facade from inside.
    await g.page.mouse.move(640, 400); await g.page.mouse.down(); await g.page.mouse.move(640 + math.pi / .005, 400, steps=12); await g.page.mouse.up(); await g.page.wait_for_timeout(600)
    rec['frames'].append({'angle': 'photo-turned', 'camera': await g.camera(), 'shot': await g.shot('camera', 'case9-photo-turned')})
    rec['cameraZmin'] = min(t['p'][2] for t in trace) if trace else None
    rec['cameraTrace'] = [t['x'] for t in trace]
    await g.page.keyboard.press('Escape'); await g.page.wait_for_timeout(600); rec['photoAfterEscape'] = (await g.ev('campusWalk.photo'))['active']
    rec['covered'] = True
    return rec


async def case10(g):
    await g.set_sky('day'); P = PARAMS['cases']['10']; rec = {'seaLevel': SEA_LEVEL, 'frames': []}
    pl = await g.place(P['x'], P['z']); rec['placement'] = pl
    if not pl['placed']: rec['covered'] = False; return rec
    worst = 9
    for name, yaw, pitch, dist in [('default', P['yaw'], -.18, 4.6), ('low-sea-behind', P['yaw'], .5, 4.6), ('low-sea-behind-far', P['yaw'], .5, 9), ('low-along', P['yaw'] + 1.2, .5, 6)]:
        c = await g.set_camera(yaw, pitch, dist); above = round(c['position'][1] - SEA_LEVEL, 3); worst = min(worst, above)
        rec['frames'].append({'angle': name, 'camera': c, 'cameraAboveSea': above, 'shot': await g.shot('camera', f'case10-{name}')})
    # Walk along the parapet with the low camera over the sea.
    await g.set_camera(P['yaw'] + 1.2, .5, 6)
    trace = await g.walk('w', 3, sample='campusWalk.camera.position'); rec['walkTrace'] = [{'t': t['t'], 'p': t['p'], 'camY': t['x'][1], 'aboveSea': round(t['x'][1] - SEA_LEVEL, 3)} for t in trace]
    worst = min([worst] + [t['aboveSea'] for t in rec['walkTrace']])
    rec['frames'].append({'angle': 'low-along-walked', 'camera': await g.camera(), 'shot': await g.shot('camera', 'case10-low-along-walked')})
    rec['worstCameraAboveSea'] = worst; rec['covered'] = True
    return rec


async def open_page(pw, browser, body, free_fn):
    ctx = await browser.new_context(viewport={'width': 1280, 'height': 800})
    await ctx.add_init_script('localStorage.removeItem("nsysu-story-v3");localStorage.removeItem("nsysu-campus-journal-v5");localStorage.setItem("nsysu-campus-v4",JSON.stringify(' + json.dumps({'flags': ['v4.bike'], 'player': {'body': body}}) + '))')
    page = await ctx.new_page(); page.set_default_timeout(300000)
    errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
    t0 = time.monotonic(); await page.goto(URL, wait_until='load')
    await page.wait_for_function('window.campusWalk&&campusWalk.navReady&&campusWalk.questList', timeout=300000)
    await page.locator('[data-action=start]').first.click(no_wait_after=True); await page.wait_for_function('campusWalk.mode.walking', timeout=120000)
    await page.wait_for_function('(r=>r.landmarksReady&&r.propsReady&&r.vegetationReady&&r.rideReady)(campusWalk.readiness)', timeout=300000)
    await page.wait_for_timeout(1500)
    r = await page.evaluate('campusWalk.readiness'); log(f'page body={body} ready in {time.monotonic()-t0:.0f}s readiness={json.dumps(r)}')
    return ctx, page, errors


async def main():
    with LOG.open('a') as f: f.write(f'\n==== v7_clip_repro phase={PHASE} {time.strftime("%Y-%m-%d %H:%M:%S")} root={ROOT} out={OUT} cases={sorted(CASES) if CASES else "all"} ====\n')
    log('free -h before: ' + subprocess.run(['free', '-h'], capture_output=True, text=True).stdout.replace('\n', ' | '))
    (OUT / 'params.json').write_text(json.dumps(PARAMS, ensure_ascii=False, indent=1) + '\n')
    server = None
    if not ARGS.no_server:
        if port_open(ARGS.port): raise SystemExit(f'port {ARGS.port} already in use')
        server = subprocess.Popen(['npx', 'vite', '--host', '127.0.0.1', '--port', str(ARGS.port), '--strictPort'], cwd=str(ROOT), stdout=(OUT / f'vite-{PHASE}.log').open('w'), stderr=subprocess.STDOUT, start_new_session=True)
        for _ in range(120):
            if port_open(ARGS.port): break
            time.sleep(.5)
        else: raise SystemExit('vite did not open the port')
        log(f'vite pid={server.pid} on {BASE}')
    watcher = threading.Thread(target=rss_watch, daemon=True); watcher.start()
    from playwright.async_api import async_playwright
    def want(n): return CASES is None or n in CASES
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=PARAMS['chromium_args'])
            try:
                for body in ['m', 'f']:
                    todo = [n for n in ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] if body == 'm' else [7]) if want(n)]
                    if not todo: continue
                    ctx, page, errors = await open_page(pw, browser, body, None)
                    g = Game(page, body)
                    try:
                        for n in todo:
                            key = f'{n}' if n != 7 else f'7{body}'
                            log(f'--- case {key}: {PARAMS["cases"][str(n)]["title"]}')
                            try:
                                rec = await globals()[f'case{n}'](g)
                                rec['class'] = PARAMS['cases'][str(n)]['class']; results['cases'][key] = rec
                            except Exception as e:
                                log(f'case {key} FAILED: {e!r}'); results['cases'][key] = {'covered': False, 'error': repr(e), 'class': PARAMS['cases'][str(n)]['class']}
                                try: await g.shot('failed', f'case{key}-exception')
                                except Exception: pass
                            log(f'peak chromium RSS so far {peak["rss"]/1e6:.0f} MB'); save()
                        results.setdefault('pageErrors', {})[body] = errors[:20]
                    finally:
                        await page.close(); await ctx.close(); log(f'page body={body} closed')
            finally:
                await browser.close(); log('browser closed')
    finally:
        peak['stop'] = True
        if server:
            try: os.killpg(os.getpgid(server.pid), signal.SIGTERM); server.wait(timeout=15)
            except Exception as e:
                log(f'vite stop fallback: {e!r}')
                try: os.killpg(os.getpgid(server.pid), signal.SIGKILL)
                except Exception: pass
            log(f'vite stopped (port open: {port_open(ARGS.port)})')
        results['finished'] = time.strftime('%Y-%m-%d %H:%M:%S'); save()
        log(f'peak chromium RSS {peak["rss"]/1e6:.0f} MB; free -h after: ' + subprocess.run(['free', '-h'], capture_output=True, text=True).stdout.replace('\n', ' | '))


if __name__ == '__main__': asyncio.run(main())
