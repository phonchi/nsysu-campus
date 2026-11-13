/** Mount override indices refer to effectiveRooms() polygons AFTER applying
 * campus-structure.json roomOverrides, never the raw walkthrough room polygons.
 * After changing either source, rerun tests/door-sign.test.ts and re-audit overrides.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Point2, WalkBuilding, CampusStructure } from '../walk-types';
import { effectiveRooms, type WalkWorld } from '../walk-world';

export const DOOR_SIGN_WIDTH = 1.35;
export const DOOR_SIGN_HEIGHT = .38;
export const DOOR_SIGN_GAP = .03;
export interface SignMountIssue { portalId: string; reason: string }
export interface SignMountOptions {
  /** Tests opt into strict auditing; runtime omits invalid signs and warns once per build. */
  strict?: boolean;
  onIssue?: (issue: SignMountIssue) => void;
}
export interface SignDoor { position: Vector3; outside: Vector3; inside: Vector3; normal?: Vector3 }
export interface SignWall {
  /** World-space outer support plane, including the actual wall thickness. */
  surface: Vector3;
  /** Anchor may move along a wall to keep the whole sign supported. */
  anchor: Vector3;
  edges: { a: Vector3; b: Vector3; halfThickness: number }[];
  override?: string;
}

/** Explicit exceptions for traced door arcs / short or oblique wall fragments. Values are
 * effective-room polygon edge indices, not navigation edits. These signs bridge fragments;
 * their support plane is the outer envelope of the nearby real wall boxes, never the door point. */
export const SIGN_MOUNT_OVERRIDES: Readonly<Record<string, number>> = {
  'EN-B1-portal-002':145, 'EN-B1-portal-004':71,
  'SC-B1-portal-011':11, 'SC-B1-portal-023':8, 'SC-B1-portal-027':24,
  'SC-B1-portal-034':11, 'SC-B1-portal-028':12, 'SC-B1-portal-030':5,
  'SC-B1-portal-035':10, 'SC-B1-portal-040':3,
  'SC-3F-portal-002':10, 'SC-3F-portal-003':1, 'SC-3F-portal-004':11,
  'SC-3F-portal-005':6, 'SC-3F-portal-007':17, 'SC-3F-portal-010':39,
  'SC-3F-portal-012':28, 'SC-3F-portal-011':0, 'SC-3F-portal-013':5,
  'SC-3F-portal-015':0, 'SC-3F-portal-017':4, 'SC-3F-portal-020':9,
  'SC-3F-portal-021':6, 'SC-3F-portal-024':13, 'SC-3F-portal-025':13,
  'SC-4F-portal-011':6, 'SC-4F-portal-012':1, 'SC-4F-portal-018':5,
  'SC-4F-portal-023':10, 'SC-4F-portal-025':24, 'SC-4F-portal-026':6,
  'SC-4F-portal-027':16, 'SC-4F-portal-029':37, 'SC-4F-portal-031':10,
  'SC-4F-portal-033':11,
};

export function doorSignNormal(door: SignDoor) {
  if (!door.normal || !Number.isFinite(door.normal.x) || !Number.isFinite(door.normal.z) || Math.hypot(door.normal.x,door.normal.z) < 1e-6) throw new Error('Door sign requires a finite horizontal portal plane normal');
  const n = door.normal.clone(); n.y = 0; n.normalize();
  if (n.dot(door.outside.clone().sub(door.inside)) < 0) n.negate();
  return n;
}

/** Clip the horizontal wall rectangle to the sign's width band. All returned points are
 * actual wall-box cross-section points, so the outer support includes tilted/fragmented edges. */
export function wallBandPoints(edge: SignWall['edges'][number], anchor: Vector3, right: Vector3): Vector3[] {
  const tangent = edge.b.clone().sub(edge.a).normalize();
  const side = new Vector3(-tangent.z, 0, tangent.x).multiplyScalar(edge.halfThickness);
  let poly = [edge.a.clone().add(side), edge.b.clone().add(side), edge.b.clone().sub(side), edge.a.clone().sub(side)];
  for (const sign of [-1, 1]) {
    const inside = (p: Vector3) => sign * p.clone().sub(anchor).dot(right) - DOOR_SIGN_WIDTH / 2;
    const next: Vector3[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], da = inside(a), db = inside(b);
      if (da <= 0) next.push(a);
      if ((da <= 0) !== (db <= 0)) next.push(a.clone().lerp(b, da / (da - db)));
    }
    poly = next;
  }
  return poly;
}

export function buildSignWall(id: string, door: SignDoor, polygon: Point2[], frame: Matrix4, scale: number, options: SignMountOptions = {}): SignWall | undefined {
  try { return buildSignWallStrict(id,door,polygon,frame,scale); }
  catch (error) {
    const issue={portalId:id,reason:error instanceof Error ? error.message : String(error)};
    if(options.strict) throw new Error(`[door-sign] ${id}: ${issue.reason}`);
    if(options.onIssue)options.onIssue(issue);
    else console.warn(`[door-sign] ${id}: ${issue.reason}; sign omitted`);
    return undefined;
  }
}

function buildSignWallStrict(id: string, door: SignDoor, polygon: Point2[], frame: Matrix4, scale: number): SignWall {
  const override = SIGN_MOUNT_OVERRIDES[id];
  if(override !== undefined && (!Number.isInteger(override) || override < 0 || override >= polygon.length)) {
    throw new Error(`Invalid effectiveRooms override edge index ${override} for portal ${id} (${polygon.length} vertices)`);
  }
  const normal = doorSignNormal(door), right = new Vector3(normal.z, 0, -normal.x);
  const edges = polygon.map((a, i) => ({ a: new Vector3(a[0],door.position.y,a[1]).applyMatrix4(frame), b: new Vector3(polygon[(i+1)%polygon.length][0],door.position.y,polygon[(i+1)%polygon.length][1]).applyMatrix4(frame), halfThickness: .08 * scale }));
  const candidates = edges.map((edge, index) => {
    const t = edge.b.clone().sub(edge.a), length = t.length(); t.normalize();
    const along = door.position.clone().sub(edge.a).dot(t);
    const closest = edge.a.clone().addScaledVector(t, Math.max(0,Math.min(length,along)));
    return { edge,index,t,length,along,distance:closest.distanceTo(door.position) };
  }).filter(e => e.length >= .07 * scale).sort((a,b) => a.distance-b.distance || a.index-b.index);
  const trusted = candidates.find(e => e.distance < .8 && e.length >= DOOR_SIGN_WIDTH && Math.abs(e.t.dot(right)) >= Math.cos(Math.PI/180));
  const support = override === undefined ? trusted : candidates.find(e => e.index === override);
  if (override !== undefined && (!support || !Number.isFinite(support.distance) || support.distance >= .8)) {
    throw new Error(`Invalid effectiveRooms override edge index ${override} for portal ${id}: edge is degenerate or no longer near the door`);
  }
  if (!support) throw new Error(`Door sign mount needs explicit audit override: ${id}`);
  const anchor = door.position.clone();
  if (override === undefined) {
    const half = DOOR_SIGN_WIDTH / 2;
    anchor.copy(support.edge.a).addScaledVector(support.t, Math.max(half,Math.min(support.length-half,support.along)));
  }
  // Include adjacent traced fragments in the same local door band, but never the opposite room wall.
  const nearby = candidates.filter(e => e.distance < .8 || e.index === support.index).map(e => e.edge);
  const points = nearby.flatMap(e => wallBandPoints(e,anchor,right));
  if (!points.length) throw new Error(`Empty door sign wall band: ${id}`);
  const outer = Math.max(...points.map(p => p.clone().sub(anchor).dot(normal)));
  return { anchor, surface:anchor.clone().addScaledVector(normal,outer), edges:nearby,
    override:override === undefined ? undefined : `${id}: effective wall edge ${override}; traced/oblique fragments, outer wall envelope` };
}

/** Pure pose: portal normal axis, public-side sign, projected outer wall + 3 cm, upright. */
export function doorSignPose(door: SignDoor, wall?: SignWall) {
  // Missing mounts deliberately hide their signs; never use an unverified wall or crash the render loop.
  if (!wall) return undefined;
  let normal: Vector3;
  try { normal = doorSignNormal(door); } catch { return undefined; }
  const position = wall.anchor.clone().addScaledVector(normal,wall.surface.clone().sub(wall.anchor).dot(normal)+DOOR_SIGN_GAP);
  position.y = door.position.y + 2.55;
  const quaternion = new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.atan2(normal.x,normal.z));
  return { position, quaternion, normal };
}

/** Read the same effective room/portal ownership as buildWalkWorld without changing its
 * navmesh-hashed source, geometry, collision or destinations. Mount metadata belongs to signs. */
export function buildDoorSignWalls(world: WalkWorld, buildings: WalkBuilding[], structure: CampusStructure, options: SignMountOptions = {}): Map<string,SignWall> {
  const issues=new Map<string,SignMountIssue>();
  const attempted=new Set<string>();
  const mounts=new Map<string,SignWall>();
  const doors=new Map(world.doors.map(d=>[d.id,d]));
  for(const b of buildings) for(const f of b.floors) for(const room of effectiveRooms(f,structure)) {
    const p=room.polygon;
    if(!['room','room-candidate'].includes(room.kind) || p.length<3)continue;
    const area=Math.abs(p.reduce((sum,a,i)=>{const q=p[(i+1)%p.length];return sum+a[0]*q[1]-q[0]*a[1];},0)/2);
    if(area<1.6)continue;
    const portals=f.access?.portals.filter(portal=>portal.roomIds.includes(room.id))??[];
    for(const id of portals.length?portals.map(p=>p.id):[room.id]) {
      const d=doors.get(id);if(!d || attempted.has(id))continue;
      attempted.add(id);
      const wall=buildSignWall(id,d,p,world.frames.get(b.id)!,world.scales.get(b.id)!,{onIssue:issue=>issues.set(id,issue)});
      if(wall)mounts.set(id,wall);
    }
  }
  for(const d of world.doors) if(!mounts.has(d.id) && !issues.has(d.id)) {
    issues.set(d.id,{portalId:d.id,reason:'No eligible effectiveRooms mounting polygon'});
  }
  if(issues.size) {
    const message=`[door-sign] ${issues.size} sign(s) omitted:\n`+[...issues.values()].map(i=>`${i.portalId}: ${i.reason}`).join('\n');
    if(options.strict)throw new Error(message);
    if(options.onIssue)for(const issue of issues.values())options.onIssue(issue);
    else console.warn(message);
  }
  return mounts;
}
