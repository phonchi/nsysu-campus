import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
URL='http://127.0.0.1:4174/campus/'
async def main():
 checks=[];errors=[]
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
  page=await b.new_page(viewport={'width':1440,'height':900});page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(URL,wait_until='networkidle');await page.wait_for_function('window.campusWalk?.navReady');await page.screenshot(path=str(ROOT/'artifacts/walk-v0-desktop.png'))
  await page.get_by_role('button',name='先看鳥瞰',exact=True).click();await page.screenshot(path=str(ROOT/'artifacts/walk-v0-overview.png'))
  await page.get_by_role('searchbox',name='搜尋可步行房間').fill('SC1001');await page.keyboard.press('Escape');checks.append({'name':'Escape dismisses focused search results','passed':await page.locator('.walk-results').is_hidden()})
  await page.get_by_role('button',name='圖資版 ↗',exact=True).click();checks.append({'name':'exit clears live walk handle','passed':await page.evaluate('!window.campusWalk')});await page.close()
  page=await b.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  await page.route('**/data/walkthrough/SC.json',lambda route:route.abort())
  await page.goto(URL,wait_until='networkidle');await page.wait_for_timeout(400);await page.get_by_role('button',name='圖資版 ↗',exact=True).click();checks.append({'name':'SC data failure still permits exit to maps','passed':await page.locator('.walkthrough').count()==0 and await page.evaluate('document.body.style.overflow!=="hidden"')});await page.close()
  page=await b.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  async def delayed(route):
   await asyncio.sleep(2);await route.continue_()
  await page.route('**/data/walkthrough/navmesh.bin',delayed)
  await page.goto(URL,wait_until='domcontentloaded');await page.wait_for_function('window.campusWalk');await page.get_by_role('button',name='圖資版 ↗',exact=True).click();await page.wait_for_timeout(2600);checks.append({'name':'late navigation load does not revive a closed experience','passed':await page.locator('.walkthrough').count()==0 and await page.evaluate('!window.campusWalk')});await page.close()
  checks.append({'name':'no lifecycle JavaScript errors','passed':not errors});await b.close()
 report={'checks':checks,'errors':errors,'passed':sum(c['passed'] for c in checks),'total':len(checks)};(ROOT/'artifacts/walk-lifecycle-qa.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False));
 if report['passed']!=report['total']:raise SystemExit(1)
asyncio.run(main())
