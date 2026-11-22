import {expect,it} from 'vitest';
import * as T from 'three';
import {TimedSports,FitnessRuntime} from '../src/walk/sports-activity';
import {parseV12,loadV12Data} from '../src/walk/v12-data';
import {SailingShow} from '../src/world/sailing-show';
import {buildSportsField} from '../src/world/sports-field';
import {course,water,craft,bus,stops} from './v121-fixtures';
it('records a valid ordered run and reloads only finite positive personal bests',()=>{
 const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}},timer=new TimedSports(storage);timer.start(course,[-1,0,0]);for(let x=0;x<=11;x++)timer.update(.2,[x,0,0],{kind:'walk'});expect(timer.result?.valid).toBe(true);expect(new TimedSports(storage).best.run).toBeCloseTo(timer.result!.seconds);
});
it('invalidates out-of-order gates, corridor shortcuts, teleport, biking, carry and rescue',()=>{
 for(const mode of [{kind:'bike' as const},{kind:'carried' as const,carrier:'bus' as const,id:'b',localAnchor:[0,0,0] as [number,number,number]},{kind:'rescue' as const,waterId:'w'}]){const t=new TimedSports();t.start(course,[-1,0,0]);t.update(.1,[-.5,0,0],mode);expect(t.result?.valid).toBe(false);}
 const out=new TimedSports();out.start(course,[-1,0,1.5]);out.update(1,[6,0,0],{kind:'walk'});expect(out.result?.reason).toContain('順序');const cut=new TimedSports();cut.start(course,[-1,0,0]);cut.update(1,[2,0,3],{kind:'walk'});expect(cut.result?.reason).toContain('賽道');const teleport=new TimedSports();teleport.start(course,[-1,0,0]);teleport.update(.01,[11,0,0],{kind:'walk'});expect(teleport.result?.reason).toContain('跳接');
});
it('portal uses a checked interior spawn and safe return; equipment keeps a recoverable exit',()=>{
 const portal={id:'p',exteriorTrigger:[0,0,0] as [number,number,number],exteriorReturnPoints:[[1,0,0],[2,0,0]] as [number,number,number][],interiorSceneId:'fitness',interiorSpawn:[100,0,100] as [number,number,number]},f=new FitnessRuntime(p=>p[0]!==1);
 expect(f.enter(portal,[10,0,0])).toBeUndefined();expect(f.enter(portal,[0,0,0])).toEqual([100,0,100]);const e={id:'t',kind:'treadmill' as const,position:[100,0,100] as [number,number,number],approach:[100,0,100] as [number,number,number],yaw:0,exitPoints:[[101,0,100]] as [number,number,number][]};expect(f.use(e,[100,0,100])).toBe(true);expect(f.stop()).toEqual([101,0,100]);expect(f.exit()).toEqual([2,0,0]);expect(f.portal).toBeUndefined();
});
it('optional missing/HTML/invalid JSON never aborts other features',async()=>{
 const fetcher=async(url:string|URL|Request)=>String(url).endsWith('sea.json')?new Response(JSON.stringify({waterBodies:[water],routes:[craft]})):String(url).endsWith('sports.json')?new Response('<html>fallback</html>'):new Response('',{status:404});
 const data=await loadV12Data(x=>x,fetcher as typeof fetch);expect(data.sea?.waterBodies).toHaveLength(1);expect(data.bus).toBeUndefined();expect(data.issues).toHaveLength(1);expect(()=>parseV12('sea',{waterBodies:[{}]})).toThrow();
});
it('builds eight moving sailing boats and real pool bottom/walls without making water walkable',()=>{
 const boats=Array.from({length:8},(_,i)=>({id:String(i),team:i<4?'nsysu' as const:'osaka' as const,path:[[0,0,0],[20,0,0],[20,0,20],[0,0,0]] as [number,number,number][],startProgress:i/8}));const show=new SailingShow({id:'show',waterId:'sea',viewingAnchorId:'view',boats,sources:[],sourceIds:[]},new T.Group());const first=show.group.children[0].position.clone();show.update(1);expect(show.group.children).toHaveLength(8);expect(show.group.children[0].position.distanceTo(first)).toBeGreaterThan(2);
 const field=buildSportsField(undefined,[{...water,kind:'pool'}],undefined,()=>.15),ray=new T.Raycaster(new T.Vector3(10,1,10),new T.Vector3(0,-1,0));expect(ray.intersectObject(field.collision,true)[0].point.y).toBeCloseTo(-1.4);show.dispose();
});

it('checks the entire movement segment, so a chord through a concave course is not a shortcut',()=>{
 const timer=new TimedSports();timer.start({...course,gates:course.gates.map(g=>({...g,a:[2,g.a[1],g.a[2]],b:[2,g.b[1],g.b[2]]})),corridor:[[0,0],[10,0],[10,10],[7,10],[7,3],[3,3],[3,10],[0,10]]},[1,0,8]);timer.update(1,[9,0,8],{kind:'walk'});expect(timer.result?.reason).toBe('離開賽道');
});
it('loads the two-route bus contract and rejects duplicate carriers or non-string edge IDs',()=>{
 const valid={stops,routes:[bus,{...bus,id:'orange-1-ext',vehicleId:'bus2'}]};expect(()=>parseV12('bus',valid)).not.toThrow();expect(()=>parseV12('bus',{...valid,routes:[bus,bus]})).toThrow();expect(()=>parseV12('bus',{...valid,routes:[{...bus,legs:[{...bus.legs[0],sourceEdgeIds:[1]},bus.legs[1]]},valid.routes[1]]})).toThrow();
});
