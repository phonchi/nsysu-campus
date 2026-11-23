import {expect,it,vi} from 'vitest';
import fs from 'node:fs';
import * as T from 'three';
import {buildRuntimeWorld} from './world-fixture';
import {parseV12} from '../src/walk/v12-data';
import {supportedStopPoint,outsideBus,busGroundPose} from '../src/walk/bus';
import type {BusData} from '../src/walk/bus-types';
import type {SeaData,SportsData} from '../src/world/v12-types';
import {RapierController,initPhysics} from '../src/walk/controller';
import {planProps} from '../src/world/props';
import {placementPolicy} from '../src/world/placement-policy';
import {inside} from '../src/walk/v12-geometry';
import {decorateCampus} from '../src/walk-art';
import {GrowableSurfaceField} from '../src/world/growable-surface';
import {grassPlacements} from '../src/render/ground';
import {SwimRuntime} from '../src/walk/swim';
import {WatercraftRuntime} from '../src/walk/watercraft';
import {TimedSports} from '../src/walk/sports-activity';
import {OutdoorRoutes} from '../src/walk/route';
import {loadRideAsset} from '../tools/ride-assets';
import {SailingShow} from '../src/world/sailing-show';
import {CameraRig} from '../src/walk/camera-rig';
const read=(p:string)=>JSON.parse(fs.readFileSync('public/data/'+p,'utf8'));
const bus=parseV12('bus',read('bus-routes.json')) as BusData,sea=parseV12('sea',read('sea.json')) as SeaData,sports=parseV12('sports',read('sports.json')) as SportsData;
const allowed={allowed:true,recall:false,reasons:[]};
let built:ReturnType<typeof buildRuntimeWorld>;const world=()=>built??=buildRuntimeWorld();
// Only leaf-card textures require DOM: retain all actual placement and exclusion logic.
const recorded=vi.hoisted(()=>({trees:[] as {x:number;y:number;z:number;s:number}[]}));
vi.mock('../src/render/foliage',async original=>({...await original<typeof import('../src/render/foliage')>(),buildTrees:(spots:typeof recorded.trees)=>{recorded.trees=spots;return new T.Group();}}));
it('all 14 real stops resolve from terrain, canStand and lie outside every serving bus',async()=>{
 await initPhysics();const w=world(),physics=new RapierController(w.world.collision);expect(bus.stops).toHaveLength(14);const failures:string[]=[];
 for(const stop of bus.stops)for(const route of bus.routes.filter(r=>r.stopOccurrences.some(o=>o.stopId===stop.id))){
  const sign=supportedStopPoint(stop.sign,(x,z,y)=>physics.supportAt(x,z,y),(x,z)=>w.terrain.heightAt(x,z));expect(sign,stop.id+' sign').toBeDefined();if(stop.id==='liberal-arts'){expect(sign![1]).toBeGreaterThanOrEqual(bus.forecourt!.levelY-.001);expect(sign![1]).toBeLessThanOrEqual(bus.forecourt!.levelY+.03);}
  const b={position:new T.Vector3(...stop.berth.position),yaw:stop.berth.yaw+Math.PI,route};
  for(const [i,p] of [stop.boardingPoint,...stop.alightingPoints].entries()){
   // Deliberately corrupt authored y: the real runtime resolver must ignore it.
   const q=supportedStopPoint([p[0],p[1]+100,p[2]],(x,z,y)=>physics.supportAt(x,z,y),(x,z)=>w.terrain.heightAt(x,z));
   if(!q||!physics.canStand(new T.Vector3(...q))||!outsideBus(b,q))failures.push(`${route.id}/${stop.id}/${i}: ${JSON.stringify(q)}`);
  }
 }
 physics.dispose();expect(failures).toEqual([]);
},30000);
it('real terrain and authored seawall produce a visible revetment population',async()=>{
 const w=world(),zones=read('story-zones.json').zones,accept=placementPolicy(w.terrain,{sea,bus,sports,issues:[]});
 decorateCampus(w.world,w.structure,w.terrain,0);const graph=new OutdoorRoutes(read('walkthrough/outdoor-graph.json'));
 const props=planProps({zone:id=>zones[id]?{x:zones[id].p[0],z:zones[id].p[1],r:zones[id].r}:undefined,open:(x,z)=>w.world.display.userData.occupancy.at(x,z)!==1,pathDistance:(x,z)=>graph.edgeDistance(x,z),ground:(x,z)=>w.terrain.heightAt(x,z),seaLevel:w.terrain.seaLevel,keepClear:[],allowed:accept,tetrapodZones:sea.hazards!.filter(h=>h.kind==='breakwater').map(h=>h.polygon)});
 const pods=props.filter(p=>p.kind==='tetrapod');const model=await loadRideAsset('public/models/props/tetrapod.glb'),box=new T.Box3().setFromObject(model.scene),visible=pods.filter(p=>p.y!+box.max.y*p.s!>w.terrain.seaLevel+.15).length;console.log('REAL_TERRAIN_TETRAPODS',pods.length,'VISIBLE',visible);expect(visible).toBeGreaterThanOrEqual(20);expect(pods.length).toBeGreaterThanOrEqual(20);
 for(const p of props){if(p.kind!=='tetrapod')expect(accept(p.x,p.z)).toBe(true);for(const poly of [...sea.waterBodies.map(w=>w.polygon),...sea.routes.map(r=>r.corridor)])expect(inside([p.x,p.z],poly)).toBe(false);}
});
it('actual tree planner and grass on real DEM exclude swimming, routes, beach waterline and forecourt',()=>{
 const w=world();if(!w.world.display.userData.groundMask)decorateCampus(w.world,w.structure,w.terrain,0);const accept=w.world.display.userData.placementAllowed;expect(recorded.trees.length).toBeGreaterThan(100);
 for(const t of recorded.trees){expect(accept(t.x,t.z),JSON.stringify(t)).toBe(true);expect(t.y).toBeGreaterThan(w.terrain.seaLevel);}
 const field=new GrowableSurfaceField(w.terrain,w.world.display.userData.groundMask);field.setReady(true);let count=0;
 for(const at of [{x:-347.8,z:164.2},{x:-425,z:150},{x:-618.19,z:-882.15},{x:150,z:180}])for(const g of grassPlacements(field,at,70)){count++;expect(accept(g.x,g.z)).toBe(true);}
 console.log('REAL_TREE_COUNT',recorded.trees.length,'GRASS_COUNT',count);expect(count).toBeGreaterThan(0);expect(accept(-347.8,164.2)).toBe(false);
},30000);
it('pool turn tolerates delayed reversal and idle, and only climbs after one second outside timing',()=>{
 const w=sea.waterBodies.find(w=>w.id==='pool-main')!,course=sports.courses.find(c=>c.mode==='swim')!,s=new SwimRuntime(),timer=new TimedSports();s.enter(w,w.entryPoints[0],allowed);expect(timer.start(course,s.position.toArray())).toBe(true);
 let wallDelay=0;for(let i=0;i<2000&&timer.course;i++){
  if(timer.next>=2)wallDelay++;const dir=wallDelay>45?1:-1;
  s.update(.1,new T.Vector3(dir,0,0),allowed,true);timer.update(.1,s.position.toArray(),{kind:'swim',waterId:w.id});expect(s.phase).toBe('swim');
 }expect(timer.result?.valid).toBe(true);
 const x=Math.min(...w.polygon.map(p=>p[0]));s.position.x=x+.01;expect(s.update(.1,new T.Vector3(-1,0,0),allowed)).toBeUndefined();expect(s.phase).toBe('swim');
 let exit;for(let i=0;i<12&&!exit;i++)exit=s.update(.1,new T.Vector3(-1,0,0),allowed);expect(exit).toBeDefined();expect(s.phase).toBe('dry');
});
it('craft stays put without input, accepts opposite directions and returns within 15 m',()=>{
 for(const r of sea.routes){const w=sea.waterBodies.find(w=>w.id===r.waterId)!,c=new WatercraftRuntime();expect(c.rent(r,w,r.launchPoint,allowed)).toBe(true);const start=c.position.clone();for(let i=0;i<100;i++)c.update(.1,new T.Vector3(),allowed);expect(c.position.distanceTo(start)).toBeLessThan(.001);
 c.update(.1,new T.Vector3(-1,0,0),allowed);expect(c.position.x).toBeLessThan(start.x);const left=c.position.x;c.update(.1,new T.Vector3(1,0,0),allowed);expect(c.position.x).toBeGreaterThan(left);
 c.position.set(r.returnPoint[0]-14,w.surfaceY,r.returnPoint[2]);expect(c.returnToShore()).toEqual(r.returnPoint);}
});
it('first person starts near horizontal and bus pitch stays within 12 degrees',()=>{
 const rig=new CameraRig(new T.PerspectiveCamera(),()=>100,{getItem:()=>null,setItem:()=>{}});rig.setMode('free');rig.pitch=.5;rig.setMode('firstPerson');expect(rig.pitch).toBeLessThanOrEqual(0);expect(rig.pitch).toBeGreaterThanOrEqual(-5*Math.PI/180);
 const pose=busGroundPose(new T.Vector3(),0,9.5,2.5,(_x,z)=>z*2);expect(Math.abs(pose.pitch)).toBeLessThanOrEqual(12*Math.PI/180);for(const z of [-4.75,0,4.75])expect(pose.y+Math.tan(pose.pitch)*z).toBeGreaterThanOrEqual(z*2);
});

it('sailing sprite glyphs are at least 20 pixels high at 200 m on a 960 by 600 viewport',()=>{
 const show=new SailingShow(sea.sailingShow!,new T.Group(),()=>{const sprite=new T.Sprite();sprite.scale.set(1.35,.38,1);return sprite;});
 const label=show.group.children[0].getObjectByName('team-label')!;expect(label.position.y-label.scale.y/2).toBeGreaterThan(6.5);
 const glyphPixels=label.scale.y*(76/112)*600/(2*Math.tan(58*Math.PI/360)*200);
 expect(glyphPixels).toBeGreaterThanOrEqual(20);show.dispose();
});
