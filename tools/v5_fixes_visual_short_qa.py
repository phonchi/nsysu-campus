"""Post-fix screenshots: preserve the original 46-check evidence separately."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'artifacts/v5-fixes/visual-after';OUT.mkdir(parents=True,exist_ok=True)
async def main():
 rows=[]
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
  for name,viewport in [('desktop',{'width':1440,'height':900}),('mobile',{'width':390,'height':844})]:
   ctx=await b.new_context(viewport=viewport,is_mobile=name=='mobile',has_touch=name=='mobile');page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto('http://127.0.0.1:4173/?view=walk&quality=C&qa=1',wait_until='networkidle');await page.wait_for_function('campusWalk.navReady&&campusWalk.questList?.length===12',timeout=180000)
   await page.locator('[data-action=start]').first.click();await page.wait_for_timeout(400)
   await page.keyboard.press('j');await page.locator('[data-journal=select][data-id=sea-stage]').click();await page.locator('[data-journal=accept]').click();await page.locator('[data-journal=close]').click()
   assert await page.evaluate('campusWalk.qaPlace(-84.2,596.2)')
   assert await page.evaluate("campusWalk.qaEncounter('monkey-snack')")
   await page.wait_for_timeout(500);await page.screenshot(path=str(OUT/f'{name}-stacked-hud.png'))
   info=await page.evaluate('''()=>{const strong=document.querySelector('.quest-pocket strong'),hint=document.querySelector('.q-hint'),r=hint.getBoundingClientRect(),sample=document.createElement('span');sample.style.color='var(--ui-ink)';document.querySelector('.walkthrough').append(sample);const expected=getComputedStyle(sample).color;sample.remove();return {pocketTitle:strong.textContent,titleColor:getComputedStyle(strong).color,expectedColor:expected,hint:hint.textContent,hintVisible:!hint.hidden,hintRect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight}}}''')
   r=info['hintRect'];info['passed']=info['titleColor']==info['expectedColor'] and info['hintVisible'] and r['x']>=0 and r['y']>=0 and r['x']+r['width']<=info['viewport']['width'] and r['y']+r['height']<=info['viewport']['height'] and not errors;info['viewportName']=name;info['errors']=errors;rows.append(info);print(json.dumps(info,ensure_ascii=False),flush=True)
   await ctx.close()
  await b.close()
 (OUT/'results.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2));assert all(r['passed'] for r in rows)
asyncio.run(main())
