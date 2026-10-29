#!/usr/bin/env python3
"""Paint the campus-map base image from the DEM: paper land, hillshade, forest tint on 壽山, sea and shoreline.
Output public/data/campus-map-base.webp plus its world bounds (consumed by tools/build_campus_map.ts).
Run: python3 tools/build_map_base.py"""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
meta = json.loads((ROOT / 'public/data/terrain/terrain.json').read_text())
h = np.fromfile(ROOT / 'public/data/terrain/terrain.bin', dtype='<f4').reshape(meta['rows'], meta['cols'])
ox, oz, cell = meta['origin'][0], meta['origin'][1], meta['cell']
# Map window (world x0, z0, x1, z1) and resolution.
X0, Z0, X1, Z1, PPM = -900.0, -1100.0, 900.0, 700.0, 1.2
W, H = int((X1 - X0) * PPM), int((Z1 - Z0) * PPM)
xs = X0 + (np.arange(W) + .5) / PPM; zs = Z0 + (np.arange(H) + .5) / PPM
fx = np.clip((xs - ox) / cell, 0, meta['cols'] - 1.001); fz = np.clip((zs - oz) / cell, 0, meta['rows'] - 1.001)
i0 = fx.astype(int); j0 = fz.astype(int); u = fx - i0; v = fz - j0
a = h[np.ix_(j0, i0)]; b = h[np.ix_(j0, i0 + 1)]; c = h[np.ix_(j0 + 1, i0)]; d = h[np.ix_(j0 + 1, i0 + 1)]
U, V = np.meshgrid(u, v)
z = (a * (1 - U) + b * U) * (1 - V) + (c * (1 - U) + d * U) * V
# Hillshade (sun from the north-west, 45°).
gy, gx = np.gradient(z, 1 / PPM)
slope = np.arctan(np.hypot(gx, gy) * 1.6); aspect = np.arctan2(-gx, gy)
az, alt = np.radians(315), np.radians(45)
shade = np.clip(np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect), 0, 1)
sea = z <= meta['seaLevel'] + .05
paper = np.array([246, 239, 221], float); forest = np.array([168, 201, 140], float); forest_hi = np.array([120, 170, 110], float)
t = np.clip((z - 2) / 25, 0, 1)[..., None]; t2 = np.clip((z - 60) / 120, 0, 1)[..., None]
land = paper * (1 - t) + forest * t
land = land * (1 - t2) + forest_hi * t2
land = land * (.72 + .36 * shade[..., None])
# Contour lines every 10 m on the hill.
contour = (np.abs(((z + 1000) % 10) - 5) > 4.6) & (z > 4)
land[contour] *= .9
shallow = np.array([173, 219, 222], float); deep = np.array([140, 199, 208], float)
depth = np.clip(-(z - meta['seaLevel']) / 1.5, 0, 1)[..., None]
water = shallow * (1 - depth) + deep * depth
img = np.where(sea[..., None], water, land).clip(0, 255).astype(np.uint8)
im = Image.fromarray(img, 'RGB')
# Shoreline ink.
edge = Image.fromarray((sea * 255).astype(np.uint8)).filter(ImageFilter.FIND_EDGES).filter(ImageFilter.MaxFilter(3))
ink = Image.new('RGB', im.size, (44, 127, 145))
im.paste(ink, mask=edge)
out = ROOT / 'public/data/campus-map-base.webp'
im.save(out, 'WEBP', quality=82, method=6)
(ROOT / 'public/data/campus-map-base.json').write_text(json.dumps({'url': 'data/campus-map-base.webp', 'bounds': [X0, Z0, X1, Z1], 'source': 'public/data/terrain (MOI 20 m DTM)', 'pixelsPerMetre': PPM}) + '\n')
print(json.dumps({'size': im.size, 'bytes': out.stat().st_size}))
