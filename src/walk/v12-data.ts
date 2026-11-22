import {PLAY_BOUNDS} from '../world/terrain';
import {boardingIssue} from './bus';
import {validLanding} from './v12-geometry';
import type {SeaData,SportsData,FitnessData,WaterBodySpec,WaterRouteSpec,TimedCourse,P3} from '../world/v12-types';
import type {BusData,BusRouteSpec} from './bus-types';
export interface V12Data {sea?:SeaData;bus?:BusData;sports?:SportsData;fitness?:FitnessData;issues:string[]}
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const point=(v:any,n=3)=>Array.isArray(v)&&v.length===n&&v.every(Number.isFinite);
const position=(v:any):P3|undefined=>point(v)?v:point(v?.position)?v.position:undefined;
const points=(v:any,n=3,min=1)=>Array.isArray(v)&&v.length>=min&&v.every(p=>point(p,n));
const list=(v:any,...keys:string[])=>keys.map(k=>v[k]).find(Array.isArray)??[];
function water(w:any):w is WaterBodySpec{return object(w)&&typeof w.id==='string'&&['sea','pool'].includes(w.kind)&&points(w.polygon,2,3)&&Number.isFinite(w.surfaceY)&&points(w.entryPoints)&&points(w.exitPoints)&&points(w.safeReturnPoints)&&Array.isArray(w.rescuePaths)&&w.rescuePaths.length>0&&w.rescuePaths.every((p:any)=>points(p))&&[...w.entryPoints,...w.exitPoints,...w.safeReturnPoints].every((p:P3)=>validLanding(p,w.polygon));}
function route(r:any):r is WaterRouteSpec{return object(r)&&typeof r.id==='string'&&typeof r.waterId==='string'&&['sup','kayak'].includes(r.craft)&&point(r.launchPoint)&&point(r.returnPoint)&&points(r.waypoints,2,2)&&points(r.corridor,2,3)&&Array.isArray(r.exclusions)&&r.exclusions.every((p:any)=>points(p,2,3));}
function course(c:any):c is TimedCourse{return object(c)&&typeof c.id==='string'&&['run','swim'].includes(c.mode)&&points(c.corridor,2,3)&&Array.isArray(c.gates)&&c.gates.length>0&&c.gates.every((g:any)=>object(g)&&typeof g.id==='string'&&point(g.a)&&point(g.b)&&point(g.direction,2))&&Array.isArray(c.requiredGateSequence)&&c.requiredGateSequence.length>0&&c.requiredGateSequence.every((id:any)=>c.gates.some((g:any)=>g.id===id));}
const equipment=(e:any)=>object(e)&&typeof e.id==='string'&&['treadmill','stationary-bike'].includes(e.kind)&&point(e.position)&&point(e.approach)&&points(e.exitPoints)&&Number.isFinite(e.yaw);
export function validFacility(f:any):boolean {
 if(!object(f)||typeof f.id!=='string'||!f.id||typeof f.kind!=='string'||!f.kind||!points(f.polygon,2,3))return false;
 if(f.courts!==undefined&&(!Array.isArray(f.courts)||!f.courts.every((p:any)=>points(p,2,3))))return false;
 if(f.inner!==undefined&&!points(f.inner,2,3)||f.infieldClay!==undefined&&!points(f.infieldClay,2,3))return false;
 if(f.diamond!==undefined&&(!object(f.diamond)||!['home','first','second','third'].every(k=>point(f.diamond[k],2))||f.diamond.mound!==undefined&&!point(f.diamond.mound,2)))return false;
 if(f.track!==undefined&&(!object(f.track)||!['kerbInnerRadius','straightLength'].every(k=>Number.isFinite(f.track[k])&&f.track[k]>0)||f.track.laneCountEstimate!==undefined&&(!Number.isInteger(f.track.laneCountEstimate)||f.track.laneCountEstimate<1||f.track.laneCountEstimate>32)))return false;
 return (f.center===undefined||point(f.center,2))&&(f.surfaceY===undefined||Number.isFinite(f.surfaceY));
}
export function parseV12(kind:'sea'|'bus'|'sports'|'fitness',raw:unknown):SeaData|BusData|SportsData|FitnessData {
 if(!object(raw))throw Error(`${kind}: 預期資料物件`);
 if(kind==='sea'){
  const bodies=list(raw,'waterBodies','waters','bodies'),routes=list(raw,'routes','waterRoutes');if(!bodies.length||!bodies.every(water)||new Set(bodies.map((w:any)=>w.id)).size!==bodies.length||!routes.every(route)||routes.some((r:any)=>!bodies.some((w:any)=>w.id===r.waterId)))throw Error('sea: 無效水域或航線');
  const show=raw.sailingShow??raw.sailingShows?.[0];if(show&&(!Array.isArray(show.boats)||show.boats.length!==8||show.boats.filter((b:any)=>b.team==='nsysu').length!==4||show.boats.filter((b:any)=>b.team==='osaka').length!==4||show.boats.some((b:any)=>!points(b.path,3,2)||!Number.isFinite(b.startProgress))))throw Error('sea: 帆船必須兩隊各四艘');
  const center=raw.center??raw.seaCenter;return {hazards:Array.isArray(raw.hazards)?raw.hazards.filter((h:any)=>points(h.polygon,2,3)):undefined,waterBodies:bodies,routes,center:center&&point(center.position)?center:undefined,buoys:Array.isArray(raw.buoys)?raw.buoys.map(position).filter((p:unknown):p is P3=>!!p):undefined,lifeguardChair:position(raw.lifeguardChair),surfZone:raw.surfZone,sailingShow:show,viewingPoint:position(raw.viewingPoint??raw.sailingViewPoint),anchors:object(raw.anchors)?Object.fromEntries(Object.entries(raw.anchors).filter(([,v])=>point(v))):undefined};
 }
 if(kind==='bus'){
  const stops=list(raw,'stops'),routes=list(raw,'routes');
  if(routes.length!==2||!stops.length||stops.some((s:any)=>!object(s)||typeof s.id!=='string'||typeof s.name!=='string'||!point(s.sign)||!point(s.boardingPoint)||!points(s.alightingPoints)||!point(s.berth?.position)||!Number.isFinite(s.berth.yaw)))throw Error('bus: 預期兩條公車線及完整站點');
  if(new Set(routes.map((r:any)=>r.id)).size!==2||new Set(routes.map((r:any)=>r.vehicleId)).size!==2||new Set(stops.map((s:any)=>s.id)).size!==stops.length)throw Error('bus: 重複 ID');
  for(const r of routes as BusRouteSpec[]){if(typeof r.vehicleId!=='string'||!r.vehicleId||!Array.isArray(r.stopOccurrences)||r.stopOccurrences.length<2||!Array.isArray(r.legs)||r.legs.length<2||!['campus-bus','orange-1-ext'].includes(r.id)||r.schedule?.gameSecondsPerRealSecond!==5||!Number.isFinite(r.schedule.initialPhaseGameSeconds)||!Number.isFinite(r.schedule.terminalLayoverRealSeconds)||r.schedule.minDwellRealSeconds!==6||![r.vehicle?.lengthM,r.vehicle?.widthM,r.vehicle?.heightM].every(n=>Number.isFinite(n)&&n>0))throw Error('bus: 路線／倍率／車體無效');
   if(new Set(r.stopOccurrences.map(o=>o.occurrenceId)).size!==r.stopOccurrences.length||r.stopOccurrences.some(o=>!stops.some((s:any)=>s.id===o.stopId)||r.legs.filter(l=>l.fromOccurrenceId===o.occurrenceId).length!==1)||r.legs.some(l=>!points(l.path,3,2)||l.path.some(p=>p[0]<PLAY_BOUNDS[0]||p[0]>PLAY_BOUNDS[2]||p[2]<PLAY_BOUNDS[1]||p[2]>PLAY_BOUNDS[3])||l.narrowSectionIds!==undefined&&(!Array.isArray(l.narrowSectionIds)||!l.narrowSectionIds.every(id=>typeof id==='string'))||!Array.isArray(l.sourceEdgeIds)||!l.sourceEdgeIds.every(id=>typeof id==='string')||(!Number.isFinite(l.cruiseMpsGame)||!(l.cruiseMpsGame>0))||!r.stopOccurrences.some(o=>o.occurrenceId===l.toOccurrenceId)))throw Error('bus: 站序路徑不完整');}
  const issue=boardingIssue(stops,routes);if(issue)throw Error(issue);
  const fc=raw.forecourt;if(fc&&(!points(fc.polygon,2,3)||!Number.isFinite(fc.levelY)))throw Error('bus: 無效廣場地表');
  return {stops,routes,forecourt:fc};
 }
 if(kind==='sports'){
  const facilities=list(raw,'facilities'),courses=list(raw,'courses','timedCourses'),portals=list(raw,'portals','fitnessPortals'),items=list(raw,'equipment');
  if(!facilities.every(validFacility)||!courses.every(course)||portals.some((p:any)=>!p.id||!p.interiorSceneId||!point(p.exteriorTrigger)||!point(p.interiorSpawn)||!points(p.exteriorReturnPoints))||!items.every(equipment))throw Error('sports: 場地／gate／portal 不完整');
  return {facilities,courses,portals,equipment:items};
 }
 const scenes=list(raw,'scenes','interiors');if(scenes.some((s:any)=>!s.id||!points(s.polygon,2,3)||!Number.isFinite(s.floorY)||!point(s.exitPoint)||!Array.isArray(s.equipment)||!s.equipment.every(equipment)))throw Error('fitness: 無效室內場景');return {scenes};
}
export async function loadV12Data(asset:(p:string)=>string,request:typeof fetch=fetch):Promise<V12Data>{
 const result:V12Data={issues:[]},paths={sea:'sea.json',bus:'bus-routes.json',sports:'sports.json',fitness:'interiors/fitness.json'};
 await Promise.all(Object.entries(paths).map(async([key,path])=>{try{const response=await request(asset('data/'+path));if(response.status===404)return;if(!response.ok)throw Error(`HTTP ${response.status}`);const value=parseV12(key as keyof typeof paths,await response.json());Object.assign(result,{[key]:value});}catch(error){result.issues.push(`${path}: ${String(error)}`);}}));return result;
}
