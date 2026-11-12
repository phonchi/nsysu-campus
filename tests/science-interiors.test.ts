import { beforeAll, afterAll, expect, it } from 'vitest';
import fs from 'node:fs';
import * as T from 'three';
import { planScienceInterior, footprintFits, blocksProtected, itemBounds, isDecoratedOffice, type InteriorLayout } from '../src/world/science-interiors';
import { effectiveRooms } from '../src/walk-world';
import { furnishScienceItem } from '../src/world/science-interior-models';
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
 for(const kind of ['sofa-back','computer','chair','bookcase','coffee-table','tv','wall-panel','rug','plant','wall-art','desk-accessories','shelf-plant','plush-cat'])expect(office.items.filter(i=>i.kind===kind).length,kind).toBe(1);
 expect(office.items.filter(i=>i.kind==='sofa-wing').length).toBe(2);
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
 for(const kind of ['sofa-back','bookcase']){
  const i=l.items.find(i=>i.kind===kind)!;
  const [x0,z0,x1,z1]=itemBounds(i);
  const from=kind==='sofa-back'?v(l,i.x,z0-.6,f.y+.65):v(l,x0-.6,i.z,f.y+1.45);
  const to=v(l,i.x,i.z,from.y);
  expect(physics.sweep(from,to,.16),kind).toBeLessThan(from.distanceTo(to)-.2);
 }
});

it('renders every item kind and limits new accessories to the fifteen requested offices',()=>{
 const kinds=new Map(layouts.flatMap(l=>l.items).map(i=>[i.kind,i]));
 for(const item of kinds.values())for(const [office,luxury] of [[false,false],[true,false],[true,true]])for(const variant of [0,1,2]){
  const group=new T.Group();furnishScienceItem(item,group,office,luxury,variant);
  let meshes=0;group.traverse(o=>{if(o instanceof T.Mesh)meshes++;});expect(meshes,item.kind).toBeGreaterThan(0);
 }
 const offices=layouts.filter(l=>isDecoratedOffice(l.code));expect(offices.length).toBe(15);
 for(const l of offices){expect(l.items.some(i=>i.kind==='desk-accessories'),l.code).toBe(true);expect(l.items.some(i=>i.kind==='wall-art'),l.code).toBe(true);}
 for(const l of layouts.filter(l=>!isDecoratedOffice(l.code)))expect(l.items.some(i=>['desk-accessories','wall-art','shelf-plant','tv','coffee-table'].includes(i.kind)),l.code).toBe(false);
});
it('keeps a continuous 1.1 m clear route through the upgraded lounge into the work area',()=>{
 const l=layouts.find(l=>l.code==='SC2002-4')!,f=world.floors.find(f=>f.data.id===l.floorId)!;
 const x0=Math.min(...l.polygon.map(p=>p[0])),z0=Math.min(...l.polygon.map(p=>p[1]));
 const path:[[number,number],[number,number],...[number,number][]]=[[.51,1.55],[4.55,1.55]];
 for(let j=1;j<path.length;j++){
  const a:[number,number]=[x0+path[j-1][0],z0+path[j-1][1]],b:[number,number]=[x0+path[j][0],z0+path[j][1]];
  for(const item of l.items.filter(i=>i.solid))expect(blocksProtected(item,[{a,b,radius:.55}]),`${item.kind} blocks segment ${j}`).toBe(false);
  const from=v(l,...a,f.y+.85),to=v(l,...b,f.y+.85);
  expect(physics.sweep(from,to,.55),`1.1m sweep segment ${j}`).toBeGreaterThanOrEqual(from.distanceTo(to)-.025);
 }
 const points=path.map(([x,z])=>v(l,x0+x,z0+z,f.y));
 physics.teleport(points[0]);for(let i=0;i<60;i++)physics.step(new T.Vector3(),1/60,false);
 for(const point of points.slice(1))expect(travel(point),'forward room passage').toBe(true);
 for(const point of points.slice(0,-1).reverse())expect(travel(point),'return room passage').toBe(true);
});
it('uses 教室 for unnamed SC rooms while preserving unique destination and door IDs',()=>{
 const unnamed=new Set(layouts.filter(l=>!l.code).map(l=>l.roomId));
 const destinations=world.destinations.filter(d=>d.buildingId==='SC'&&d.roomId&&unnamed.has(d.roomId));
 expect(destinations.length).toBeGreaterThan(1);expect(new Set(destinations.map(d=>d.id)).size).toBe(destinations.length);
 for(const d of destinations){expect(d.label).toBe('教室');expect(d.displayName).toBeUndefined();}
 for(const d of world.doors.filter(d=>d.buildingId==='SC'))expect(d.label).not.toMatch(/未編號|候選|圖面未標|undefined/);
 for(const code of ['SC2001','SC2002-4','SC2004','SC4010','SC4009'])expect(world.destinations.filter(d=>d.label===code).length).toBe(1);
});

it('leaves the U-sofa hollow walkable and seats the plush on a real cushion',()=>{
 const l=layouts.find(l=>l.code==='SC2002-4')!,f=world.floors.find(f=>f.data.id===l.floorId)!;
 const x0=Math.min(...l.polygon.map(p=>p[0])),z0=Math.min(...l.polygon.map(p=>p[1]));
 const toy=l.items.find(i=>i.kind==='plush-cat')!,wing=l.items.find(i=>i.kind==='sofa-wing'&&i.turn===3)!;
 expect(toy.solid).toBe(false);expect(toy.y).toBeCloseTo(.555,6);
 const cushion={x:wing.x+.055,z:wing.z,w:wing.d-.22,d:wing.w-.14-.025};
 const bounds=itemBounds(toy);
 expect(bounds[0]).toBeGreaterThan(cushion.x-cushion.w/2);expect(bounds[2]).toBeLessThan(cushion.x+cushion.w/2);
 expect(bounds[1]).toBeGreaterThan(cushion.z-cushion.d/2);expect(bounds[3]).toBeLessThan(cushion.z+cushion.d/2);
 const origin=v(l,x0+.51,z0+1.55,f.y);physics.teleport(origin);for(let k=0;k<60;k++)physics.step(new T.Vector3(),1/60,false);
 for(const x of [2.51,3.79]){
  for(const [u,z] of [[3.15,2.2],[x,2.4],[x,3.05],[x,2.4],[3.15,2.2]])expect(travel(v(l,x0+u,z0+z,f.y)),`U opening ${u},${z}`).toBe(true);
 }
 expect(travel(origin)).toBe(true);
});
it('keeps the local extension roof solid and all three translated office doors',()=>{
 const f=b.floors.find(f=>f.id==='SC-2F')!;
 expect(f.roofPatches?.length).toBeGreaterThan(0);
 const patch=f.roofPatches![0],x=patch.reduce((n,p)=>n+p[0],0)/patch.length,z=patch.reduce((n,p)=>n+p[1],0)/patch.length;
 const floor=world.floors.find(f=>f.data.id==='SC-2F')!,point=new T.Vector3(x,floor.y+3.45,z).applyMatrix4(world.frames.get('SC')!);
 expect(physics.supportAt(point.x,point.z,point.y)).toBeCloseTo(point.y,1);
 const newFloor=new T.Vector3(11.3,floor.y,9.9).applyMatrix4(world.frames.get('SC')!);
 expect(physics.supportAt(newFloor.x,newFloor.z,floor.y)).toBeCloseTo(floor.y,1);
 const entry=f.access!.portals.find(p=>p.roomIds.includes('SC-2F-SC2002-1'))!.clearancePositions!['SC-2F-SC2002-1'];
 const inside=new T.Vector3(entry[0],floor.y,entry[1]).applyMatrix4(world.frames.get('SC')!);
 physics.teleport(inside);for(let k=0;k<60;k++)physics.step(new T.Vector3(),1/60,false);
 expect(travel(newFloor),'new floor extension').toBe(true);expect(physics.position.y).toBeCloseTo(floor.y,1);
 expect(travel(inside),'return from extension').toBe(true);

 for(const [code,doorZ] of [['SC2002-3',4.455],['SC2002-2',6.628],['SC2002-1',8.939]] as const){
  const room=f.rooms.find(r=>r.code===code)!;expect(room.door.position[1]).toBeCloseTo(doorZ,5);
  expect(world.destinations.some(d=>d.roomId===room.id)).toBe(true);
 }
 expect(layouts.find(l=>l.code==='SC2001')!.seats).toBe(76);
});
