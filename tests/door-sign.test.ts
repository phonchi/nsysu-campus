import { beforeAll, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { Matrix4, Vector3 } from 'three';
import { buildWalkWorld, type WalkWorld, type WorldDoor } from '../src/walk-world';
import { WALK_BUILDING_IDS } from '../src/walk-nav';
import type { CampusStructure, FloorAccess, WalkBuilding } from '../src/walk-types';
import { doorSignPose, buildSignWall, buildDoorSignWalls, type SignWall, SIGN_MOUNT_OVERRIDES, DOOR_SIGN_WIDTH, DOOR_SIGN_HEIGHT } from '../src/walk/door-sign';

let world: WalkWorld;
let walls: Map<string,SignWall>;
beforeAll(() => {
  const read = (p:string) => JSON.parse(fs.readFileSync(`public/data/walkthrough/${p}.json`,'utf8'));
  const access = read('access-plan') as { floors:Record<string,FloorAccess> };
  const buildings = WALK_BUILDING_IDS.map(id => {
    const b = read(id) as WalkBuilding;
    for (const f of b.floors) f.access = access.floors[f.id];
    return b;
  });
  world = buildWalkWorld(buildings,read('campus-structure') as CampusStructure);
  walls = buildDoorSignWalls(world,buildings,read('campus-structure') as CampusStructure,{strict:true});
},30000);
const angle = (a:Vector3,b:Vector3) => Math.acos(Math.min(1,Math.abs(a.dot(b))))*180/Math.PI;
function verify(d:WorldDoor) {
  const wall=walls.get(d.id)!, pose=doorSignPose(d,wall)!;
  expect(angle(pose.normal,d.normal!),d.id).toBeLessThanOrEqual(1);
  expect(pose.normal.dot(d.outside.clone().sub(d.inside)),d.id).toBeGreaterThan(0);
  expect(new Vector3(0,1,0).applyQuaternion(pose.quaternion).distanceTo(new Vector3(0,1,0))).toBeLessThan(1e-10);
  expect(pose.position.y-d.position.y).toBeCloseTo(2.55,10);
  expect(Math.hypot(pose.position.x-d.position.x,pose.position.z-d.position.z),`${d.id} stays at its doorway`).toBeLessThan(1.5);
  for (const x of [-DOOR_SIGN_WIDTH/2,DOOR_SIGN_WIDTH/2]) for (const y of [-DOOR_SIGN_HEIGHT/2,DOOR_SIGN_HEIGHT/2]) {
    const corner=new Vector3(x,y,0).applyQuaternion(pose.quaternion).add(pose.position);
    expect(corner.clone().sub(wall.surface).dot(pose.normal),d.id).toBeCloseTo(.03,8);
    // Independent rectangle-distance check against the actual uncut wall boxes at sign height
    // (above the 2.3 m door lintel). Short/oblique exceptions may bridge gaps, but cannot penetrate.
    for (const e of wall.edges) {
      const t=e.b.clone().sub(e.a), length=t.length();t.normalize();
      const rel=corner.clone().sub(e.a), along=rel.dot(t), perpendicular=Math.abs(rel.x*(-t.z)+rel.z*t.x);
      const gap=Math.hypot(Math.max(0,-along,along-length),Math.max(0,perpendicular-e.halfThickness));
      expect(gap,`${d.id} corner against wall`).toBeGreaterThan(1e-8);
    }
  }
}
it('SC2001 faces the public corridor even though the saved normal points inside',()=>{
  const d=world.doors.find(d=>d.id==='SC-2F-portal-022')!;
  expect(d.normal!.dot(d.outside.clone().sub(d.inside))).toBeLessThan(0);
  expect(angle(d.outside.clone().sub(d.position).normalize(),d.normal!)).toBeCloseTo(23.9961,3);
  verify(d);
});
it('a normal BI door stays upright and outside its mounting wall',()=>verify(world.doors.find(d=>d.buildingId==='BI')!));
it('SC-B1 portal-023 corrects the largest old angle, with an explicit fragment override',()=>{
  const d=world.doors.find(d=>d.id==='SC-B1-portal-023')!;
  expect(angle(d.outside.clone().sub(d.position).normalize(),d.normal!)).toBeCloseTo(62.526,2);
  expect(walls.get(d.id)!.override).toContain(d.id);verify(d);
});
it('audits all eight buildings: 891 upright signs, no angle or wall-clearance exceptions',()=>{
  expect(world.doors).toHaveLength(891);
  const missing=world.doors.filter(d=>!walls.has(d.id)).map(d=>d.id);
  expect(missing,'Portals with missing mounting faces').toEqual([]);
  expect(walls.size).toBe(world.doors.length);
  console.info('Door-sign mount coverage',JSON.stringify({doors:world.doors.length,mounts:walls.size,missing,difference:world.doors.length-walls.size}));
  const rows=WALK_BUILDING_IDS.map(id=>{
    const doors=world.doors.filter(d=>d.buildingId===id);
    doors.forEach(verify);
    return {building:id,total:doors.length,before:doors.filter(d=>angle(d.outside.clone().sub(d.position).normalize(),d.normal!)>1).length,after:doors.filter(d=>angle(doorSignPose(d,walls.get(d.id)!)!.normal,d.normal!)>1).length};
  });
  expect(rows.reduce((s,r)=>s+r.before,0)).toBe(38);
  expect(rows.reduce((s,r)=>s+r.after,0)).toBe(0);
  const overrides=world.doors.filter(d=>walls.get(d.id)!.override);
  expect(overrides.map(d=>d.id).sort()).toEqual(Object.keys(SIGN_MOUNT_OVERRIDES).sort());
  console.info('Door-sign audit',JSON.stringify(rows));
  console.info('Explicit mounting overrides (no angular/clearance exemptions)',overrides.map(d=>walls.get(d.id)!.override).join('\n'));
});

it('omits unmatched doors safely, warns once per runtime build, and strict mode names every missing portal',()=>{
  const a=world.doors[0], doors=[{...a,id:'future-door-a'},{...a,id:'future-door-b'}];
  const fixture={...world,doors};
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  try {
    const mounts=buildDoorSignWalls(fixture,[],{} as CampusStructure);
    expect(mounts.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('future-door-a');
    expect(warn.mock.calls[0][0]).toContain('future-door-b');
    expect(doorSignPose(a,mounts.get(a.id))).toBeUndefined();
    expect(()=>buildDoorSignWalls(fixture,[],{} as CampusStructure,{strict:true})).toThrow(/future-door-a[\s\S]*future-door-b/);
    expect(warn).toHaveBeenCalledTimes(1);
  } finally { warn.mockRestore(); }
});
it('diagnoses invalid effective polygon override indices with portal ID, without breaking runtime',()=>{
  const d=world.doors.find(d=>d.id==='SC-B1-portal-023')!;
  const polygon:[number,number][]=[[0,0],[1,0],[1,1],[0,1]];
  const onIssue=vi.fn();
  expect(buildSignWall(d.id,d,polygon,new Matrix4(),1,{onIssue})).toBeUndefined();
  expect(onIssue).toHaveBeenCalledWith(expect.objectContaining({portalId:d.id,reason:expect.stringContaining('edge index 8')}));
  expect(()=>buildSignWall(d.id,d,polygon,new Matrix4(),1,{strict:true})).toThrow(/SC-B1-portal-023.*edge index 8/);
});
it('runtime builder uses roomOverrides before validating override edge indices',()=>{
  const d=world.doors.find(d=>d.id==='SC-B1-portal-023')!;
  const building=JSON.parse(fs.readFileSync('public/data/walkthrough/SC.json','utf8')) as WalkBuilding;
  const access=JSON.parse(fs.readFileSync('public/data/walkthrough/access-plan.json','utf8')) as {floors:Record<string,FloorAccess>};
  for(const f of building.floors)f.access=access.floors[f.id];
  const structure=JSON.parse(fs.readFileSync('public/data/walkthrough/campus-structure.json','utf8')) as CampusStructure;
  const floor=building.floors.find(f=>f.id===d.floorId)!;
  const portal=floor.access!.portals.find(p=>p.id===d.id)!;
  structure.roomOverrides??={};structure.roomOverrides[floor.id]??={};
  for(const roomId of portal.roomIds)structure.roomOverrides[floor.id][roomId]=[[0,0],[2,0],[2,2],[0,2]];
  const fixture={...world,doors:[d]},warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  try {
    expect(buildDoorSignWalls(fixture,[building],structure).size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('SC-B1-portal-023');
    expect(warn.mock.calls[0][0]).toContain('edge index 8');
    expect(()=>buildDoorSignWalls(fixture,[building],structure,{strict:true})).toThrow(/SC-B1-portal-023.*edge index 8/);
  } finally { warn.mockRestore(); }
});
it('missing trustworthy walls and invalid normals also omit signs, with strict diagnostics',()=>{
  const d=world.doors[0],onIssue=vi.fn();
  expect(buildSignWall('no-support',d,[],new Matrix4(),1,{onIssue})).toBeUndefined();
  expect(()=>buildSignWall('no-support',d,[],new Matrix4(),1,{strict:true})).toThrow('no-support');
  const invalid={...d,normal:new Vector3(0,1,0)};
  expect(buildSignWall('bad-normal',invalid,[],new Matrix4(),1,{onIssue})).toBeUndefined();
  expect(doorSignPose(invalid,walls.get(d.id))).toBeUndefined();
  expect(onIssue).toHaveBeenCalledTimes(2);
});
