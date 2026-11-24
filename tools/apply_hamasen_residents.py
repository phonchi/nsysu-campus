#!/usr/bin/env python3
"""Merge the verified Hamasen residents into public/data/npcs.json."""
from pathlib import Path

import v12_world_common as C

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/sources/hamasen/content-final.json'
NPCS = ROOT / 'public/data/npcs.json'

# Use the roadside or the edge of the cycleway for the stationary residents.
POSTS = {
    'hms-mrt-senior': [695.87, 493.15],
    'hms-ice-boss': [458.65, 724.01],
    'hms-butokuden-uncle': [590.69, 223.28],
    'hms-rail-volunteer': [919.0, 530.2],
}

# Two small terrain lips block a character capsule on the straight link
# from [928.2, 516.19] to [931.57, 508.54].
RAIL_BYPASS = [924.4, 511.2]


def main():
    args = C.cli(__doc__).parse_args()
    residents = C.read_json(SOURCE)['residents']
    data = C.read_json(NPCS)
    talkable = residents['talkable']
    trees = residents['trees']
    ids = {n['id'] for n in talkable}
    kept = [n for n in data['npcs'] if n['id'] not in ids]
    clashes = [n['id'] for n in kept if n.get('talk') in trees]
    if clashes:
        C.die(f'哈瑪星對話樹 ID 已由其他 NPC 使用：{clashes}')
    for npc in talkable:
        npc['district'] = 'hamasen'
        if npc['id'] in POSTS:
            for slot in npc['schedule'].values():
                slot['at'] = POSTS[npc['id']]
    data['npcs'] = list({n['id']: n for n in [*data['npcs'], *talkable]}.values())
    data['trees'].update(trees)
    ambient = data.get('ambient', {})
    walkers = residents['ambient']
    rail = next(n for n in walkers if n['id'] == 'hms-amb-6')['route']
    rail.insert(rail.index([931.57, 508.54]), RAIL_BYPASS)
    data['ambient'] = {**ambient, 'hamasen': list({n['id']: n for n in [*ambient.get('hamasen', []), *walkers]}.values())}
    print(f'哈瑪星居民：{len(talkable)} 位可對話、{len(walkers)} 位走動、{len(trees)} 棵對話樹')
    C.finish(args, [C.emit(NPCS, C.dump(data), args)], [])


if __name__ == '__main__':
    main()
