"""Local Chromium visual and journal interaction evidence for v5."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/os.environ.get('V5_QA_OUT','artifacts/v5/browser')
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 checks=[]
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
  for name,size in [('desktop',{'width':1440,'height':900}),('mobile',{'width':390,'height':844})]:
   ctx=await b.new_context(viewport=size,is_mobile=name=='mobile',has_touch=name=='mobile')
   page=await ctx.new_page(); errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto(os.environ.get('CAMPUS_WALK_URL','http://127.0.0.1:4173/')+'?view=walk&quality=C&qa=1',wait_until='networkidle')
   await page.wait_for_function('window.campusWalk?.navReady',timeout=120000)
   await page.wait_for_function('window.campusWalk?.questList?.length===12',timeout=120000)
   await page.locator('[data-action=start]').first.click()
   await page.wait_for_timeout(2500)
   await page.screenshot(path=str(OUT/f'{name}-walk.png'))
   await page.keyboard.press('j'); await page.wait_for_timeout(500)
   await page.screenshot(path=str(OUT/f'{name}-journal.png'))
   await page.locator('.journal-book').wait_for(state='visible')
   assert await page.locator('[data-journal=select]').count()==12
   await page.locator('[data-journal=accept]').click()
   assert len((await page.evaluate('window.campusWalk.journal'))['quests'])==1
   await page.locator('[data-journal=tab][data-id=events]').click()
   assert await page.locator('[data-journal=select]').count()>0
   await page.screenshot(path=str(OUT/f'{name}-timeline.png'))
   await page.keyboard.press('Escape')
   assert not await page.locator('.campus-journal').is_visible()
   await page.reload(wait_until='networkidle')
   await page.wait_for_function('window.campusWalk?.questList?.length===12',timeout=120000)
   assert len((await page.evaluate('window.campusWalk.journal'))['quests'])==1
   await page.wait_for_function('window.campusWalk?.questList?.length===12',timeout=120000)
   await page.locator('[data-action=start]').first.click()
   await page.wait_for_timeout(1000)
   assert await page.evaluate("window.campusWalk.qaEncounter('monkey-snack')")
   await page.wait_for_timeout(300)
   await page.screenshot(path=str(OUT/f'{name}-encounter.png'))
   await page.locator('[data-encounter=accept]').click()
   assert (await page.evaluate('window.campusWalk.encounter'))['phase']=='active'
   await page.locator('[data-encounter=skip]').click()
   assert await page.evaluate('window.campusWalk.encounter') is None
   checks.append({'viewport':name,'errors':errors,'stats':await page.evaluate('window.campusWalk.renderStats'),'overflow':await page.evaluate('document.documentElement.scrollWidth>innerWidth')})
   await ctx.close()
  await b.close()
 (OUT/'results.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2))
 print(json.dumps(checks,ensure_ascii=False,indent=2))
if __name__=='__main__':asyncio.run(main())
