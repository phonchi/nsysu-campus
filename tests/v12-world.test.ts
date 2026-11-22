import {expect,it,vi} from 'vitest';
import * as T from 'three';
import {buildWalkWorld} from '../src/walk-world';
import {normalizeLift} from '../src/walk/lift';
import {syncLift,liftObstacles} from '../src/walk/lift-world';
import {decorateCampus} from '../src/walk-art';
import type {CampusStructure,WalkBuilding,WalkFloor,WalkRoom} from '../src/walk-types';
// Tree texture painting is unrelated to dynamic-lift batching and needs a DOM.
vi.mock('../src/render/foliage',async original=>({...await original<typeof import('../src/render/foliage')>(),buildTrees:()=>new T.Group()}));
const floor=(level:number):WalkFloor=>({id:`SC-${level}F`,level,label:`${level}F`,sourceId:'fixture',page:1,crop:null,bounds:[-5,-5,5,5],outline:[[-5,-5],[5,-5],[5,5],[-5,5]],rooms:[],stairs:[]});
const structure=():CampusStructure=>({version:12,placements:{SC:{x:0,z:0,scale:1,rotation:0,basis:'schematic'}},lifts:{},stairCores:{},roomOverrides:{},connectors:[],context:{landmarks:[],background:[],roads:[],water:[],sport:[]}});
it('cuts shaft slabs, replaces only named services and keeps the car dynamic after campus decoration',()=>{
 const data:WalkBuilding[]=[{id:'SC',name:'理學院',floors:[floor(1),floor(2)]}],s=structure();
 const lift=normalizeLift({id:'fixture-lift',center:[0,0],size:2,angle:0,basis:'schematic',stops:data[0].floors.map(f=>({floorId:f.id,level:f.level,storey:f.level}))},'SC');lift.replacesServiceIds=['replace-me'];s.lifts.SC=[lift];
 for(const f of data[0].floors)f.verticalServices=[{id:'replace-me',kind:'shaft',polygon:lift.shaftPolygon},{id:'keep-me',kind:'service',polygon:[[2,2],[3,2],[3,3],[2,3]]}];
 const world=buildWalkWorld(data,s),ray=new T.Raycaster(new T.Vector3(0,12,0),new T.Vector3(0,-1,0));
 // Hollow down to the sealed pit (no basement: the ground stays closed under it).
 expect(ray.intersectObject(world.collision,true).every(hit=>hit.point.y<0)).toBe(true);ray.ray.origin.set(2.5,12,2.5);expect(ray.intersectObject(world.collision,true).some(hit=>hit.point.y>6.9&&hit.point.y<7)).toBe(true);
 const w=world.lifts[0],before=liftObstacles([w]).map(o=>o.id).sort();
 // This is pure scene decoration, no renderer, browser, server or asset loader.
 decorateCampus(world,s,undefined,0);syncLift(w);expect(liftObstacles([w]).map(o=>o.id).sort()).toEqual(before);expect(w.carPanels.every(p=>p.parent?.parent===w.car)).toBe(true);
 w.runtime.select('SC-2F');for(let i=0;i<600;i++)w.runtime.update(1/60,{doorway:false});syncLift(w);
 const carFloor=liftObstacles([w]).find(o=>o.id==='fixture-lift:floor')!;expect(carFloor.center[1]).toBeCloseTo(3.73,4);
});
it('renders restroom fixtures and publishes metadata and displayName independently of room code',()=>{
 const r:WalkRoom={id:'WC-F',kind:'restroom',displayName:'女廁',gender:'female',accessible:true,aliases:['洗手間'],polygon:[[-3,-3],[0,-3],[0,1],[-3,1]],door:{position:[-1.5,-3],width:1,basis:'schematic'},basis:'schematic'};
 const f=floor(1);f.rooms=[r];const world=buildWalkWorld([{id:'SC',name:'理學院',floors:[f]}],structure());
 expect(world.destinations.find(d=>d.id===r.id)).toMatchObject({category:'restroom',gender:'female',accessible:true,aliases:['洗手間'],displayName:'女廁'});
 expect(world.doors[0].label).toBe('女廁');expect(world.floors[0].group.userData.restrooms[0].fixtures.some((f:{kind:string})=>f.kind==='sink')).toBe(true);
});

it('keeps an unserved intermediate storey hollow but seals its shaft wall',()=>{
 const data:WalkBuilding[]=[{id:'SC',name:'理學院',floors:[floor(1),floor(2),floor(3)]}],s=structure();
 s.lifts.SC=[normalizeLift({id:'skip-lift',center:[0,0],size:2,angle:0,basis:'schematic',stops:[1,3].map(n=>({floorId:`SC-${n}F`,storey:n,level:n}))},'SC')];
 const world=buildWalkWorld(data,s),down=new T.Raycaster(new T.Vector3(0,12,0),new T.Vector3(0,-1,0));expect(down.intersectObject(world.collision,true).every(hit=>hit.point.y<0)).toBe(true);
 const cross=new T.Raycaster(new T.Vector3(-2,4.78,0),new T.Vector3(1,0,0));expect(cross.intersectObject(world.collision,true)[0].distance).toBeCloseTo(.92,3);
});

it('seals the shaft with a pit, opens the ground only for basement lifts and skips invalid slab holes',()=>{
 const shaftHits=(world:ReturnType<typeof buildWalkWorld>,x=0,z=0)=>new T.Raycaster(new T.Vector3(x,12,z),new T.Vector3(0,-1,0)).intersectObject(world.collision,true).map(h=>h.point.y);
 // Ground-level lift: ground stays closed (first hit -0.055), pit just under the car floor.
 const ground=structure();ground.lifts.SC=[{id:'g-lift',center:[0,0],size:2,angle:0,basis:'schematic',stops:[1,2].map(n=>({floorId:`SC-${n}F`,storey:n,level:n}))}];
 const a=shaftHits(buildWalkWorld([{id:'SC',name:'理學院',floors:[floor(1),floor(2)]}],ground));expect(a[0]).toBeCloseTo(-.055,3);expect(a.some(y=>Math.abs(y-(.08-.15))<1e-3)).toBe(true);
 // Basement lift: ground opened over the shaft, the first thing below is the pit under B1.
 const basement=structure(),b1={...floor(-1),id:'SC-B1',label:'B1'};basement.lifts.SC=[{id:'b-lift',center:[0,0],size:2,angle:0,basis:'schematic',stops:[{floorId:'SC-B1',storey:-1,level:-1},{floorId:'SC-1F',storey:1,level:1}]}];
 const b=shaftHits(buildWalkWorld([{id:'SC',name:'理學院',floors:[b1,floor(1)]}],basement));expect(b[0]).toBeCloseTo(-3.62-.15,3);
 // A shaft outside the slab is not cut (the slab stays whole) and is reported.
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{}),outside=structure();outside.lifts.SC=[{id:'o-lift',center:[5,0],size:2,angle:0,basis:'schematic',stops:[1,2].map(n=>({floorId:`SC-${n}F`,storey:n,level:n}))}];
 const world=buildWalkWorld([{id:'SC',name:'理學院',floors:[floor(1),floor(2)]}],outside);
 expect(warn).toHaveBeenCalledWith(expect.stringContaining('o-lift'));warn.mockRestore();
 expect(shaftHits(world,-2,0).some(y=>Math.abs(y-3.78)<.01)).toBe(true);
});
