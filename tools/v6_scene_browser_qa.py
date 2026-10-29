"""Independent fixed-build surface/vegetation/real skinned-sole acceptance.
qaPlace is used only to locate a case; all motion uses real keyboard/mouse input.
"""
import asyncio, json, math, time, re, os
from pathlib import Path
from playwright.async_api import async_playwright
from v6_scene_ray_probe import TREE_GEOMETRY_PROBE

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / os.environ.get('SCENE_QA_OUT', 'artifacts/v6/scene-browser')
URL = 'http://127.0.0.1:4173/?view=walk&quality=A&qa=1'

SNAPSHOT = '''() => {
 const w=campusWalk,g=w.grass;
 const routes=w.routeSurfaces;
 let segments=0,points=0,maxError=0,unsupported=0;
 for(const part of routes?.story??[]){segments++;for(const p of part){points++;const s=w.surfaceAt(p[0],p[2],p[1]-.035)?.support;if(s===undefined)unsupported++;else maxError=Math.max(maxError,Math.abs(p[1]-s-.035));}}
 for(const part of routes?.automatic??[]){segments++;for(let i=0;i<part.length;i+=3){points++;const s=w.surfaceAt(part[i],part[i+2],part[i+1]-.035)?.support;if(s===undefined)unsupported++;else maxError=Math.max(maxError,Math.abs(part[i+1]-s-.035));}}
 return {position:w.position,camera:w.camera,mode:w.mode,readiness:w.readiness,foot:w.footContact,
 grass:g?{ready:g.ready,count:g.count,illegal:g.illegal,maxRootError:g.maxRootError,surfaceVersion:g.surfaceVersion,revision:g.revision,roots:g.roots}:null,
 route:{segments,points,maxError,unsupported,geometry:routes}};
}'''

FRAME_TRACE = '''async (count) => {
 const frames=[]; let last=performance.now();
 for(let i=0;i<count;i++) {
  await new Promise(requestAnimationFrame);const now=performance.now();
  frames.push({frame:i,dt:now-last,position:campusWalk.position,foot:campusWalk.footContact,animState:campusWalk.animState,onGround:campusWalk.onGround});last=now;
 }
 return frames;
}'''

def foot_summary(frames):
    evaluated=[]; failures=[]
    for frame in frames:
        f=frame.get('foot') or {}; feet=f.get('feet',[])
        if not f.get('onGround') or f.get('state') not in ['idle','walk','run','land']:
            continue
        clearances=[p.get('minVertexClearance') for p in feet if p.get('minVertexClearance') is not None]
        if len(clearances)!=2:
            failures.append({'frame':frame['frame'],'reason':'missing two actual sole-vertex clearance patches','foot':f});continue
        lowest=min(clearances);evaluated.append(lowest)
        # Swing feet may lift. At least one foot must support a grounded walk/idle,
        # and neither visible sole may penetrate the supporting surface by >2 cm.
        highest=max(clearances)
        if lowest < -.02 or lowest > .03 or (f.get('state')=='idle' and highest>.03):
            failures.append({'frame':frame['frame'],'minimumClearance':lowest,'maximumClearance':highest,'foot':f})
    return {'criterion':'Each sole vertex is queried at its own x/z on the same layer; no centre-point fallback','evaluated':len(evaluated),'failures':len(failures),'minClearance':min(evaluated,default=None),'maxSupportingClearance':max(evaluated,default=None),'firstFailures':failures[:12]}

async def main():
    OUT.mkdir(parents=True,exist_ok=True)
    results={'url':URL,'viewport':[1280,800],'method':'Chromium SwiftShader, production preview; qaPlace location only; real keyboard motion; actual skinned-sole samples every rendered frame','cases':[],'errors':[],'requestFailures':[]}
    def save(): (OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
        context=await browser.new_context(viewport={'width':1280,'height':800})
        page=await context.new_page()
        page.on('pageerror',lambda e:results['errors'].append(str(e)))
        page.on('requestfailed',lambda r:results['requestFailures'].append({'url':r.url,'failure':r.failure}))
        async def instrument(route):
            response=await route.fetch(); source=await response.text()
            if 'window.campusWalk=' in source:
                scene=re.search(r'drawBreakdown\(\)\{.*?return (\w+)\.traverseVisible',source).group(1)
                camera=re.search(r'get camera\(\)\{return\{position:(\w+)\.position\.toArray',source).group(1)
                physics=re.search(r'get physicsStats\(\)\{return (\w+)\.stats',source).group(1)
                source=source.replace('window.campusWalk=',f'window.__sceneProbe={{scene:{scene},camera:{camera},physics:{physics}}},window.campusWalk=',1)
            await route.fulfill(response=response,body=source)
        await page.route('**/assets/runtime-*.js',instrument)
        try:
            await page.goto(URL,wait_until='networkidle')
            await page.wait_for_function('campusWalk.worldReady && campusWalk.readiness.vegetationReady && campusWalk.story && campusWalk.footContact?.feet.length===2',timeout=120000)
            results['initialReadiness']=await page.evaluate('campusWalk.readiness');save()
            print(json.dumps({'initialReadiness':results['initialReadiness']},ensure_ascii=False),flush=True)
            await page.locator('[data-action=start]').first.click()
            for name,x,z,y in [
                ('road-1',62.813,-150.95,None),('road-2',23.412,211.781,None),('road-3',151.638,-56.895,None),
                ('crosswalk',-90.41,-150.88,None),('tunnel-mouth',19.1,154.4,1.0),('tunnel-inside',28.6,151,1.0),
                ('tunnel-upper-soil',75,164,None),('library-front',-65,-72,None),('admin-front',-70,94,None)]:
                if os.environ.get('SCENE_ONLY') and name != os.environ['SCENE_ONLY']: continue
                placement=await page.evaluate('''([x,z,y])=>{const s=campusWalk.surfaceAt(x,z,y??0);const reference=y??s?.soil?.height??0;return {requested:[x,reference,z],placed:campusWalk.qaPlace(x,z,reference),surface:s};}''',[x,z,y])
                await page.wait_for_timeout(1100)
                snapshot=await page.evaluate(SNAPSHOT)
                await page.screenshot(path=str(OUT/f'{name}.png'))
                record={'name':name,'placement':placement,'snapshot':snapshot}
                if name=='road-1':
                    core='/assets/'+next((ROOT/'dist/assets').glob('three.core-*.js')).name
                    record['pixelRays']=await page.evaluate('''async core=>{
                     const exports=Object.values(await import(core)),Raycaster=exports.find(v=>typeof v==='function'&&v.prototype?.setFromCamera&&v.prototype?.intersectObject);
                     const {scene,camera}=window.__sceneProbe,ray=new Raycaster();ray.params.Line.threshold=.1;
                     return [[180,450],[330,500],[835,185],[1018,284],[1175,368]].map(([x,y])=>{ray.setFromCamera({x:x/1280*2-1,y:1-y/800*2},camera);return {pixel:[x,y],hits:ray.intersectObjects(scene.children,true).filter(h=>{for(let p=h.object;p;p=p.parent)if(!p.visible)return false;return true;}).slice(0,12).map(h=>{const o=h.object,parents=[];for(let p=o;p;p=p.parent)parents.push(p.name||p.type);return{name:o.name,type:o.type,parents,point:h.point.toArray(),distance:h.distance,index:h.index,faceIndex:h.faceIndex,material:[o.material].flat().filter(Boolean).map(m=>({name:m.name,color:m.color?.getHexString(),depthTest:m.depthTest,transparent:m.transparent,opacity:m.opacity}))};})};});
                    }''',core)
                record['grassPass']=bool(snapshot['grass'] and snapshot['grass']['ready'] and snapshot['grass']['illegal']==0 and snapshot['grass']['maxRootError']<=.01)
                record['routePass']=snapshot['route']['unsupported']==0 and snapshot['route']['maxError']<=.011
                results['cases'].append(record);save()
                print(json.dumps({'case':name,'placed':placement['placed'],'position':snapshot['position'],'grass':{k:v for k,v in (snapshot['grass'] or {}).items() if k!='roots'},'route':{k:v for k,v in snapshot['route'].items() if k!='geometry'}},ensure_ascii=False),flush=True)

            # A side-on low camera exposes real soles instead of hiding them behind the body.
            # D/A moves across the camera, while drag lowers its line of sight.
            for name,x,z in [('flat-walk',151.638,-56.895),('crosswalk-slope-walk',-90.41,-150.88),('hillside-walk',75,164)]:
                if os.environ.get('SCENE_ONLY') and name != os.environ['SCENE_ONLY']: continue
                placement=await page.evaluate('''([x,z])=>{const s=campusWalk.surfaceAt(x,z,0);return campusWalk.qaPlace(x,z,s?.soil?.height??0);}''',[x,z])
                if not placement:
                    results['cases'].append({'name':name,'placed':False,'requested':[x,z],'skipped':'No safe placement; never measure the old location as this case'});save();continue
                await page.wait_for_timeout(900)
                camera=await page.evaluate('campusWalk.camera')
                # A photo-only override keeps the full soles inside the viewport.
                target_pitch=float(os.environ.get('SCENE_CAMERA_PITCH','.08'))
                dy=(camera['pitch']-target_pitch)/.003
                await page.mouse.move(640,400);await page.mouse.down();await page.mouse.move(640,400+dy,steps=8);await page.mouse.up()
                distance=float(os.environ.get('SCENE_CAMERA_DISTANCE','2.2'))
                await page.mouse.wheel(0,math.log(distance/camera['distance'])*1000 if os.environ.get('SCENE_ONLY') else -300);await page.wait_for_timeout(400)
                idle=await page.evaluate(FRAME_TRACE,int(os.environ.get('SCENE_IDLE_FRAMES','12')))
                await page.screenshot(path=str(OUT/f'{name}-idle-side.png'))
                motion=[]
                for key in ['d','a']:
                    await page.keyboard.down(key)
                    task=asyncio.create_task(page.evaluate(FRAME_TRACE,int(os.environ.get('SCENE_FRAMES','36'))))
                    await page.wait_for_timeout(450)
                    await page.screenshot(path=str(OUT/f'{name}-{key}-side.png'))
                    frames=await task
                    await page.keyboard.up(key)
                    summary=foot_summary(frames)
                    motion.append({'key':key,'frames':frames,'summary':summary})
                    print(json.dumps({'case':name,'key':key,'placed':placement,'summary':summary},ensure_ascii=False),flush=True)
                results['cases'].append({'name':name,'placed':placement,'idle':idle,'idleSummary':foot_summary(idle),'motion':motion});save()
            if os.environ.get('TREE_FINAL'):
                core='/assets/'+next((ROOT/'dist/assets').glob('three.core-*.js')).name
                results['tunnelVegetation']=await page.evaluate(TREE_GEOMETRY_PROBE,core);save()
                camera=await page.evaluate('campusWalk.camera')
                await page.mouse.move(640,400);await page.mouse.down();await page.mouse.move(640,400+(camera['pitch']+.18)/.003,steps=8);await page.mouse.up()
                await page.mouse.wheel(0,math.log(4.6/camera['distance'])*1000)
                results['treeViews']=[]
                for name,x,z,y in [('tunnel-inside',28.6,151,1),('tunnel-upper-soil',75,164,None)]:
                    placed=await page.evaluate('''([x,z,y])=>campusWalk.qaPlace(x,z,y??campusWalk.surfaceAt(x,z,0).soil.height)''',[x,z,y]);await page.wait_for_timeout(1200)
                    await page.screenshot(path=str(OUT/f'{name}.png'))
                    results['treeViews'].append({'name':name,'placed':placed,'snapshot':await page.evaluate(SNAPSHOT)});save()
                print(json.dumps({'treeFinal':results['tunnelVegetation']},ensure_ascii=False),flush=True)
        except Exception as exc:
            results['exception']=str(exc);save()
            try: await page.screenshot(path=str(OUT/'exception.png'))
            except Exception: pass
            raise
        finally:
            save();await browser.close()
    print('COMPLETE',len(results['cases']),'cases',flush=True)

if __name__=='__main__':asyncio.run(main())
