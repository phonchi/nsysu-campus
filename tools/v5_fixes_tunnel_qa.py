#!/usr/bin/env python3
"""Isolate c2 using the actual dev scene; response instrumentation is read-only."""
import asyncio, json, os, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/v5-fixes/tunnel'
VERIFY = os.environ.get('TUNNEL_VERIFY') == '1'
if VERIFY: OUT = OUT / 'fixed'
PROBE = r'''
window.__tunnelProbe = {
 land: () => teleportTo(new T.Vector3(19.1,1.6,154.4),new T.Vector3(19.9,.982722,148.5),true),
 snapshot: () => {
 const a=physics.position.clone(), goal=director?.goal(); if(!goal)return {noGoal:true};
 const clear=sightLine((p,q,r)=>physics.sweep(p,q,r));
 const base=plan(a,goal,navigation,routes,clear);
 const nearby=obstacleField.obstacles.filter(o=>Math.hypot(o.center[0]-a.x,o.center[2]-a.z)<30);
 const blocks=(p,q)=>nearby.filter(o=>{const f=new ObstacleField();f.add([o]);return !f.clear(p,q,.30);}).map(o=>o.id);
 const from=a.clone().add(new T.Vector3(0,.9,0)),to=goal.clone().add(new T.Vector3(0,.9,0));
 return {position:a.toArray(),goal:goal.toArray(),support:physics.supportAt(goal.x,goal.z,goal.y),ready:routesValidated,
 nav:navigation?.findPath(a,goal).map(p=>p.toArray()),outdoor:routes?.path(a,goal).map(p=>p.toArray()),
 base:base.map(p=>p.toArray()),repaired:planRoute(goal).map(p=>p.toArray()),
 direct:{clear:clear(a,goal),sweep:physics.sweep(from,to,.3),length:from.distanceTo(to),blockedBy:blocks(a,goal)},
 edges:base.slice(1).map((b,i)=>({a:base[i].toArray(),b:b.toArray(),clear:clear(base[i],b),blockedBy:blocks(base[i],b)})),
 obstacles:nearby,actors:npcs?.bodies(a).map(n=>({...n,position:n.position.toArray()}))};
}};
'''

async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
  context=await browser.new_context(viewport={'width':1280,'height':800})
  await context.add_init_script("localStorage.setItem('nsysu-story-v3',JSON.stringify({active:'c2-tunnel',done:['c1-gate'],flags:['c1.talked','c2.briefed'],fired:{'c1-gate':['arrow','talk','done'],'c2-tunnel':['arrow','arrive']},sideQuests:[],npcAt:{}}));")
  page=await context.new_page(); console=[]; errors=[]
  page.on('console',lambda m:console.append({'type':m.type,'text':m.text}))
  page.on('pageerror',lambda e:errors.append(str(e)))
  async def instrument(route):
   response=await route.fetch(); body=await response.text(); marker='window.campusWalk ='
   assert marker in body,'runtime instrumentation anchor missing'
   await route.fulfill(response=response,body=body.replace(marker,PROBE+'\n'+marker,1))
  await page.route('**/src/walk/runtime.ts*',instrument)
  await page.goto(os.environ.get('CAMPUS_WALK_URL','http://127.0.0.1:5173/?view=walk&story=1&qa=1&quality=C'),wait_until='networkidle')
  await page.wait_for_function('window.campusWalk?.worldReady && window.__tunnelProbe',timeout=120000)
  await page.evaluate('window.__tunnelProbe.land()' if VERIFY else 'window.campusWalk.qaPlace(19.1,154.4,1.6)')
  await page.wait_for_timeout(1000)
  before=await page.evaluate('window.__tunnelProbe.snapshot()');print(json.dumps({'phase':'before',**before},ensure_ascii=False),flush=True)
  await page.keyboard.press('g');await page.wait_for_timeout(2000)
  trace=[]
  if VERIFY:
   start=time.monotonic()
   while time.monotonic()-start<90:
    state=await page.evaluate('({position:window.campusWalk.position,story:window.campusWalk.story,route:window.campusWalk.route.length})')
    trace.append(state)
    print(json.dumps({'phase':'walk','elapsed':round(time.monotonic()-start,1),**state}),flush=True)
    if state['story']['blocking'] and ((state['position'][0]-28.6)**2+(state['position'][2]-151)**2)**.5<5:break
    await page.wait_for_timeout(1000)
  after=await page.evaluate('({probe:window.__tunnelProbe.snapshot(),story:window.campusWalk.story,route:window.campusWalk.route})')
  await page.screenshot(path=str(OUT/'tunnel.png'))
  (OUT/'result.json').write_text(json.dumps({'before':before,'after':after,'trace':trace,'errors':errors,'console':console},ensure_ascii=False,indent=2)+'\n')
  print(json.dumps({'phase':'after',**after,'errors':errors},ensure_ascii=False),flush=True)
  await browser.close()
  if VERIFY:
   assert not errors,errors
   assert before['repaired'],'connected shuttle landing must have a real route'
   assert trace and trace[-1]['story']['blocking'] and ((trace[-1]['position'][0]-28.6)**2+(trace[-1]['position'][2]-151)**2)**.5<5,'G did not physically reach the tunnel interior'

if __name__=='__main__':asyncio.run(main())
