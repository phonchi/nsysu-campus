"""Female actual skinned-sole slope evidence; placement only via QA, motion is real D/A input."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
from v6_scene_browser_qa import FRAME_TRACE,foot_summary
OUT=Path('artifacts/v6/riding/female-foot-browser');OUT.mkdir(parents=True,exist_ok=True)
async def main():
 result={'body':'f','cases':[],'errors':[]}
 def save():(OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
 async with async_playwright() as pw:
  b=await pw.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader']);ctx=await b.new_context(viewport={'width':1280,'height':800});await ctx.add_init_script('localStorage.setItem("nsysu-campus-v4",JSON.stringify({flags:[],player:{body:"f",palette:0}}))');page=await ctx.new_page();page.on('pageerror',lambda e:result['errors'].append(str(e)))
  try:
   await page.goto('http://127.0.0.1:4173/?view=walk&quality=A&qa=1',wait_until='networkidle');await page.wait_for_function('campusWalk.navReady&&campusWalk.readiness.rideReady',timeout=240000);await page.locator('[data-action=start]').first.click();await page.wait_for_function('campusWalk.talk.mode==="walk"',timeout=30000)
   for name,x,z in [('road-1',62.813,-150.95),('crosswalk',-90.41,-150.88)]:
    placed=await page.evaluate('''([x,z])=>{const s=campusWalk.surfaceAt(x,z,0);return campusWalk.qaPlace(x,z,s?.soil?.height??0)}''',[x,z]);assert placed,(name,'placement failed');await page.wait_for_timeout(600)
    camera=await page.evaluate('campusWalk.camera');dx=(camera['yaw']-(-1.989))/.004;dy=(camera['pitch']-.08)/.003;await page.mouse.move(640,400);await page.mouse.down();await page.mouse.move(640+dx,400+dy,steps=8);await page.mouse.up();await page.wait_for_timeout(250)
    idle=await page.evaluate(FRAME_TRACE,12);record={'name':name,'placed':placed,'idle':idle,'idleSummary':foot_summary(idle),'motion':[]};result['cases'].append(record);save();await page.screenshot(path=str(OUT/f'{name}-idle.png'));print(json.dumps({'name':name,'phase':'idle','summary':record['idleSummary']}),flush=True)
    for key in ['d','a']:
     await page.keyboard.down(key);frames=await page.evaluate(FRAME_TRACE,36);await page.keyboard.up(key);summary=foot_summary(frames);record['motion'].append({'key':key,'frames':frames,'summary':summary});save();print(json.dumps({'name':name,'key':key,'summary':summary}),flush=True);await page.screenshot(path=str(OUT/f'{name}-{key}.png'))
   result['passed']=not result['errors'] and all(c['idleSummary']['failures']==0 and all(m['summary']['failures']==0 for m in c['motion']) for c in result['cases']);save();assert result['passed'],result
  except Exception as exc:result['exception']=str(exc)[:3000];save();await page.screenshot(path=str(OUT/'failure.png'));raise
  finally:await b.close()
asyncio.run(main())
