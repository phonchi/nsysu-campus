import { afterEach,expect,it,vi } from 'vitest';
import { RhythmRound,guitarScore,type RhythmSpec } from '../src/audio/rhythm';
import { RhythmPerformance } from '../src/audio/rhythm-performance';
import { CampusSound } from '../src/audio/sound';
import { routeEventE,submitRhythmResult } from '../src/walk/interaction-events';
const spec:RhythmSpec={id:'clap',cues:8,interval:4,lead:2,window:.2,need:5,style:'light'};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('uses inclusive ±0.2 s windows and counts each cue once',()=>{
 for(const delta of [-.201,-.2,0,.2,.201]) {
   let time=0;const round=new RhythmRound(spec,()=>time);time=2+delta;
   expect(round.clap(),String(delta)).toBe(Math.abs(delta)<=.2);
   expect(round.hits).toBe(Math.abs(delta)<=.2?1:0);
   expect(round.clap(),'a second press cannot count twice').toBe(false);
 }
});
it('shows the lead-in, reports misses, and finishes once all eight windows have passed',()=>{
 let time=0;const round=new RhythmRound(spec,()=>time);
 expect(round.sample()).toMatchObject({ring:1,visible:true,hits:0,done:false});
 time=1;expect(round.sample().ring).toBeCloseTo(.5);
 time=2.21;expect(round.sample()).toMatchObject({feedback:'miss',cue:2,visible:false});
 for(let i=1;i<8;i++){time=2+i*4;round.clap();}
 expect(round.hits).toBe(7);time=30.2;expect(round.sample().done).toBe(false);
 time=30.21;expect(round.sample()).toMatchObject({done:true,hits:7});expect(round.clap()).toBe(false);
});
it('pauses both cue time and judgement, then resumes without losing the current window',()=>{
 let time=0;const round=new RhythmRound(spec,()=>time);time=1;round.setPaused(true);
 time=51;expect(round.sample()).toMatchObject({elapsed:1,paused:true});expect(round.clap()).toBe(false);
 round.setPaused(false);time=52;expect(round.clap()).toBe(true);expect(round.sample().elapsed).toBe(2);
});
it('E never falls through to interactions during rhythm, including an offbeat or pause',()=>{
 let time=0;const round=new RhythmRound(spec,()=>time),interact=vi.fn(),clap=vi.fn(()=>round.clap());
 routeEventE(true,clap,interact);time=2;routeEventE(true,clap,interact);routeEventE(true,clap,interact);
 round.setPaused(true);routeEventE(true,clap,interact);
 expect(clap).toHaveBeenCalledTimes(4);expect(round.hits).toBe(1);expect(interact).not.toHaveBeenCalled();
 routeEventE(false,clap,interact);expect(interact).toHaveBeenCalledOnce();
 const engine={act:vi.fn(()=>[])};submitRhythmResult(engine,'clap',round.hits);expect(engine.act).toHaveBeenCalledWith('clap',{hits:1});
});
it('both guitar styles keep their accent notes on the same eight judged beats',()=>{
 const light=guitarScore(spec),slow=guitarScore({...spec,style:'慢'});
 expect(light.length).toBeGreaterThan(slow.length);
 expect(light.filter(n=>n.accent).map(n=>n.at)).toEqual(new RhythmRound(spec,()=>0).times);
 expect(slow.filter(n=>n.accent).map(n=>n.at)).toEqual(light.filter(n=>n.accent).map(n=>n.at));
});
it('a visual-only performance works with no audio context and still counts hits',()=>{
 let t=0;const performance=new RhythmPerformance(spec,()=>t);
 performance.update(false,false);t=2;expect(performance.clap()).toBe(true);
 t=31;expect(performance.update(false,false)).toMatchObject({done:true,hits:1});performance.dispose();
});
it('audio notes and ring judgement use the audio clock, and reschedule together after pause/mute',()=>{
 let now=100;const starts:number[]=[],stops=vi.fn();
 const gain=()=>({gain:{value:0},connect:vi.fn(),disconnect:vi.fn()});
 const ctx={get currentTime(){return now;},sampleRate:8000,createGain:gain,createBuffer:(_c:number,n:number)=>({getChannelData:()=>new Float32Array(n)}),
   createBufferSource:()=>({buffer:null,onended:null,connect:()=>gain(),disconnect:vi.fn(),start:(at:number)=>starts.push(at),stop:stops})} as unknown as AudioContext;
 const performance=new RhythmPerformance(spec,()=>ctx.currentTime,ctx,{} as AudioNode);
 performance.update(false,true);expect(starts).toContain(102);expect(starts).toContain(106);
 now=102;expect(performance.clap()).toBe(true);
 now=103;performance.update(true,true);const count=starts.length;now=113;performance.update(false,true);
 expect(starts.slice(count)).toContain(116);expect(performance.round.elapsed).toBe(3);
 performance.update(false,false);expect(stops).toHaveBeenCalled();now=116;expect(performance.clap()).toBe(true);
 performance.dispose();
});
it('a muted invitation releases its prepared clock on cancellation, and a later round resumes it',()=>{
 const sound=new CampusSound(),ctx={state:'suspended',currentTime:100,
   resume:vi.fn(async()=>{ctx.state='running';}),suspend:vi.fn(async()=>{ctx.state='suspended';}),close:vi.fn(async()=>{ctx.state='closed';})};
 Object.assign(sound,{ctx});sound.enabled=false;
 sound.prepareActivity();expect(ctx.state).toBe('running');sound.stopRhythm();expect(ctx.state).toBe('suspended');
 sound.stopRhythm();expect(ctx.suspend).toHaveBeenCalledOnce();
 const round=sound.startRhythm(spec);expect(ctx.state).toBe('running');
 ctx.currentTime=102;expect(round.clap()).toBe(true);expect(sound.enabled).toBe(false);
 sound.setHidden(true);ctx.currentTime=202;expect(sound.updateRhythm(true)).toMatchObject({hits:1,paused:true,elapsed:2});
 sound.setHidden(false);sound.updateRhythm(false);ctx.currentTime=206;expect(round.clap()).toBe(true);
 sound.stopRhythm();expect(ctx.state).toBe('suspended');expect(round.clap()).toBe(false);sound.dispose();
});
it('CampusSound falls back to a monotonic visual clock when Web Audio is unavailable',()=>{
 let time=0;vi.stubGlobal('AudioContext',undefined);vi.spyOn(performance,'now').mockImplementation(()=>time*1000);
 const sound=new CampusSound();sound.enabled=false;sound.prepareActivity();const round=sound.startRhythm(spec);
 time=2;expect(round.clap()).toBe(true);sound.updateRhythm(true);time=52;expect(sound.updateRhythm(true)?.elapsed).toBe(2);
 sound.updateRhythm(false);time=56;expect(round.clap()).toBe(true);time=81;
 expect(sound.updateRhythm(false)).toMatchObject({done:true,hits:2});sound.dispose();
});
for(const delta of [-.3,-.15,.15,.3])it(`judges all eight presses at ${delta} s with only one rendered frame every 0.5 s`,()=>{
 let time=0;const liveSpec={...spec,interval:3.6},performance=new RhythmPerformance(liveSpec,()=>time,undefined,undefined,()=>time*1000);
 for(const cue of performance.round.times){
   const pressedAt=cue+delta;
   time=Math.floor(pressedAt/.5)*.5;performance.update(false,false); // last RAF sample
   time=pressedAt;const stamp=performance.captureTime(time*1000);
   expect(performance.clap(stamp),`cue ${cue}`).toBe(Math.abs(delta)<=.2);
 }
 expect(performance.round.hits).toBe(Math.abs(delta)<=.2?8:0);
});
it('captures the clock once per judgement even if processing crosses the end of a hit window',()=>{
 const now=vi.fn(()=>0),round=new RhythmRound(spec,now);now.mockClear();
 now.mockReturnValueOnce(2.15).mockReturnValue(2.4);
 expect(round.clap()).toBe(true);expect(now).toHaveBeenCalledOnce();expect(round.hits).toBe(1);
});
it('maps a queued DOM timestamp onto the audio clock and recovers a frame-expired miss only once',()=>{
 let time=0;const performance=new RhythmPerformance(spec,()=>100+time,undefined,undefined,()=>time*1000);
 time=2.5;performance.update(false,false);expect(performance.round.states[0]).toBe('miss');
 const at=performance.captureTime(2150);expect(at).toBeCloseTo(102.15);
 expect(performance.clap(at)).toBe(true);expect(performance.clap(at)).toBe(false);expect(performance.round.hits).toBe(1);
 expect(performance.captureTime(Number.NaN)).toBe(102.5);
 expect(performance.captureTime(Date.now())).toBe(102.5); // legacy epoch timestamp is not a performance timestamp
});
it('interpolates the ring from the live clock between sparse rendered frames',()=>{
 let time=0;const performance=new RhythmPerformance(spec,()=>time);
 time=1.5;expect(performance.update(false,false).ring).toBeCloseTo(.25);
 time=1.85;expect(performance.round.sample()).toMatchObject({elapsed:1.85,visible:true});
 expect(performance.round.sample().ring).toBeCloseTo(.075);
});
