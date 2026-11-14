import {beforeAll,afterEach,expect,it,vi} from 'vitest';
import {BoxGeometry,Group,Mesh,MeshBasicMaterial,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {NpcManager,findFreeNpcPlacement,type StoryZones} from '../src/world/npc';
import {RapierController,initPhysics} from '../src/walk/controller';
import {OutdoorRoutes} from '../src/walk/route';
beforeAll(()=>initPhysics());afterEach(()=>vi.restoreAllMocks());
const box=(w:number,h:number,d:number,x:number,y:number,z:number)=>{const o=new Mesh(new BoxGeometry(w,h,d),new MeshBasicMaterial());o.position.set(x,y,z);return o;};
async function fixture(wall=false){
 vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async()=>({scene:new Group(),animations:[]} as never));
 const floor=new Group();floor.add(box(30,1,30,0,-.5,0));
 if(wall)for(const x of [-.65,.65])floor.add(box(.1,3,4,x,1.5,0)); // 1.2m: one body must yield back into the end apron
 const physics=new RapierController(floor);physics.teleport(new Vector3(8,.05,0));
 const zones:StoryZones={zones:{a:{label:'a',p:[0,-4],r:1},b:{label:'b',p:[0,4],r:1}},npcs:{a:{model:'student-m',at:'a'},b:{model:'student-m',at:'b'}}};
 const routes=new OutdoorRoutes({nodes:[{id:0,p:[0,.055,-4]},{id:1,p:[0,.055,4]}],edges:[[0,1,8]],edgeKind:['path'],anchors:{}});
 const manager=new NpcManager(zones,routes,undefined,x=>x);
 manager.setCollision((...args)=>physics.sweepActor(...args),(x,z,y)=>physics.supportAt(x,z,y),body=>physics.setActor(body));
 await manager.load();physics.setActors(manager.bodies(physics.position));
 const step=()=>{manager.update(.05,physics.position);physics.setActors(manager.bodies(physics.position));};
 return {manager,physics,step};
}
it('an occupied destination settles safely beside the post instead of walking forever',async()=>{
 const {manager,physics,step}=await fixture();manager.moveTo('a','b',physics.position);
 for(let i=0;i<600;i++)step();
 expect(manager.get('a')!.path).toHaveLength(0);
 expect(manager.get('a')!.position.distanceTo(manager.get('b')!.position)).toBeGreaterThanOrEqual(.64);
 expect(manager.get('a')!.position.distanceTo(new Vector3(0,0,4))).toBeLessThan(1.5);
 manager.dispose();physics.dispose();
});
it('two opposing walkers yield in a narrow corridor and both finish without overlapping',async()=>{
 const {manager,physics,step}=await fixture(true);manager.moveTo('a','b',physics.position);manager.moveTo('b','a',physics.position);
 for(let i=0;i<1200;i++){step();expect(manager.get('a')!.position.distanceTo(manager.get('b')!.position)).toBeGreaterThanOrEqual(.64);}
 expect(manager.get('a')!.position.z).toBeGreaterThan(3);
 expect(manager.get('b')!.position.z).toBeLessThan(-3);
 expect(manager.get('a')!.path).toHaveLength(0);expect(manager.get('b')!.path).toHaveLength(0);
 manager.dispose();physics.dispose();
});

it('free placements respect reservations, floor height, swept connectivity and missing support',()=>{
 const goal=new Vector3(),occupied=[{id:'first',position:goal,radius:.32,height:1.7}];
 const free=findFreeNpcPlacement('next',goal,()=>0,undefined,occupied)!;expect(free.distanceTo(goal)).toBeGreaterThan(.64);
 const third=findFreeNpcPlacement('third',goal,()=>0,undefined,[...occupied,{id:'next',position:free,radius:.32,height:1.7}])!;expect(third.distanceTo(free)).toBeGreaterThan(.64);
 expect(findFreeNpcPlacement('next',goal,()=>undefined,undefined,[])).toBeUndefined();
 expect(findFreeNpcPlacement('next',goal,()=>3,undefined,[])).toBeUndefined();
 expect(findFreeNpcPlacement('next',goal,()=>0,()=>0,[])).toBeUndefined();
 expect(findFreeNpcPlacement('next',goal,()=>0,undefined,[{...occupied[0],position:new Vector3(0,3,0)}])!.toArray()).toEqual([0,0,0]);
});
it('talking and game ownership freeze root motion; borrowed pauses do not consume path or timeout',async()=>{
 const {manager,physics,step}=await fixture();manager.moveTo('a','b',physics.position);const a=manager.get('a')!,before=a.position.clone();
 manager.setTalking('a');for(let i=0;i<100;i++)manager.update(.05,before.clone().add(new Vector3(.1,0,0))); expect(a.position.equals(before)).toBe(true);manager.setTalking(undefined);
 manager.reserveForGame('a',true);for(let i=0;i<100;i++)step();expect(a.position.equals(before)).toBe(true);manager.reserveForGame('a',false);
 expect(manager.borrowPath('a',[before.clone(),new Vector3(0,0,0)])).toBe(true);for(let i=0;i<100;i++)manager.update(.1,physics.position,true);
 expect(a.position.equals(before)).toBe(true);expect(manager.releaseBorrowed('a')).toBe(false);manager.releaseAllBorrowed();expect(a.position.equals(before)).toBe(true);
 manager.dispose();physics.dispose();
});
it('blocked replanning is bounded rather than requested every frame',async()=>{
 const {manager,physics,step}=await fixture();let calls=0;
 manager.setCollision(()=>0,()=>0,body=>physics.setActor(body),()=>{calls++;return [];});manager.moveTo('a','b',physics.position);
 for(let i=0;i<600;i++)step();expect(calls).toBeGreaterThan(0);expect(calls).toBeLessThanOrEqual(3);expect(manager.get('a')!.path.length).toBeGreaterThan(0);
 manager.dispose();physics.dispose();
});
it('a borrowed walker cannot be released while yielding, and still reaches its original goal',async()=>{
 const {manager,physics,step}=await fixture(true);manager.moveTo('a','b',physics.position);
 const b=manager.get('b')!;expect(manager.borrowPath('b',[b.position.clone(),new Vector3(0,0,-4)])).toBe(true);
 for(let i=0;i<1200;i++){
  step();if(!b.path.length&&b.position.z>-3){expect(manager.borrowedMoving).toBe(true);expect(manager.releaseBorrowed('b')).toBe(false);}
 }
 expect(b.position.z).toBeLessThan(-3);expect(manager.targets.get('b')!.z).toBe(-4);expect(manager.releaseBorrowed('b')).toBe(true);
 manager.dispose();physics.dispose();
});
it('simultaneous model loads reserve distinct safe spawn positions',async()=>{
 vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async()=>({scene:new Group(),animations:[]} as never));
 const zones:StoryZones={zones:{home:{label:'home',p:[0,0],r:3}},npcs:{a:{model:'student-m',at:'home'},b:{model:'student-m',at:'home'},c:{model:'student-m',at:'home'}}};
 const manager=new NpcManager(zones,undefined,undefined,x=>x);await manager.load();
 for(const a of ['a','b','c'])for(const b of ['a','b','c'])if(a!==b)expect(manager.get(a)!.position.distanceTo(manager.get(b)!.position)).toBeGreaterThanOrEqual(.68);
 manager.dispose();
});
