import fs from 'node:fs';
import { Terrain, type TerrainMeta } from '../src/world/terrain';

/** The shipped DEM, read from disk for node-side tests and tools. */
export function loadTerrain(dir = 'public/data/terrain') {
  const meta = JSON.parse(fs.readFileSync(`${dir}/terrain.json`, 'utf8')) as TerrainMeta;
  const buf = fs.readFileSync(`${dir}/terrain.bin`);
  return new Terrain(meta, new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
}
