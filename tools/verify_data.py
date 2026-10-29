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
    for room in rooms:
        rid = room['id']
        floor = floor_by_id.get(room.get('floorId'))
        source = source_by_id.get(room.get('sourceId'))
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
        if room.get('buildingId') == 'SC' and not re.match(r'^SC\s*\d', code, re.I):
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
