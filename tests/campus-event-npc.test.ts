import { expect,it,vi } from 'vitest';
import { Group,Vector3 } from 'three';
import { NpcManager,type StoryZones } from '../src/world/npc';
import type { NpcData } from '../src/story/talk';
const zones:StoryZones={zones:{home:{label:'home',p:[100,100],r:4}},npcs:{}};
function fixture() {
 const root=new Group(),update=vi.fn();
 const actor={id:'m3-thief',root,position:root.position,path:[] as Vector3[],absent:false,talking:false,monkey:true,speed:3,activity:'Sit',update};
 const def={id:actor.id,schedule:{day:{at:'home'},sunset:null,night:null}};
 const manager=new NpcManager(zones,undefined,undefined,x=>x,{npcs:[def],trees:{},version:1} as unknown as NpcData);
 (manager as unknown as {npcs:Map<string,typeof actor>}).npcs.set(actor.id,actor);
 return {manager,actor,update};
}
it('event borrowing never teleports, survives schedule changes, freezes when paused, and waits for arrival before release',()=>{
 const {manager,actor,update}=fixture(),path=[new Vector3(),new Vector3(3,0,0)];
 expect(manager.borrowPath(actor.id,path)).toBe(true);expect(actor.position.toArray()).toEqual([0,0,0]);
 manager.schedule('sunset',true,{},new Vector3());expect(actor.absent).toBe(false);expect(actor.path).toHaveLength(2);
 manager.update(.1,new Vector3(200,0,0),true);expect(update).not.toHaveBeenCalled();expect(actor.position.toArray()).toEqual([0,0,0]);
 manager.update(.1,new Vector3(200,0,0));expect(update).toHaveBeenCalledTimes(1);expect(actor.position.toArray()).toEqual([0,0,0]);
 expect(manager.releaseBorrowed(actor.id)).toBe(false);
 actor.path=[];expect(manager.releaseBorrowed(actor.id)).toBe(true);expect(actor.speed).toBe(3);expect(actor.activity).toBe('Sit');
 manager.schedule('sunset',true,{},new Vector3());expect(actor.absent).toBe(true);
});
it('reserved, absent, talking or unrouteable actors cannot be borrowed; cancellation leaves the actor at its current position',()=>{
 const {manager,actor}=fixture(),path=[new Vector3(),new Vector3(3,0,0)];
 manager.reserveForGame(actor.id,true);expect(manager.borrowPath(actor.id,path)).toBe(false);
 manager.schedule('day',true,{},new Vector3());expect(actor.position.toArray()).toEqual([0,0,0]);
 manager.reserveForGame(actor.id,false);actor.absent=true;expect(manager.borrowPath(actor.id,path)).toBe(false);
 actor.absent=false;actor.talking=true;expect(manager.borrowPath(actor.id,path)).toBe(false);
 actor.talking=false;expect(manager.borrowPath(actor.id,[])).toBe(false);
 expect(manager.borrowPath(actor.id,[new Vector3(30,0,0),new Vector3(35,0,0)])).toBe(false);
 expect(manager.borrowPath(actor.id,path)).toBe(true);manager.releaseAllBorrowed();
 expect(manager.isBorrowed(actor.id)).toBe(false);expect(actor.path).toEqual([]);expect(actor.position.toArray()).toEqual([0,0,0]);
});
