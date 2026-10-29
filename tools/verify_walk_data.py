#!/usr/bin/env python3
"""Read-only input locks and per-floor coverage checks for offline walkthrough meshes."""
import hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
ids=['SC','EN','BI','PH','CH','EC','MS','EV']
errors=[]
def load(path):
 try:return json.loads((root/path).read_text())
 except (OSError,ValueError) as exc:errors.append(f'{path}: {exc}');return {}
def sha(path):
 try:return hashlib.sha256((root/path).read_bytes()).hexdigest()
 except OSError as exc:errors.append(f'{path}: {exc}');return None
meta=load('public/data/walkthrough/navmesh-meta.json')
scope=meta.get('scope')
if scope not in ['prototype-SC-1F-2F','campus-science-engineering-v2']:errors.append('unknown nav scope')
prototype=scope=='prototype-SC-1F-2F'
selected=['SC'] if prototype else ids
required={f'public/data/walkthrough/{bid}.json' for bid in selected}|{'public/data/walkthrough/access-plan.json','src/walk-world.ts','src/walk-types.ts','src/walk-nav.ts','tools/bake_walk_nav.ts','public/data/terrain/terrain.json','public/data/terrain/terrain.bin','src/world/terrain.ts','src/world/road-surface.ts','public/data/story-zones.json','public/models/landmarks/placements.json','src/world/landmarks.ts','src/world/tunnel-surface.ts','tests/world-fixture.ts'}
if not prototype:required.add('public/data/walkthrough/index.json')
for report in (root/'public/data/walkthrough').glob('*source-review*.json'):required.add(str(report.relative_to(root)))
access=load('public/data/walkthrough/access-plan.json')
review_file=access.get('sourceReviewFile')
if review_file:
 required.add(review_file)
 if sha(review_file)!=access.get('sourceReviewHash'):errors.append('stale access-plan source review hash')
if meta.get('status')!='ready':errors.append('nav bake is not ready')
inputs=meta.get('inputs',{})
for name in sorted(required-set(inputs)):errors.append('missing input hash: '+name)
for name,digest in inputs.items():
 if sha(name)!=digest:errors.append('stale nav input: '+name)
if sha('public/data/walkthrough/navmesh.bin')!=meta.get('binarySha256'):errors.append('nav binary checksum mismatch')
binary=root/'public/data/walkthrough/navmesh.bin'
if binary.exists() and binary.stat().st_size!=meta.get('binaryBytes'):errors.append('nav binary size mismatch')
if not isinstance(meta.get('surfaceVersion'),str) or not meta['surfaceVersion'].startswith(('terrain-triangles-v1:','terrain-triangles-v2:','flat-ground-v1')):errors.append('missing or unsupported terrain surface revision')
runtime=load('public/data/walkthrough/navmesh-runtime.json')
for field in ['status','scope','createdAt','validationPassed','binaryBytes','binarySha256','surfaceVersion','error']:
 if runtime.get(field)!=meta.get(field):errors.append('runtime manifest differs from evidence: '+field)
c=meta.get('coverage',{});checks=c.get('checks',[])
inside_counts=c.get('insideSummary',{})
expected_runtime_coverage={'total':c.get('total'),'reachable':c.get('reachable'),'allDestinationsReachable':c.get('allDestinationsReachable'),
 'insideTotal':inside_counts.get('total'),'insideReachable':inside_counts.get('reachable'),'insideReturnReachable':inside_counts.get('returnReachable'),
 'allInteriorsReachable':inside_counts.get('allReachable'),'buildings':len(c.get('buildings',[])),'floors':len(c.get('floors',[])),
 'reachableFloors':sum(f.get('reachable',0)>0 for f in c.get('floors',[]))}
if runtime.get('coverage')!=expected_runtime_coverage:errors.append('runtime coverage summary differs from full evidence')
if set(runtime)-{'status','scope','createdAt','validationPassed','binaryBytes','binarySha256','surfaceVersion','coverage','error'}:errors.append('unexpected payload in runtime manifest')

if not checks:errors.append('no destination coverage checks')
if len(checks)!=c.get('total') or sum(bool(x.get('reachable')) for x in checks)!=c.get('reachable'):errors.append('coverage counters do not match checks')
if len({x.get('id') for x in checks})!=len(checks):errors.append('duplicate destination check IDs')
for item in checks:
 if not item.get('reachable') or item.get('returnReachable',True) is False:errors.append('unreachable destination: '+str(item.get('id'))+' at '+str(item.get('target')))
if not c.get('allDestinationsReachable'):errors.append('not all destinations are reachable')
if prototype:
 if not c.get('stairs',{}).get('up') or not c.get('stairs',{}).get('down'):errors.append('prototype bidirectional stairs disconnected')
else:
 index=load('public/data/walkthrough/index.json');entries=index.get('buildings',[])
 if len(entries)!=8 or {e.get('id') for e in entries}!=set(ids):errors.append('index does not declare exactly eight buildings')
 if meta.get('validationPassed') is not True:errors.append('bake coverage validation did not pass')
 if c.get('errors'):errors.extend(c['errors'])
 expected={}
 for bid in ids:
  building=load(f'public/data/walkthrough/{bid}.json')
  if building.get('id')!=bid:errors.append('building ID mismatch: '+bid)
  for f in building.get('floors',[]):expected[(bid,f['id'])]=f
 floor_reports=c.get('floors',[])
 if len(floor_reports)!=len(expected) or {(f.get('buildingId'),f.get('floorId')) for f in floor_reports}!=set(expected):errors.append('declared floor coverage incomplete or duplicated')
 for f in floor_reports:
  bid,fid=f.get('buildingId'),f.get('floorId');items=[x for x in checks if x.get('buildingId')==bid and x.get('floorId')==fid]
  reached=sum(bool(x.get('reachable')) for x in items)
  if not f.get('rendered') or not reached:errors.append('no rendered, reachable door/entrance: '+str(fid))
  if f.get('total')!=len(items) or f.get('reachable')!=reached:errors.append('floor counters disagree: '+str(fid))
 if len(c.get('buildings',[]))!=8 or {b.get('buildingId') for b in c.get('buildings',[])}!=set(ids):errors.append('building coverage incomplete')
 door_ids=c.get('renderedDoorIds',[])
 if len(door_ids)!=len(set(door_ids)):errors.append('duplicate rendered door IDs')
 for item in checks:
  if item.get('roomId') and item.get('doorId') not in door_ids:errors.append('destination missing rendered door: '+str(item.get('id')))
# Independently derive the room inventory; never trust a builder that omitted rooms.
access=load('public/data/walkthrough/access-plan.json')
expected_rooms=set()
for bid in selected:
 if access.get('sourceSHA256',{}).get(bid+'.json')!=sha(f'public/data/walkthrough/{bid}.json'):errors.append('stale access plan: '+bid)
 building=load(f'public/data/walkthrough/{bid}.json')
 for floor in building.get('floors',[]):
  if prototype and floor.get('level') not in [1,2]:continue
  if floor['id'] not in access.get('floors',{}):errors.append('missing floor access: '+floor['id'])
  for room in floor.get('rooms',[]):
   p=room.get('polygon',[])
   area=abs(sum(a[0]*p[(i+1)%len(p)][1]-p[(i+1)%len(p)][0]*a[1] for i,a in enumerate(p))/2) if len(p)>=3 else 0
   if room.get('kind') in ['room','room-candidate'] and area>=1.6:expected_rooms.add((bid,floor['id'],room['id']))
checked_rooms={(x.get('buildingId'),x.get('floorId'),x.get('roomId')) for x in checks if x.get('roomId')}
for key in sorted(expected_rooms-checked_rooms):errors.append('builder omission: '+'/'.join(key))
if c.get('builderOmissions'):errors.append('bake reported builder omissions')
# Room interior coverage is separate from reaching a doorway outside the room.
inside=c.get('insideChecks',[]);inside_summary=c.get('insideSummary',{})
inside_keys=[(x.get('buildingId'),x.get('floorId'),x.get('roomId')) for x in inside]
if len(inside_keys)!=len(set(inside_keys)) or set(inside_keys)!=expected_rooms:errors.append('own-room interior coverage incomplete or duplicated')
if inside_summary.get('total')!=len(inside) or inside_summary.get('reachable')!=sum(bool(x.get('reachable')) for x in inside) or inside_summary.get('returnReachable')!=sum(bool(x.get('returnReachable')) for x in inside):errors.append('interior coverage counters disagree')
if inside_summary.get('allReachable') is not True:errors.append('not all own-room interiors are reachable bidirectionally')
for item in inside:
 rid=item.get('roomId');fid=item.get('floorId');door=item.get('doorId')
 portal=next((p for p in access.get('floors',{}).get(fid,{}).get('portals',[]) if p.get('id')==door),None)
 core=portal.get('clearancePositions',{}).get(rid) if portal else None
 if core is None or item.get('localTarget')!=core:errors.append('interior target is not the own-room access core: '+str(rid))
 if not item.get('reachable') or not item.get('returnReachable'):errors.append('unreachable room interior: '+str(rid)+' at '+str(item.get('target')))
 if not any(x.get('buildingId')==item.get('buildingId') and x.get('floorId')==fid and x.get('roomId')==rid and x.get('doorId')==door for x in checks):errors.append('interior door differs from room destination: '+str(rid))
for f in c.get('floors',[]):
 items=[x for x in inside if x.get('floorId')==f.get('floorId') and x.get('buildingId')==f.get('buildingId')]
 if f.get('insideTotal')!=len(items) or f.get('insideReachable')!=sum(bool(x.get('reachable')) for x in items) or f.get('insideReturnReachable')!=sum(bool(x.get('returnReachable')) for x in items):errors.append('floor interior counters disagree: '+str(f.get('floorId')))
if errors:raise SystemExit('\n'.join(dict.fromkeys(errors))+'\nReview failures, then run npm run walk:bake after geometry is frozen.')
print(f'Walkthrough integrity ({scope}): {c["reachable"]}/{c["total"]} destinations, '+
      (f'{len(c.get("floors",[]))} declared floors, ' if not prototype else 'bidirectional stairs, ')+
      f'{inside_summary.get("reachable",0)}/{inside_summary.get("total",0)} own-room interiors bidirectional; binary and required source hashes verified.')
