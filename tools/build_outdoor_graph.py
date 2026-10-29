#!/usr/bin/env python3
"""Outdoor walk graph from OSM highways, heights from the T3 terrain.

Nodes are OSM vertices (densified to <= MAX_SEG m) merged within MERGE m; the
graph keeps the connected component that reaches the spawn. Tunnel ways get a
linear grade between their portal heights (the terrain above is the hill).
Anchors: chapter targets plus every context landmark (nearest component node
to its footprint edge). Output: public/data/walkthrough/outdoor-graph.json.
"""
from __future__ import annotations
import argparse, collections, hashlib, json, math, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import numpy as np
from scipy.spatial import cKDTree
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from shapely.geometry import Polygon, Point, LineString
import build_campus_structure as B

ROOT = pathlib.Path(__file__).resolve().parents[1]
OSM = ROOT/'data/sources/osm/osm-nsysu.json'
STRUCT = ROOT/'public/data/walkthrough/campus-structure.json'
TERRAIN = ROOT/'public/data/terrain'
CORR = ROOT/'artifacts/v3/T3/corrections.json'
OUT = ROOT/'public/data/walkthrough/outdoor-graph.json'
KINDS = {'footway', 'path', 'steps', 'service', 'residential', 'unclassified', 'living_street', 'pedestrian', 'tertiary', 'track', 'corridor', 'cycleway'}
MAX_SEG, MERGE, SNAP = 10.0, 1.0, 8.0
SPAWN = (-69.0, 119.0)


class Terrain:
    def __init__(self):
        m = json.loads((TERRAIN/'terrain.json').read_text()); blob = (TERRAIN/'terrain.bin').read_bytes()
        assert hashlib.sha256(blob).hexdigest() == m['sha256'], 'terrain.bin sha mismatch'
        self.m = m; self.h = np.frombuffer(blob, '<f4').reshape(m['rows'], m['cols'])

    def inside(self, x, z):
        m = self.m; return m['origin'][0] <= x <= m['origin'][0]+(m['cols']-1)*m['cell'] and m['origin'][1] <= z <= m['origin'][1]+(m['rows']-1)*m['cell']

    def y(self, x, z):
        m = self.m; c = (x-m['origin'][0])/m['cell']; r = (z-m['origin'][1])/m['cell']
        c0 = int(np.clip(math.floor(c), 0, m['cols']-2)); r0 = int(np.clip(math.floor(r), 0, m['rows']-2)); fc, fr = c-c0, r-r0; h = self.h
        return float(h[r0, c0]*(1-fc)*(1-fr)+h[r0, c0+1]*fc*(1-fr)+h[r0+1, c0]*(1-fc)*fr+h[r0+1, c0+1]*fc*fr)


def densify(pts):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = max(1, math.ceil(math.dist(a, b)/MAX_SEG))
        out += [(a[0]+(b[0]-a[0])*i/n, a[1]+(b[1]-a[1])*i/n) for i in range(1, n+1)]
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', type=pathlib.Path, default=OUT); a = ap.parse_args()
    T = Terrain(); osm = json.loads(OSM.read_text()); struct = json.loads(STRUCT.read_text())
    raw_pts, raw_y, raw_edges, raw_kind = [], [], [], []
    stats = {}
    for e in osm['elements']:
        t = e.get('tags', {}); k = t.get('highway')
        if k not in KINDS or 'geometry' not in e: continue
        pts = [B.project(g['lat'], g['lon']) for g in e['geometry']]
        if not all(T.inside(*p) for p in pts): pts = [p for p in pts if T.inside(*p)]
        if len(pts) < 2: continue
        dp = densify(pts); tunnel = t.get('tunnel') in ('yes', 'building_passage') and t.get('tunnel') == 'yes'
        if tunnel:  # straight grade between portals
            s = np.r_[0, np.cumsum([math.dist(p, q) for p, q in zip(dp, dp[1:])])]; y0, y1 = T.y(*dp[0]), T.y(*dp[-1])
            ys = list(y0+(y1-y0)*s/s[-1])
        else: ys = [T.y(*p) for p in dp]
        base = len(raw_pts); raw_pts += dp; raw_y += ys
        kind = 'tunnel' if tunnel else k
        for i in range(len(dp)-1): raw_edges.append((base+i, base+i+1)); raw_kind.append(kind)
        stats[kind] = stats.get(kind, 0)+1
    P = np.array(raw_pts); Y = np.array(raw_y)
    # Merge within MERGE m (union-find over close pairs).
    parent = np.arange(len(P))
    def find(i):
        while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for i, j in cKDTree(np.c_[P, Y]).query_pairs(MERGE):  # 3D: tunnel never fuses with paths above
        ri, rj = find(i), find(j)
        if ri != rj: parent[max(ri, rj)] = min(ri, rj)
    root = np.array([find(i) for i in range(len(P))]); uniq, inv = np.unique(root, return_inverse=True)
    NP = np.array([P[root == u].mean(0) for u in uniq]); NY = np.array([Y[root == u].max() if False else Y[root == u].mean() for u in uniq])
    edges = {}
    for (i, j), k in zip(raw_edges, raw_kind):
        u, v = int(inv[i]), int(inv[j])
        if u == v: continue
        key = (min(u, v), max(u, v))
        if key not in edges or k == 'tunnel': edges[key] = k
    n = len(NP)
    def comps():
        E = np.array(list(edges.keys())); return connected_components(coo_matrix((np.ones(len(E)), (E[:, 0], E[:, 1])), shape=(n, n)), directed=False)
    # Snap-link small OSM digitising gaps (<= SNAP m) between components.
    ncomp, lab = comps(); links = 0
    for c in range(ncomp):
        mine = np.where(lab == c)[0]; other = np.where(lab != c)[0]
        if not len(other): continue
        d, j = cKDTree(NP[other]).query(NP[mine]); i = int(np.argmin(d))
        if d[i] <= SNAP:
            u, v = int(mine[i]), int(other[j[i]]); edges[(min(u, v), max(u, v))] = 'gap-link'; links += 1
    ncomp, lab = comps(); print('gap links added', links)
    sizes = np.bincount(lab); tree = cKDTree(NP)
    _, sn = tree.query(SPAWN); keep_lab = lab[sn]
    print(f'raw vertices {len(P)} -> merged nodes {n}, edges {len(edges)}, components {ncomp}; largest {sizes.max()}, spawn component {sizes[keep_lab]} (largest: {keep_lab == sizes.argmax()})')
    print('top component sizes', sorted(sizes.tolist(), reverse=True)[:8])
    for c in np.argsort(-sizes)[1:4]:
        q = NP[lab == c]; d, j = cKDTree(NP[lab == keep_lab]).query(q); i = int(np.argmin(d))
        print(f'  dropped component {sizes[c]} nodes, bbox x {q[:, 0].min():.0f}..{q[:, 0].max():.0f} z {q[:, 1].min():.0f}..{q[:, 1].max():.0f}; closest gap {d[i]:.1f} m at {q[i].round(1)}')
    keep = np.where(lab == keep_lab)[0]; remap = {int(o): i for i, o in enumerate(keep)}
    nodes = [dict(id=i, p=[round(float(NP[o][0]), 2), round(float(NY[o]), 2), round(float(NP[o][1]), 2)]) for i, o in enumerate(keep)]
    out_edges, kinds = [], []
    for (u, v), k in edges.items():
        if u in remap and v in remap:
            pu, pv = nodes[remap[u]]['p'], nodes[remap[v]]['p']
            out_edges.append([remap[u], remap[v], round(math.dist(pu, pv), 2)]); kinds.append(k)
    KP = np.array([[nd['p'][0], nd['p'][2]] for nd in nodes]); ktree = cKDTree(KP)

    def add_anchor(name, xz, label, source):
        d, i = ktree.query(xz); i = int(i)
        nid = len(nodes); y = T.y(*xz)
        nodes.append(dict(id=nid, p=[round(xz[0], 2), round(y, 2), round(xz[1], 2)]))
        L = math.dist(nodes[nid]['p'], nodes[i]['p']); out_edges.append([nid, i, round(L, 2)]); kinds.append('anchor-link')
        anchors[name] = dict(node=nid, label=label, linkedTo=i, linkLength=round(float(d), 1), source=source)
    anchors = {}
    corr = json.loads(CORR.read_text()); miss = {m['id']: m for m in corr['missing']}
    lm = {l['id']: l for l in struct['context']['landmarks']}
    ad = Polygon(lm['AD']['polygon']); minx, minz, maxx, maxz = ad.bounds
    il = Polygon(lm['IL']['polygon'])
    add_anchor('gate', tuple(miss['GATE']['world']), '校門 大門', 'official map via local fit, snapped to OSM 蓮海路')
    add_anchor('tunnel-west', tuple(miss['TUNNEL_W']['world']), '西子灣隧道 校園端', 'OSM way 25822227')
    add_anchor('tunnel-east', tuple(miss['TUNNEL_E']['world']), '西子灣隧道 哨船街端', 'OSM way 25822227')
    add_anchor('admin', ((minx+maxx)/2, maxz+4), '行政大樓 (south facade)', 'AD footprint south edge +4 m')
    add_anchor('library', (il.centroid.x, il.bounds[3]+4), '圖資大樓', 'IL footprint south edge +4 m')
    add_anchor('arcade', SPAWN, '理工長廊 / spawn', 'spawn point')
    add_anchor('sunset', tuple(miss['SEAWALL']['world']), '海堤 sunset view', 'OSM 中山大學海堤道路 near map 海堤')
    add_anchor('beach', tuple(miss['BEACH_SAND']['world']), '西子灣沙灘', 'official map via local fit')
    for l in struct['context']['landmarks']:
        ring = LineString(Polygon(l['polygon']).exterior.coords)
        ds = [ring.distance(Point(p)) for p in KP]; i = int(np.argmin(ds))
        anchors[l['id']] = dict(node=i, label=l['name'], linkLength=round(float(ds[i]), 1), source='nearest graph node to OSM footprint edge')
    for key in ('MA', 'FA', 'LA'):
        m = miss[key]
        if 'polygon' in m:
            ring = LineString(Polygon(m['polygon']).exterior.coords); ds = [ring.distance(Point(p)) for p in KP]; i = int(np.argmin(ds))
            anchors[key] = dict(node=i, label=m['label'], linkLength=round(float(ds[i]), 1), source=m['source'])
        else:
            d, i = ktree.query(m['world']); anchors[key] = dict(node=int(i), label=m['label'], linkLength=round(float(d), 1), source=m['source'], note='map-derived position, outside OSM coverage')
    # Connectivity check from arcade over the final graph.
    n2 = len(nodes); E2 = np.array([[e[0], e[1]] for e in out_edges])
    nc2, lab2 = connected_components(coo_matrix((np.ones(len(E2)), (E2[:, 0], E2[:, 1])), shape=(n2, n2)), directed=False)
    total = sum(e[2] for e in out_edges); ys = [nd['p'][1] for nd in nodes]
    graph = dict(version=1, units='metres', axes='x east, y up, z south', origin=struct['origin'],
                 source=dict(osm=str(OSM.relative_to(ROOT)), osmSha256=hashlib.sha256(OSM.read_bytes()).hexdigest(), license='ODbL 1.0 © OpenStreetMap contributors',
                             terrainSha256=T.m['sha256'], kinds=sorted(KINDS)),
                 note='Edges [a, b, length3D]; edgeKind is parallel to edges. Tunnel edges are graded linearly between portal heights (below the terrain surface). '
                      'Anchor-link edges are straight connectors from a named target to its nearest OSM-path node.',
                 nodes=nodes, edges=out_edges, edgeKind=kinds, anchors=anchors,
                 stats=dict(nodes=n2, edges=len(out_edges), components=int(nc2), totalLength=round(total, 1), osmWaysByKind=stats,
                            droppedComponents=int(ncomp-1), keptOfMerged=f'{len(keep)}/{n}', yRange=[min(ys), max(ys)]))
    a.out.write_text(json.dumps(graph, ensure_ascii=False, separators=(',', ':'))+'\n')
    print(f'graph: {n2} nodes, {len(out_edges)} edges, components {nc2}, total {total/1000:.2f} km, y {min(ys):.1f}..{max(ys):.1f}')
    print('kinds', {k: kinds.count(k) for k in sorted(set(kinds))})
    for k, v in anchors.items(): print(f'  anchor {k:12s} node {v["node"]:5d} link {v["linkLength"]:6.1f} m  {v["label"]}')
    tk = [i for i, k in enumerate(kinds) if k == 'tunnel']; print('tunnel edges kept', len(tk))
    deg = np.bincount(np.array([[e[0], e[1]] for e in out_edges]).ravel(), minlength=n2)
    te = [out_edges[i] for i in tk]; tn = sorted({v for e in te for v in e[:2]})
    print(f"tunnel: {len(te)} edges, max |dy| {max(abs(nodes[a]['p'][1]-nodes[b]['p'][1]) for a, b, _ in te):.2f} m, max len {max(e[2] for e in te):.2f} m, "
          f"total {sum(e[2] for e in te):.1f} m, node degrees {sorted(collections.Counter(int(deg[v]) for v in tn).items())}")
    from scipy.sparse.csgraph import dijkstra
    W = np.array(out_edges); A = coo_matrix((W[:, 2], (W[:, 0].astype(int), W[:, 1].astype(int))), shape=(n2, n2))
    dist = dijkstra(A, directed=False, indices=anchors['arcade']['node'])
    print('route lengths from arcade:', {k: round(float(dist[v['node']])) for k, v in anchors.items() if k in ('gate', 'tunnel-west', 'tunnel-east', 'admin', 'library', 'sunset', 'beach', 'ME', 'MB', 'FA', 'LA')})
    print('wrote', a.out)


if __name__ == '__main__':
    main()
