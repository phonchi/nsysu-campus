/** Enrich only the in-memory map catalog; retain the published source data and hashes. */
import gateCollision from '../../public/models/landmarks/gate.collision.json';
export type MapPoint = [number,number];
export interface HamasenPoi {
  position: MapPoint;
  approach: [number, number, number];
  labelHeight: number;
  street: string;
  buildingIds: string[];
}
export interface HamasenPlace {
  name: string;
  kind: 'landmark' | 'shop';
  category: string;
  poi: HamasenPoi;
}
export interface HamasenMapPlace extends HamasenPlace { id: string }
export const HAMASEN_MAP_ALIASES: Readonly<Record<string, string>> = {
  'hamasen-exit-1': 'hamasen-poi-mrt-hamasen-exit-1',
  'hamasen-exit-2': 'hamasen-poi-mrt-hamasen-exit-2',
  'hamasen-rail-park': 'hamasen-poi-takao-railway-museum',
};
export const SHOP_MAP_SCALE = 1;
export const hamasenKindLabel = (kind: HamasenPlace['kind']) => kind === 'shop' ? '店家' : '地標';
export function hamasenCardCategory(kind: HamasenPlace['kind'], category: string) {
  const label = hamasenKindLabel(kind);
  return category.startsWith(label + '・') ? category : `${label}・${category}`;
}
const POI_STYLES: Record<string, { color: string; glyph: string }> = {
  '交通・捷運': { color: '#ae4d18', glyph: '捷' },
  '交通・輕軌': { color: '#376436', glyph: '輕' },
  '交通・渡輪': { color: '#215b94', glyph: '渡' },
  早餐: { color: '#a05017', glyph: '早' },
  正餐: { color: '#a54034', glyph: '餐' },
  冰品甜點: { color: '#775295', glyph: '冰' },
  飲料: { color: '#207269', glyph: '飲' },
  宵夜: { color: '#41456e', glyph: '宵' },
};
export const hamasenMarkerStyle = (category: string) => POI_STYLES[category] ?? { color: '#2c7f91', glyph: '地' };
export interface MapBuilding {id:string;name:string;kind:string;walkable:boolean;polygon:MapPoint[];holes?:MapPoint[][];storeys?:number}
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
