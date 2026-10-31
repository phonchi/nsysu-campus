#!/usr/bin/env python3
"""Does a standing NPC on the route stall real auto-walk? Places the walker right behind an NPC
along the route's own direction, then watches progress and status messages. QA placement only sets
up the geometry; walking itself is the game's auto-walk."""
import asyncio,json,math,os,time
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'artifacts/v7/quests/autowalk-block';OUT.mkdir(parents=True,exist_ok=True)
CHAPTERS=json.loads((ROOT/'public/data/chapters.json').read_text())['chapters']
URL=os.environ.get('CAMPUS_WALK_URL','http://127.0.0.1:4312/')+'?view=walk&quality=C&qa=1'
NPCS=os.environ.get('BLOCKERS','s2,gardener-hai,jogger-po,m1').split(',');GOALS=['SC2001']
OFFSETS=[0,.15,-.15]
log=(OUT/'run.log').open('w')
def emit(**k):
 line=json.dumps(k,ensure_ascii=False);print(line,flush=True);log.write(line+'\n');log.flush()
async def main():
 results=[]
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader','--disable-dev-shm-usage'])
  ctx=await b.new_context(viewport={'width':1024,'height':640})
  await ctx.add_init_script('if(!sessionStorage.getItem("qa-fixture")){localStorage.clear();localStorage.setItem("nsysu-walk-guide-v7","1");localStorage.setItem("nsysu-story-v3",JSON.stringify('+json.dumps(dict(done=[x['id'] for x in CHAPTERS],flags=[],fired={},sideQuests=[],npcAt={}))+'));sessionStorage.setItem("qa-fixture","1")}')
  page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(URL,wait_until='networkidle')
  await page.wait_for_function('window.campusWalk?.worldReady && window.campusWalk?.npcs?.length>0',timeout=180000)
  await page.locator('[data-action=start]').first.click();await page.wait_for_timeout(3000)
  for id in NPCS:
   for off in OFFSETS:
    n=await page.evaluate('(id)=>window.campusWalk.npcs.find(x=>x.id===id)',id)
    x,y,z=n['position']
    await page.evaluate('p=>window.campusWalk.qaPlace(p[0]+2.2,p[1])',[x,z]);await page.wait_for_timeout(500)
    await page.evaluate('g=>window.campusWalk.goTo(g)',GOALS[0]);await page.wait_for_timeout(250)
    r=await page.evaluate('window.campusWalk.route')
    if not r:emit(npc=id,offset=off,skipped='no route');continue
    pos=await page.evaluate('window.campusWalk.position')
    far=next((q for q in r if math.hypot(q[0]-pos[0],q[2]-pos[2])>4),r[-1])
    a=math.atan2(far[2]-pos[2],far[0]-pos[0])
    # Stand behind the NPC, looking through it at where the route is going.
    px,pz=x-math.cos(a+off)*1.5,z-math.sin(a+off)*1.5
    await page.evaluate('()=>window.campusWalk.qaPlace(%f,%f)'%(px,pz));await page.wait_for_timeout(400)
    await page.evaluate('g=>window.campusWalk.goTo(g)',GOALS[0])
    t0=time.monotonic();msgs=[];trace=[];start=await page.evaluate('window.campusWalk.position');closest=9;passed=None
    while time.monotonic()-t0<22:
     s=await page.evaluate('()=>({p:window.campusWalk.position,r:window.campusWalk.route.length,m:document.querySelector(".walk-status")?.textContent||"",n:window.campusWalk.npcs.find(x=>x.id==="%s").position})'%id)
     if s['m'] and (not msgs or msgs[-1]!=s['m']):msgs.append(s['m'])
     d=math.hypot(s['p'][0]-s['n'][0],s['p'][2]-s['n'][2]);closest=min(closest,d)
     moved=math.hypot(s['p'][0]-start[0],s['p'][2]-start[2])
     if moved>6 and passed is None:passed=round(time.monotonic()-t0,1)
     if not s['r'] or passed:break
     await page.wait_for_timeout(200)
    stopped=await page.evaluate('window.campusWalk.route.length')==0
    rec=dict(npc=id,offset=off,npc_at=[x,z],start=start,passed_6m_s=passed,stopped=stopped and passed is None,closest=round(closest,2),msgs=msgs[-4:]);results.append(rec);emit(**rec)
    if rec['stopped']:await page.screenshot(path=str(OUT/f'stall-{id}-{off}.png'))
    await page.keyboard.press('Escape');await page.wait_for_timeout(200)
    if await page.locator('.walk-menu:not([hidden])').count():await page.keyboard.press('Escape');await page.wait_for_timeout(200)
  await b.close()
 (OUT/'results.json').write_text(json.dumps(dict(trials=results,errors=errors,stalled=sum(r['stopped'] for r in results)),ensure_ascii=False,indent=2))
 emit(finished=True,trials=len(results),stalled=sum(r['stopped'] for r in results),errors=errors)
asyncio.run(main())
