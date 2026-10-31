#!/usr/bin/env python3
"""Exercise actual keyboard/autowalk inputs. No player teleport acceptance hooks."""
import asyncio,json,os,time
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
async def main():
 checks=[];errors=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
  context=await browser.new_context(viewport={'width':1440,'height':900},record_video_dir=str(ROOT/'artifacts/v7/navigation/walk-video'),record_video_size={'width':1280,'height':800})
  page=await context.new_page();await page.add_init_script("try{localStorage.setItem('nsysu-walk-guide-v7','1')}catch(e){}");page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(os.environ.get('CAMPUS_WALK_URL','http://127.0.0.1:5173/?view=walk&spawn=arcade'),wait_until='networkidle');await page.wait_for_function('window.campusWalk?.navReady',timeout=120000)
  await page.get_by_role('button',name='開始探索 →',exact=True).click()
  checks.append({'name':'original Blender character and walk canvas load','passed':await page.locator('.walk-canvas canvas').count()==1})
  before=await page.evaluate('window.campusWalk.position');await page.keyboard.down('w')
  # Hold W until the player has moved; the first frames after start compile shaders for seconds under
  # software rendering, so allow up to 20 s.
  for _ in range(80):
   await page.wait_for_timeout(250);now=await page.evaluate('window.campusWalk.position')
   if sum((now[i]-before[i])**2 for i in [0,2])>.25:break
  await page.keyboard.up('w');after=await page.evaluate('window.campusWalk.position');checks.append({'name':'W moves player using physics','passed':sum((after[i]-before[i])**2 for i in [0,2])>.25,'before':before,'after':after})
  await page.keyboard.press('v');checks.append({'name':'V switches to first person','passed':await page.evaluate('window.campusWalk.mode.firstPerson')})
  await page.keyboard.press('v')
  # v4: search lives in the Esc menu; "/" opens it with the search box focused.
  await page.keyboard.press('/');await page.wait_for_timeout(300)
  search=page.get_by_role('searchbox',name='搜尋可步行房間');await search.fill('SC2001');await page.locator('[data-destination="SC-2F-SC2001"]').click()
  trace=[];start=time.monotonic()
  while time.monotonic()-start<240:
   state=await page.evaluate('({p:window.campusWalk.position,n:window.campusWalk.route.length})');trace.append(state)
   if len(trace)%5==0:print(json.dumps({'phase':'autowalk','elapsed':round(time.monotonic()-start,1),**state}),flush=True)
   if state['n']==0:break
   await page.wait_for_timeout(2000)
  goal=await page.evaluate("window.campusWalk.destinations.find(d=>d.label==='SC2001').position");arrived=state['n']==0 and abs(state['p'][1]-goal[1])<.4 and sum((state['p'][i]-goal[i])**2 for i in [0,2])<1;checks.append({'name':'real autowalk climbs stairs and reaches SC2001','passed':arrived,'goal':goal,'trace':trace});assert arrived,'autowalk did not reach the authored SC2001 doorway; dependent door checks skipped'
  await page.screenshot(path=str(ROOT/'artifacts/v7/navigation/campus-walk-2f.png'))
  await page.keyboard.press('e');await page.wait_for_function("window.campusWalk.doors.some(d=>d.label.includes('SC2001') && d.open>.8)",timeout=20000);doors=await page.evaluate('window.campusWalk.doors');checks.append({'name':'E opens nearest real door','passed':any('SC2001' in d['label'] and d['open']>.8 for d in doors)})
  # Turn with the real canvas drag, then physically cross the open doorway.
  import math
  foot=await page.evaluate('window.campusWalk.position');door=next(d for d in doors if 'SC2001' in d['label']);heading=await page.evaluate('window.campusWalk.heading');desired=math.atan2(-(door['position'][0]-foot[0]),-(door['position'][2]-foot[2]));delta=(heading-desired+math.pi)%(math.pi*2)-math.pi
  # Start the drag on bare canvas: HTML labels/cards above the canvas must not swallow it.
  sx,sy=await page.evaluate("(()=>{for(let y=430;y<760;y+=30)for(let x=650;x<1100;x+=40){const e=document.elementFromPoint(x,y);if(e&&e.tagName==='CANVAS')return [x,y];}return [650,430];})()")
  hit=await page.evaluate(f"document.elementFromPoint({sx},{sy})?.className||document.elementFromPoint({sx},{sy})?.tagName")
  await page.mouse.move(sx,sy);await page.mouse.down();await page.mouse.move(sx+delta/.004,sy,steps=12);await page.mouse.up();
  print(json.dumps({'phase':'door-turn','start':[sx,sy],'hit':str(hit),'headingBefore':heading,'desired':desired,'headingAfter':await page.evaluate('window.campusWalk.heading'),'foot':foot,'door':door['position']}),flush=True)
  # Hold W until the doorway is crossed (software GPU frames are capped at dt .065, so wall-clock time varies).
  await page.keyboard.down('w');held=time.monotonic()
  while time.monotonic()-held<10:
   inside=await page.evaluate('window.campusWalk.position')
   if sum((inside[i]-door['position'][i])*(door['position'][i]-foot[i]) for i in [0,2])/max(.001,sum((door['position'][i]-foot[i])**2 for i in [0,2])**.5)>.6:break
   await page.wait_for_timeout(250)
  await page.keyboard.up('w');inside=await page.evaluate('window.campusWalk.position');checks.append({'name':'player walks through open SC2001 doorway into the room','passed':sum((inside[i]-door['position'][i])*(door['position'][i]-foot[i]) for i in [0,2])/max(.001,sum((door['position'][i]-foot[i])**2 for i in [0,2])**.5)>.35 and inside[1]>3.4,'position':inside})
  await page.screenshot(path=str(ROOT/'artifacts/v7/navigation/campus-walk-inside-room.png'));await page.keyboard.press('v');await page.keyboard.down('w');await page.wait_for_timeout(700);await page.keyboard.up('w');await page.screenshot(path=str(ROOT/'artifacts/v7/navigation/campus-walk-room-first-person.png'));await page.keyboard.press('v')
  await page.keyboard.press('/');await page.wait_for_timeout(300);await search.fill('SC1001');await page.locator('[data-destination="SC-1F-SC1001"]').click();await page.wait_for_timeout(800);await page.keyboard.down('a');await page.wait_for_timeout(250);await page.keyboard.up('a');checks.append({'name':'manual movement cancels automatic route','passed':await page.evaluate('window.campusWalk.route.length===0')})
  await page.keyboard.press('m');checks.append({'name':'M enters overview','passed':await page.evaluate('window.campusWalk.mode.overview')});await page.get_by_role('combobox',name='鳥瞰樓層').select_option('SC-1F');await page.wait_for_timeout(350);await page.screenshot(path=str(ROOT/'artifacts/v7/navigation/campus-walk-cutaway.png'))
  await page.set_viewport_size({'width':390,'height':844});await page.keyboard.press('Escape');await page.wait_for_timeout(300);await page.get_by_role('button',name='步行',exact=True).click();await page.wait_for_timeout(300);await page.screenshot(path=str(ROOT/'artifacts/v7/navigation/campus-walk-mobile.png'))
  checks.append({'name':'mobile horizontal layout stays within viewport','passed':await page.evaluate('document.querySelector(".walkthrough").getBoundingClientRect().width<=390')})
  checks.append({'name':'no JavaScript errors','passed':not errors})
  await context.close();await browser.close()
 report={'checks':checks,'errors':errors,'passed':sum(c['passed'] for c in checks),'total':len(checks),'note':'Local Chromium software rendering; 240s wall-clock allowance for capped simulation under SwiftShader, not a real-phone GPU performance certification.'}
 (ROOT/'artifacts/v7/navigation/campus-walkthrough-qa.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False),flush=True)
 if report['passed']!=report['total']:raise SystemExit(1)
if __name__=='__main__':asyncio.run(main())
