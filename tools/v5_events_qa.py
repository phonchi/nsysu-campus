#!/usr/bin/env python3
"""Real UI/E/photo verification; QA placement skips transit, never quest transitions.
Uses an isolated browser context with completed-main-story fixture, not the user's saves.
"""
import asyncio,json,time,traceback
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'artifacts/v5/events-browser';OUT.mkdir(parents=True,exist_ok=True)
QUESTS=json.loads((ROOT/'public/data/quests.json').read_text())['quests']
ENCOUNTERS=json.loads((ROOT/'public/data/encounters.json').read_text())['encounters']
ZONES=json.loads((ROOT/'public/data/story-zones.json').read_text())['zones']
CHAPTERS=json.loads((ROOT/'public/data/chapters.json').read_text())['chapters']
async def main():
 results=[];errors=[]
 def check(name,ok,**extra):
  r=dict(name=name,passed=bool(ok),**extra);results.append(r);print(json.dumps(r,ensure_ascii=False),flush=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
  ctx=await browser.new_context(viewport={'width':1280,'height':800},accept_downloads=True)
  await ctx.add_init_script('if(!sessionStorage.getItem("qa-fixture")){localStorage.clear();localStorage.setItem("nsysu-story-v3",JSON.stringify('+json.dumps(dict(done=[x['id'] for x in CHAPTERS],flags=[],fired={},sideQuests=[],npcAt={})) +'));sessionStorage.setItem("qa-fixture","1")}')
  page=await ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto('http://127.0.0.1:4173/?view=walk&quality=C&qa=1',wait_until='networkidle')
  await page.wait_for_function('window.campusWalk?.questList?.length===12',timeout=120000)
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
   async with page.expect_download(timeout=20000):await page.keyboard.press('Space')
   await page.wait_for_timeout(250);await page.keyboard.press('Escape');await page.wait_for_timeout(200)
  for q in QUESTS[:2]:
   try:
    await notebook(q['id'],'accept')
    for step in q['steps']:
     await place(step['target'])
     if step.get('kind')=='photo':await photo()
     else:await page.keyboard.press('e');await page.wait_for_timeout(350);await drain()
     print(json.dumps(dict(quest=q['id'],step=step['id'],state=await page.evaluate('(id)=>window.campusWalk.journal.quests[id]',q['id']),position=await page.evaluate('window.campusWalk.position'),mode=await page.evaluate('window.campusWalk.talk.mode'),npcs=await page.evaluate('window.campusWalk.npcs'),hint=await page.locator('.q-hint').text_content()),ensure_ascii=False),flush=True)
    state=await page.evaluate('(id)=>window.campusWalk.journal.quests[id]',q['id'])
    check('quest:'+q['id'],state['status']=='completed',state=state)
    if state['status']!='completed':
     await page.screenshot(path=str(OUT/'stalled.png'));raise RuntimeError('stalled quest')
   except Exception as exc:
    check('quest:'+q['id'],False,error=str(exc));await page.screenshot(path=str(OUT/'error.png'));break
  await page.screenshot(path=str(OUT/'quests-complete.png'))
  await page.reload(wait_until='networkidle');await page.wait_for_function('window.campusWalk?.questList?.length===12',timeout=120000);await page.locator('[data-action=start]').first.click();await page.wait_for_function('window.campusWalk.talk.mode === "walk"',timeout=10000)
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
     await page.evaluate('p=>window.campusWalk.qaPlace(p[0]+.2,p[2],p[1])',a['target']);await page.wait_for_timeout(80)
     if d['id']=='group-photo' and attempt==0:await photo()
     await page.keyboard.press('e');await page.wait_for_timeout(160)
    entries=await page.evaluate('(id)=>window.campusWalk.journal.journal.filter(x=>x.kind==="encounter"&&x.id.includes(id))',d['id'])
    check('encounter:'+d['id'],any(x.get('result')==d['success'] for x in entries),entries=entries)
    if await page.evaluate('window.campusWalk.encounter'):await page.keyboard.press('Escape')
   except Exception as exc:check('encounter:'+d['id'],False,error=str(exc));await page.keyboard.press('Escape')
  before=await page.evaluate('window.campusWalk.journal');await page.reload(wait_until='networkidle');await page.wait_for_function('window.campusWalk?.journal',timeout=120000)
  after=await page.evaluate('window.campusWalk.journal');check('reload persists journal',before==after)
  check('no browser runtime errors',not errors,errors=errors)
  await browser.close()
 (OUT/'results.json').write_text(json.dumps(dict(checks=results,passed=sum(x['passed'] for x in results),total=len(results),fixture='isolated completed-main-story; QA placement skips walking, actual UI/E/photo performs transitions'),ensure_ascii=False,indent=2))
if __name__=='__main__':asyncio.run(main())
