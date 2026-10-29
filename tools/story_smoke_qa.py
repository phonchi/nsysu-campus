import asyncio,json,math
from playwright.async_api import async_playwright
import os,pathlib
S=str(pathlib.Path(__file__).resolve().parents[1]/'artifacts/v3/T6')+'/';os.makedirs(S,exist_ok=True)
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
  pg=await b.new_page(viewport={'width':1440,'height':900});errs=[];pg.on('pageerror',lambda e:errs.append(str(e)));pg.on('console',lambda m:m.type=='warning' and errs.append('warn:'+m.text))
  await pg.goto('http://127.0.0.1:5173/?view=walk&story=1&quality=A',wait_until='networkidle')
  await pg.evaluate("localStorage.removeItem('nsysu-story-v3')")
  await pg.reload(wait_until='networkidle')
  await pg.wait_for_function('window.campusWalk?.story',timeout=90000)
  await pg.wait_for_timeout(2500)
  print(json.dumps(await pg.evaluate('({pos:window.campusWalk.position,story:window.campusWalk.story,npcs:window.campusWalk.npcs,stats:window.campusWalk.renderStats})')))
  await pg.screenshot(path=S+'story-gate.png')
  # walk toward guide using real keys: turn camera via heading then hold W
  for i in range(40):
   st=await pg.evaluate('({p:window.campusWalk.position,g:window.campusWalk.npcs[0].position,h:window.campusWalk.camera.yaw})')
   dx=st['g'][0]-st['p'][0];dz=st['g'][2]-st['p'][2];d=math.hypot(dx,dz)
   if d<2.2:break
   want=math.atan2(-dx,-dz);delta=math.atan2(math.sin(want-st['h']),math.cos(want-st['h']))
   await pg.mouse.move(720,600);await pg.mouse.down();await pg.mouse.move(720-delta/.004,600,steps=6);await pg.mouse.up()
   await pg.keyboard.down('w');await pg.wait_for_timeout(700);await pg.keyboard.up('w')
  await pg.keyboard.press('e');await pg.wait_for_timeout(1500)
  print('after E',json.dumps(await pg.evaluate('window.campusWalk.story')))
  await pg.screenshot(path=S+'story-dialogue.png')
  for i in range(12):
   await pg.keyboard.press('e');await pg.wait_for_timeout(500)
   await pg.keyboard.press('e');await pg.wait_for_timeout(300)
   s=await pg.evaluate('window.campusWalk.story')
   if not s['dialogue'] and s['blocking']:break
  await pg.wait_for_timeout(800);await pg.screenshot(path=S+'story-card.png')
  print('end',json.dumps(await pg.evaluate('window.campusWalk.story')),errs[:5])
  await b.close()
asyncio.run(main())
