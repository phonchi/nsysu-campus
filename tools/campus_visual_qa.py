#!/usr/bin/env python3
"""Browser interaction/lifecycle QA; observes campusWalk without teleporting.

Production: CAMPUS_QA_URL=http://localhost:4174/campus/ python tools/campus_visual_qa.py
The URL defaults to the development server. Every run requires navReady=true;
actual autowalk/upstairs/door traversal is covered separately by walkthrough_qa.py.
"""
import asyncio,json,math,os,re,time,traceback
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'artifacts'
QA_URL=os.environ.get('CAMPUS_QA_URL','http://127.0.0.1:5173/')
BASE_PATH=urlparse(QA_URL).path.rstrip('/')+'/'

def overlap(a,b):
 return min(a['x']+a['width'],b['x']+b['width'])>max(a['x'],b['x']) and min(a['y']+a['height'],b['y']+b['height'])>max(a['y'],b['y'])

def artifact_prefix():
 prefix=os.environ.get('CAMPUS_QA_PREFIX','final-prod' if os.environ.get('CAMPUS_QA_URL') else 'campus-visual')
 if not re.fullmatch(r'[A-Za-z0-9_-]+',prefix):raise ValueError('CAMPUS_QA_PREFIX must contain only letters, digits, underscore or hyphen')
 # Keep earlier failures and screenshots intact when a run is repeated.
 if (OUT/f'{prefix}-qa.json').exists():prefix+='-'+datetime.now().strftime('%Y%m%d-%H%M%S')
 return prefix

async def main():
 OUT.mkdir(exist_ok=True);prefix=artifact_prefix();report_path=OUT/f'{prefix}-qa.json'
 report={'url':QA_URL,'artifactPrefix':prefix,'environment':'Local Chromium; desktop1440x900/mobile390x844 has_touch/DPR1; SwiftShader, not real mobile GPU performance.','navigation':'navReady MUST be true. This is readiness/UI acceptance; actual autowalk, stair climbing and door traversal are tested separately by walkthrough_qa.py.','views':[],'fatal':None}
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
  try:
   for mobile in [False,True]:
    label='mobile' if mobile else 'desktop';errors=[];console=[];crashed=[];http_errors=[];request_failures=[]
    context=await browser.new_context(viewport={'width':390 if mobile else 1440,'height':844 if mobile else 900},is_mobile=mobile,has_touch=mobile,device_scale_factor=1)
    def attach_page(page):
     page.on('pageerror',lambda e:errors.append(str(e)))
     page.on('crash',lambda:crashed.append(True))
     page.on('console',lambda m:console.append({'type':m.type,'text':m.text}) if m.type in ['error','warning'] else None)
    context.on('page',attach_page)
    context.on('response',lambda response:http_errors.append({'status':response.status,'url':response.url}) if response.status>=400 else None)
    context.on('requestfailed',lambda request:request_failures.append({'url':request.url,'error':request.failure}))
    page=await context.new_page();view={'label':label,'errors':errors,'console':console,'crashed':crashed,'http_errors':http_errors,'request_failures':request_failures,'checks':[]};report['views'].append(view)
    def check(name,passed,**data):view['checks'].append({'name':name,'passed':bool(passed),**data})
    async def screenshot(name):
     await page.screenshot(path=str(OUT/f'{prefix}-{label}-{name}.png'),timeout=45000)
    async def real_click(locator):
     await (locator.tap() if mobile else locator.click())
    async def reset_player():
     await real_click(page.locator('.walk-actions [data-action=reset]'));await page.wait_for_timeout(300)
    async def source_map():
     async with page.expect_popup() as event:await real_click(page.locator('.walk-toolbar [data-action=plan]'))
     popup=await event.value;await popup.wait_for_load_state('domcontentloaded');url=popup.url;await popup.close();return url
    started=time.monotonic();await page.goto(QA_URL,wait_until='domcontentloaded',timeout=45000)
    await page.wait_for_function('!!window.campusWalk',timeout=90000);await page.locator('.walk-loading').wait_for(state='hidden',timeout=15000)
    await page.wait_for_function('window.campusWalk?.navReady===true',timeout=60000)
    view['load_seconds']=round(time.monotonic()-started,2);view['navReady']=await page.evaluate('window.campusWalk.navReady');check('navReady is true',view['navReady'] is True)
    await page.wait_for_timeout(500);view['initial_stats']=await page.evaluate('window.campusWalk.renderStats');await screenshot('welcome')
    await real_click(page.locator('[data-action=start]'));await page.wait_for_function("window.campusWalk?.mode.walking && document.querySelector('.walk-welcome')?.hidden",timeout=15000);await page.wait_for_timeout(300);await screenshot('walk')
    run=page.locator('.walk-actions [data-action=run]')
    if not mobile:
     async def measure(shift=False):
      await reset_player()
      if shift:await page.keyboard.down('Shift')
      before=await page.evaluate('window.campusWalk.position');t=time.monotonic();await page.keyboard.down('w');await page.wait_for_timeout(1000);await page.keyboard.up('w');elapsed=time.monotonic()-t;after=await page.evaluate('window.campusWalk.position')
      if shift:await page.keyboard.up('Shift')
      distance=math.dist([before[0],before[2]],[after[0],after[2]])
      return {'distance_m':distance,'elapsed_s':elapsed,'observed_wallclock_mps':distance/elapsed,'before':before,'after':after}
     walking=await measure();shift=await measure(True);await run.click();await page.wait_for_timeout(150);toggle=await measure()
     ratio_shift=shift['distance_m']/max(walking['distance_m'],.001);ratio_toggle=toggle['distance_m']/max(walking['distance_m'],.001)
     check('Shift and toggle both produce approximately 2x actual physics displacement',walking['distance_m']>.4 and 1.5<ratio_shift<2.6 and 1.5<ratio_toggle<2.6,walk=walking,shift=shift,toggle=toggle,ratio_shift=ratio_shift,ratio_toggle=ratio_toggle)
    else:await run.tap()
    await page.wait_for_timeout(200);check('run toggle enables running',await page.evaluate('window.campusWalk.mode.running'))
    await screenshot('run');await real_click(run);await page.wait_for_timeout(200);check('run toggle returns to walking',not await page.evaluate('window.campusWalk.mode.running'))
    boxes={}
    for action in ['run','door','jump','reset']:boxes[action]=await page.locator(f'.walk-actions [data-action={action}]').bounding_box()
    if mobile:
     boxes['joystick']=await page.locator('.walk-joystick').bounding_box();check('touch joystick is visible',boxes['joystick'] is not None)
     overlaps=[(a,b) for i,a in enumerate(boxes) for b in list(boxes)[i+1:] if boxes[a] and boxes[b] and overlap(boxes[a],boxes[b])]
     check('mobile touch targets >=44px and do not overlap joystick',not overlaps and all(box and box['width']>=44 and box['height']>=44 for box in boxes.values()),boxes=boxes,overlaps=overlaps)
     cdp=await context.new_cdp_session(page)
     async def touch(kind,x=None,y=None):
      points=[] if kind=='touchEnd' else [{'x':x,'y':y,'id':1,'radiusX':2,'radiusY':2,'force':1}]
      await cdp.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':points})
     await reset_player();joy=await page.locator('.walk-joystick').bounding_box();x=joy['x']+joy['width']/2;y=joy['y']+joy['height']/2
     before=await page.evaluate('window.campusWalk.position');await touch('touchStart',x,y);await touch('touchMove',x,y-36);await page.wait_for_timeout(700);await touch('touchEnd');after=await page.evaluate('window.campusWalk.position')
     distance=math.dist([before[0],before[2]],[after[0],after[2]]);check('trusted touch joystick moves actual physics player',distance>.5,before=before,after=after,distance_m=distance)
     await page.wait_for_timeout(300);look_before=await page.evaluate('({heading:window.campusWalk.heading,position:window.campusWalk.position})')
     await touch('touchStart',340,410)
     for xx,yy in [(320,415),(295,425),(270,435),(245,445)]:await touch('touchMove',xx,yy);await page.wait_for_timeout(60)
     await touch('touchEnd');await page.wait_for_timeout(200);look_after=await page.evaluate('({heading:window.campusWalk.heading,position:window.campusWalk.position})')
     check('right canvas touch changes heading without moving player',abs(look_after['heading']-look_before['heading'])>.1 and math.dist(look_before['position'],look_after['position'])<.1,before=look_before,after=look_after);await screenshot('touch-look')
    # Exercise the real camera mode controls and keyboard bindings.
    if mobile:await real_click(page.locator('.walk-toolbar [data-action=camera]'))
    else:await page.locator('.walk-toolbar [data-action=walk]').focus();await page.keyboard.press('v')
    check('first-person camera switch works',await page.evaluate('window.campusWalk.mode.firstPerson'));await screenshot('first-person')
    if mobile:await real_click(page.locator('.walk-toolbar [data-action=camera]'))
    else:await page.keyboard.press('v')
    check('third-person camera switch works',not await page.evaluate('window.campusWalk.mode.firstPerson'))
    walk_map=await source_map();check('walking source map retains base URL',urlparse(walk_map).path.startswith(BASE_PATH+'data/walkthrough/'),url=walk_map)
    if mobile:await real_click(page.locator('.walk-toolbar [data-action=overview]'))
    else:await page.locator('.walk-toolbar [data-action=walk]').focus();await page.keyboard.press('m')
    check('M or overview control enters overview',await page.evaluate('window.campusWalk.mode.overview'))
    building_select=page.get_by_role('combobox',name='鳥瞰建築');floor_select=page.get_by_role('combobox',name='鳥瞰樓層')
    buildings=await building_select.locator('option').evaluate_all('(options)=>options.map(o=>({id:o.value,label:o.textContent}))');floor_inventory={}
    for building in buildings:
     await building_select.select_option(building['id']);floor_inventory[building['id']]=await floor_select.locator('option').evaluate_all('(options)=>options.filter(o=>o.value!=="all").map(o=>({id:o.value,label:o.textContent}))')
    total=sum(len(f) for f in floor_inventory.values());ids=[f['id'] for floors in floor_inventory.values() for f in floors]
    check('selectors expose exactly 8 buildings and 60 distinct floors',len(buildings)==8 and total==60 and len(set(ids))==60,buildings=buildings,floor_inventory=floor_inventory,total=total)
    await building_select.select_option('EC');await floor_select.select_option('EC-9F');await page.wait_for_timeout(350);await screenshot('EC9F-overview');view['overview_stats']=await page.evaluate('window.campusWalk.renderStats')
    ec9=await source_map();check('EC9F source map uses production base URL',urlparse(ec9).path==BASE_PATH+'data/walkthrough/EC-9F.webp',url=ec9)
    await floor_select.select_option('all');ecall=await source_map();check('all-building source map uses inspected EC1F',urlparse(ecall).path==BASE_PATH+'data/walkthrough/EC-1F.webp',url=ecall)
    await building_select.select_option('SC');await floor_select.select_option('SC-1F');await page.wait_for_timeout(300);await screenshot('SC1F-cutaway')
    check('SC1F cutaway selector retains selected floor',await floor_select.input_value()=='SC-1F')
    view['layout']=await page.evaluate('''()=>({innerWidth,scrollWidth:document.documentElement.scrollWidth,hostWidth:document.querySelector('.walkthrough').getBoundingClientRect().width})''');check('no document horizontal overflow',view['layout']['scrollWidth']==view['layout']['innerWidth'])
    await real_click(page.locator('.walk-toolbar [data-action=exit]'));await page.locator('.walkthrough').wait_for(state='detached',timeout=15000);await page.locator('#loading').wait_for(state='hidden',timeout=30000)
    check('legacy exit removes walk hooks/overlay and retains base path',await page.evaluate('!window.campusWalk && !document.querySelector(".walkthrough") && new URL(location.href).searchParams.get("legacy")==="1"') and urlparse(page.url).path==BASE_PATH)
    check('legacy renderer has one scene canvas',await page.locator('#scene canvas').count()==1)
    await real_click(page.locator('[data-mode="2d"]'));await page.locator('#map2d').wait_for(state='visible',timeout=15000);await real_click(page.locator('#sources-open'));await page.locator('#sources-dialog').wait_for(state='visible');await real_click(page.locator('#sources-close'))
    check('legacy 2D and sources dialog remain usable',await page.locator('#map2d').is_visible() and not await page.locator('#sources-dialog').is_visible())
    if mobile:await page.locator('#mobile-list').tap()
    await page.locator('#search').fill('SC1001');await page.wait_for_timeout(250);check('legacy room search remains usable',await page.locator('#room-hits button').count()>0);await screenshot('legacy')
    await page.reload(wait_until='domcontentloaded');await page.locator('#loading').wait_for(state='hidden',timeout=30000);check('legacy reload does not reopen walkthrough',await page.locator('.walkthrough').count()==0 and not await page.evaluate('!!window.campusWalk'))
    await page.wait_for_timeout(250);check('no HTTP404 or other HTTP errors',not http_errors,errors=list(http_errors));check('no uncaught JavaScript errors or crash',not errors and not crashed)
    gpu_losses=[m for m in console if re.search(r'context.{0,8}lost|GPU process.{0,30}crash',m['text'],re.I)];check('no GPU context-loss warning',not gpu_losses,warnings=gpu_losses)
    view['fps_note']='Observed software-rendering behavior only; no real-device performance claim.';view['passed']=sum(c['passed'] for c in view['checks']);view['total']=len(view['checks']);print(json.dumps(view,ensure_ascii=False),flush=True);await context.close()
  except Exception as e:
   report['fatal']={'type':type(e).__name__,'message':str(e),'traceback':traceback.format_exc()};print(json.dumps(report['fatal'],ensure_ascii=False),flush=True)
  finally:
   await browser.close();report['passed']=sum(c['passed'] for v in report['views'] for c in v['checks']);report['total']=sum(len(v['checks']) for v in report['views']);report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print('QA_REPORT '+str(report_path),flush=True)
 if report['fatal'] or report['passed']!=report['total']:raise SystemExit(1)
if __name__=='__main__':asyncio.run(main())
