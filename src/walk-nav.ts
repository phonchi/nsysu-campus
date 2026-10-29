import { Vector3 } from 'three';
import type { WalkBuilding } from './walk-types';
export const WALK_BUILDING_IDS = ['SC','EN','BI','PH','CH','EC','MS','EV'] as const;
export type WalkNavScope = 'prototype-SC-1F-2F' | 'campus-science-engineering-v2';
import { init, importNavMesh, NavMesh, NavMeshQuery, Detour } from 'recast-navigation';

/** Queries a pre-baked virtual walkthrough mesh; never upgrades verified-map evidence. */
export class WalkNavigation {
  private readonly query: NavMeshQuery;
  private disposed = false;
  private readonly reversibleSurface: boolean;
  /** Maximum projection from a requested footpoint, in model units. */
  readonly projection = { horizontal: .45, vertical: .32 };
  constructor(private readonly mesh: NavMesh) {
    this.query = new NavMeshQuery(mesh, { maxNodes: 65535 });
    let offMesh=false;
    for(let i=0;i<mesh.getMaxTiles();i++)if((mesh.getTile(i).header()?.offMeshConCount()??0)>0){offMesh=true;break;}
    this.reversibleSurface=!offMesh;
  }
  findPath(from: Vector3, to: Vector3): Vector3[] {
    if (this.disposed || ![...from.toArray(), ...to.toArray()].every(Number.isFinite)) return [];
    const halfExtents = { x: this.projection.horizontal, y: this.projection.vertical, z: this.projection.horizontal };
    const project = (p: Vector3) => {
      const r = this.query.findClosestPoint(p, { halfExtents });
      if (!r.success || !r.polyRef || Math.hypot(r.point.x-p.x,r.point.z-p.z)>this.projection.horizontal ||
          Math.abs(r.point.y-p.y)>this.projection.vertical) return undefined;
      return r;
    };
    const a=project(from), b=project(to);
    if (!a || !b) return [];
    const forbidden=Detour.DT_PARTIAL_RESULT|Detour.DT_BUFFER_TOO_SMALL|Detour.DT_OUT_OF_NODES;
    const search=(fromRef:number,toRef:number,start:typeof a.point,end:typeof b.point)=>{
      const result=this.query.findPath(fromRef,toRef,start,end,{maxPathPolys:4096});
      try{
        const refs=Array.from({length:result.polys.size},(_,i)=>result.polys.get(i));
        return {status:result.status,complete:result.success&&!(result.status&forbidden)&&refs[0]===fromRef&&refs.at(-1)===toRef,refs};
      }finally{result.polys.destroy();}
    };
    const forward=search(a.polyRef,b.polyRef,a.point,b.point);
    let refs=forward.refs;
    if(!forward.complete){
      // Retry only resource exhaustion, never promote an ordinary partial path.
      // No one-way/off-mesh links may be reversed, even if a reverse path exists.
      if(!(forward.status&Detour.DT_OUT_OF_NODES)||!this.reversibleSurface)return [];
      const reverse=search(b.polyRef,a.polyRef,b.point,a.point);
      if(!reverse.complete)return [];
      refs=reverse.refs.reverse();
      // Validate actual directed links in the requested direction. Do not rely
      // on an assumption that all surface polygons have reciprocal links.
      for(let i=0;i<refs.length-1;i++){
        const part=this.mesh.getTileAndPolyByRef(refs[i]);if(!part.success)return [];
        let link=part.poly.firstLink(),found=false,remaining=part.tile.header()?.maxLinkCount()??0;
        while(link!==Detour.DT_NULL_LINK&&remaining-->0){
          const edge=part.tile.links(link);if(edge.ref()===refs[i+1]){found=true;break;}link=edge.next();
        }
        if(!found)return [];
      }
    }
    if(refs[0]!==a.polyRef||refs.at(-1)!==b.polyRef)return [];
    // Funnel the already validated corridor in the requested direction. Calling
    // computePath here would repeat the same potentially exhausted global A*.
    const straight=this.query.findStraightPath(a.point,b.point,refs,{maxStraightPathPoints:4096});
    try{
      if(!straight.success||straight.status&forbidden||!straight.straightPathCount)return [];
      const points=Array.from({length:straight.straightPathCount},(_,i)=>new Vector3(straight.straightPath.get(i*3),straight.straightPath.get(i*3+1),straight.straightPath.get(i*3+2)));
      if(points[0].distanceTo(new Vector3(a.point.x,a.point.y,a.point.z))>.025||points.at(-1)!.distanceTo(new Vector3(b.point.x,b.point.y,b.point.z))>.025)return [];
      return points;
    }finally{
      straight.straightPath.destroy();straight.straightPathFlags.destroy();straight.straightPathRefs.destroy();
    }
  }

  dispose(): void { if(!this.disposed){this.disposed=true;this.query.destroy();this.mesh.destroy();} }
}

/** base is the application base URL, e.g. import.meta.env.BASE_URL. */
export async function loadWalkNavigation(base: string, expectedScope?: WalkNavScope, expectedSurfaceVersion?: string): Promise<WalkNavigation> {
  const prefix=base.replace(/\/?$/, '/');
  const [metaResponse,binaryResponse]=await Promise.all([
    fetch(`${prefix}data/walkthrough/navmesh-runtime.json`),
    fetch(`${prefix}data/walkthrough/navmesh.bin`),
  ]);
  if(!metaResponse.ok||!binaryResponse.ok)throw new Error('Walkthrough navigation assets unavailable');
  const meta=await metaResponse.json();
  if(meta.status!=='ready'||!['prototype-SC-1F-2F','campus-science-engineering-v2'].includes(meta.scope)||
    (expectedScope && meta.scope!==expectedScope))throw new Error('Walkthrough navigation bake scope is not ready');
  if(typeof meta.surfaceVersion!=='string'||!(/^(terrain-triangles-v[12]:|flat-ground-v1$)/.test(meta.surfaceVersion))||(expectedSurfaceVersion!==undefined&&meta.surfaceVersion!==expectedSurfaceVersion))throw new Error('Walkthrough navigation surface version mismatch');
  const binary=new Uint8Array(await binaryResponse.arrayBuffer());
  if(binary.byteLength!==meta.binaryBytes)throw new Error('Walkthrough navigation length mismatch');
  const digest=await crypto.subtle.digest('SHA-256',binary);
  const hex=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
  if(hex!==meta.binarySha256)throw new Error('Walkthrough navigation checksum mismatch');
  await init();
  return new WalkNavigation(importNavMesh(binary).navMesh);
}

/** Fetch all eight buildings declared by the local index. No runtime geometry bake. */
export async function loadWalkBuildings(base: string): Promise<WalkBuilding[]> {
  const prefix=base.replace(/\/?$/, '/');
  const response=await fetch(`${prefix}data/walkthrough/index.json`);
  if(!response.ok)throw new Error(`Walkthrough index: ${response.status}`);
  const index=await response.json() as {buildings?:{id:string;url:string}[]};
  const rows=index.buildings;
  if(!Array.isArray(rows)||rows.length!==WALK_BUILDING_IDS.length||
    new Set(rows.map(b=>b.id)).size!==WALK_BUILDING_IDS.length||
    WALK_BUILDING_IDS.some(id=>!rows.some(b=>b.id===id)))throw new Error('Walkthrough index must declare all eight buildings exactly once');
  return Promise.all(WALK_BUILDING_IDS.map(async id=>{
    const entry=rows.find(b=>b.id===id)!;
    if(entry.url!==`/data/walkthrough/${id}.json`&&entry.url!==`data/walkthrough/${id}.json`)throw new Error(`Unexpected local asset URL: ${id}`);
    const res=await fetch(`${prefix}${entry.url.replace(/^\//,'')}`);
    if(!res.ok)throw new Error(`Walkthrough ${id}: ${res.status}`);
    const data=await res.json() as WalkBuilding;
    if(data.id!==id||!Array.isArray(data.floors)||!data.floors.length)throw new Error(`Invalid walkthrough building: ${id}`);
    return data;
  }));
}
