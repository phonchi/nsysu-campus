#!/usr/bin/env python3
"""v9 edits to SC.json, idempotent. Courtyard void from the official 2F/3F/4F wall lines and RF opening; doors and rooms from the official plans.
Room names cite official pages. Trees in the void are illustrative (src/walk-art.ts): no official source records them."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SC = ROOT / 'public/data/walkthrough/SC.json'
REVIEW = ROOT / 'public/data/walkthrough/final-three-door-source-review.json'
COURT = [[-11.2, 9.6], [6.3, 9.6], [6.3, 21.6], [-11.2, 21.6]]
NOTE = '依官方平面圖 RF 開口與 2F／3F／4F 牆線示意的中庭挖空；未經現地測量。'
COURSE = 'https://highschool-math.nsysu.edu.tw/static/file/186/1186/img/4321/654177968.pdf'
LIBRARY = 'https://sites.google.com/math.nsysu.edu.tw/library'
NAMES = {'SC1005': ('國際會議廳・高中人才培育班', COURSE), 'SC2001': ('高中人才培育班教室', COURSE), 'SC4009': ('應數系數學圖書館', LIBRARY), 'SC4010': ('應數系系辦', COURSE)}
DOORS = {'SC2001': [8.8, 13.0], 'SC3001': [8.8, 13.0], 'SC4009': [-1.15, -2.2]}
# Door-arc fragments in the traced south wall leave no width-qualified span for the plan's double door.
POLYGONS = {'SC4009': [[-4.5077, -8.599], [-4.5077, -2.2], [2.1623, -2.2], [2.1623, -8.599]]}


def main():
    data = json.loads(SC.read_text())
    floors = {f['id']: f for f in data['floors']}
    for fid in ('SC-2F', 'SC-3F', 'SC-4F'):
        f = floors[fid]
        if COURT not in f['holes']:
            f['holes'].append(COURT)
        f['courtyardEvidence'] = NOTE
    f4 = floors['SC-4F']
    if not any(r.get('code') == 'SC4010' for r in f4['rooms']):
        f4['rooms'].append({'id': 'SC-4F-SC4010', 'code': 'SC4010', 'kind': 'room', 'polygon': [[2.4, .1], [6.89, .1], [6.89, 9.21], [2.4, 9.21]],
                            'door': {'position': [6.0, .1], 'width': 1, 'basis': 'map-derived', 'note': '依官方 4F 平面圖北牆門弧；未經現地。'}, 'basis': 'map-derived',
                            'reviewStatus': 'outline-checked-door-review-required', 'note': '對照官方 4F 平面圖描繪；近似輪廓，非 CAD 尺寸。'})
        f4['unmatchedRoomLabels'] = [x for x in f4['unmatchedRoomLabels'] if x['code'] != 'SC4010']
    for f in data['floors']:
        for room in f['rooms']:
            code = room.get('code')
            if code in DOORS:
                room['door']['position'] = DOORS[code]
                room['door'].update(basis='map-derived', note='依官方平面圖門位核對；未經現地。')
                room['door'].pop('outsideHint', None)
            if code in POLYGONS:
                room['polygon'] = POLYGONS[code]
            if code in NAMES:
                room['displayName'], room['nameSource'] = NAMES[code]
    SC.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    review = json.loads(REVIEW.read_text())
    sha = hashlib.sha256(SC.read_bytes()).hexdigest()
    if review['sourceBuildingSHA256']['SC'] != sha:
        review['sourceBuildingSHA256']['SC'] = sha
        review.setdefault('sourceSHARefreshHistory', []).append('v9: SC.json courtyard void, SC2001/SC3001 doors, SC4010 room, display names; reviewed B1 entry unaffected.')
    REVIEW.write_text(json.dumps(review, ensure_ascii=False, indent=2) + '\n')
    print('SC', sha)


main()
