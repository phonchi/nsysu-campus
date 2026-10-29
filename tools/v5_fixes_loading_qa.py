"""Verify optional event-data failures cannot disable the world, main story, or navigation."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'artifacts/v5-fixes/loading-browser'
async def main():
 OUT.mkdir(parents=True,exist_ok=True);results=[]
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
  for resource in ['quests.json','encounters.json']:
   ctx=await b.new_context(viewport={'width':1280,'height':800});page=await ctx.new_page();errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   await page.route('**/data/'+resource,lambda route:route.fulfill(status=503,body='unavailable'))
   await page.goto('http://127.0.0.1:4173/?view=walk&story=1&quality=C&qa=1',wait_until='networkidle')
   await page.wait_for_function('window.campusWalk?.story?.active && window.campusWalk?.readiness?.worldReady',timeout=120000)
   observed=await page.evaluate('({story:window.campusWalk.story,features:window.campusWalk.readiness,ready:window.campusWalk.readiness.worldReady,stats:window.campusWalk.physicsStats})')
   assert observed['ready'];assert observed['story']['active'];assert not errors,errors
   results.append({'resource':resource,'passed':True,'observed':observed,'errors':errors})
   await page.screenshot(path=str(OUT/resource.replace('.json','.png')));await ctx.close()
  await b.close()
 (OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(json.dumps(results,ensure_ascii=False),flush=True)
if __name__=='__main__':asyncio.run(main())
