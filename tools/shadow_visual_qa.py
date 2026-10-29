#!/usr/bin/env python3
"""Isolated visual A/B by module response interception; source/collision unchanged."""
import asyncio,json,re
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'artifacts'
async def main():
 report={'method':'Runtime module-response A/B, no repository source mutation. Local Chromium/SwiftShader, not real mobile GPU performance.','variants':[]}
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
  for variant in ['baseline','ground-no-cast']:
   context=await browser.new_context(viewport={'width':1440,'height':900},device_scale_factor=1);page=await context.new_page();errors=[];hits=[];page.on('pageerror',lambda e:errors.append(str(e)))
   if variant!='baseline':
    async def intercept(route):
     response=await route.fetch();body=await response.text();pattern=r'(function decorateCampus\(world\)\s*\{)'
     body,count=re.subn(pattern,r'\1 world.display.traverse(o=>{if(o.isMesh && !Array.isArray(o.material) && o.material.color?.getHexString()==="8b9d79")o.castShadow=false;});',body,count=1);hits.append(count);await route.fulfill(response=response,body=body)
    await page.route('**/src/walk-art.ts*',intercept)
   await page.goto('http://127.0.0.1:5173/',wait_until='domcontentloaded');await page.wait_for_function('!!window.campusWalk',timeout=60000);await page.locator('.walk-loading').wait_for(state='hidden');await page.wait_for_timeout(500);await page.screenshot(path=str(OUT/f'shadow-{variant}.png'),timeout=30000)
   report['variants'].append({'variant':variant,'interceptionCount':hits,'errors':errors,'stats':await page.evaluate('window.campusWalk.renderStats')});await context.close()
  await browser.close()
 (OUT/'shadow-visual-qa.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))
if __name__=='__main__':asyncio.run(main())
