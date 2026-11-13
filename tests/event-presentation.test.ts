import { expect,it,vi } from 'vitest';
import { EventCommandQueue,EventPlayerPose,staySecondsRemaining,campusEventWorld,type EventPorts,type RuntimeEventCommand } from '../src/walk/interaction-events';
import { bindRhythmClap } from '../src/story/ui';
it('pairs sit/stand, stands on movement and re-sits only within the requested seat range',()=>{
 const apply=vi.fn(),pose=new EventPlayerPose(apply);
 pose.request('sit','zone:seat');pose.update(false,false);expect(pose.sitting).toBe(false);
 pose.update(false,true);pose.update(false,true);expect(apply.mock.calls).toEqual([[true]]);
 pose.update(true,true);expect(pose.sitting).toBe(false);
 pose.update(false,true);pose.request('stand');pose.request('stand');expect(apply.mock.calls).toEqual([[true],[false],[true],[false]]);
 expect(pose.target).toBeUndefined();expect(pose.requested).toBe(false);
});
it('dispatches the §11.2 commands without changing the engine, filters conditional speech and restores pose on cancellation',()=>{
 const log:string[]=[],pose=new EventPlayerPose(sit=>log.push(sit?'sit':'stand'));
 const ports:EventPorts={banner:()=>{},sound:()=>{},journal:()=>{},move:()=>true,moving:()=>false,release:()=>{},say:(_n,text)=>log.push(text),invite:()=>{},objective:()=>{},counter:()=>{},reward:()=>{},moveFailed:()=>{},
 pose:(p,at)=>{pose.request(p,at);pose.update(false,true);},rhythm:c=>log.push(`rhythm:${c.id}`),stopRhythm:()=>log.push('stop'),achievement:id=>log.push(`achievement:${id}`),questChoice:(q,s)=>q==='sea-stage'&&s==='return'?'slow':undefined};
 const queue=new EventCommandQueue(ports);
 const fixture:RuntimeEventCommand[]=[{kind:'request',request:{kind:'pose',pose:'sit',at:'zone:seat'}},
 {kind:'request',request:{kind:'say',who:'yun',text:'慢歌',if:{quest:'sea-stage',step:'return',choice:'slow'}}},
 {kind:'request',request:{kind:'say',who:'yun',text:'快歌',if:{quest:'sea-stage',step:'return',choice:'light'}}},
 {kind:'rhythm',id:'song',cues:8,interval:4,lead:2,window:.2,need:5,style:'slow'},
 {kind:'achievement',id:'audience'},{kind:'request',request:{kind:'pose',pose:'stand'}}];
 queue.push(fixture);queue.flush();expect(log).toEqual(['sit','慢歌','rhythm:song','achievement:audience','stand']);
 queue.push([{kind:'request',request:{kind:'pose',pose:'sit'}}]);queue.flush();queue.clear();expect(pose.sitting).toBe(false);expect(log.slice(-3)).toEqual(['sit','stand','stop']);
});
it('stay countdown reads stepProgress and returns to the full duration after movement resets held',()=>{
 expect(staySecondsRemaining({held:0,hold:60})).toBe(60);
 expect(staySecondsRemaining({held:18.2,hold:60})).toBe(42);
 expect(staySecondsRemaining({held:0,hold:60})).toBe(60);
 expect(staySecondsRemaining({held:60.01,hold:60})).toBe(0);
});
it('touch scores on contact, ignores its following click, and preserves keyboard activation',()=>{
 const button=Object.assign(new EventTarget(),{disabled:false}),clap=vi.fn();
 bindRhythmClap(button as unknown as HTMLElement,clap);
 const down=Object.assign(new Event('pointerdown',{cancelable:true}),{button:0});
 button.dispatchEvent(down);expect(down.defaultPrevented).toBe(true);expect(clap).toHaveBeenCalledOnce();
 expect(clap).toHaveBeenLastCalledWith(down.timeStamp);
 button.dispatchEvent(Object.assign(new Event('click'),{detail:1}));expect(clap).toHaveBeenCalledOnce();
 button.dispatchEvent(Object.assign(new Event('click'),{detail:0}));expect(clap).toHaveBeenCalledTimes(2);
 button.disabled=true;
 button.dispatchEvent(Object.assign(new Event('pointerdown'),{button:0}));
 button.dispatchEvent(Object.assign(new Event('click'),{detail:0}));expect(clap).toHaveBeenCalledTimes(2);
});
it('preserves live movement and quest-choice hooks through the event-world adapter',()=>{
 let moving=false;const choices:Record<string,string>={style:'slow'};
 const world=campusEventWorld({timeOfDay:()=> 'night',distanceTo:()=>1,playerMoving:()=>moving,
   questChoice:(quest,step)=>quest==='sea-stage'?choices[step]:undefined},[],()=>true);
 expect(world.playerMoving?.()).toBe(false);moving=true;expect(world.playerMoving?.()).toBe(true);
 expect(world.questChoice?.('sea-stage','style')).toBe('slow');choices.style='light';
 expect(world.questChoice?.('sea-stage','style')).toBe('light');expect(world.questChoice?.('other','style')).toBeUndefined();
});
