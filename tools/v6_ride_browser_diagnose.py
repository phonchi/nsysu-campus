import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
OUT=Path('artifacts/v6/riding/browser');OUT.mkdir(parents=True,exist_ok=True)
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader']);ctx=await b.new_context(viewport={'width':1280,'height':800});await ctx.add_init_script('localStorage.setItem("nsysu-campus-v4",JSON.stringify({flags:["v4.bike"],player:{body:"m"}}))');page=await ctx.new_page();page.on('pageerror',lambda e:print('ERROR',str(e),flush=True));await page.goto('http://127.0.0.1:4173/?view=walk&quality=A&qa=1',wait_until='networkidle');await page.wait_for_function('campusWalk.navReady&&campusWalk.questList',timeout=240000);await page.locator('[data-action=start]').first.click();await page.wait_for_function('campusWalk.talk.mode==="walk"',timeout=20000);print('PLACE',await page.evaluate('campusWalk.qaPlace(-90,590)'),flush=True)
  async def snap():return await page.evaluate('({ready:campusWalk.readiness,ride:campusWalk.rideContact,feet:campusWalk.animationContact,status:document.querySelector(".walk-status").textContent,p:campusWalk.position,mode:campusWalk.mode,talk:campusWalk.talk,anim:campusWalk.animState,flags:campusWalk.campus.flags})')
  print('BEFORE',json.dumps(await snap()),flush=True);await page.keyboard.press('b')
  for i in range(12):await page.wait_for_timeout(250);print('FRAME',i,json.dumps(await snap()),flush=True)
  await page.screenshot(path=str(OUT/'riding.png'));await b.close()
asyncio.run(main())
