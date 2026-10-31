#!/usr/bin/env python3
"""Real UI/E/photo verification; QA placement skips transit, never quest transitions.
Uses an isolated browser context with completed-main-story fixture, not the user's saves.
"""
import asyncio,json,time,traceback,os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'artifacts/v7/events/events-browser';OUT=OUT/(os.environ.get('EVENTS_OUT','encounters-final') if os.environ.get('EVENTS_ONLY') else 'full');OUT.mkdir(parents=True,exist_ok=True)
QUESTS=json.loads((ROOT/'public/data/quests.json').read_text())['quests']
ENCOUNTERS=json.loads((ROOT/'public/data/encounters.json').read_text())['encounters']
ZONES=json.loads((ROOT/'public/data/story-zones.json').read_text())['zones']
CHAPTERS=json.loads((ROOT/'public/data/chapters.json').read_text())['chapters']
async def main():
 results=[];errors=[]
 def check(name,ok,**extra):
  r=dict(name=name,passed=bool(ok),**extra);results.append(r);print(json.dumps(r,ensure_ascii=False),flush=True);(OUT/'results.json').write_text(json.dumps(dict(checks=results,passed=sum(x['passed'] for x in results),total=len(results)),ensure_ascii=False,indent=2))
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
  ctx=await browser.new_context(viewport={'width':1280,'height':800},accept_downloads=True)
  await ctx.add_init_script('if(!sessionStorage.getItem("qa-fixture")){localStorage.clear();localStorage.setItem("nsysu-story-v3",JSON.stringify('+json.dumps(dict(done=[x['id'] for x in CHAPTERS],flags=[],fired={},sideQuests=[],npcAt={})) +'));sessionStorage.setItem("qa-fixture","1")}')
  page=await ctx.new_page();await page.add_init_script("try{localStorage.setItem('nsysu-walk-guide-v7','1')}catch(e){}");page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(os.environ.get('CAMPUS_WALK_URL','http://127.0.0.1:4312/')+'?view=walk&quality=C&qa=1',wait_until='networkidle')
  await page.wait_for_function('window.campusWalk?.worldReady && window.campusWalk?.questList?.length===12',timeout=120000)
  await page.locator('[data-action=start]').first.click();await page.wait_for_timeout(3000)
  async def drain():
   for _ in range(35):
    state=await page.evaluate('window.campusWalk.talk')
    visible=await page.locator('.q-dialog:not([hidden])').count()
    if not visible:
     await page.wait_for_timeout(200)
     if not await page.locator('.q-dialog:not([hidden])').count():return
    elif state and state['choices']:await page.keyboard.press('1')
    else:await page.locator('.q-dialog:not([hidden])').click(position={'x':600,'y':70})
    await page.wait_for_timeout(250)
  async def notebook(qid,action):
   await drain();await page.keyboard.press('j');await page.wait_for_timeout(160)
   await page.locator(f'[data-journal=select][data-id="{qid}"]').click()
   await page.locator(f'[data-journal={action}][data-id="{qid}"]').click();await page.wait_for_timeout(160)
   await page.keyboard.press('Escape');await page.wait_for_function('window.campusWalk.talk.mode === "walk"',timeout=10000)
  async def accept(q):
   # Quests are accepted from their giver, not from the journal (v7).
   await drain();await place(q['accept']['near']);await select_interaction('accept:'+q['id']);await page.keyboard.press('e');await page.wait_for_timeout(350);await drain()
   await page.wait_for_function('(id)=>window.campusWalk.journal.quests[id]?.status==="active"',arg=q['id'],timeout=10000)
  async def place(target):
   kind,id=target.split(':')
   if kind=='npc':
    for attempt in range(4):
     n=next((x for x in await page.evaluate('window.campusWalk.npcs') if x['id']==id and not x['absent']),None)
     if n:break
     await page.keyboard.press('n');await page.wait_for_timeout(1000)
    if not n:raise Exception('NPC unavailable '+id)
    x,y,z=n['position'];await page.evaluate('p=>window.campusWalk.qaPlace(p[0]+1,p[2],p[1])',[x,y,z])
   else:
    z=ZONES[id];x,zp=z['p'];await page.evaluate('p=>p[2]===null?window.campusWalk.qaPlace(p[0],p[1]):window.campusWalk.qaPlace(p[0],p[1],p[2])',[x,zp,z.get('y')])
   await page.wait_for_timeout(700)
   await page.wait_for_function('window.campusWalk.talk.mode === "walk"',timeout=10000)
  async def photo():
   if not await page.evaluate('window.campusWalk.photo.active'):await page.keyboard.press('p');await page.wait_for_timeout(200)
   async with page.expect_download(timeout=20000) as download_info:await page.keyboard.press('Space')
   download=await download_info.value;await download.save_as(str(OUT/f'photo-{time.time_ns()}.png'))
   await page.wait_for_timeout(250);await page.keyboard.press('Escape');await page.wait_for_function('window.campusWalk.talk.mode === "walk"',timeout=10000)
  async def select_interaction(wanted):
   # Read the selected/candidate diagnostics, use actual R keys to cycle.
   for _ in range(20):
    state=await page.evaluate('window.campusWalk.interaction')
    if state and state.get('selected')==wanted:return
    await page.keyboard.press('r');await page.wait_for_timeout(120)
   raise RuntimeError('cannot select interaction '+wanted+' '+str(state))
  if not os.environ.get('EVENTS_ONLY'):
   # A photo at a wrong location must not turn into a valid submission on arrival.
   photo_quest=next(q for q in QUESTS if q['id']=='tunnel-photo')
   await accept(photo_quest);await place('zone:gate');await photo();await place('zone:tunnel-west')
   check('wrong-place photo cannot be submitted on arrival',await page.evaluate('window.campusWalk.journal.quests["tunnel-photo"].step')==0)
   await photo();check('correct shutter advances photo quest',await page.evaluate('window.campusWalk.journal.quests["tunnel-photo"].step')==1)
   # Record an isolated post-v5 fact, which must not be mislabeled as pre-v5 history.
   await page.evaluate('()=>{const p=JSON.parse(localStorage.getItem("nsysu-campus-v4")||"{}");p.talked=[...(p.talked||[]),"qa-post-v5-person"];localStorage.setItem("nsysu-campus-v4",JSON.stringify(p))}')
   for _ in range(2):
    await page.reload(wait_until='networkidle');await page.wait_for_function('window.campusWalk?.worldReady && window.campusWalk?.questList?.length===12',timeout=120000);await page.locator('[data-action=start]').first.click();await page.wait_for_function('window.campusWalk.talk.mode === "walk"',timeout=10000)
   check('two reloads do not manufacture new legacy history',not await page.evaluate('window.campusWalk.journal.journal.some(e=>e.id==="legacy:npc:qa-post-v5-person")'))
   for q in QUESTS[:2]:
    try:
     await accept(q)
     # Accepting from the giver can already consume a first step at the same NPC.
     for step in q['steps'][await page.evaluate('(id)=>window.campusWalk.journal.quests[id].step',q['id']):]:
      await place(step['target'])
      if step.get('kind')=='photo':await photo()
      else:await select_interaction('quest:'+q['id']);await page.keyboard.press('e');await page.wait_for_timeout(350);await drain()
      print(json.dumps(dict(quest=q['id'],step=step['id'],state=await page.evaluate('(id)=>window.campusWalk.journal.quests[id]',q['id']),position=await page.evaluate('window.campusWalk.position'),mode=await page.evaluate('window.campusWalk.talk.mode'),npcs=await page.evaluate('window.campusWalk.npcs'),hint=await page.locator('.q-hint').text_content()),ensure_ascii=False),flush=True)
     state=await page.evaluate('(id)=>window.campusWalk.journal.quests[id]',q['id'])
     check('quest:'+q['id'],state['status']=='completed',state=state)
     if state['status']!='completed':
      await page.screenshot(path=str(OUT/'stalled.png'));raise RuntimeError('stalled quest')
    except Exception as exc:
     check('quest:'+q['id'],False,error=str(exc));await page.screenshot(path=str(OUT/'error.png'));break
   await page.screenshot(path=str(OUT/'quests-complete.png'))
   await page.reload(wait_until='networkidle');await page.wait_for_function('window.campusWalk?.worldReady && window.campusWalk?.questList?.length===12',timeout=120000);await page.locator('[data-action=start]').first.click();await page.wait_for_function('window.campusWalk.talk.mode === "walk"',timeout=10000)
  await place('zone:gate')
  async def diagnostic(label,**extra):
   snapshot=await page.evaluate('()=>({readiness:window.campusWalk.readiness,mode:window.campusWalk.talk.mode,encounter:window.campusWalk.encounter,interaction:window.campusWalk.interaction,position:window.campusWalk.position,menu:!document.querySelector(".walk-menu").hidden,clock:window.campusWalk.encounterClock})')
   print(json.dumps(dict(diagnostic=label,snapshot=snapshot,**extra),ensure_ascii=False),flush=True)
  before_offer=await page.evaluate('window.campusWalk.journal.journal.length')
  before_clock=await page.evaluate('window.campusWalk.encounterClock')
  offered=await page.evaluate('window.campusWalk.qaEncounter("monkey-snack")')
  await diagnostic('first-offer',offered=offered)
  if not offered or not await page.evaluate('window.campusWalk.encounter'):
   await page.screenshot(path=str(OUT/'first-offer-failed.png'));check('first offer generated safely',False);raise RuntimeError('first offer failed; isolated snapshot saved')
  await page.keyboard.press('Escape');await page.wait_for_function('!document.querySelector(".walk-menu").hidden && window.campusWalk.talk.mode==="menu"',timeout=10000)
  check('offered Esc opens menu without abandonment entry',await page.evaluate('window.campusWalk.journal.journal.length')==before_offer and await page.locator('.walk-menu:not([hidden])').count()==1)
  await page.keyboard.press('Escape');await page.wait_for_function('document.querySelector(".walk-menu").hidden && window.campusWalk.talk.mode === "walk"',timeout=10000)
  if await page.evaluate('window.campusWalk.encounter'):
   await page.locator('[data-encounter=skip]').click();await page.wait_for_function('!window.campusWalk.encounter',timeout=10000)
  after_clock=await page.evaluate('window.campusWalk.encounterClock')
  check('offered cancellation does not consume cooldown',before_clock['lastGlobal']==after_clock['lastGlobal'] and before_clock['lastKind']==after_clock['lastKind'])
  scene_fail=await page.evaluate('window.campusWalk.qaEncounter("monkey-snack",true)');await page.wait_for_timeout(200)
  failed_clock=await page.evaluate('window.campusWalk.encounterClock')
  await diagnostic('scene-failure',offered=scene_fail)
  check('failed scene neither journals abandonment nor consumes cooldown',not scene_fail and not await page.evaluate('window.campusWalk.encounter') and await page.evaluate('window.campusWalk.journal.journal.length')==before_offer and after_clock['lastGlobal']==failed_clock['lastGlobal'] and after_clock['lastKind']==failed_clock['lastKind'])
  # Place on wide gate clearing for deterministic encounter scene, use live scene target.
  for d in ENCOUNTERS:
   try:
    await place('zone:gate')
    offered=await page.evaluate('(id)=>window.campusWalk.qaEncounter(id)',d['id']);await page.wait_for_timeout(200)
    if not offered or not await page.evaluate('window.campusWalk.encounter'):raise Exception('offer refused or safe corridor unavailable')
    await page.locator('[data-encounter=accept]').click()
    for attempt in range(12):
     a=await page.evaluate('window.campusWalk.encounter')
     if not a:break
     placement=await page.evaluate('p=>window.campusWalk.qaPlace(p[0]+.85,p[2],p[1])',a['target']);await diagnostic('approach',qaPlaceReturn=placement,requested=a['target']);await page.wait_for_timeout(80)
     if d['id']=='group-photo' and attempt==0:await photo()
     await select_interaction('encounter');await page.keyboard.press('e');await page.wait_for_timeout(160)
    entries=await page.evaluate('(id)=>window.campusWalk.journal.journal.filter(x=>x.kind==="encounter"&&x.id.includes(id))',d['id'])
    check('encounter:'+d['id'],any(x.get('result')==d['success'] for x in entries),entries=entries)
    if await page.evaluate('window.campusWalk.encounter'):await page.keyboard.press('Escape')
   except Exception as exc:
    check('encounter:'+d['id'],False,error=str(exc));await diagnostic('first-failure');await page.screenshot(path=str(OUT/'encounter-failed.png'));break
  before=await page.evaluate('window.campusWalk.journal');await page.reload(wait_until='networkidle');await page.wait_for_function('window.campusWalk?.journal',timeout=120000)
  after=await page.evaluate('window.campusWalk.journal');check('reload persists journal',before==after)
  check('no browser runtime errors',not errors,errors=errors)
  await browser.close()
 (OUT/'results.json').write_text(json.dumps(dict(checks=results,passed=sum(x['passed'] for x in results),total=len(results),fixture='isolated completed-main-story; QA placement skips walking, actual UI/E/photo performs transitions'),ensure_ascii=False,indent=2))
 if not all(x['passed'] for x in results) or not results:raise SystemExit(1)
if __name__=='__main__':asyncio.run(main())
