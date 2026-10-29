/** Enrich only the in-memory map catalog; retain the published source data and hashes. */
import gateCollision from '../../public/models/landmarks/gate.collision.json';
export type MapPoint = [number,number];
export interface MapBuilding {id:string;name:string;kind:string;walkable:boolean;polygon:MapPoint[];storeys?:number}
interface GateMapData {buildings:MapBuilding[];landmarks?:Record<string,{centroid:MapPoint;yaw?:number}>}
export function withGateMapBuilding<T extends GateMapData>(data:T):Omit<T,'buildings'> & {buildings:MapBuilding[]} {
  const gate=data.landmarks?.gate;
  if(data.buildings.some(b=>b.id==='GATE')||!gate||!Array.isArray(gate.centroid))return data;
  const tower=gateCollision.boxes.reduce((a,b)=>b.size[1]>a.size[1]?b:a);
  const base=gateCollision.boxes.find(b=>b.walkable&&Math.abs(b.center[0]-tower.center[0])<.01&&Math.abs(b.center[2]-tower.center[2])<.01);
  if(!base)return data;
  const yaw=gate.yaw??0,c=Math.cos(yaw),s=Math.sin(yaw),a=yaw+base.yaw,ca=Math.cos(a),sa=Math.sin(a);
  const x=gate.centroid[0]+base.center[0]*c+base.center[2]*s,z=gate.centroid[1]-base.center[0]*s+base.center[2]*c;
  const polygon:MapPoint[]=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sz])=>{const dx=sx*base.size[0]/2,dz=sz*base.size[2]/2;return[x+dx*ca+dz*sa,z-dx*sa+dz*ca];});
  return {...data,buildings:[...data.buildings,{id:'GATE',name:'校門・校碑',kind:'scenic',walkable:false,polygon}]};
}
