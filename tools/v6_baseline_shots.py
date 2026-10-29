"""Capture user-visible v5 symptoms before surface/rig replacement, isolated local browser."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'artifacts/v6/baseline';OUT.mkdir(parents=True,exist_ok=True)
async def main():
 rows=[]
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader']);ctx=await b.new_context(viewport={'width':1280,'height':800})
  await ctx.add_init_script("localStorage.setItem('nsysu-campus-v4',JSON.stringify({flags:['v4.bike']}))")
  page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto('http://127.0.0.1:4173/?view=walk&quality=A&qa=1',wait_until='networkidle');await page.wait_for_function('campusWalk.worldReady&&campusWalk.questList',timeout=180000)
  await page.locator('[data-action=start]').first.click()
  for name,x,z in [('road-1',62.813,-150.95),('road-2',23.412,211.781),('road-3',151.638,-56.895),('crosswalk',-90.41,-150.88),('tunnel',28.6,151)]:
   placed=await page.evaluate('p=>campusWalk.qaPlace(...p)',[x,z]);await page.wait_for_timeout(1500)
   await page.screenshot(path=str(OUT/f'{name}.png'));rows.append({'name':name,'placed':placed,'position':await page.evaluate('campusWalk.position'),'camera':await page.evaluate('campusWalk.camera')})
  await page.evaluate('campusWalk.qaPlace(-90,590)');await page.wait_for_timeout(500);await page.keyboard.press('b');await page.wait_for_timeout(500);await page.screenshot(path=str(OUT/'ride.png'))
  (OUT/'browser.json').write_text(json.dumps({'rows':rows,'errors':errors},ensure_ascii=False,indent=2));await b.close()
asyncio.run(main())
