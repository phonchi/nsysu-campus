"""Fixed build evidence of actual surfaces, vegetation instances and male/female ride contacts."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/os.environ.get('V6_QA_OUT','artifacts/v6/browser')
async def main():
 OUT.mkdir(parents=True,exist_ok=True);rows=[]
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
  for body in ['m','f']:
   ctx=await b.new_context(viewport={'width':1280,'height':800})
   await ctx.add_init_script('localStorage.setItem("nsysu-campus-v4",JSON.stringify('+json.dumps({'flags':['v4.bike'],'player':{'body':body}})+'))')
   page=await ctx.new_page();page.set_default_timeout(90000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto('http://127.0.0.1:4173/?view=walk&quality=A&qa=1',wait_until='networkidle');await page.wait_for_function('campusWalk.navReady&&campusWalk.questList',timeout=240000)
   await page.locator('[data-action=start]').first.click(no_wait_after=True);await page.wait_for_function('campusWalk.mode.walking')
   if body=='m' and not os.environ.get('V6_SKIP_ROADS'):
    for name,x,z in [('road-1',62.813,-150.95),('road-2',23.412,211.781),('road-3',151.638,-56.895),('crosswalk',-90.41,-150.88),('tunnel',28.6,151)]:
     placed=await page.evaluate('p=>campusWalk.qaPlace(...p)',[x,z]);await page.wait_for_timeout(1000)
     await page.screenshot(path=str(OUT/f'{name}.png'));g=await page.evaluate('campusWalk.grass');assert not g or g['illegal']==0,g
     rows.append({'case':name,'placed':placed,'position':await page.evaluate('campusWalk.position'),'grass':g,'route':await page.evaluate('campusWalk.routeSurfaces')});(OUT/'results.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
   assert await page.evaluate('campusWalk.qaPlace(-90,590)')
   await page.wait_for_timeout(500);await page.keyboard.press('b');await page.wait_for_function('campusWalk.animState==="ride"&&campusWalk.rideContact?.ready',timeout=15000)
   samples=[];await page.keyboard.down('w')
   for i in range(20):
    await page.wait_for_timeout(150);r=await page.evaluate('campusWalk.rideContact');samples.append(r)
    assert await page.evaluate('campusWalk.animState==="ride"'), 'riding unexpectedly ended'
    assert max(c['error'] for c in r['grips'])<=.02,r
    assert max(c['error'] for c in r['pedals'])<=.03,r
    assert max(c['error'] for c in r['wheels'])<=.02,r
    if i in [0,5,10,19]:await page.screenshot(path=str(OUT/f'ride-{body}-{i:02}.png'))
   await page.keyboard.up('w')
   await page.mouse.move(640,400);await page.mouse.down();await page.mouse.move(1000,400,steps=8);await page.mouse.up();await page.wait_for_timeout(400);await page.screenshot(path=str(OUT/f'ride-{body}-side.png'))
   assert not errors,errors
   rows.append({'case':'ride-'+body,'samples':samples,'errors':errors});await ctx.close()
  await b.close()
 (OUT/'results.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2));print('PASS',len(rows),'cases',flush=True)
asyncio.run(main())
