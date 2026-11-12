import { beforeAll, afterAll, expect, it } from 'vitest';
import fs from 'node:fs';
import * as T from 'three';
import { planScienceInterior, footprintFits, blocksProtected, itemBounds, type InteriorLayout } from '../src/world/science-interiors';
import { effectiveRooms } from '../src/walk-world';
import type { WalkBuilding, CampusStructure } from '../src/walk-types';
import { buildRuntimeWorld } from './world-fixture';
import { RapierController, initPhysics } from '../src/walk/controller';
const b=JSON.parse(fs.readFileSync('public/data/walkthrough/SC.json','utf8')) as WalkBuilding;
const s=JSON.parse(fs.readFileSync('public/data/walkthrough/campus-structure.json','utf8')) as CampusStructure;
const a=JSON.parse(fs.readFileSync('public/data/walkthrough/access-plan.json','utf8'));
const make=()=>b.floors.flatMap(f=>{f.access=a.floors[f.id];return effectiveRooms(f,s).map(r=>planScienceInterior(r,f,s.placements.SC.scale));});
const layouts=make();
it('furnishes named SC rooms deterministically and protects actual door cores',()=>{
 expect(make()).toEqual(layouts);
 const named=layouts.filter(l=>l.code);expect(named.length).toBe(75);
 for(const l of named){
  expect(l.skipped,l.code).toBeUndefined();
  expect(l.items.some(i=>i.solid),l.code).toBe(true);
  for(const item of l.items){
   expect(footprintFits(item,l.polygon),item.id).toBe(true);
   if(item.solid)expect(blocksProtected(item,l.protected),item.id).toBe(false);
   expect(item.y+item.h,item.id).toBeLessThanOrEqual(3.2);
  }
 }
 expect(layouts.filter(l=>!l.code).every(l=>l.items.length===0)).toBe(true);
 const office=named.find(l=>l.code==='SC2002-4')!;
 for(const kind of ['sofa','computer','chair','bookcase'])expect(office.items.some(i=>i.kind===kind),kind).toBe(true);
 expect(named.find(l=>l.code==='SC2004')!.items.filter(i=>i.kind==='computer').length).toBeGreaterThanOrEqual(13);
});
it('all four lecture halls have dense supported seats, continuous risers and sufficient headroom',()=>{
 const halls=layouts.filter(l=>l.use==='tiered-lecture');expect(halls.map(l=>l.code).sort()).toEqual(['SC1001','SC1005','SC2001','SC3001']);
 for(const l of halls){
  expect(l.seats,l.code).toBeGreaterThanOrEqual(50);
  const platforms=l.items.filter(i=>i.kind==='platform').sort((a,b)=>a.h-b.h);
  let h=0;for(const p of platforms){expect(p.h-h,l.code).toBeLessThanOrEqual(.16);expect(3.2-p.h,l.code).toBeGreaterThanOrEqual(2.1);h=p.h;}
  for(const seat of l.items.filter(i=>i.kind==='lecture-seat'&&i.y>0)){
   const bounds=itemBounds(seat);
   expect(platforms.some(p=>{const r=itemBounds(p);return Math.abs(p.h-seat.y)<1e-6&&bounds[0]>=r[0]-.01&&bounds[1]>=r[1]-.01&&bounds[2]<=r[2]+.01&&bounds[3]<=r[3]+.01;}),seat.id).toBe(true);
  }
 }
});
let physics:RapierController,world:ReturnType<typeof buildRuntimeWorld>['world'];
beforeAll(async()=>{await initPhysics();world=buildRuntimeWorld().world;physics=new RapierController(world.collision);},30000);
afterAll(()=>physics?.dispose());
const v=(l:InteriorLayout,x:number,z:number,y:number)=>new T.Vector3(x/s.placements.SC.scale,y,z/s.placements.SC.scale).applyMatrix4(world.frames.get('SC')!);
function travel(to:T.Vector3){
 for(let tick=0;tick<1800;tick++){
  const dir=to.clone().sub(physics.position);dir.y=0;
  if(dir.length()<.13)return true;
  physics.step(dir.normalize(),1/60,false,2.5);
 }
 return false;
}
it('walks up and down every tiered centre aisle without jumping or ceiling collisions',()=>{
 const rows=[];
 for(const l of layouts.filter(l=>l.use==='tiered-lecture')){
  const f=world.floors.find(f=>f.data.id===l.floorId)!;
  const plats=l.items.filter(i=>i.kind==='platform').sort((a,b)=>a.h-b.h),last=plats.at(-1)!;
  const xs=l.polygon.map(p=>p[0]),zs=l.polygon.map(p=>p[1]),swap=l.code==='SC1005';
  const start=swap?v(l,Math.min(...xs)+1.95,(Math.min(...zs)+Math.max(...zs))/2,f.y):v(l,(Math.min(...xs)+Math.max(...xs))/2,Math.min(...zs)+1.95,f.y);
  const top=v(l,last.x,last.z,f.y+last.h);
  physics.teleport(start);for(let i=0;i<60;i++)physics.step(new T.Vector3(),1/60,false);
  expect(travel(top),`${l.code} ascent stalled at ${physics.position.toArray()}`).toBe(true);
  expect(physics.position.y,l.code).toBeCloseTo(top.y,1);
  expect(physics.onGround,l.code).toBe(true);
  expect(travel(start),`${l.code} descent stalled`).toBe(true);
  for(let i=0;i<30;i++)physics.step(new T.Vector3(),1/60,false);
  expect(physics.position.y,l.code).toBeCloseTo(start.y,1);
  rows.push({code:l.code,seats:l.seats,rows:l.rows,top:last.h,passed:true});
 }
 console.info('SC tier traversal:',JSON.stringify(rows));
},60000);
it('sofa and bookshelves block walking and camera rays',()=>{
 const l=layouts.find(l=>l.code==='SC2002-4')!,f=world.floors.find(f=>f.data.id===l.floorId)!;
 for(const kind of ['sofa','bookcase']){
  const i=l.items.find(i=>i.kind===kind)!;
  const from=v(l,i.x,i.z-i.d/2-.6,f.y+(kind==='sofa'?.65:1.45));
  const to=v(l,i.x,i.z+i.d/2+.6,from.y);
  expect(physics.sweep(from,to,.16),kind).toBeLessThan(from.distanceTo(to)-.5);
 }
});
