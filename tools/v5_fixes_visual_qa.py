"""Visual/input regressions, isolated output; no source mutation or fabricated completion."""
import asyncio,json,math
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'artifacts/v5-fixes/visual';OUT.mkdir(parents=True,exist_ok=True)
ZONES=json.loads((ROOT/'public/data/story-zones.json').read_text())['zones']
async def main():
 results=[]
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
  for name,size in [('desktop',{'width':1440,'height':900}),('mobile',{'width':390,'height':844})]:
   context=await browser.new_context(viewport=size,is_mobile=name=='mobile',has_touch=name=='mobile');page=await context.new_page();errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   def record(label,passed,**details):
    row={'viewport':name,'check':label,'passed':bool(passed),**details};results.append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
   async def snap(label):await page.screenshot(path=str(OUT/f'{name}-{label}.png'))
   async def select_target(target):
    for _ in range(15):
     state=await page.evaluate('campusWalk.interaction')
     if state.get('selected')==target:return True
     await page.keyboard.press('r');await page.wait_for_timeout(100)
    return False
   async def finish_dialogue():
    for _ in range(20):
     if not await page.evaluate('campusWalk.story?.dialogue'):return
     if await page.locator('.q-choices:not([hidden]) button').count():await page.keyboard.press('1')
     else:await page.keyboard.press('e')
     await page.wait_for_timeout(100)
   await page.goto('http://127.0.0.1:4173/?view=walk&quality=C&qa=1',wait_until='networkidle')
   await page.wait_for_function('campusWalk.navReady && campusWalk.questList?.length===12',timeout=180000)
   await page.locator('[data-action=start]').first.click();await page.wait_for_timeout(800)
   await page.keyboard.press('Escape');await page.keyboard.press('j');await page.wait_for_timeout(200)
   record('J opens notebook from menu',await page.locator('.journal-book').is_visible());await snap('notebook-menu')
   await page.locator('[data-journal=select][data-id=gate-lost]').click();await page.locator('[data-journal=accept]').click();await page.keyboard.press('Escape')
   # Resolve authored targets from current data rather than assuming a two-step quest.
   x,z=ZONES['gate']['p']
   while True:
    view=await page.evaluate("campusWalk.questList.find(q=>q.definition.id==='gate-lost')")
    if view['state']['status']=='completed':break
    step=view['step'];target=step['target'];kind,identifier=target.split(':')
    if kind=='npc':
     n=next(n for n in await page.evaluate('campusWalk.npcs') if n['id']==identifier);point=n['position']
     await page.evaluate('([x,z,y])=>campusWalk.qaPlace(x,z,y)',[point[0]+1,point[2],point[1]])
    else:
     zx,zz=ZONES[identifier]['p'];await page.evaluate('([x,z])=>campusWalk.qaPlace(x,z)',[zx,zz])
    await page.wait_for_timeout(350)
    selected=await select_target('quest:gate-lost')
    record(f"authored step {step['id']} is selectable",selected,interaction=await page.evaluate('campusWalk.interaction'))
    if not selected:raise AssertionError('authored target not reachable/selectable')
    await page.wait_for_timeout(200)
    state=await page.evaluate('campusWalk.interaction');hint=await page.locator('.q-hint').text_content();button=await page.locator('[data-action=door]').text_content()
    record('hint and E button match same selected candidate',bool(state.get('label')) and state['label'] in hint and state['label'] in button,hint=hint,button=button)
    if name=='mobile' and await page.locator('[data-action=cycle-target]').is_visible():
     before=await page.evaluate('campusWalk.interaction.selected');await page.locator('[data-action=cycle-target]').click();after=await page.evaluate('campusWalk.interaction.selected');record('touch cycles same candidate selection',before!=after);await select_target('quest:gate-lost')
    old_step=view['state']['step'];await page.keyboard.press('e');await page.wait_for_timeout(100)
    if kind=='npc':record('side quest conversation registers person',await page.evaluate('(id)=>campusWalk.campus.talked.includes(id)',identifier))
    await finish_dialogue();await page.wait_for_timeout(250)
    newer=await page.evaluate("campusWalk.journal.quests['gate-lost']")
    record(f"selected E advances {step['id']}",newer['step']>old_step)
    if newer['step']<=old_step:raise AssertionError('step did not advance')
   record('side quest completes through authored targets',True)
   await page.keyboard.press('j');await page.locator('[data-journal=tab][data-id=people]').click();record('person appears in notebook',await page.locator('[data-journal=select][data-id=guard-chung]').count()==1);await snap('people')
   await page.locator('[data-journal=tab][data-id=tasks]').click();await page.locator('[data-journal=select][data-id=sea-stage]').click();await page.locator('[data-journal=accept]').click();await page.locator('[data-journal=time]').click();await page.wait_for_timeout(100)
   sky_label=await page.locator('[data-action=sky]').text_content();record('notebook time action updates HUD', '夕陽' in sky_label,sky=sky_label)
   await page.keyboard.press('Escape');await page.keyboard.press('n');await page.wait_for_timeout(300)
   # Return to a known safe, flat gate area for the invitation, keeping a tracked task and live status.
   await page.evaluate('([x,z])=>campusWalk.qaPlace(x,z)',[x,z]);await page.wait_for_timeout(300)
   offered=await page.evaluate("campusWalk.qaEncounter('monkey-snack')");record('safe invitation can appear',offered)
   if offered:
    await page.wait_for_timeout(200);await snap('stacked-hud')
    rects=await page.evaluate('''()=>Object.fromEntries(['.quest-pocket','.walk-status','.q-objective','.encounter-card','.walk-actions'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect(),css=getComputedStyle(e);return[s,css.display==='none'||e.hidden||!r.width||!r.height?null:{x:r.x,y:r.y,w:r.width,h:r.height}]}))''')
    def overlap(a,b):return bool(a and b and min(a['x']+a['w'],b['x']+b['w'])>max(a['x'],b['x'])+1 and min(a['y']+a['h'],b['y']+b['h'])>max(a['y'],b['y'])+1)
    pairs=[(a,b) for i,a in enumerate(rects) for b in list(rects)[i+1:] if overlap(rects[a],rects[b])]
    record('task/status/objective/encounter/controls do not overlap',not pairs,pairs=pairs,rects=rects)
    await page.locator('[data-encounter=accept]').click();await page.wait_for_timeout(200)
    at=await page.evaluate('campusWalk.encounter.target');await page.evaluate('([x,z,y])=>campusWalk.qaPlace(x,z,y)',[at[0]+2.7,at[2],at[1]]);await page.wait_for_timeout(100)
    info=await page.evaluate('({encounter:campusWalk.encounter,position:campusWalk.position,interaction:campusWalk.interaction})');dist=math.dist(info['position'],info['encounter']['target']) if info['encounter'] else 0
    record('active encounter outside 1.5m is not E candidate', dist<=1.5 or not any(c['id']=='encounter' for c in info['interaction']['candidates']),distance=dist)
    await page.locator('[data-encounter=skip]').click()
   record('no page errors',not errors,errors=errors)
   await context.close()
  await browser.close()
 (OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));assert all(r['passed'] for r in results),'visual/input regression failure'
asyncio.run(main())
