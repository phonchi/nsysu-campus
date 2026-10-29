import {expect,it} from 'vitest';
import {Group,Vector3} from 'three';
import {encounterCorridor,EncounterScene} from '../src/world/encounter-scene';
it('produces only ground-supported swept routes and refuses blocked/steep areas',()=>{
 const start=new Vector3(0,0,0);
 const route=encounterCorridor(start,()=>0,(a,b)=>a.distanceTo(b));expect(route).toHaveLength(11);expect(route[0].x).toBe(3);expect(route.at(-1)!.x).toBe(13);
 expect(encounterCorridor(start,()=>0,()=>0)).toEqual([]);
 expect(encounterCorridor(start,(x,z)=>Math.hypot(x,z)*2,(a,b)=>a.distanceTo(b))).toEqual([]);
});

it('rejects unsupported corridors and sweeps a separate event actor with its actual height',()=>{
 expect(encounterCorridor(new Vector3(),()=>undefined,(a,b)=>a.distanceTo(b))).toEqual([]);
 let blocked=false;const calls:{id:string,height:number,fromY:number}[]=[];
 const scene=new EncounterScene(new Group(),{asset:p=>p,ground:()=>2,sweep:(a,b)=>a.distanceTo(b),actorSweep:(id,a,b,_radius,height)=>{calls.push({id,height,fromY:a.y});return blocked?0:a.distanceTo(b)||Infinity;}});
 const definition={id:'rolling-ball',title:'ball',zone:'admin',npc:'jogger-po',description:'',target:'npc:jogger-po',radius:4,reward:'',success:'',giveUp:'',duration:90};
 expect(scene.start(definition,new Vector3(0,2,0))).toBe(true);
 const before=scene.getTarget()!;blocked=true;scene.update(.1,new Vector3(0,2,0),false,true);
 expect(scene.getTarget()!.distanceTo(before)).toBe(0);expect(calls.every(c=>c.id==='encounter:rolling-ball'&&c.height===.55&&Math.abs(c.fromY-2.3)<1e-6)).toBe(true);
 expect(scene.bodies()[0].height).toBe(.55);scene.reset();expect(scene.bodies()).toEqual([]);scene.dispose();
});

it('spawns outside the player and checks its own volume before any movement',()=>{
 const origin=new Vector3();
 const sweep=(a:Vector3,b:Vector3)=>a.x<2.9&&Math.abs(a.z)<.1?0:a.distanceTo(b);
 const route=encounterCorridor(origin,()=>0,sweep,1.7,.38,p=>p.length()>=3-1e-6);
 expect(route).toHaveLength(11);expect(route[0].x).toBe(3);
 expect(encounterCorridor(origin,()=>0,sweep,1.7,.38,()=>false)).toEqual([]);
});
