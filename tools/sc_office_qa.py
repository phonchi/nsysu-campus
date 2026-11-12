"""Office upgrade: browser doorway, repeated classroom-name selection and department-office quest checks.
SC_QA_OUT must name a fresh evidence directory. QA placement only initializes each
case; subsequent movement and interaction use real keys and the runtime planner.
"""
import asyncio, json, math, os, time
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ['SC_QA_OUT']);OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('CAMPUS_WALK_URL','http://127.0.0.1:4192/')+'?view=walk&quality=C&qa=1'
D=ROOT/'public/data/walkthrough';S=json.loads((D/'SC.json').read_text());A=json.loads((D/'access-plan.json').read_text());P=json.loads((D/'campus-structure.json').read_text())['placements']['SC']
CODES=['SC2002-4','SC2002-1','SC3002-1','SC4010','SC-2F-unnumbered-1','SC-4F-region-002']
def world(p):
 x,z=p;c,s=math.cos(P['rotation']),math.sin(P['rotation']);return [P['x']+(x*c+z*s)*P['scale'],P['z']+(-x*s+z*c)*P['scale']]
async def main():
 report={'url':URL,'doors':[],'quests':[],'search':[],'errors':[]}
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--ignore-gpu-blocklist'])
  page=await browser.new_page(viewport={'width':1280,'height':800})
  page.on('pageerror',lambda e:report['errors'].append(str(e)))
  chapters=json.loads((ROOT/'public/data/chapters.json').read_text())['chapters']
  save={'done':[c['id'] for c in chapters],'flags':[],'fired':{c['id']:[s['id'] for s in c['steps']] for c in chapters},'sideQuests':[]}
  await page.add_init_script('localStorage.setItem("nsysu-story-v3",JSON.stringify('+json.dumps(save)+'));localStorage.setItem("nsysu-walk-guide-v7","1");localStorage.setItem("nsysu-walk-tips-v8",JSON.stringify(["goal","accept","switch","bike","photo","line"]));')
  await page.goto(URL,timeout=180000)
  await page.wait_for_function('window.campusWalk?.navReady && window.campusWalk.questList?.length>0',timeout=240000)
  await page.locator('[data-action=start]').first.click();await page.wait_for_timeout(800)
  await page.keyboard.press('v');await page.wait_for_timeout(300)
  async def face(dx,dz):
   yaw=math.atan2(-dx,-dz)
   await page.evaluate('yaw=>{const s=campusWalk.camera,d=Math.atan2(Math.sin(yaw-s.yaw),Math.cos(yaw-s.yaw));document.querySelector(".walkthrough canvas").dispatchEvent(new PointerEvent("pointermove",{movementX:-d/.004,movementY:(s.pitch+.1)/.003,bubbles:true}));}',yaw)
  async def place(x,z,y):
   ok=await page.evaluate('([x,z,y])=>campusWalk.qaPlace(x,z,y)',[x,z,y]);await page.wait_for_timeout(500);return ok
  for f in S['floors']:
   for r in f['rooms']:
    code=r.get('code') or r['id']
    if code not in CODES:continue
    port=next(p for p in A['floors'][f['id']]['portals'] if r['id'] in p['roomIds']);other=next(n for n in port['nodeIds'] if n!=r['id'])
    out,inn=world(port['clearancePositions'][other]),world(port['clearancePositions'][r['id']]);door=world(port['position'])
    dx,dz=inn[0]-out[0],inn[1]-out[1];n=math.hypot(dx,dz);dx/=n;dz/=n;y=(f['level']-1)*3.7+.08
    ok=await place(out[0]-.4*dx,out[1]-.4*dz,y);await face(dx,dz)
    opened=next(d['open'] for d in await page.evaluate('campusWalk.doors') if d['id']==port['id'])
    if opened<.8:await page.keyboard.press('e');await page.wait_for_timeout(650)
    # Move until past the actual aperture; keep short holds so furniture cannot conceal a failed door crossing.
    await page.keyboard.down('w');past=-99;start=time.monotonic()
    while past<.48 and time.monotonic()-start<12:
     await page.wait_for_timeout(200);pos=await page.evaluate('campusWalk.position');past=(pos[0]-door[0])*dx+(pos[2]-door[1])*dz
    await page.keyboard.up('w');await page.wait_for_timeout(400)
    inside=await page.evaluate('campusWalk.position');screenshot=code in ['SC2002-4','SC2004','SC2001','SC4010']
    if screenshot:await page.screenshot(path=str(OUT/(code+'-C.png')))
    await page.keyboard.down('s');back=99;start=time.monotonic()
    while back>-.3 and time.monotonic()-start<12:
     await page.wait_for_timeout(200);pos=await page.evaluate('campusWalk.position');back=(pos[0]-door[0])*dx+(pos[2]-door[1])*dz
    await page.keyboard.up('s')
    row={'code':code,'placed':ok,'inside':inside,'pastDoor':round(past,3),'returnPastDoor':round(back,3),'passed':ok and past>=.48 and back<=-.3 and abs(inside[1]-y)<.25}
    report['doors'].append(row);print(json.dumps(row),flush=True)
  # Each edited quest location still supports real G-follow + E interaction.
  for step,code in [(3,'SC4010')]:
   await page.evaluate('s=>campusWalk.qaSetQuest("math-day",s)',step);await page.wait_for_timeout(700)
   goal=await page.evaluate('campusWalk.focus.goal');dest=next(d for d in await page.evaluate('campusWalk.destinations') if d['label']==code)
   f=next(f for f in S['floors'] if f['id']==dest['floorId']);port=next(p for p in A['floors'][f['id']]['portals'] if p['id']==dest['doorId']);inn=world(port['clearancePositions'][dest['roomId']]);dx,dz=inn[0]-goal[0],inn[1]-goal[2];n=math.hypot(dx,dz);dx/=n;dz/=n
   placed=await place(goal[0]-dx*2,goal[2]-dz*2,goal[1]);await page.keyboard.press('g');await page.wait_for_timeout(600)
   start=time.monotonic()
   while await page.evaluate('campusWalk.route.length') and time.monotonic()-start<40:await page.wait_for_timeout(300)
   interaction=await page.evaluate('campusWalk.interaction');await page.keyboard.press('e');await page.wait_for_timeout(400)
   for _ in range(4):
    if not await page.evaluate('campusWalk.story.dialogue'):break
    await page.keyboard.press('Space');await page.wait_for_timeout(200)
   state=await page.evaluate('campusWalk.questList.find(q=>q.definition.id==="math-day").state')
   row={'code':code,'step':step,'placed':placed,'interaction':interaction,'state':state,'passed':placed and state['step']==step+1}
   report['quests'].append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
  # Equal display labels must still dispatch distinct stable IDs from actual search buttons.
  destinations=await page.evaluate('campusWalk.destinations')
  assert all(not any(word in d['label'] for word in ['未編號','候選','圖面未標']) for d in destinations if d['buildingId']=='SC')
  for pick in [0,1]:
   await page.keyboard.press('/');await page.locator('.walk-search input').fill('教室');await page.wait_for_timeout(400)
   buttons=page.locator('.walk-results button[data-destination]');assert await buttons.count()>1
   button=buttons.nth(pick);target_id=await button.get_attribute('data-destination');label=await button.locator('strong').inner_text()
   expected=next(d for d in destinations if d['id']==target_id)
   if pick==0:await page.screenshot(path=str(OUT/'classroom-search.png'),timeout=120000)
   await button.click();await page.wait_for_timeout(150)
   route=await page.evaluate('campusWalk.route');delta=math.dist(route[-1],expected['position']) if route else 999
   row={'id':target_id,'label':label,'floor':expected['floorId'],'routePoints':len(route),'goalError':delta,'passed':label=='教室' and delta<.7}
   report['search'].append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
  assert report['search'][0]['id']!=report['search'][1]['id']
  report['render']=await page.evaluate('campusWalk.renderStats');report['mode']=await page.evaluate('campusWalk.mode')
  await browser.close()
 (OUT/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 assert not report['errors'] and all(r['passed'] for r in report['doors']+report['quests']+report['search']), report
asyncio.run(main())
