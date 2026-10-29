"""Read-only ray and geometry diagnosis against the fixed production build."""
import asyncio, json, re, os
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/os.environ.get('SCENE_RAY_OUT','artifacts/v6/scene-browser/ray-probe')

TREE_GEOMETRY_PROBE = '''async core=>{
   const ex=Object.values(await import(core)),Box3=ex.find(v=>typeof v==='function'&&v.prototype?.setFromObject&&v.prototype?.intersectsBox),Matrix4=ex.find(v=>typeof v==='function'&&v.prototype?.makeRotationY&&v.prototype?.setPosition);
   const V=window.__sceneProbe.camera.position.constructor,scene=window.__sceneProbe.scene;
   const transform=new Matrix4().makeRotationY(-1.8395).setPosition(19.9,.981878,148.5),inverse=transform.clone().invert();
   const bore=new Box3(new V(-3.3,0,-20),new V(3.3,5.8,0)),hits=[];let scanned=0;
   scene.updateMatrixWorld(true);scene.traverse(o=>{if(!o.isMesh||!/trunk|tree|palm|foliage/i.test(o.name))return;
    let visible=true;for(let p=o;p;p=p.parent)if(!p.visible)visible=false;
    o.geometry.computeBoundingBox();const base=o.geometry.boundingBox;if(!base)return;
    const count=o.isInstancedMesh?o.count:1;
    for(let i=0;i<count;i++){const matrix=new Matrix4();if(o.isInstancedMesh)o.getMatrixAt(i,matrix);matrix.premultiply(o.matrixWorld);const local=base.clone().applyMatrix4(inverse.clone().multiply(matrix));scanned++;
     if(local.intersectsBox(bore)){
      const world=base.clone().applyMatrix4(matrix),localMatrix=inverse.clone().multiply(matrix),position=o.geometry.attributes.position,uv=o.geometry.attributes.uv,index=o.geometry.index;
      let trunkTriangles=0,allTriangles=0;const examples=[];
      const clip=(poly,axis,bound,sign)=>{const out=[];for(let j=0;j<poly.length;j++){const a=poly[j],b=poly[(j+1)%poly.length],da=sign*(a[axis]-bound),db=sign*(b[axis]-bound);if(da>=0)out.push(a);if((da>=0)!==(db>=0))out.push(a.clone().lerp(b,da/(da-db)));}return out;};
      for(let k=0;k<(index?.count??position.count);k+=3){const indices=[0,1,2].map(j=>index?index.getX(k+j):k+j);let poly=indices.map(i=>new V().fromBufferAttribute(position,i).applyMatrix4(localMatrix));
       for(const axis of ['x','y','z']){poly=clip(poly,axis,bore.min[axis],1);if(poly.length)poly=clip(poly,axis,bore.max[axis],-1);if(!poly.length)break;}
       if(poly.length>=3){allTriangles++;const trunk=uv&&indices.every(i=>Math.abs(uv.getX(i)-8/256)<1e-6&&Math.abs(uv.getY(i)-(1-8/256))<1e-6);if(trunk){trunkTriangles++;if(examples.length<5)examples.push(poly.map(p=>p.toArray()));}}
      }
      hits.push({name:o.name,type:o.type,visible,index:o.isInstancedMesh?i:null,originLocal:new V().applyMatrix4(localMatrix).toArray(),intersectingTriangles:allTriangles,intersectingTrunkTriangles:trunkTriangles,trunkExamples:examples,localBounds:{min:local.min.toArray(),max:local.max.toArray()},worldBounds:{min:world.min.toArray(),max:world.max.toArray()},material:[o.material].flat().map(m=>({name:m.name,color:m.color?.getHexString()}))});}
    }
   });
   const from=new V(-2.5,4,-5.0772).applyMatrix4(transform),to=new V(2.5,4,-5.0772).applyMatrix4(transform);
   const clearance={from:from.toArray(),to:to.toArray(),length:from.distanceTo(to),free:window.__sceneProbe.physics.sweep(from,to,.08)};
   return{scanned,bore:{min:bore.min.toArray(),max:bore.max.toArray()},hits,clearance};
  }'''

async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
  page=await browser.new_page(viewport={'width':1280,'height':800});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  async def instrument(route):
   response=await route.fetch();source=await response.text()
   if 'window.campusWalk=' in source:
    scene=re.search(r'drawBreakdown\(\)\{.*?return (\w+)\.traverseVisible',source).group(1)
    camera=re.search(r'get camera\(\)\{return\{position:(\w+)\.position\.toArray',source).group(1)
    physics=re.search(r'get physicsStats\(\)\{return (\w+)\.stats',source).group(1)
    source=source.replace('window.campusWalk=',f'window.__sceneProbe={{scene:{scene},camera:{camera},physics:{physics}}},window.campusWalk=',1)
   await route.fulfill(response=response,body=source)
  await page.route('**/assets/runtime-*.js',instrument)
  await page.goto('http://127.0.0.1:4173/?view=walk&quality=A&qa=1',wait_until='networkidle')
  await page.wait_for_function('campusWalk.worldReady&&campusWalk.readiness.vegetationReady',timeout=120000)
  await page.locator('[data-action=start]').first.click()
  original_layer=await page.evaluate('campusWalk.qaPlace(62.813,-150.95,0)')
  placed=await page.evaluate('campusWalk.qaPlace(62.813,-150.95)') if os.environ.get('TREE_FINAL') else original_layer
  await page.wait_for_timeout(1200)
  await page.screenshot(path=str(OUT/'road-1-original-layer.png'))
  core='/assets/'+next((ROOT/'dist/assets').glob('three.core-*.js')).name
  data=await page.evaluate('''async core=>{
   const ex=Object.values(await import(core)),Raycaster=ex.find(v=>typeof v==='function'&&v.prototype?.setFromCamera&&v.prototype?.intersectObject);
   const {scene,camera}=window.__sceneProbe,ray=new Raycaster();ray.params.Line.threshold=.15;
   const rays=[[180,450],[330,500],[835,185],[1018,284],[1175,368]].map(([x,y])=>{ray.setFromCamera({x:x/1280*2-1,y:1-y/800*2},camera);return{pixel:[x,y],hits:ray.intersectObjects(scene.children,true).filter(h=>{for(let p=h.object;p;p=p.parent)if(!p.visible)return false;return true;}).slice(0,10).map(h=>{const o=h.object,parents=[];for(let p=o;p;p=p.parent)parents.push(p.name||p.type);return{name:o.name,type:o.type,parents,point:h.point.toArray(),distance:h.distance,index:h.index,faceIndex:h.faceIndex,material:[o.material].flat().filter(Boolean).map(m=>({name:m.name,color:m.color?.getHexString(),depthTest:m.depthTest,side:m.side,transparent:m.transparent,opacity:m.opacity}))};})};});
   return{position:campusWalk.position,camera:campusWalk.camera,surface:campusWalk.surfaceAt(62.813,-150.95,0),rays};
  }''',core)
  data['placed']=placed;data['explicitOriginalLayerPlaced']=original_layer;data['errors']=errors
  if os.environ.get('TREE_FINAL'):
   data['views']=[]
   for name,x,z,y in [('tunnel-inside',28.6,151,1),('tunnel-upper-soil',75,164,None)]:
    ok=await page.evaluate('''([x,z,y])=>campusWalk.qaPlace(x,z,y??campusWalk.surfaceAt(x,z,0).soil.height)''',[x,z,y]);await page.wait_for_timeout(1200)
    await page.screenshot(path=str(OUT/f'{name}.png'))
    data['views'].append({'name':name,'placed':ok,'state':await page.evaluate('''()=>({position:campusWalk.position,camera:campusWalk.camera,grass:{count:campusWalk.grass?.count,illegal:campusWalk.grass?.illegal},foot:campusWalk.footContact})''')})
  # Inspect actual transformed vegetation instances against the tunnel's occupied bore.
  data['tunnelVegetation']=await page.evaluate(TREE_GEOMETRY_PROBE,core)
  (OUT/'results.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');print(json.dumps(data,ensure_ascii=False),flush=True)
  await browser.close()

if __name__=='__main__':asyncio.run(main())
