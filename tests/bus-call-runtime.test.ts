import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {V12Runtime} from '../src/walk/v12-runtime';
import {Avatar} from '../src/walk/avatar';
import type {RapierController} from '../src/walk/controller';
import type {BusData,BusStopSpec} from '../src/walk/bus-types';

const busData=JSON.parse(readFileSync('public/data/bus-routes.json','utf8')) as BusData;
const origin=busData.stops.find(stop=>stop.id==='liberal-arts')!;

// Extend the review-fixes adapter's EventTarget stub to retain UI output. These
// tests inspect generated markup/hidden flags, not browser layout or rendering.
class ElementStub extends EventTarget {
 className='';hidden=false;dataset:Record<string,string>={};textContent='';innerHTML='';
 children:ElementStub[]=[];
 style={setProperty:vi.fn()};
 setAttribute=vi.fn();
 append(...children:ElementStub[]){this.children.push(...children);}
 remove=vi.fn();
 querySelector(){return null;}
}

const cleanup:(()=>void)[]=[];
afterEach(()=>{for(const dispose of cleanup.splice(0))dispose();vi.unstubAllGlobals();});

function adapter(){
 const host=new ElementStub(),document=Object.assign(new EventTarget(),{createElement:()=>new ElementStub()});
 vi.stubGlobal('document',document);
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn()});
 const avatar=new Avatar(),position=new T.Vector3(...origin.boardingPoint);
 const carry=vi.fn((point:T.Vector3)=>position.copy(point));
 const canStand=vi.fn(()=>true),supportAt=vi.fn((_x:number,_z:number,y:number)=>y);
 const physics={position,carry,canStand,supportAt} as unknown as RapierController;
 const modeChanged=vi.fn(),say=vi.fn();
 const runtime=new V12Runtime({host:host as unknown as HTMLElement,scene:new T.Scene(),data:{bus:structuredClone(busData),issues:[]},physics,avatar,asset:p=>p,say,cue:vi.fn(),modeChanged,params:new URLSearchParams()});
 cleanup.push(()=>{runtime.dispose();avatar.dispose();});
 const element=(className:string)=>{const found=host.children.find(e=>e.className===className);expect(found,className).toBeDefined();return found!;};
 const panel=element('walk-v12-panel'),overlay=element('walk-v12-busride');
 const frame=(dt:number)=>{
  const carried=runtime.update(dt,new T.Vector3(),[],'day',{kind:'walk'});
  // Apply the returned carried foot as the outer walking frame does. Keep the
  // carry spy exclusive to V12Runtime's own alighting calls.
  if(carried)position.copy(carried);
  runtime.afterMovement(dt,{kind:'walk'});
 };
 const advance=(frames=31)=>{for(let i=0;i<frames;i++)frame(.1);};
 const actions=()=>runtime.actions(position);
 const run=(id:string)=>{const action=actions().find(a=>a.id===id);expect(action,id).toBeDefined();action!.run();};
 const callAndBoard=(stop:BusStopSpec)=>{
  position.fromArray(stop.boardingPoint);
  run(`v12:bus-call-${stop.id}`);advance();run(`v12:bus-board-${stop.id}`);frame(0);
 };
 return {runtime,position,carry,canStand,supportAt,modeChanged,say,panel,overlay,frame,advance,actions,run,callAndBoard};
}

function destinationButtons(panel:ElementStub){
 return [...panel.innerHTML.matchAll(/<button\b[^>]*\bdata-bus-dest="([^"]+)"[^>]*>/g)].map(match=>match[1]);
}

it('calls, boards, chooses with key 2, arrives, then reboards and exits with Escape through V12Runtime',()=>{
 const a=adapter(),runtime=a.runtime;
 expect(runtime.mode).toEqual({kind:'walk'});expect(runtime.hideAvatar).toBe(false);
 expect(a.panel.hidden).toBe(true);expect(a.overlay.hidden).toBe(true);
 const call=a.actions().find(action=>action.id===`v12:bus-call-${origin.id}`);
 expect(call?.label).toBe('叫公車 E');expect(call?.point.toArray()).toEqual(origin.boardingPoint);
 a.run(`v12:bus-call-${origin.id}`);
 expect(runtime.bus?.phase).toBe('arriving');expect(a.say).toHaveBeenCalledWith(expect.stringContaining('3 秒'));
 expect(a.actions().some(action=>action.id.startsWith('v12:bus-board-'))).toBe(false);
 a.advance(29);expect(runtime.bus?.phase).toBe('arriving');
 expect(a.actions().some(action=>action.id.startsWith('v12:bus-board-'))).toBe(false);
 a.advance(2);expect(runtime.bus?.phase).toBe('boardable');
 a.run(`v12:bus-board-${origin.id}`);
 expect(runtime.mode).toMatchObject({kind:'carried',carrier:'bus'});expect(runtime.hideAvatar).toBe(true);expect(runtime.ownsMotion).toBe(true);expect(a.actions()).toEqual([]);
 a.frame(0);expect(a.panel.hidden).toBe(false);expect(a.overlay.hidden).toBe(true);
 const buttons=destinationButtons(a.panel),places=[...new Set(busData.stops.map(stop=>stop.name))].filter(name=>name!==origin.name);
 expect(buttons.filter(name=>name!=='__exit').sort()).toEqual(places.sort());expect(buttons).toContain('__exit');
 expect(a.panel.innerHTML).toContain('選擇目的地');
 const selected=runtime.bus!.destinations()[1],destination=busData.stops.find(stop=>stop.id===selected.stopId)!;
 expect(buttons[1]).toBe(selected.name);
 a.carry.mockClear();a.modeChanged.mockClear();
 expect(runtime.key('2')).toBe(true);expect(runtime.bus?.phase).toBe('riding');expect(runtime.bus?.trip?.name).toBe(selected.name);
 expect(a.modeChanged).toHaveBeenCalledTimes(1);
 a.frame(0);expect(a.overlay.hidden).toBe(false);expect(a.panel.hidden).toBe(true);expect(runtime.hideAvatar).toBe(true);expect(a.actions()).toEqual([]);
 expect(a.overlay.innerHTML).toContain(selected.name);expect(a.overlay.style.setProperty).toHaveBeenLastCalledWith('--progress','0');
 a.advance(10);expect(runtime.bus?.phase).toBe('riding');expect(runtime.bus!.rideProgress).toBeCloseTo(1/3);expect(a.carry).not.toHaveBeenCalled();
 const progress=a.overlay.style.setProperty.mock.lastCall!;expect(progress[0]).toBe('--progress');expect(Number(progress[1])).toBeCloseTo(1/3);
 a.advance(21);
 expect(runtime.bus?.phase).toBe('leaving');expect(runtime.bus?.stop?.id).toBe(destination.id);
 expect(a.carry).toHaveBeenCalledExactlyOnceWith(new T.Vector3(...destination.alightingPoints[0]));
 expect(a.position.distanceTo(new T.Vector3(...destination.alightingPoints[0]))).toBeLessThan(.001);
 expect(a.canStand).toHaveBeenCalledWith(new T.Vector3(...destination.alightingPoints[0]));
 expect(runtime.mode).toEqual({kind:'walk'});expect(runtime.hideAvatar).toBe(false);expect(runtime.ownsMotion).toBe(false);
 expect(a.panel.hidden).toBe(true);expect(a.overlay.hidden).toBe(true);expect(a.modeChanged).toHaveBeenCalledTimes(2);

 // Walk back to the same stop's boarding point and call again during departure.
 a.callAndBoard(destination);expect(runtime.mode.kind).toBe('carried');expect(a.panel.hidden).toBe(false);
 a.carry.mockClear();a.modeChanged.mockClear();
 expect(runtime.key('escape')).toBe(true);
 expect(runtime.bus?.stop?.id).toBe(destination.id);expect(runtime.bus?.phase).toBe('leaving');
 expect(a.carry).toHaveBeenCalledExactlyOnceWith(new T.Vector3(...destination.alightingPoints[0]));
 expect(a.position.toArray()).toEqual(destination.alightingPoints[0]);expect(runtime.mode).toEqual({kind:'walk'});expect(runtime.hideAvatar).toBe(false);
 a.frame(0);expect(a.panel.hidden).toBe(true);expect(a.overlay.hidden).toBe(true);expect(a.modeChanged).toHaveBeenCalledTimes(1);
});

it('exposes a single parked bus collider and none while idle, arriving, onboard, riding or driving away',()=>{
 const a=adapter(),runtime=a.runtime;
 expect(runtime.bus?.phase).toBe('idle');expect(runtime.busObstacles()).toEqual([]);
 a.run(`v12:bus-call-${origin.id}`);expect(runtime.bus?.phase).toBe('arriving');expect(runtime.busObstacles()).toEqual([]);
 a.advance();expect(runtime.bus?.phase).toBe('boardable');
 const boxes=runtime.busObstacles(),bus=runtime.bus!,vehicle=bus.route!.vehicle;
 expect(boxes).toHaveLength(1);expect(boxes[0]).toEqual({id:'bus:service',shape:'box',center:[bus.position.x,bus.position.y+vehicle.heightM/2,bus.position.z],half:[vehicle.widthM/2,vehicle.heightM/2,vehicle.lengthM/2],yaw:bus.yaw,navigation:false});
 a.run(`v12:bus-board-${origin.id}`);a.frame(0);expect(runtime.bus?.phase).toBe('onboard');expect(runtime.busObstacles()).toEqual([]);
 expect(runtime.key('2')).toBe(true);a.frame(0);expect(runtime.bus?.phase).toBe('riding');expect(runtime.busObstacles()).toEqual([]);
 a.advance();expect(runtime.bus?.phase).toBe('leaving');expect(runtime.busObstacles()).toHaveLength(1);
 a.advance(21);expect(runtime.bus?.phase).toBe('leaving');expect(runtime.busObstacles()).toEqual([]);
 a.advance();expect(runtime.bus?.phase).toBe('idle');expect(runtime.busObstacles()).toEqual([]);
});
