"""Capture office-upgrade views. SC_CAPTURE_OUT is a fresh evidence directory.
SC_URL and SC_QUALITY select the site and tier. QA placement initializes views only.
"""
import asyncio,json,math,sys,time,statistics,os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]; OUT=Path(os.environ['SC_CAPTURE_OUT']);OUT.mkdir(parents=True,exist_ok=True)
C=json.loads((ROOT/'public/data/walkthrough/campus-structure.json').read_text()); S=json.loads((ROOT/'public/data/walkthrough/SC.json').read_text()); A=json.loads((ROOT/'public/data/walkthrough/access-plan.json').read_text()); P=C['placements']['SC']
def world(p):
 x,z=p;c,s=math.cos(P['rotation']),math.sin(P['rotation']);k=P['scale'];return [P['x']+(x*c+z*s)*k,P['z']+(-x*s+z*c)*k]
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'])
  page=await browser.new_page(viewport={'width':1280,'height':800});errs=[];page.on('pageerror',lambda e:errs.append(str(e)));network=[];page.on('requestfailed',lambda r:network.append({'url':r.url,'failure':r.failure}))
  chapters=json.loads((ROOT/'public/data/chapters.json').read_text())['chapters']
  await page.add_init_script('localStorage.setItem("nsysu-story-v3", JSON.stringify('+json.dumps({'done':[c['id'] for c in chapters],'flags':[],'fired':{c['id']:[s['id'] for s in c['steps']] for c in chapters},'sideQuests':[]})+'));')
  await page.add_init_script("localStorage.setItem('nsysu-walk-guide-v7','1');localStorage.setItem('nsysu-walk-tips-v8',JSON.stringify(['goal','accept','switch','bike','photo','line']));")
  await page.goto(os.environ.get('SC_URL','http://127.0.0.1:4190/')+'?view=walk&quality='+os.environ.get('SC_QUALITY','B')+'&qa=1',timeout=180000)
  await page.wait_for_function('window.campusWalk?.physicsStats',timeout=240000)
  await page.locator('[data-action=start]').first.click();await page.wait_for_timeout(700)
  await page.keyboard.press('v');rows=[]
  for f in S['floors']:
   for r in f['rooms']:
    if r.get('code') not in os.environ.get('SC_CODES','SC2002-4,SC2002-1,SC2002-7,SC3002-1,SC3002-7,SC4010,SC2004').split(','):continue
    poly=C.get('roomOverrides',{}).get(f['id'],{}).get(r['id'],r['polygon']);xs=[p[0] for p in poly];zs=[p[1] for p in poly]
    ports=[a for a in A['floors'][f['id']]['portals'] if r['id'] in a['roomIds']];port=ports[0];core=port['clearancePositions'][r['id']]
    x,z=world(core);face=world([(min(xs)+max(xs))/2,(min(zs)+max(zs))/2]);y=(f['level']-1)*3.7+.08
    ok=await page.evaluate('([x,z,y])=>window.campusWalk.qaPlace(x,z,y)',[x,z,y]);await page.wait_for_timeout(500)
    yaw=math.atan2(-(face[0]-x),-(face[1]-z))
    await page.evaluate('([yaw])=>{const s=window.campusWalk.camera, d=Math.atan2(Math.sin(yaw-s.yaw),Math.cos(yaw-s.yaw));const c=document.querySelector(".walkthrough canvas");c.dispatchEvent(new PointerEvent("pointermove",{movementX:-d/.004,movementY:(s.pitch+.1)/.003,bubbles:true}));}',[yaw])
    await page.wait_for_timeout(1200)
    await page.wait_for_function('document.querySelectorAll(".q-banner").length === 0',timeout=20000)
    await page.screenshot(path=str(OUT/(r['code']+'.png')),timeout=120000)
    row={'code':r['code'],'placed':ok,'position':await page.evaluate('window.campusWalk.position'),'camera':await page.evaluate('window.campusWalk.camera'),'mode':await page.evaluate('window.campusWalk.mode'),'render':await page.evaluate('window.campusWalk.renderStats'),'visible':await page.evaluate('window.campusWalk.drawBreakdown()')};rows.append(row);print(r['code'],ok,flush=True)
  if os.environ.get('SC_LOUNGE_DETAILS')=='1':
   floor=next(f for f in S['floors'] if f['id']=='SC-2F');room=next(r for r in floor['rooms'] if r.get('code')=='SC2002-4');xs=[q[0] for q in room['polygon']];zs=[q[1] for q in room['polygon']];scale=P['scale'];depth=(max(zs)-min(zs))*scale;y=3.78
   for name,offset,target,pitch in [('lounge',(3.15,.8),(3.15,3.3),-.18),('plush',(1.98,1.8),(1.88,depth-1.484),-.55)]:
    x,z=world([min(xs)+offset[0]/scale,min(zs)+offset[1]/scale]);face=world([min(xs)+target[0]/scale,min(zs)+target[1]/scale]);ok=await page.evaluate('([x,z,y])=>campusWalk.qaPlace(x,z,y)',[x,z,y]);await page.wait_for_timeout(400)
    yaw=math.atan2(-(face[0]-x),-(face[1]-z))
    await page.evaluate('([yaw,pitch])=>{const s=campusWalk.camera,d=Math.atan2(Math.sin(yaw-s.yaw),Math.cos(yaw-s.yaw));document.querySelector(".walkthrough canvas").dispatchEvent(new PointerEvent("pointermove",{movementX:-d/.004,movementY:(s.pitch-pitch)/.003,bubbles:true}));}',[yaw,pitch]);await page.wait_for_timeout(1000)
    await page.wait_for_function('document.querySelectorAll(".q-banner").length===0',timeout=20000);await page.screenshot(path=str(OUT/('SC2002-4-'+name+'.png')),timeout=120000)
    rows.append({'code':'SC2002-4','view':name,'placed':ok,'position':await page.evaluate('campusWalk.position'),'camera':await page.evaluate('campusWalk.camera'),'mode':await page.evaluate('campusWalk.mode'),'render':await page.evaluate('campusWalk.renderStats')});print('SC2002-4',name,ok,flush=True)
  (OUT/'result.json').write_text(json.dumps({'rooms':rows,'errors':errs,'networkFailures':network},ensure_ascii=False,indent=2));await browser.close()
asyncio.run(main())
