#!/usr/bin/env python3
"""Every quest leg (previous place -> next target) must have a route, per the time of day the leg needs.
Places the player with qaPlace only to query the planner; the real-input walk is tools/v7_quests_qa.py."""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parents[1]; OUT = Path(os.environ.get('V7_ARTIFACTS', ROOT / 'artifacts/v7')) / 'quests/route-audit'
BASE = os.environ.get('CAMPUS_WALK_URL', 'http://127.0.0.1:4312/')
QUESTS = json.loads((ROOT / 'public/data/quests.json').read_text())['quests']
CH = json.loads((ROOT / 'public/data/chapters.json').read_text())['chapters']
STORY = {'done': [c['id'] for c in CH], 'flags': [], 'fired': {c['id']: [s['id'] for s in c['steps']] for c in CH}, 'sideQuests': [], 'npcAt': {}}
PRESETS = ['day', 'sunset', 'night']
async def main():
    OUT.mkdir(parents=True, exist_ok=True); rows = []
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'])
        try:
            pg = await b.new_page(viewport={'width': 800, 'height': 500})
            await pg.add_init_script("if(!sessionStorage.f){sessionStorage.f=1;localStorage.setItem('nsysu-walk-guide-v7','1');localStorage.setItem('nsysu-story-v3',%s)}" % json.dumps(json.dumps(STORY)))
            await pg.goto(BASE + '?view=walk&story=1&quality=C&qa=1', wait_until='networkidle')
            await pg.wait_for_function('window.campusWalk?.worldReady && window.campusWalk.story && window.campusWalk.questList?.length===12', timeout=180000)
            await pg.wait_for_timeout(2000)
            for preset in PRESETS:
                label = {'day': '白天', 'sunset': '夕陽', 'night': '夜晚'}[preset]
                for _ in range(3):
                    if label in await pg.evaluate('document.querySelector("[data-action=sky]")?.textContent ?? ""'): break
                    await pg.keyboard.press('n'); await pg.wait_for_timeout(1500)
                now = await pg.evaluate('document.querySelector("[data-action=sky]")?.textContent ?? ""')
                assert label in now, f'time of day not reached: {now}'
                for q in QUESTS:
                    legs = [(q['accept']['near'], q['steps'][0])] + [(q['steps'][i - 1]['target'], q['steps'][i]) for i in range(1, len(q['steps']))]
                    for src, step in legs:
                        if step.get('when') and step['when'] != preset: continue
                        r = await pg.evaluate('''([src,dst])=>{const n=t=>{const [k,id]=t.split(':');if(k==='npc'){const m=campusWalk.npcs.find(x=>x.id===id);return m?m.position:null}return campusWalk.plan(t).goal&&null};
                          const a=src.startsWith('npc:')?n(src):null;const pre=src.startsWith('npc:')?a:(()=>{const s=campusWalk.plan(src);return s.goal})();
                          if(!pre)return {skip:'source absent'};const ok=campusWalk.qaPlace(pre[0],pre[2],pre[1]);if(!ok)return {skip:'place failed',pre};
                          return {...campusWalk.plan(dst),pre,pos:campusWalk.position}}''', [src, step['target']])
                        row = {'preset': preset, 'quest': q['id'], 'step': step['id'], 'from': src, 'to': step['target'], **r}
                        rows.append(row)
                        if r.get('plan', 1) == 0 or r.get('skip'): print(json.dumps(row, ensure_ascii=False)[:500], flush=True)
                print('preset', preset, 'actual', now, 'rows', len(rows), flush=True)
        finally:
            await b.close()
    (OUT / 'results.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1) + '\n')
    fails = [r for r in rows if r.get('plan') == 0]; print('legs', len(rows), 'fail', len(fails), 'skip', sum(1 for r in rows if r.get('skip')))
asyncio.run(main())
