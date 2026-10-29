/** SUPERSEDED (2026-10): encodes the pre-v2 hand placement (SC/EN 1 m gap, AABB no-overlap).
 * v2 placement is checked per storey with real polygons in tools/build_campus_structure.py
 * (`separationRemaining` in campus-structure.json) and walked in tests/walk-manual.test.ts. */
/** Registered-footprint and virtual-gallery spacing check; not a site survey.
 * Run: node --import tsx tools/verify_walk_placement.ts
 * Writes only the requested verification artifact, never modifies source data.
 */
import {readFileSync as readStructureSync} from 'node:fs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import * as T from 'three';
import {buildWalkWorld} from '../src/walk-world';
import type {WalkBuilding,FloorAccess} from '../src/walk-types';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ids=['SC','EN','BI','PH','CH','EC','MS','EV'] as const;
const pairsWithMargin=[['EN','CH'],['EN','MS'],['EV','EC']] as const;
const sha=(input:string|Uint8Array)=>createHash('sha256').update(input).digest('hex');
const plain=(b:T.Box3)=>({min:b.min.toArray(),max:b.max.toArray()});

export async function verifyWalkPlacement(){
 const inputs=['src/walk-world.ts','public/data/walkthrough/access-plan.json',...ids.map(id=>`public/data/walkthrough/${id}.json`)];
 const sourceSHA256:Record<string,string>={};
 for(const path of inputs)sourceSHA256[path]=sha(await readFile(resolve(root,path)));
 const access=JSON.parse(await readFile(resolve(root,'public/data/walkthrough/access-plan.json'),'utf8')) as {floors:Record<string,FloorAccess>};
 const data=await Promise.all(ids.map(async id=>JSON.parse(await readFile(resolve(root,`public/data/walkthrough/${id}.json`),'utf8')) as WalkBuilding));
 for(const b of data)for(const f of b.floors){if(!access.floors[f.id])throw Error(`Missing access: ${f.id}`);f.access=access.floors[f.id];}
 const world=buildWalkWorld(data,JSON.parse(readStructureSync('public/data/walkthrough/campus-structure.json','utf8')));world.display.updateMatrixWorld(true);
 const boxes=new Map<string,T.Box3>();
 const buildings=ids.map(id=>{
  const group=world.display.children.find(object=>object.name===id);
  const frame=world.frames.get(id);
  if(!group||!frame)throw Error(`Missing building/frame: ${id}`);
  const body=new T.Box3();
  for(const floor of world.floors.filter(f=>f.buildingId===id))for(const [x,z] of floor.data.outline)body.expandByPoint(new T.Vector3(x,floor.y,z).applyMatrix4(frame));
  const total=new T.Box3().setFromObject(group);boxes.set(id,total);
  const tower=group.getObjectByName(`Virtual service stair ${id}`);
  return {id,frame:frame.elements.slice(),position:new T.Vector3().setFromMatrixPosition(frame).toArray(),registeredSourceBounds:plain(body),withVirtualGalleriesAndTower:plain(total),serviceTowerBounds:tower?plain(new T.Box3().setFromObject(tower)):null};
 });
 const checks=[];const errors:string[]=[];
 for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
  const a=boxes.get(ids[i])!,b=boxes.get(ids[j])!;
  const overlapX=Math.min(a.max.x,b.max.x)-Math.max(a.min.x,b.min.x),overlapZ=Math.min(a.max.z,b.max.z)-Math.max(a.min.z,b.min.z);
  const gapX=Math.max(a.min.x-b.max.x,b.min.x-a.max.x,0),gapZ=Math.max(a.min.z-b.max.z,b.min.z-a.max.z,0);
  const intentional=ids[i]==='SC'&&ids[j]==='EN';
  const overlaps=overlapX>1e-5&&overlapZ>1e-5;
  const pair=[ids[i],ids[j]];
  const marginRequired=pairsWithMargin.some(p=>p.every(id=>pair.includes(id)))?2:0;
  const gap=Math.hypot(gapX,gapZ);
  if(overlaps&&!intentional)errors.push(`Unintended XZ bounding-box overlap: ${pair.join('/')}`);
  if(marginRequired&&gap<marginRequired-1e-4)errors.push(`Spacing below 2m: ${pair.join('/')} ${gap}`);
  checks.push({pair,intentionalConnection:intentional,overlapX,overlapZ,gapX,gapZ,distanceXZ:gap,requiredMargin:marginRequired,passed:intentional||(!overlaps&&gap>=marginRequired-1e-4)});
 }
 // Preserve the already-established core connection and its auto-derived EN Z.
 const sc=buildings.find(b=>b.id==='SC')!,en=buildings.find(b=>b.id==='EN')!;
 if(Math.abs(sc.position[0])>1e-6||Math.abs(sc.position[2])>1e-6||Math.abs(en.position[0])>1e-6)errors.push('SC/EN core frame X/Z connection changed');
 const scGround=data.find(b=>b.id==='SC')!.floors.find(f=>f.level===1)!,enGround=data.find(b=>b.id==='EN')!.floors.find(f=>f.level===1)!;
 if(Math.abs(en.position[2]-(scGround.bounds[0]-enGround.bounds[2]-1))>1e-6)errors.push('EN auto-placement does not preserve the existing 1m source-core gap');
 const changedInputs=[];
 for(const path of inputs)if(sha(await readFile(resolve(root,path)))!==sourceSHA256[path])changedInputs.push(path);
 if(changedInputs.length)errors.push('Source changed during measurement; rerun this verifier');
 return {valid:errors.length===0,createdAt:new Date().toISOString(),method:'Three.Box3 from current buildWalkWorld building groups: registered source outlines, detailed geometry, access walkOutline, virtual exterior galleries and service towers. No decoration-only campus art or LOD shells.',units:'illustrative registered world metres; not a site measurement',scope:'8 science/engineering buildings; SC/EN deliberate shared-gallery connection is retained',sourceSHA256,changedInputs,buildings,checks,errors,adjustment:{basis:'Minimum east-only displacement with fixed SC/EN and north/south locations, reserving >=2m between conservative full scene bounding boxes.',placements:{CH:[80.01,-136,0],MS:[81.62,-198,0],EC:[80.59,-264,0]},previousPlacements:{CH:[72,-136,0],MS:[72,-198,0],EC:[67,-264,0]},note:'This prevents unintended model collisions involving registered footprints and virtual walkways; it does not claim survey-accurate campus coordinates or globally minimal movement over unrestricted directions.'}};
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 const report=await verifyWalkPlacement();
 const output=resolve(root,'artifacts/walk-placement-verification.json');
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({valid:report.valid,pairs:report.checks.length,margins:report.checks.filter(c=>c.requiredMargin>0).map(c=>({pair:c.pair,gap:c.distanceXZ})),output}));
 if(!report.valid){for(const error of report.errors)console.error(error);process.exitCode=1;}
}
