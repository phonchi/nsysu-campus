#!/usr/bin/env python3
"""Verify official assets and reviewed metadata without writing any files.

python tools/verify_data.py          # read-only; missing/mismatched lock fails
python tools/verify_data.py --lock   # explicitly replace baseline after review

Requires Pillow. No network access, downloads, OCR, or automatic lock updates.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / 'public/data/asset-integrity.json'


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def local_path(relative: str, base: Path = ROOT) -> Path:
    path = (base / relative).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError(f'path escapes project: {relative}')
    return path


def finite(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def records(name: str, errors: list[str]) -> list[dict]:
    data = json.loads((ROOT / f'public/data/{name}.json').read_text())
    if not isinstance(data, list):
        raise ValueError(f'{name}.json must be an array')
    seen = set()
    for row in data:
        if not isinstance(row, dict) or not isinstance(row.get('id'), str) or not row['id']:
            raise ValueError(f'{name}.json has a record without a string id')
        if row['id'] in seen:
            errors.append(f'{name}: duplicate id {row["id"]}')
        seen.add(row['id'])
    return data


WALK = ROOT / 'public/data/walkthrough'
WALK_BUILDINGS = ['SC', 'EN', 'BI', 'PH', 'CH', 'EC', 'MS', 'EV']
WC_KEYWORDS = ['廁所', '洗手間', 'WC', 'toilet']


def walkthrough_floors() -> dict:
    """{buildingId: {floorId: floor}} from the walkthrough building files (read-only)."""
    out = {}
    for bid in WALK_BUILDINGS:
        path = WALK / f'{bid}.json'
        out[bid] = {f['id']: f for f in json.loads(path.read_text())['floors']} if path.exists() else {}
    return out


def segment_distance(p, a, b) -> float:
    dx, dz = b[0] - a[0], b[1] - a[1]; length = dx * dx + dz * dz
    t = 0 if length == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / length))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz)


def inside(p, polygon) -> bool:
    hit = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]:
            hit = not hit
    return hit


def is_point(value: object) -> bool:
    return isinstance(value, list) and len(value) == 2 and all(finite(v) for v in value)


def is_evidence(value: object) -> bool:
    return isinstance(value, dict) and bool(value.get('sourceId')) and bool(value.get('locator')) and value.get('basis') in ('map-derived', 'schematic')


def check_lifts(walk: dict, errors: list[str]) -> None:
    """LiftGeometryV12 (docs/spec-v12.md §2): every landing door sits on its shaft boundary."""
    structure = json.loads((WALK / 'campus-structure.json').read_text())
    lifts = structure.get('lifts', {}); replaced: list[str] = []
    services = {v.get('id') for floors in walk.values() for f in floors.values() for v in f.get('verticalServices') or []}
    for bid in WALK_BUILDINGS:
        if not lifts.get(bid):
            errors.append(f'lift {bid}: building has no lift'); continue
        for lift in lifts[bid]:
            lid = lift.get('id', bid + '-lift-?'); shaft = lift.get('shaftPolygon')
            if lift.get('buildingId') != bid: errors.append(f'lift {lid}: buildingId missing or wrong')
            if not is_point(lift.get('center')) or not finite(lift.get('angle')) or not finite(lift.get('size')) or lift.get('size', 0) <= 0:
                errors.append(f'lift {lid}: legacy center/angle/size missing'); continue
            if not isinstance(shaft, list) or len(shaft) < 3 or not all(is_point(p) for p in shaft):
                errors.append(f'lift {lid}: shaftPolygon missing or invalid'); continue
            if not inside(lift['center'], shaft): errors.append(f'lift {lid}: center is outside shaftPolygon')
            xs = [p[0] for p in shaft]; zs = [p[1] for p in shaft]; cabin = lift.get('cabinSize')
            if not is_point(cabin) or min(cabin) <= 0 or max(cabin) > max(max(xs) - min(xs), max(zs) - min(zs)) + 1e-6:
                errors.append(f'lift {lid}: cabinSize missing or larger than the shaft')
            if lift.get('basis') not in ('map-derived', 'schematic'): errors.append(f'lift {lid}: basis invalid')
            if not is_evidence(lift.get('evidence')): errors.append(f'lift {lid}: evidence must be {{sourceId, locator, basis}}')
            elif lift['evidence']['basis'] != lift.get('basis'): errors.append(f'lift {lid}: basis differs from evidence.basis')
            ids = lift.get('replacesServiceIds')
            if not isinstance(ids, list) or not all(isinstance(i, str) and i for i in ids):
                errors.append(f'lift {lid}: replacesServiceIds missing'); ids = []
            replaced += ids
            stops = lift.get('stops') or []
            if len(stops) < 2: errors.append(f'lift {lid}: fewer than two stops')
            ux, uz = math.cos(lift['angle']), math.sin(lift['angle'])
            for i in ids:
                if i.endswith('-shaft-x'): errors.append(f'lift {lid}: {i} is a different shaft and must not be replaced')
                if '-car@' not in i and i not in services: errors.append(f'lift {lid}: replaced service {i} does not exist')
                if '-car@' in i and i not in [f"{lid}-car@{s.get('floorId')}" for s in stops]: errors.append(f'lift {lid}: car id {i} has no stop')
            for stop in stops:
                fid = stop.get('floorId'); where = f'lift {lid} @ {fid}'
                if fid not in walk.get(bid, {}): errors.append(f'{where}: unknown floor'); continue
                if not finite(stop.get('level')) or not finite(stop.get('storey')): errors.append(f'{where}: level/storey missing')
                if f'{lid}-car@{fid}' not in ids: errors.append(f'{where}: car id missing from replacesServiceIds')
                if not is_evidence(stop.get('evidence')): errors.append(f'{where}: stop evidence missing')
                door = stop.get('landingDoor') or {}; approach = stop.get('approach')
                if not is_point(door.get('center')) or not is_point(door.get('tangent')) or not finite(door.get('clearWidth')) or not is_point(approach):
                    errors.append(f'{where}: landingDoor/approach missing'); continue
                edge = min(zip(shaft, shaft[1:] + shaft[:1]), key=lambda e: segment_distance(door['center'], *e))
                if segment_distance(door['center'], *edge) > .02: errors.append(f'{where}: landing door is not on the shaft boundary')
                tx, tz = door['tangent']; length = math.hypot(edge[1][0] - edge[0][0], edge[1][1] - edge[0][1]) or 1
                if abs(math.hypot(tx, tz) - 1) > 1e-3: errors.append(f'{where}: door tangent is not a unit vector')
                if abs(tx * ux + tz * uz) > 1e-3: errors.append(f'{where}: door tangent disagrees with the lift angle')
                if abs(tx * (edge[1][1] - edge[0][1]) - tz * (edge[1][0] - edge[0][0])) / length > 1e-3: errors.append(f'{where}: door tangent is not along the shaft wall')
                if not .8 <= door['clearWidth'] <= 1.2 or door['clearWidth'] > length + 1e-6: errors.append(f'{where}: clearWidth out of range')
                if inside(approach, shaft): errors.append(f'{where}: approach point is inside the shaft')
                if (approach[0] - lift['center'][0]) * ux + (approach[1] - lift['center'][1]) * uz >= 0: errors.append(f'{where}: approach is not on the opening side (opening = -angle)')
                if not .3 <= math.hypot(approach[0] - door['center'][0], approach[1] - door['center'][1]) <= 1.5: errors.append(f'{where}: approach is not in front of the landing door')
                # The runtime cuts the whole shaft out of upper slabs and centres the car (cabinSize[0] along the door
                # axis): a car short of the sill leaves a gap a rider falls through on the way out.
                if is_point(cabin):
                    sill = (lift['center'][0] - door['center'][0]) * ux + (lift['center'][1] - door['center'][1]) * uz - cabin[0] / 2
                    if sill > .16: errors.append(f'{where}: car stops {sill:.2f} m short of the landing door (shaft deeper than cabinSize[0])')
    if len(replaced) != len(set(replaced)): errors.append('lifts: replacesServiceIds are not globally unique')
    if len(services) != sum(len(f.get('verticalServices') or []) for floors in walk.values() for f in floors.values()) or None in services:
        errors.append('verticalServices: missing or duplicate ids')


def check_v12_rooms(rooms: list[dict], walk: dict, errors: list[str]) -> None:
    """rooms.json rows for split sub-rooms (aliases, no parent row) and restrooms (kind, gender, accessible, keywords)."""
    rows = {r.get('walkRoomId'): r for r in rooms if r.get('v12')}
    codes = {(r.get('buildingId'), r.get('code')) for r in rooms if not r.get('v12')}
    for bid, floors in walk.items():
        for fid, floor in floors.items():
            for room in floor.get('rooms', []):
                restroom = room.get('kind') == 'restroom'; child = bool(room.get('splitFrom')) and not restroom
                if not restroom and not child: continue
                row = rows.get(room['id'])
                if row is None:
                    errors.append(f'rooms.json: no row for {room["id"]}'); continue
                if row.get('buildingId') != bid or row.get('floorId') != fid or row.get('code') != room.get('code'):
                    errors.append(f'rooms.json {row["id"]}: building/floor/code differs from the walkthrough room')
                if restroom:
                    if row.get('kind') != 'restroom' or row.get('gender') != room.get('gender') or row.get('accessible') is not room.get('accessible'):
                        errors.append(f'rooms.json {row["id"]}: kind/gender/accessible differs from the walkthrough room')
                    if not isinstance(row.get('keywords'), list) or any(k not in row['keywords'] for k in WC_KEYWORDS):
                        errors.append(f'rooms.json {row["id"]}: keywords must include {WC_KEYWORDS}')
                else:
                    if row.get('aliases') != room.get('aliases') or not row.get('aliases'):
                        errors.append(f'rooms.json {row["id"]}: aliases differ from the walkthrough room')
                    for alias in room.get('aliases', []):
                        if (bid, alias) in codes: errors.append(f'rooms.json: parent row {alias} must not be kept beside its sub-rooms')
    known = {room['id'] for floors in walk.values() for floor in floors.values() for room in floor.get('rooms', [])}
    for rid, row in rows.items():
        if rid not in known: errors.append(f'rooms.json {row["id"]}: walkRoomId {rid} does not exist')


def build_snapshot() -> tuple[dict, list[str]]:
    errors: list[str] = []
    sources = records('sources', errors)
    floors = records('floors', errors)
    rooms = records('rooms', errors)
    source_by_id = {s['id']: s for s in sources}
    floor_by_id = {f['id']: f for f in floors}
    snapshot = {'version': 3, 'sources': {}, 'floors': {}, 'rooms': {r['id']:r for r in rooms}, 'campus': {}, 'navigation': {}, 'layout': {}}
    for source in sources:
        sid = source['id']
        try:
            path = local_path(source['localPdf'])
            sha = digest(path)
            with path.open('rb') as stream:
                if not stream.read(1024).lstrip().startswith(b'%PDF-'):
                    errors.append(f'source {sid}: file is not a PDF')
            if sha != source.get('sha256'):
                errors.append(f'source {sid}: PDF SHA256 differs from sources.json')
            snapshot['sources'][sid] = {'sha256': sha, 'metadata': source}
        except (OSError, ValueError, KeyError) as exc:
            errors.append(f'source {sid}: {exc}')
    for floor in floors:
        fid = floor['id']
        source = source_by_id.get(floor.get('sourceId'))
        if source is None:
            errors.append(f'floor {fid}: unknown sourceId {floor.get("sourceId")}')
        page = floor.get('page')
        if source is not None and (not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= source.get('pages', 0)):
            errors.append(f'floor {fid}: page outside source page count')
        crop = floor.get('crop')
        if crop is not None and (not isinstance(crop, dict) or any(not finite(crop.get(k)) for k in ('x', 'y', 'width', 'height')) or crop['x'] < 0 or crop['y'] < 0 or crop['width'] <= 0 or crop['height'] <= 0):
            errors.append(f'floor {fid}: invalid crop rectangle')
        rotation = floor.get('rotation', 0)
        if not finite(rotation) or rotation % 90:
            errors.append(f'floor {fid}: rotation must be a multiple of 90 degrees')
        try:
            url = floor['imageUrl']
            if not isinstance(url, str) or not url.startswith('/') or url.startswith('//'):
                raise ValueError('imageUrl must be a local absolute URL path')
            # Official plan renders are kept unpublished in data/official-plans (the URL is only a data key).
            path = local_path(url.lstrip('/'), ROOT / 'data/official-plans')
            sha = digest(path)
            with Image.open(path) as image:
                dimensions = list(image.size)
                image.verify()
            if dimensions != [floor.get('width'), floor.get('height')]:
                errors.append(f'floor {fid}: actual image dimensions {dimensions} differ from metadata')
            metadata = dict(floor, rotation=rotation)
            metadata['sourceSHA256'] = source.get('sha256') if source else None
            snapshot['floors'][fid] = {'sha256': sha, 'dimensions': dimensions, 'metadata': metadata}
        except (OSError, ValueError, KeyError) as exc:
            errors.append(f'floor {fid}: {exc}')
    walk = walkthrough_floors()
    check_v12_rooms(rooms, walk, errors)
    check_lifts(walk, errors)
    for room in rooms:
        rid = room['id']
        floor = floor_by_id.get(room.get('floorId'))
        source = source_by_id.get(room.get('sourceId'))
        # v12 restrooms also exist on storeys that have no entry in floors.json (basements, the other seven
        # buildings): there the walkthrough floor is the reference, and its sourceId must match.
        walk_floor = walk.get(room.get('buildingId'), {}).get(room.get('floorId')) if room.get('kind') == 'restroom' and room.get('v12') else None
        if walk_floor is not None and floor is None:
            if walk_floor.get('sourceId') != room.get('sourceId'):
                errors.append(f'room {rid}: sourceId differs from its walkthrough floor')
            for axis in ('x', 'y'):
                if not finite(room.get(axis)) or not 0 <= room[axis] <= 1:
                    errors.append(f'room {rid}: {axis} is not a normalized coordinate')
            continue
        if floor is None:
            errors.append(f'room {rid}: unknown floorId {room.get("floorId")}')
        if source is None:
            errors.append(f'room {rid}: unknown sourceId {room.get("sourceId")}')
        if floor and (room.get('sourceId') != floor.get('sourceId') or room.get('buildingId') != floor.get('buildingId')):
            errors.append(f'room {rid}: source/building differs from its floor')
        for axis in ('x', 'y'):
            if not finite(room.get(axis)) or not 0 <= room[axis] <= 1:
                errors.append(f'room {rid}: {axis} is not a normalized coordinate')
        code = room.get('code', '')
        # SC identifiers are specific to the SC/East-complex source. They must
        # never leak into BI/PH or another building during ingestion/merging.
        if re.match(r'^SC\s*\d', code, re.I) and (room.get('buildingId') != 'SC' or not floor or floor.get('buildingId') != 'SC' or not source or source.get('buildingId') != 'SC'):
            errors.append(f'room {rid}: SC room code assigned to another building/source')
        if room.get('buildingId') == 'SC' and room.get('kind') != 'restroom' and not re.match(r'^SC\s*\d', code, re.I):
            errors.append(f'room {rid}: non-SC room code assigned to SC')
    # Lock the campus reference and the derived image together. Coordinate
    # annotations must not silently survive a changed map or changed preview.
    for name in ('campus-original.jpg', 'campus-preview.webp', 'science-engineering-reference.jpg'):
        try:
            path = ROOT / 'data/official-plans/maps' / name
            with Image.open(path) as im:
                dims = list(im.size)
            snapshot['campus'][name] = {'sha256':digest(path),'dimensions':dims,'mapDate':None if name=='science-engineering-reference.jpg' else '2022-09','sourceUrl':'https://science.nsysu.edu.tw/static/file/20/1020/pictures/928/m/mczh-tw700x700_large169939_850927118763.jpg' if name=='science-engineering-reference.jpg' else 'https://www.nsysu.edu.tw/static/file/0/1000/img/440826181.jpg'}
        except OSError as exc:
            errors.append(f'campus {name}: {exc}')
    nav = json.loads((ROOT / 'public/data/navigation.json').read_text())
    node_by_id = {n['id']:n for n in nav['nodes']}
    room_by_id = {r['id']:r for r in rooms}
    if len(node_by_id) != len(nav['nodes']): errors.append('navigation duplicate node id')
    for node in nav['nodes']:
        if any(not finite(node.get(a)) or not 0<=node[a]<=1 for a in ('x','y')):
            errors.append(f'navigation {node["id"]}: invalid normalized coordinate')
        if node.get('floorId'):
            floor=floor_by_id.get(node['floorId'])
            if not floor or floor['buildingId']!=node.get('buildingId'):
                errors.append(f'navigation {node["id"]}: mismatched floor/building')
        if node.get('roomId'):
            room=room_by_id.get(node['roomId'])
            if not room or room['floorId']!=node.get('floorId') or node['kind']!='door':
                errors.append(f'navigation {node["id"]}: mismatched room door')
    for edge in nav['edges']:
        a,b=node_by_id.get(edge['from']),node_by_id.get(edge['to'])
        if not a or not b:
            errors.append('navigation edge: missing node');continue
        if not finite(edge.get('cost')) or edge['cost']<=0:
            errors.append('navigation edge: invalid cost')
        if edge.get('enabled'):
            proof=edge.get('evidence',{})
            if proof.get('sourceId') not in {*source_by_id,'campus-2022'} or not proof.get('note'):
                errors.append('navigation edge: missing source evidence')
            if a.get('floorId') and b.get('floorId') and a['floorId']!=b['floorId']:
                fa,fb=floor_by_id.get(a['floorId']),floor_by_id.get(b['floorId'])
                paired=(a['kind']==b['kind']=='stairs' and a.get('stairGroupId') and a.get('stairGroupId')==b.get('stairGroupId') and a.get('buildingId')==b.get('buildingId'))
                adjacent=fa and fb and finite(fa.get('level')) and finite(fb.get('level')) and abs(fa['level']-fb['level'])==1
                if not paired or not adjacent: errors.append('navigation edge: unverified or nonadjacent stair pairing')
            if bool(a.get('floorId')) != bool(b.get('floorId')) and proof.get('thresholdChecked') is not True:
                errors.append('navigation edge: outside/inside threshold lacks explicit check')
    snapshot['layout']['world']={'sha256':digest(ROOT/'data/legacy/world-layout.json'),'metadata':json.loads((ROOT/'data/legacy/world-layout.json').read_text())}
    snapshot['navigation']['graph'] = {'sha256':digest(ROOT/'public/data/navigation.json'),'metadata':nav}
    return snapshot, errors


def compare_snapshots(expected: dict, actual: dict) -> list[str]:
    errors = []
    if expected.get('version') != actual['version']:
        errors.append('unsupported integrity lock version')
    for group in ('sources', 'floors', 'rooms', 'campus', 'navigation', 'layout'):
        before = expected.get(group, {})
        after = actual[group]
        for key in sorted(set(before) | set(after)):
            if key not in before:
                errors.append(f'{group} {key}: absent from reviewed lock')
            elif key not in after:
                errors.append(f'{group} {key}: reviewed asset removed')
            elif before[key] != after[key]:
                fields = sorted(k for k in set(before[key]) | set(after[key]) if before[key].get(k) != after[key].get(k))
                errors.append(f'{group} {key}: changed {", ".join(fields)}; inspect and explicitly --lock after review')
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--lock', action='store_true', help='explicitly establish/replace the reviewed integrity snapshot')
    args = parser.parse_args()
    try:
        snapshot, errors = build_snapshot()
        if not args.lock:
            if not LOCK.exists():
                errors.append('asset-integrity.json missing; review assets and explicitly run --lock')
            else:
                errors.extend(compare_snapshots(json.loads(LOCK.read_text()), snapshot))
        if errors:
            for error in errors:
                print(f'ERROR: {error}', file=sys.stderr)
            print(f'Integrity check failed: {len(errors)} issue(s).', file=sys.stderr)
            return 1
        if args.lock:
            LOCK.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2, sort_keys=True) + '\n')
            print(f'Explicit integrity lock written: {LOCK.relative_to(ROOT)}')
        print(f'Integrity verified: {len(snapshot["sources"])} source PDFs, {len(snapshot["floors"])} floor images, room references and coordinates.')
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f'ERROR: integrity check could not complete: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
