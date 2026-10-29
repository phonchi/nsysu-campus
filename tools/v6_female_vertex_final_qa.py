"""Final female actual-skin per-vertex proof. Never substitutes center clearance for missing samples."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
OUT=Path('artifacts/v6/riding/female-vertex-final');OUT.mkdir(parents=True,exist_ok=True)
async def main():
 result={'body':'f','case':'road-1','requested':[62.813,-150.95],'frames':{},'errors':[]}
 def save():(OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader']);ctx=await b.new_context(viewport={'width':1280,'height':800});await ctx.add_init_script('localStorage.setItem("nsysu-campus-v4",JSON.stringify({flags:[],player:{body:"f",palette:0}}))');page=await ctx.new_page();page.on('pageerror',lambda e:result['errors'].append(str(e)))
  try:
   await page.goto('http://127.0.0.1:4173/?view=walk&quality=A&qa=1',wait_until='networkidle');await page.wait_for_function('campusWalk.navReady&&campusWalk.questList',timeout=240000);await page.locator('[data-action=start]').first.click();await page.wait_for_function('campusWalk.footContact?.feet.length===2',timeout=60000)
   placed=await page.evaluate('''([x,z])=>{const s=campusWalk.surfaceAt(x,z,0);return campusWalk.qaPlace(x,z,s?.soil?.height??0)}''',result['requested']);assert placed,'No safe placement';await page.wait_for_timeout(700)
   c=await page.evaluate('campusWalk.camera');await page.mouse.move(640,400);await page.mouse.down();await page.mouse.move(640+(c['yaw']+1.989)/.004,400+(c['pitch']-.08)/.003,steps=8);await page.mouse.up()
   for phase,key in [('idle',None),('walk-d','d'),('walk-a','a')]:
    if key:await page.keyboard.down(key)
    frames=await page.evaluate('''async()=>{const rows=[];for(let i=0;i<12;i++){await new Promise(requestAnimationFrame);rows.push({frame:i,position:campusWalk.position,foot:campusWalk.footContact});}return rows;}''')
    if key:await page.keyboard.up(key)
    result['frames'][phase]=frames;save();await page.screenshot(path=str(OUT/f'{phase}.png'))
    evaluated=[]
    for row in frames:
     foot=row['foot'];assert foot and foot['onGround'],(phase,'missing grounded contact');assert len(foot['feet'])==2
     for f in foot['feet']:
      assert isinstance(f.get('minVertexClearance'),(int,float)),(phase,'missing minVertexClearance',f)
      assert f.get('vertexClearances') and all(isinstance(x,(int,float))for x in f['vertexClearances']),(phase,'unsupported vertex',f)
      assert min(f['vertexClearances'])>=-.02,(phase,'vertex penetration',f)
     mins=[f['minVertexClearance']for f in foot['feet']];assert min(mins)<=.03,(phase,'no support foot',mins)
     if phase=='idle':assert max(mins)<=.03,(phase,'idle floating foot',mins)
     evaluated.extend(mins)
    result.setdefault('summaries',{})[phase]={'frames':len(frames),'minVertexClearance':min(evaluated),'maxFootMinimumClearance':max(evaluated),'passed':True};save();print(json.dumps({'phase':phase,**result['summaries'][phase]}),flush=True)
   assert not result['errors'];result['passed']=True;save()
  except Exception as e:result['passed']=False;result['exception']=str(e)[:3000];save();await page.screenshot(path=str(OUT/'failure.png'));raise
  finally:await b.close()
asyncio.run(main())
