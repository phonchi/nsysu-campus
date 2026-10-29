import asyncio,json,re
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'artifacts/v6/riding/female-vertex-browser';OUT.mkdir(parents=True,exist_ok=True)
async def main():
 result={'body':'f','cases':[],'errors':[]}
 def save():(OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
 async with async_playwright() as pw:
  b=await pw.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader']);ctx=await b.new_context(viewport={'width':1280,'height':800});await ctx.add_init_script('localStorage.setItem("nsysu-campus-v4",JSON.stringify({flags:[],player:{body:"f",palette:0}}))');page=await ctx.new_page();page.on('pageerror',lambda e:result['errors'].append(str(e)))
  async def instrument(route):
   response=await route.fetch();source=await response.text()
   if 'window.campusWalk=' in source:
    scene=re.search(r'drawBreakdown\(\)\{.*?return (\w+)\.traverseVisible',source).group(1);source=source.replace('window.campusWalk=',f'window.__vertexScene={scene},window.campusWalk=',1)
   await route.fulfill(response=response,body=source)
  await page.route('**/assets/runtime-*.js',instrument)
  try:
   await page.goto('http://127.0.0.1:4173/?view=walk&quality=A&qa=1',wait_until='networkidle');await page.wait_for_function('campusWalk.navReady&&campusWalk.questList',timeout=240000);await page.locator('[data-action=start]').first.click();await page.wait_for_function('campusWalk.footContact?.feet.length===2',timeout=60000)
   core='/assets/'+next((ROOT/'dist/assets').glob('three.core-*.js')).name
   await page.evaluate('''async core=>{const values=Object.values(await import(core)),V=values.find(v=>typeof v==='function'&&v.prototype?.applyMatrix4&&v.prototype?.setFromMatrixPosition);window.soleVertexProbe=()=>{const out={};window.__vertexScene.updateMatrixWorld(true);window.__vertexScene.traverse(mesh=>{if(!mesh.isSkinnedMesh||mesh.name!=='student-f_mesh')return;mesh.skeleton.update();const uv=mesh.geometry.attributes.uv,ix=mesh.geometry.attributes.skinIndex,wt=mesh.geometry.attributes.skinWeight;for(let i=0;i<uv.count;i++){if(Math.abs(uv.getX(i)-.4375)>.004||Math.abs(uv.getY(i)-.1875)>.004)continue;const ids=[ix.getX(i),ix.getY(i),ix.getZ(i),ix.getW(i)],weights=[wt.getX(i),wt.getY(i),wt.getZ(i),wt.getW(i)];const name=mesh.skeleton.bones[ids[weights.indexOf(Math.max(...weights))]].name;if(!/^Foot[LR]$/.test(name))continue;const p=mesh.getVertexPosition(i,new V()).applyMatrix4(mesh.matrixWorld),surface=campusWalk.surfaceAt(p.x,p.z,campusWalk.position[1]);(out[name]??=[]).push({vertex:i,position:p.toArray(),support:surface?.support,clearance:surface?.support===undefined?null:p.y-surface.support});}});return out;};}''',core)
   async def sample(n):
    return await page.evaluate('''async n=>{const result=[];for(let i=0;i<n;i++){await new Promise(requestAnimationFrame);result.push({frame:i,anim:campusWalk.animState,grounded:campusWalk.onGround,position:campusWalk.position,feet:window.soleVertexProbe()});}return result;}''',n)
   for name,x,z in [('road-1',62.813,-150.95),('crosswalk',-90.41,-150.88)]:
    assert await page.evaluate('''([x,z])=>{const s=campusWalk.surfaceAt(x,z,0);return campusWalk.qaPlace(x,z,s?.soil?.height??0)}''',[x,z]);await page.wait_for_timeout(700);idle=await sample(6);record={'name':name,'idle':idle,'motion':[]};result['cases'].append(record);save();await page.screenshot(path=str(OUT/f'{name}-idle.png'))
    for key in ['d','a']:
     await page.keyboard.down(key);frames=await sample(18);await page.keyboard.up(key);record['motion'].append({'key':key,'frames':frames});save()
    clearances=[v['clearance']for f in idle+[f for m in record['motion']for f in m['frames']]for foot in f['feet'].values()for v in foot if v['clearance']is not None];record['minimumVertexClearance']=min(clearances);record['penetratingSamples']=sum(c<-.02 for c in clearances);print(json.dumps({k:v for k,v in record.items()if k not in ['idle','motion']}),flush=True);save()
   result['passed']=not result['errors']and all(c['penetratingSamples']==0 for c in result['cases']);save()
  except Exception as exc:result['exception']=str(exc);save();raise
  finally:await b.close()
asyncio.run(main())
