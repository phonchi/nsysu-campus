import * as T from 'three';
import {surfaceCutters,subtractSurfacePolygon,type SurfaceVertex} from './road-surface';

type Point2 = [number, number];
export interface TerrainSurface { id:string; height:number; normal:T.Vector3; kind:'terrain'; layer:'ground' }
export interface TerrainMeta { origin: Point2; cell: number; cols: number; rows: number; minY: number; maxY: number; seaLevel: number; sha256?: string; pad?: { buffer_m: number; spawn: Point2; spawnRadius: number } }

/** Ground is 5.5 cm below the walkable floors' zero; the DEM pad is at 0, so shift it to meet the ground plane. */
export const GROUND_Y = -.055;
/** Collision/navigation extent; the display grid covers the whole DEM. */
export const PLAY_BOUNDS: [number, number, number, number] = [-700, -1060, 460, 700];

/** MOI 20 m DTM resampled to a 4 m grid by tools/build_terrain.py (public/data/terrain/). Shared by render, Rapier and Recast. */
export class Terrain {
  /** Polygons where the grid is cut away (tunnel mouth); walkable landmark geometry fills them. */
  carves: Point2[][] = [];
  constructor(readonly meta: TerrainMeta, readonly heights: Float32Array) {
    if (heights.length !== meta.cols * meta.rows) throw new Error(`terrain: ${heights.length} heights for ${meta.cols}x${meta.rows}`);
  }

  static async load(asset: (p: string) => string) {
    const [meta, bin] = await Promise.all([
      fetch(asset('data/terrain/terrain.json')).then(r => { if (!r.ok) throw Error('地形資料尚未就緒'); return r.json() as Promise<TerrainMeta>; }),
      fetch(asset('data/terrain/terrain.bin')).then(r => { if (!r.ok) throw Error('地形資料尚未就緒'); return r.arrayBuffer(); }),
    ]);
    return new Terrain(meta, new Float32Array(bin));
  }

  get seaLevel() { return this.meta.seaLevel + GROUND_Y; }

  /** Revision shared by terrain queries, road overlays and navigation provenance. */
  private heightDigest?: string;
  get surfaceVersion() {
    if(!this.heightDigest){let h=2166136261;for(const byte of new Uint8Array(this.heights.buffer,this.heights.byteOffset,this.heights.byteLength)){h=Math.imul(h^byte,16777619);}this.heightDigest=(h>>>0).toString(16);}
    let holes=2166136261;for(const ch of JSON.stringify({clipping:'exact-triangle-polygons-v1',grid:[this.meta.origin,this.meta.cell,this.meta.cols,this.meta.rows],carves:this.carves}))holes=Math.imul(holes^ch.charCodeAt(0),16777619);
    return `terrain-triangles-v2:${this.heightDigest}:${(holes>>>0).toString(16)}`;
  }

  private cellAt(x: number, z: number) {
    const { origin, cell, cols, rows } = this.meta;
    const fx = T.MathUtils.clamp((x-origin[0])/cell,0,cols-1.000001), fz = T.MathUtils.clamp((z-origin[1])/cell,0,rows-1.000001);
    return {i:Math.floor(fx),j:Math.floor(fz),u:fx-Math.floor(fx),v:fz-Math.floor(fz)};
  }
  /** The exact vertex used by mesh(), including the flat-pad seam rule. */
  vertexHeight(i:number,j:number) {
    const x=this.meta.origin[0]+i*this.meta.cell,z=this.meta.origin[1]+j*this.meta.cell;
    const [x0,z0,x1,z1]=this.pad, h=this.heights[j*this.meta.cols+i];
    return (x>=x0&&x<=x1&&z>=z0&&z<=z1?Math.max(0,h):h)+GROUND_Y;
  }
  /** Underlying 4 m terrain triangles, even below a carved landmark. This is not a support query. */
  heightAt(x:number,z:number) {
    const {i,j,u,v}=this.cellAt(x,z),a=this.vertexHeight(i,j),b=this.vertexHeight(i+1,j),c=this.vertexHeight(i,j+1),d=this.vertexHeight(i+1,j+1);
    return u+v<=1?a*(1-u-v)+b*u+c*v:b*(1-v)+c*(1-u)+d*(u+v-1);
  }
  surfaceAt(x:number,z:number):TerrainSurface|undefined {
    const {origin,cell,cols,rows}=this.meta;
    if(!Number.isFinite(x)||!Number.isFinite(z)||x<origin[0]||z<origin[1]||x>origin[0]+cell*(cols-1)||z>origin[1]+cell*(rows-1))return;
    const {i,j,u,v}=this.cellAt(x,z);if(this.carves.some(p=>inPolygon([x,z],p)))return;
    const a=this.vertexHeight(i,j),b=this.vertexHeight(i+1,j),c=this.vertexHeight(i,j+1),d=this.vertexHeight(i+1,j+1);
    const dx=u+v<=1?(b-a)/cell:(d-c)/cell,dz=u+v<=1?(c-a)/cell:(d-b)/cell;
    return {id:`terrain:${i}:${j}:${u+v<=1?0:1}`,height:this.heightAt(x,z),normal:new T.Vector3(-dx,1,-dz).normalize(),kind:'terrain',layer:'ground'};
  }

  private padBox?: [number, number, number, number];
  private get pad() { return this.padBox ??= this.padBounds(); }

  /** Bounding box of the exactly-flat pad cells (DEM height 0), in world x/z. */
  padBounds(): [number, number, number, number] {
    const { origin, cell, cols, rows } = this.meta; let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (this.heights[j * cols + i] === 0) {
      const x = origin[0] + i * cell, z = origin[1] + j * cell;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    return [x0, z0, x1, z1];
  }

  /** Lowest terrain under a footprint (for seating buildings on slopes). */
  minUnder(poly: Point2[]) { let m = Infinity; for (const [x, z] of poly) m = Math.min(m, this.heightAt(x, z)); return m; }
  maxUnder(poly: Point2[]) { let m = -Infinity; for (const [x, z] of poly) m = Math.max(m, this.heightAt(x, z)); return m; }

  /** Grid mesh for [x0,z0]-[x1,z1], skipping cells entirely inside `exclude` (the flat pad keeps its precise ground). */
  mesh(bounds: [number, number, number, number], exclude?: (x: number, z: number) => boolean, step = 1) {
    const { origin, cell, cols, rows } = this.meta, c = cell * step;
    const i0 = Math.max(0, Math.floor((bounds[0] - origin[0]) / cell)), i1 = Math.min(cols - 1, Math.ceil((bounds[2] - origin[0]) / cell));
    const j0 = Math.max(0, Math.floor((bounds[1] - origin[1]) / cell)), j1 = Math.min(rows - 1, Math.ceil((bounds[3] - origin[1]) / cell));
    const pos: number[] = [], idx: number[] = [], vid = new Map<number, number>(),cutters=surfaceCutters(this.carves);
    const vert = (i: number, j: number) => {
      const k = j * cols + i; let n = vid.get(k);
      if (n === undefined) {
        n = pos.length / 3; vid.set(k, n);
        const x = origin[0] + i * cell, z = origin[1] + j * cell;
        // Inside the flat pad's box the DEM never dips below the ground plane (no millimetre hollows at the seam).
        pos.push(x, this.vertexHeight(i,j), z);
      }
      return n;
    };
    for (let j = j0; j + step <= j1; j += step) for (let i = i0; i + step <= i1; i += step) {
      const x = origin[0] + i * cell, z = origin[1] + j * cell;
      if (exclude && exclude(x, z) && exclude(x + c, z) && exclude(x, z + c) && exclude(x + c, z + c)) continue;
      const a = vert(i, j), b = vert(i + step, j), d = vert(i, j + step), e = vert(i + step, j + step);
      const relevant=cutters.filter(cut=>cut.bounds[0]<x+c&&cut.bounds[2]>x&&cut.bounds[1]<z+c&&cut.bounds[3]>z);
      if(!relevant.length){idx.push(a,d,b,b,d,e);continue;}
      // Keep the original terrain plane outside each exact opening. Whole-cell removal
      // would create unsupported shoulders outside the narrower replacement tunnel floor.
      const point=(n:number):SurfaceVertex=>({x:pos[n*3],y:pos[n*3+1],z:pos[n*3+2],u:0,v:0});
      for(const triangle of [[a,d,b],[b,d,e]]){
        let pieces=[triangle.map(point)];for(const cutter of relevant){pieces=pieces.flatMap(p=>subtractSurfacePolygon(p,cutter));if(!pieces.length)break;}
        for(const polygon of pieces)for(let k=1;k<polygon.length-1;k++){
          const tri=[polygon[0],polygon[k],polygon[k+1]];
          if(Math.abs((tri[1].x-tri[0].x)*(tri[2].z-tri[0].z)-(tri[1].z-tri[0].z)*(tri[2].x-tri[0].x))<1e-8)continue;
          for(const p of tri){idx.push(pos.length/3);pos.push(p.x,p.y!,p.z);}
        }
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); g.userData.surfaceVersion=this.surfaceVersion;
    return g;
  }
}

/** Pad polygon: convex hull of the walkable footprints grown by `buffer` metres, matching build_terrain.py's flat pad. */
export function padPolygon(footprints: Point2[][], buffer: number): Point2[] {
  const pts: Point2[] = [];
  for (const f of footprints) for (const [x, z] of f) for (let k = 0; k < 8; k++) pts.push([x + Math.cos(k * Math.PI / 4) * buffer, z + Math.sin(k * Math.PI / 4) * buffer]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point2, a: Point2, b: Point2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point2[] = [], upper: Point2[] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export const inPolygon = (p: Point2, poly: Point2[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};
