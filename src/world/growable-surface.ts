import { Box3, Vector3, type Object3D } from 'three';

export interface SoilSurface {
  id: string;
  height: number;
  normal: Vector3;
  kind: 'terrain';
  layer: 'ground';
}
export interface SoilSource {
  readonly surfaceVersion: string;
  surfaceAt(x: number, z: number): SoilSurface | undefined;
}
export interface GrassRoad { points: [number, number][]; width: number; tunnel?: boolean }
type Segment = { ax: number; az: number; bx: number; bz: number; half: number };
const GRID = 32;
// Half-width/height of the three crossed cards, plus the shader's largest (sunset) wind.
export const GRASS_ENVELOPE = Math.hypot(.32, .32) + Math.SQRT2 * .05 * 1.4;
const offsets = [[0, 0], [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
/** buildWalkWorld batches collision meshes and removes their names. Use the retained
 * semantic display groups, never a bounding box around the whole collider batch. */
export function campusVegetationVolumes(display: Object3D, buildingIds: Iterable<string>): Box3[] {
  const ids = new Set(buildingIds); display.updateMatrixWorld(true);
  return display.children.filter(o => ids.has(o.name) || /^(Campus exterior |Join )/.test(o.name)).map(o => {
    const box = new Box3().setFromObject(o); box.min.y = -Infinity; return box;
  });
}
const key = (x: number, z: number) => `${Math.floor(x / GRID)},${Math.floor(z / GRID)}`;
function cells(box: Box3, visit: (key: string) => void) {
  for (let z = Math.floor(box.min.z / GRID); z <= Math.floor(box.max.z / GRID); z++)
    for (let x = Math.floor(box.min.x / GRID); x <= Math.floor(box.max.x / GRID); x++) visit(`${x},${z}`);
}
function distance(x: number, z: number, s: Segment) {
  const dx = s.bx - s.ax, dz = s.bz - s.az, t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - s.ax - t * dx, z - s.az - t * dz);
}

/** Select soil explicitly. A roof or a tunnel floor can never become soil just because it
 * happens to be the highest collider at an x/z coordinate. */
export class GrowableSurfaceField {
  ready = false;
  revision = 0;
  private volumes = new Map<string, Box3[]>();
  private volumeIndex = new Map<string, Box3[]>();
  private roadIndex = new Map<string, Segment[]>();
  constructor(private source: SoilSource, private mask: { free(x: number, z: number): boolean }) {}
  get surfaceVersion() { return this.source.surfaceVersion; }
  setReady(ready: boolean) { if (this.ready !== ready) { this.ready = ready; this.revision++; } }
  setRoads(roads: GrassRoad[]) {
    this.roadIndex.clear();
    for (const road of roads) {
      // A tunnel centreline is not a surface at DEM height; the bore gets a 3-D exclusion.
      if (road.tunnel) continue;
      for (let i = 1; i < road.points.length; i++) {
        const [ax, az] = road.points[i - 1], [bx, bz] = road.points[i], half = road.width / 2;
        const segment = { ax, az, bx, bz, half }, margin = half + GRASS_ENVELOPE * 1.6;
        cells(new Box3(new Vector3(Math.min(ax, bx) - margin, 0, Math.min(az, bz) - margin), new Vector3(Math.max(ax, bx) + margin, 0, Math.max(az, bz) + margin)), k => {
          const a = this.roadIndex.get(k) ?? []; a.push(segment); this.roadIndex.set(k, a);
        });
      }
    }
    this.revision++;
  }
  /** World-space closed volumes include enclosed air, not just wall triangles. */
  setVolumes(owner: string, boxes: Box3[]) {
    this.volumes.set(owner, boxes.filter(b => !b.isEmpty()).map(b => b.clone()));
    this.volumeIndex.clear();
    for (const group of this.volumes.values()) for (const box of group) {
      const expanded = box.clone().expandByScalar(GRASS_ENVELOPE * 1.6);
      cells(expanded, k => { const a = this.volumeIndex.get(k) ?? []; a.push(box); this.volumeIndex.set(k, a); });
    }
    this.revision++;
  }
  sample(x: number, z: number, scale: number): SoilSurface | undefined {
    if (!this.ready || !this.mask.free(x, z)) return undefined;
    const surface = this.source.surfaceAt(x, z);
    if (!surface || !Number.isFinite(surface.height) || surface.normal.y < .5) return undefined;
    const radius = GRASS_ENVELOPE * scale;
    if ((this.roadIndex.get(key(x, z)) ?? []).some(s => distance(x, z, s) <= s.half + radius)) return undefined;
    // The envelope includes card width, slope rotation and maximum shader wind. Check
    // its soil neighbourhood too, so blades cannot extend over a carved terrain cell.
    for (const [dx, dz] of offsets) {
      const px = x + dx * radius, pz = z + dz * radius;
      if (!this.mask.free(px, pz) || !this.source.surfaceAt(px, pz)) return undefined;
    }
    const envelope = new Box3(new Vector3(x - radius, surface.height - radius, z - radius), new Vector3(x + radius, surface.height + radius, z + radius));
    if ((this.volumeIndex.get(key(x, z)) ?? []).some(box => box.intersectsBox(envelope))) return undefined;
    return surface;
  }
}
