import { expect, it, vi } from 'vitest';
import { Box3, Group, Vector3 } from 'three';
import { TalkDirector, type NpcData, type NpcDef, type TalkWorld } from '../src/story/talk';
import type { StoryUi } from '../src/story/ui';
import type { Campus } from '../src/story/collection';
import type { StoryEngine } from '../src/story/engine';
import { toggleDoorById } from '../src/walk/interaction';
import type { WalkWorld, WorldDoor } from '../src/walk-world';

it('offers every NPC within 3 m; pressId never switches to a nearer person and rechecks presence/reach/busy',()=>{
 const positions=new Map([['a',new Vector3(1,0,0)],['b',new Vector3(2,0,0)],['c',new Vector3(3,0,0)]]), absent=new Set<string>();
 const player=new Vector3(), toast=vi.fn();
 const data={npcs:['a','b','c'].map(id=>({id,name:id,role:'student',observe:true} as NpcDef)),trees:{}} as NpcData;
 const world={nearest:()=> 'a',position:id=>positions.get(id),present:id=>!absent.has(id),playerPosition:()=>player,toast,setTalking:()=>{},timeOfDay:()=>'day',cue:()=>{},play:async()=>true} as TalkWorld;
 const talk=new TalkDirector(data,{version:1,items:[],stamps:[],achievements:[]},{} as StoryUi,{} as Campus,{} as StoryEngine,world);
 expect(talk.candidate(player).map(n=>n.id)).toEqual(['a','b','c']);
 expect(talk.pressId('b')).toBe(true);expect(toast.mock.lastCall![0]).toMatch(/^b：/);
 absent.add('b');expect(talk.pressId('b')).toBe(false);
 absent.delete('b');positions.get('b')!.x=3.01;expect(talk.pressId('b')).toBe(false);
 expect(talk.pressId('missing')).toBe(false);
 Object.assign(talk,{busy:true});expect(talk.pressId('a')).toBe(false);
 expect(toast).toHaveBeenCalledTimes(1);
});
const door=(id:string,x:number):WorldDoor=>({id,position:new Vector3(x,0,0),outside:new Vector3(x,0,1),inside:new Vector3(x,0,-1),group:new Group(),panel:new Group(),closedBox:new Box3(new Vector3(x-.5,0,-.1),new Vector3(x+.5,2.2,.1)),open:0,target:0,label:id,buildingId:'BI',floorId:'BI-1F'});
it('toggles the selected door, rejects stale state/out-of-range IDs, and cannot close on the player',()=>{
 const a=door('a',.3),b=door('b',1.4),world={doors:[a,b]} as WalkWorld,p=new Vector3(0,0,1);
 expect(toggleDoorById(world,p,'b',0).kind).toBe('opened');expect(a.target).toBe(0);expect(b.target).toBe(1);
 expect(toggleDoorById(world,p,'b',0).kind).toBe('none');
 expect(toggleDoorById(world,new Vector3(20,0,0),'b').kind).toBe('none');
 expect(toggleDoorById(world,p,'missing').kind).toBe('none');
 expect(toggleDoorById(world,new Vector3(1.4,0,0),'b',1).kind).toBe('blocked');expect(b.target).toBe(1);
});
