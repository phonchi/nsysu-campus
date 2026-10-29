import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {withGateMapBuilding} from '../src/map/map-landmarks';
const data=JSON.parse(readFileSync('public/data/campus-map.json','utf8'));
it('adds one searchable/selectable real stele footprint without changing source map data',()=>{
 const before=JSON.stringify(data),map=withGateMapBuilding(data),g=map.buildings.filter((b:{id:string})=>b.id==='GATE');
 expect(g).toHaveLength(1);expect(g[0].name).toContain('校碑');expect(g[0].kind).toBe('scenic');expect(g[0].walkable).toBe(false);
 const p=g[0].polygon;expect(p.reduce((v:number,q:number[])=>v+q[0]/4,0)).toBeCloseTo(-91.7);expect(p.reduce((v:number,q:number[])=>v+q[1]/4,0)).toBeCloseTo(596.2);
 expect(JSON.stringify(data)).toBe(before);expect(withGateMapBuilding(map)).toBe(map);
});
it('transforms the collision-base footprint using the same placement yaw',()=>{
 const map=withGateMapBuilding({buildings:[],landmarks:{gate:{centroid:[10,20] as [number,number],yaw:Math.PI/2}}});const p=map.buildings[0].polygon;
 expect(p.reduce((v,q)=>v+q[0]/4,0)).toBeCloseTo(10);expect(p.reduce((v,q)=>v+q[1]/4,0)).toBeCloseTo(27.5);
});
