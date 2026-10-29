#!/usr/bin/env python3
"""Mobile Chromium touch-input checks. Never teleports or mutates app state via hooks."""
import asyncio,json,math,io
from pathlib import Path
from PIL import Image,ImageChops,ImageStat
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts'
OUT.mkdir(exist_ok=True)

async def main():
 checks=[];errors=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
  context=await browser.new_context(is_mobile=True,has_touch=True,device_scale_factor=1,viewport={'width':390,'height':844})
  page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  cdp=await context.new_cdp_session(page)
  async def touch(kind,x=None,y=None):
   points=[] if kind=='touchEnd' else [{'x':x,'y':y,'id':1,'radiusX':2,'radiusY':2,'force':1}]
   await cdp.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':points})
  async def joy_drag(hold=1100):
   box=await page.locator('.walk-joystick').bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
   await touch('touchStart',x,y);await touch('touchMove',x,y-36);await page.wait_for_timeout(hold);await touch('touchEnd')
   return box
  await page.goto('http://127.0.0.1:5173/',wait_until='networkidle');await page.wait_for_function('window.campusWalk?.navReady',timeout=45000)
  await page.locator('.walk-loading').wait_for(state='hidden',timeout=30000)
  await page.screenshot(path=str(OUT/'walk-mobile-welcome.png'))
  await page.locator('[data-action=start]').tap();await page.wait_for_timeout(600)
  joystick=page.locator('.walk-joystick');visible=await joystick.is_visible();checks.append({'name':'touch context displays joystick','passed':visible})
  pos_before=await page.evaluate('window.campusWalk.position');box=await joy_drag();pos_after=await page.evaluate('window.campusWalk.position')
  distance=math.dist([pos_before[0],pos_before[2]],[pos_after[0],pos_after[2]])
  checks.append({'name':'trusted CDP touch drag on joystick moves physics player','passed':distance>.5,'distance_m':distance,'before':pos_before,'after':pos_after})
  target=await page.evaluate('''()=>{const e=document.querySelector('.walk-joystick'),r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.className}''')
  toolbar=await page.locator('.walk-toolbar').bounding_box();overlap=not(toolbar['x']+toolbar['width']<=box['x'] or box['x']+box['width']<=toolbar['x'] or toolbar['y']+toolbar['height']<=box['y'] or box['y']+box['height']<=toolbar['y'])
  checks.append({'name':'toolbar does not cover joystick and centre receives joystick input','passed':not overlap and target=='walk-joystick','target':target,'toolbar':toolbar,'joystick':box})
  await page.screenshot(path=str(OUT/'walk-mobile-after-joystick.png'))
  before_image=await page.screenshot(clip={'x':175,'y':260,'width':190,'height':260});viewpos_before=await page.evaluate('window.campusWalk.position')
  await touch('touchStart',310,420)
  for x,y in [(295,425),(280,430),(260,440),(240,450),(220,460)]:
   await touch('touchMove',x,y);await page.wait_for_timeout(70)
  await touch('touchEnd');await page.wait_for_timeout(300)
  after_image=await page.screenshot(clip={'x':175,'y':260,'width':190,'height':260});viewpos_after=await page.evaluate('window.campusWalk.position')
  diff=ImageChops.difference(Image.open(io.BytesIO(before_image)).convert('RGB'),Image.open(io.BytesIO(after_image)).convert('RGB'))
  mean=sum(ImageStat.Stat(diff).mean)/3
  checks.append({'name':'right-side canvas touch drag visibly changes scene without moving player','passed':mean>3 and math.dist(viewpos_before,viewpos_after)<.1,'mean_pixel_difference':mean,'player_position_delta':math.dist(viewpos_before,viewpos_after)})
  await page.screenshot(path=str(OUT/'walk-mobile-look-drag.png'))
  search=page.get_by_role('searchbox',name='搜尋可步行房間');await search.fill('SC1001');await page.locator('[data-destination="SC-1F-SC1001"]').tap();await page.wait_for_timeout(250)
  initial_route=await page.evaluate('window.campusWalk.route.length')
  await joy_drag(350);remaining=await page.evaluate('window.campusWalk.route.length')
  checks.append({'name':'SC1001 selection starts route and manual touch movement cancels it','passed':initial_route>0 and remaining==0,'route_before':initial_route,'route_after':remaining})
  layout=await page.evaluate('''()=>({innerWidth,scrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth,hostWidth:document.querySelector('.walkthrough').getBoundingClientRect().width})''')
  checks.append({'name':'390px mobile has no horizontal document overflow','passed':layout['scrollWidth']<=390 and layout['bodyScrollWidth']<=390 and layout['hostWidth']<=390,'metrics':layout})
  checks.append({'name':'no uncaught JS errors','passed':not errors,'errors':errors})
  await page.screenshot(path=str(OUT/'walk-mobile-final.png'))
  await context.close();await browser.close()
 report={'checks':checks,'passed':sum(c['passed'] for c in checks),'total':len(checks),'errors':errors,'environment':'Chromium mobile/touch emulation, viewport390x844, DPR1, SwiftShader. Not real handset or mobile GPU performance verification.'}
 (OUT/'walk-mobile-qa.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
 if report['passed']!=report['total']:raise SystemExit(1)

if __name__=='__main__':asyncio.run(main())
