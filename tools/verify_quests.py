#!/usr/bin/env python3
"""Validate quest references, scheduled speakers and the v5 save compatibility contract.
Read-only: no caches, generated data or navmesh changes. Run from any directory.
"""
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TIMES = ('day', 'sunset', 'night')
IDS = ['gate-lost', 'gate-mia', 'tunnel-leaflet', 'tunnel-photo', 'admin-list', 'admin-garden',
       'library-bookmark', 'library-corner', 'arcade-coffee', 'arcade-club', 'sea-postcard', 'sea-stage']
TITLES = ['阿忠伯的失物招領', 'Mia 的第一天', '迎新傳單飛走了', '洞口攝影練習', '小禾的報到清單', '海伯的園藝幫手',
          '遺落的書籤', '靠海閱讀角', '阿凱的咖啡訂單', '社團攤位救援', '小橘的夕陽明信片', '允哲的海風小舞台']
GATES = ['c1-gate', 'c4-library', 'c2-tunnel', 'c4-library', 'c4-library', 'c4-library',
         'c4-library', 'c4-library', 'c5-arcade', 'c5-arcade', 'c5-arcade', 'c5-arcade']


def load():
    def read(name):
        return json.loads((ROOT / 'public/data' / name).read_text())
    return read('quests.json'), read('encounters.json'), read('npcs.json'), read('story-zones.json'), read('chapters.json'), read('walkthrough/outdoor-graph.json')


def verify(quests, encounters, npcs, zones, chapters, graph):
    errors, results = [], set()
    def check(ok, message):
        if not ok:
            errors.append(message)
    people = {n['id']: n for n in npcs['npcs']}
    zone_map, anchors = zones['zones'], graph['anchors']
    chapters_list = chapters['chapters']
    chapter_ids = [c['id'] for c in chapters_list]
    # Match the actual ownership list, rather than guessing that story NPCs always use schedules.
    source = (ROOT / 'src/world/npc.ts').read_text()
    story_npcs = set(re.findall(r"'([^']+)'", re.search(r'export const STORY_NPCS = \[(.*?)\]', source, re.S).group(1)))

    def anchor(name):
        if name in zone_map:
            return zone_map[name]['p']
        a = anchors.get(name)
        if a and isinstance(a.get('node'), int) and 0 <= a['node'] < len(graph['nodes']):
            p = graph['nodes'][a['node']]['p']
            return [p[0], p[2]]  # routes.anchor uses the graph node, never an invented zone.
        return None

    for name in ('IL', 'ACTIVITY'):
        check(name in anchors and anchor(name) is not None, f'routes.anchor({name}) does not resolve')

    def placement(npc, time, done_count):
        if npc not in people:
            return None
        if npc in story_npcs and done_count < len(chapters_list):
            at = zones['npcs'].get(npc, {}).get('at', people[npc]['schedule'].get('day', {}).get('at'))
            for ch in chapters_list[:done_count]:
                for step in ch['steps']:
                    for action in step['then']:
                        if 'moveNpc' in action and action['moveNpc'][0] == npc:
                            at = action['moveNpc'][1]
            spec = {'at': at, 'offset': zones['npcs'].get(npc, {}).get('offset', [0, 0])}
        else:
            spec = people[npc]['schedule'].get(time)
        if not spec:
            return None
        at = spec['at']
        p = anchor(at) if isinstance(at, str) else at
        if p is None:
            errors.append(f'NPC {npc}/{time}: unresolved anchor {at}')
            return None
        offset = spec.get('offset', [0, 0])
        return [p[0] + offset[0], p[1] + offset[1]]

    def target_point(target, time, count):
        kind, _, name = target.partition(':')
        if kind == 'npc':
            return placement(name, time, count)
        return anchor(name) if kind == 'zone' else None

    def reference(target, label):
        kind, _, name = target.partition(':')
        check((kind == 'npc' and name in people) or (kind == 'zone' and anchor(name) is not None), f'{label}: unknown target {target}')

    check(quests.get('version') == 1, 'quest data version must stay 1')
    check([q['id'] for q in quests['quests']] == IDS, 'quest IDs/order changed')
    for index, q in enumerate(quests['quests']):
        label = q['id']
        if label not in IDS:
            continue
        index = IDS.index(label)
        check(q['reward'] == TITLES[index] + '紀念章', f'{label}: reward changed')
        expected = ['explore', 'return'] if label in ('tunnel-photo', 'library-corner', 'sea-postcard') else ['errand-1', 'errand-2', 'return'] if label == 'arcade-coffee' else ['errand-1', 'errand-2', 'errand-3', 'return']
        check([s['id'] for s in q['steps']] == expected, f'{label}: save step IDs/count changed')
        check(q['steps'][-1]['id'] == 'return', f'{label}: delivery must be last')
        gate = q.get('accept', {}).get('chapterDone')
        check(gate in chapter_ids and gate == GATES[index], f'{label}: incorrect chapter gate {gate}')
        reference(q.get('accept', {}).get('near', ''), label + '/accept')
        check(q.get('accept', {}).get('near') == 'npc:' + q['npc'], f'{label}: acceptance must be at its NPC')
        check(q['steps'][0]['target'] == q['accept']['near'] or any(l.get('who') == q['npc'] for l in q['accept'].get('lines', [])), f'{label}: the NPC must ask on acceptance')
        count_min = chapter_ids.index(gate) + 1 if gate in chapter_ids else 0
        inherited = None
        for step in q['steps']:
            sl = f"{label}/{step['id']}"
            reference(step['target'], sl)
            check(step.get('when', 'day') in TIMES, f'{sl}: invalid time')
            inherited = step.get('when', inherited)
            check(bool(step.get('lines')), f'{sl}: missing on-location lines')
            for line in step.get('lines', []):
                check(line['who'] == 'player' or line['who'] in people, f'{sl}: unknown speaker {line["who"]}')
                check(bool(line['text']) and not re.search(r'[,!?:;]', line['text']), f'{sl}: use full-width punctuation')
            for time in TIMES:
                for count in range(count_min, len(chapters_list) + 1):
                    point = target_point(step['target'], time, count)
                    required = step.get('when', inherited)
                    if required and required != time:
                        continue
                    if step['target'].startswith('npc:') and point is None:
                        check(bool(q.get('absent', {}).get(time)), f'{sl}/{time}: absent NPC needs directions')
                        check(required is None, f'{sl}/{time}: timed or inherited-time NPC absent')
                        continue
                    for line in step.get('lines', []):
                        who = line['who']
                        if who == 'player':
                            continue
                        p = placement(who, time, count)
                        check(p is not None and point is not None and math.dist(p, point) <= step.get('radius', 4), f'{sl}/{time}/chapter-count={count}: speaker {who} is not on location')
            for choice in step.get('choices', []):
                result = choice['result']
                check(result not in results, f'{sl}: duplicate choice result')
                results.add(result)
                check(not any(t in result for t in ('對方笑著向你道謝', '留下了屬於你們的校園回憶')), f'{sl}: old template result')
                check(not re.search(r'[,!?:;]', result), f'{sl}: result punctuation')
        # A night-only absence in any later step must be discoverable from the notebook.
        for time in TIMES:
            if placement(q['npc'], time, len(chapters_list)) is None:
                check(bool(q.get('absent', {}).get(time)), f'{label}/{time}: acceptance NPC absence needs directions')
    check(len(results) == 24, 'expected 24 distinct choice results')
    for e in encounters['encounters']:
        reference(e['target'], e['id'])
        check(e['npc'] == 'player' or e['npc'] in people, f'{e["id"]}: unknown attribution')
        check(e.get('when', 'day') in TIMES, f'{e["id"]}: invalid time')
        # Encounter actors are spawned props; npc is attribution, not an actor-presence requirement.
        # Authored references to a person at a particular area still need a matching schedule.
        if e['id'] in ('rolling-ball', 'pop-up-song', 'group-photo'):
            for time in [e['when']] if e.get('when') else TIMES:
                spec = people[e['npc']]['schedule'].get(time)
                check(spec is not None and spec['at'] == e['zone'], f'{e["id"]}/{time}: attribution conflicts with location')
    return errors


if __name__ == '__main__':
    errors = verify(*load())
    for error in errors:
        print(error, file=sys.stderr)
    print(f'quests: {"FAIL" if errors else "OK"}（12 個任務、24 個結果、排程、錨點與舊存檔契約）')
    sys.exit(bool(errors))
