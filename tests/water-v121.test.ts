import {expect,it} from 'vitest';
import * as T from 'three';
import {waveHeight,evaluateSea,seaConditions,SeaPolicyClock} from '../src/walk/water-policy';
import {SwimRuntime} from '../src/walk/swim';
import {WatercraftRuntime,attachPaddle} from '../src/walk/watercraft';
import {shoreConstraint} from '../src/walk/shore-constraint';
import {Avatar} from '../src/walk/avatar';
import {water,clear,craft} from './v121-fixtures';
it('daily-wave-v1 has exact annual quotas in common/leap years and decimetre values',()=>{
 for(const year of [2024,2025,2026]){const values:number[]=[];for(let d=new Date(Date.UTC(year,0,1));d.getUTCFullYear()===year;d.setUTCDate(d.getUTCDate()+1)){const key=d.toISOString().slice(0,10).replaceAll('-',''),h=waveHeight(key);expect(h).toBe(waveHeight(key));expect(h*10).toBeCloseTo(Math.round(h*10),8);values.push(h);}
 expect(values.filter(h=>h>=2)).toHaveLength(Math.floor(values.length*.03));expect(values.filter(h=>h>=1)).toHaveLength(Math.round(values.length*.2));expect(values.every(h=>h>=.3&&h<=2.6)).toBe(true);}
 expect(()=>waveHeight('20260229')).toThrow();expect(()=>waveHeight('20261301')).toThrow();
});
it('uses >= 1 and >= 2, allows sunset and closes night/storm/management',()=>{
 expect(evaluateSea('swim',{...clear,waveHeightM:.9}).allowed).toBe(true);for(const a of ['swim','sup','kayak','sailing-show'] as const)expect(evaluateSea(a,{...clear,waveHeightM:1}).allowed).toBe(false);
 for(const a of ['surf-class','supervised-training'] as const){expect(evaluateSea(a,{...clear,waveHeightM:1.9,period:'sunset'}).allowed).toBe(true);expect(evaluateSea(a,{...clear,waveHeightM:2}).allowed).toBe(false);}
 for(const change of [{period:'night' as const},{thunder:true},{typhoonWarning:true},{operatorClosed:true}])expect(evaluateSea('swim',{...clear,...change}).recall).toBe(true);
});
it('QA is opt-in, validates finite/range values and uses device-local civil date',()=>{
 const now=new Date(2026,0,5,23,59);expect(seaConditions('day',new URLSearchParams('qaWave=9&qaSea=thunder'),now).qaOverride).toBe(false);
 const c=seaConditions('sunset',new URLSearchParams('qa=1&qaWave=1.09&qaSea=closed'),now);expect(c.date).toBe('20260105');expect(c.waveHeightM).toBe(1);expect(c.operatorClosed).toBe(true);
 for(const h of ['NaN','Infinity','-1','11',''])expect(seaConditions('day',new URLSearchParams('qa=1&qaWave='+h),now).waveHeightM).toBe(waveHeight('20260105'));
 let date=now;const clock=new SeaPolicyClock(new URLSearchParams(),()=>date);date=new Date(2026,0,6,0,1);expect(clock.update('day').date).toBe('20260106');
});
it('enters through an entry, separates capsule/root, exits safely and rejects closed entry',()=>{
 const s=new SwimRuntime();expect(s.enter(water,[.5,.15,1],evaluateSea('swim',{...clear,waveHeightM:2}))).toBe(false);expect(s.enter(water,[.5,.15,1],evaluateSea('swim',clear))).toBe(true);
 expect(s.frame?.renderRootWorld[1]).toBe(0);expect(s.foot.y).toBe(.8);expect(s.exit()).toEqual([-.5,.15,1]);expect(s.phase).toBe('dry');
 expect(new SwimRuntime(()=>{},()=>false).enter(water,[.5,.15,1],evaluateSea('swim',clear))).toBe(false);
});
it('exhaustion, bounds and policy closure trigger one whistle and authored return path',()=>{
 for(const cause of ['stamina','bounds','closed']){let whistles=0;const s=new SwimRuntime(()=>whistles++);s.enter(water,[.5,.15,1],evaluateSea('swim',clear));s.position.set(10,0,10);if(cause==='stamina')s.stamina=0;if(cause==='bounds')s.position.x=21;
 s.update(.1,new T.Vector3(),evaluateSea('swim',cause==='closed'?{...clear,period:'night'}:clear));expect(s.phase).toBe('rescue');expect(whistles).toBe(1);let returned;for(let i=0;i<200&&s.phase!=='dry';i++)returned=s.update(.1,new T.Vector3(),evaluateSea('swim',clear));expect(returned).toEqual([0,.15,-1]);expect(whistles).toBe(1);}
});
it('keeps unsupported sea and unopened pools blocked, but allows the selected water mode',()=>{
 const terrain={seaLevel:0,heightAt:()=>-2},p=new T.Vector3(0,.1,0),v=new T.Vector3(1,0,0);const shore=shoreConstraint(terrain,()=>.1);shore(p,v,1);expect(v.x).toBe(1);
 const edge=shoreConstraint({seaLevel:0,heightAt:(x)=>x<0?.2:-2},()=>undefined),dry=new T.Vector3(-.5,.2,0),seaward=new T.Vector3(1,0,0);edge(dry,seaward,1);expect(seaward.x).toBe(0);
 const pool=shoreConstraint({seaLevel:-10,heightAt:()=>0},()=>0,()=>false,(x)=>x>.4);const blocked=new T.Vector3(1,0,0);pool(new T.Vector3(),blocked,1);expect(blocked.x).toBe(0);
 const allowed=shoreConstraint(terrain,()=>undefined,()=>true),go=new T.Vector3(1,0,0);allowed(p,go,1);expect(go.x).toBe(1);
});
it('watercraft follows player direction, clamps to corridor and recalls on policy closure',()=>{
 const c=new WatercraftRuntime();expect(c.rent(craft,water,craft.launchPoint,evaluateSea('sup',clear))).toBe(true);c.position.set(5,0,4);c.update(.1,new T.Vector3(0,0,-1),evaluateSea('sup',clear));expect(c.position.z).toBeLessThan(4);expect(c.position.z).toBe(3);expect(c.frame?.clip).toBe('PaddleStand');expect(c.update(.1,new T.Vector3(0,0,-1),evaluateSea('sup',{...clear,waveHeightM:1}))).toBe('recall');
});
it('paddle uses both palm transforms and water animation precedes seated/ground IK',()=>{
 const parent=new T.Group(),l=new T.Object3D(),r=new T.Object3D(),paddle=new T.Group();parent.add(l,r,paddle);l.position.set(0,2,0);r.position.set(0,1,0);attachPaddle(paddle,l,r,parent,'sup');expect(paddle.position.y).toBeCloseTo(-.05);
 const avatar=new Avatar();avatar.setModel(new T.Group(),['Idle','Sit','Swim','Tread','PaddleStand','PaddleSit'].map(n=>new T.AnimationClip(n,1,[])));avatar.setSeated(true);avatar.externalPose={position:[1,5,2],heading:0,clip:'Swim'};avatar.update(.1,{foot:new T.Vector3(1,5.8,2),onGround:true,airborneFor:0,speed:0,intendedSpeed:0,jumped:false,runSpeed:7,surfaceHeight:10});expect(avatar.root.position.y).toBe(5);expect(avatar.state).toBe('swim');avatar.dispose();
});

it('a local-midnight open-to-closed transition starts recall on the next policy evaluation',()=>{
 let date=new Date(2026,0,1);for(let i=0;i<364;i++){const next=new Date(date.getFullYear(),date.getMonth(),date.getDate()+1);const key=(d:Date)=>`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;if(waveHeight(key(date))<1&&waveHeight(key(next))>=1)break;date=next;}
 const clock=new SeaPolicyClock(new URLSearchParams(),()=>date),s=new SwimRuntime();s.enter(water,[.5,.15,1],evaluateSea('swim',clock.update('day')));expect(s.phase).toBe('swim');date=new Date(date.getFullYear(),date.getMonth(),date.getDate()+1);s.update(.01,new T.Vector3(),evaluateSea('swim',clock.update('day')));expect(s.phase).toBe('rescue');
});
