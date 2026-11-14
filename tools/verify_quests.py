#!/usr/bin/env python3
"""Validate quest references, scheduled speakers and the save compatibility contract.
Read-only: no caches, generated data or navmesh changes. Run from any directory.

The contract (`saveContract` in quests.json) is the revision-1 snapshot of what a save can refer to: quest ids, step ids in
their original order, rewards (saved as strings), chapter gates and choice ids. A rewrite may move steps and change targets or
lines, but every revision-1 step id must still exist or be mapped by `legacySteps` to one that does, a reordered quest must
carry `revision >= 2` and `legacyStepOrder` equal to the snapshot, the reward must equal the snapshot or keep it in
`legacyRewards`, the chapter gate may only move earlier, and the last step must stay `return` with choices (the runtime's
delivery contract).

v10.2 additions: every quest states `accept.times` and its giver and chain are on campus at each of them; `works` point at
existing spots with variant kinds from quest-spots.ts and conditions on existing quest flags, one quest per spot;
`completionRewards` name a `group: 'quest'` item in collection.json with an a/b variant per choice; npcs.json
`scheduleOverrides` keep the base schedule's zone and use existing quest flags.

v11 additions: `links` on a quest and on a step ({label, url}, at most MAX_LINKS each) pass `allowed_link`, the same rule as
`isAllowedLink` in src/story/quests.ts (shared vectors: tests/fixtures/link-cases.json). `verify_seats` (run from __main__
and the tests, not inside verify(), so fixture overrides without a seat still exercise the older checks) reads the
`seats` registry in story-zones.json: every human `Sit` schedule or override names an existing seat within SEAT_REACH of
its station, seats are SEAT_GAP apart, an event stay-step zone names a player seat inside its radius that no NPC uses,
and every number is finite. Monkeys never need a seat.

Route audit (warnings only, never a failure): for every acceptable time of day, straight-line distance between consecutive
steps over ROUTE_LEG_WARN metres, or a retrace share over ROUTE_RETRACE_WARN. Distances are 2D straight lines from the same
placement rules as the speaker check (zone anchor + offset, spot `at`); `dest:` rooms have no outdoor coordinate here and end
a leg chain.
"""
import json
import math
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
TIMES = ('day', 'sunset', 'night')
RESULTS = 28
MAX_LINKS = 2  # per step and per quest (spec-v11 §3)
SEAT_GAP, SEAT_REACH = .7, 1.5  # metres between seats; seat to the schedule station (spec-v11 §1 坐姿)
ROUTE_LEG_WARN, ROUTE_RETRACE_WARN, ROUTE_MIN_TOTAL = 300, .4, 100


# A spot must be close enough to the stand point to interact, and near the walking network unless it is indoors.
STAND_REACH, SPOT_RADIUS, PHOTO_RADIUS, PATH_REACH, ZONE_REACH = 2.6, 3, 4, 18, 45  # a walk ends up to .35 m short of its stand point


def point_in_polygon(x, z, polygon):
    inside = False
    for i, (ax, az) in enumerate(polygon):
        bx, bz = polygon[i - 1]
        if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
            inside = not inside
    return inside


def segment_distance(x, z, a, b):
    ex, ez = b[0] - a[0], b[1] - a[1]
    length = ex * ex + ez * ez
    t = max(0, min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / length)) if length > 1e-9 else 0
    return math.hypot(a[0] + ex * t - x, a[1] + ez * t - z)


def building_rooms(code):
    # dest:SC1005 reads the building from its prefix. A code the map labels but no room polygon holds counts: a destination is still to come for it.
    match = re.match(r'[A-Z]+', code)
    path = ROOT / 'public/data/walkthrough' / f'{match.group(0) if match else "?"}.json'
    if not path.exists():
        return set()
    codes = set()
    for floor in json.loads(path.read_text())['floors']:
        codes |= {room.get('code') for room in floor.get('rooms', [])}
        codes |= {label.get('code') for label in floor.get('unmatchedRoomLabels', [])}
    return codes


def load():
    def read(name):
        return json.loads((ROOT / 'public/data' / name).read_text())
    return read('quests.json'), read('encounters.json'), read('npcs.json'), read('story-zones.json'), read('chapters.json'), read('walkthrough/outdoor-graph.json'), read('walkthrough/campus-structure.json'), read('collection.json')


def quest_flags(quests):
    """Every flag the quest data can produce: quest.<id>.<step>.<choice> and quest.<id>.done (QuestEngine.flag)."""
    out = set()
    for q in quests['quests']:
        out.add(f"quest.{q['id']}.done")
        for step in q['steps']:
            for choice in step.get('choices', []):
                out.add(f"quest.{q['id']}.{step['id']}.{choice['id']}")
    return out


def cond_flags(cond):
    """Flags a dialogue-style condition refers to; other condition kinds carry none."""
    if not isinstance(cond, dict):
        return [None]
    if 'flag' in cond:
        return [cond['flag']]
    if 'notFlag' in cond:
        return [cond['notFlag']]
    if 'all' in cond or 'any' in cond:
        return [f for c in cond.get('all', cond.get('any', [])) for f in cond_flags(c)]
    return []


def allowed_link(url):
    """The v11 official-site whitelist; keep identical to isAllowedLink() in src/story/quests.ts. Raw-string checks first
    (ASCII printable, no backslash, no %2e/%2f/%5c, https, a literal [A-Za-z0-9.-] host, no dot segments) so urlsplit and the
    browser's URL parser cannot disagree; then the host must end with .nsysu.edu.tw, or be sites.google.com under
    /math.nsysu.edu.tw. Story `sources` do not use it."""
    if not isinstance(url, str) or not url or len(url) > 2048:
        return False
    if not re.fullmatch(r'[\x21-\x7e]+', url) or '\\' in url or re.search(r'%(2e|2f|5c)', url, re.I):
        return False
    if url[:8].lower() != 'https://':
        return False
    authority = re.split(r'[/?#]', url[8:], maxsplit=1)[0]
    if not re.fullmatch(r'[A-Za-z0-9.-]+', authority):  # literal host only: no userinfo, port, percent-encoding or IDN
        return False
    raw_path = re.split(r'[?#]', url[8 + len(authority):], maxsplit=1)[0]
    if re.search(r'(^|/)\.{1,2}(/|$)', raw_path):
        return False
    try:
        parts = urlsplit(url)
        host = (parts.hostname or '').lower()
    except ValueError:
        return False
    path = parts.path
    if len(host) > len('.nsysu.edu.tw') and host.endswith('.nsysu.edu.tw'):
        return True
    return host == 'sites.google.com' and (path == '/math.nsysu.edu.tw' or path.startswith('/math.nsysu.edu.tw/'))


def check_links(links, label, check):
    """`links` of a quest or a step: optional list of {label, url}, at most MAX_LINKS, every url allowed."""
    if links is None:
        return
    if not isinstance(links, list):
        check(False, f'{label}: links must be a list')
        return
    check(len(links) <= MAX_LINKS, f'{label}: more than {MAX_LINKS} links')
    for i, link in enumerate(links):
        ok = isinstance(link, dict) and isinstance(link.get('label'), str) and link['label'].strip() and isinstance(link.get('url'), str)
        check(ok, f'{label}: links[{i}] needs label and url')
        if ok:
            check(allowed_link(link['url']), f'{label}: links[{i}] url not allowed {link["url"]}')


def accept_times(quest):
    """Times of day a new acceptance is possible; older data without the field counts as the first step's time (or day)."""
    times = quest.get('accept', {}).get('times')
    if times:
        return list(times)
    return [quest['steps'][0].get('when') or next((s['when'] for s in quest['steps'] if s.get('when')), 'day')]


def placements(npcs, zones, chapters, graph, errors=None):
    """NPC position per time of day and completed-chapter count, and the anchor resolver, shared by checks and the route audit."""
    people = {n['id']: n for n in npcs['npcs']}
    zone_map, anchors = zones['zones'], graph['anchors']
    chapters_list = chapters['chapters']
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
            if errors is not None:
                errors.append(f'NPC {npc}/{time}: unresolved anchor {at}')
            return None
        offset = spec.get('offset', [0, 0])
        return [p[0] + offset[0], p[1] + offset[1]]

    return people, anchor, placement


def verify(quests, encounters, npcs, zones, chapters, graph, structure, collection=None):
    errors, results = [], set()
    flags = quest_flags(quests)
    def check(ok, message):
        if not ok:
            errors.append(message)
    people, anchor, placement = placements(npcs, zones, chapters, graph, errors)
    zone_map, anchors = zones['zones'], graph['anchors']
    chapters_list = chapters['chapters']
    chapter_ids = [c['id'] for c in chapters_list]

    for name in ('IL', 'ACTIVITY'):
        check(name in anchors and anchor(name) is not None, f'routes.anchor({name}) does not resolve')

    spots = quests.get('spots', {})
    kinds = set(re.search(r'export type SpotKind = (.*?);', (ROOT / 'src/world/quest-spots.ts').read_text(), re.S).group(1).replace("'", '').replace(' ', '').split('|'))
    footprints = [l['polygon'] for l in structure['context']['landmarks'] if l.get('storeys')]
    live_edges = [(graph['nodes'][a]['p'], graph['nodes'][b]['p']) for (a, b, _), kind in zip(graph['edges'], graph['edgeKind']) if kind != 'tunnel']
    def path_distance(x, z):
        return min(segment_distance(x, z, (a[0], a[2]), (b[0], b[2])) for a, b in live_edges)
    used_spots, spot_owner = set(), {}
    items = {i['id']: i for i in (collection or {'items': []})['items']}
    for sid, s in spots.items():
        check(s.get('kind') in kinds, f'spot {sid}: unknown kind {s.get("kind")}')
        check(bool(s.get('label')), f'spot {sid}: missing label')
        (x, z), (sx, sz) = s['at'], s['stand']
        check(math.hypot(x - sx, z - sz) <= STAND_REACH, f'spot {sid}: stand point out of reach of the object')
        if s.get('y') is None:  # with y it sits indoors or under the hill by design; tools/v9_visibility_qa.py proves it reachable.
            for px, pz, what in ((x, z, 'object'), (sx, sz, 'stand point')):
                check(not any(point_in_polygon(px, pz, polygon) for polygon in footprints), f'spot {sid}: {what} inside a building footprint')
                check(path_distance(px, pz) <= PATH_REACH, f'spot {sid}: {what} too far from the walking network')

    def target_point(target, time, count):
        kind, _, name = target.partition(':')
        if kind == 'npc':
            return placement(name, time, count)
        if kind == 'spot':
            return spots[name]['at'] if name in spots else None
        return anchor(name) if kind == 'zone' else None

    def reference(target, label):
        kind, _, name = target.partition(':')
        known = (kind == 'npc' and name in people) or (kind == 'zone' and anchor(name) is not None) or (kind == 'spot' and name in spots) or (kind == 'dest' and name in building_rooms(name))
        check(known, f'{label}: unknown target {target}')

    # ---- save compatibility contract ----------------------------------------------------------------------------------
    check(quests.get('version') == 1, 'quest data version must stay 1')
    contract = quests.get('saveContract') or {}
    check(contract.get('revision') == 1 and isinstance(contract.get('quests'), dict), 'saveContract must be the revision-1 snapshot')
    legacy = contract.get('quests', {})
    current_ids = [q['id'] for q in quests['quests']]
    check(len(set(current_ids)) == len(current_ids), 'duplicate quest id')
    check(len(current_ids) == 14 and set(current_ids) == set(legacy), f'the fourteen quest ids must match the save contract (have {sorted(current_ids)})')
    for qid in legacy:
        check(qid in current_ids, f'{qid}: quest in the save contract no longer exists')
    for q in quests['quests']:
        label = q['id']
        snapshot = legacy.get(label)
        check(snapshot is not None, f'{label}: quest missing from the save contract')
        revision = q.get('revision', 1)
        check(isinstance(revision, int) and revision >= 1, f'{label}: revision must be a positive integer')
        ids = [s['id'] for s in q['steps']]
        check(len(set(ids)) == len(ids), f'{label}: duplicate step id')
        check(ids and ids[-1] == 'return' and len(q['steps'][-1].get('choices', [])) >= 2, f'{label}: delivery must be last, as `return` with choices')
        if snapshot is None:
            continue
        check(q['reward'] == snapshot['reward'] or snapshot['reward'] in q.get('legacyRewards', []), f'{label}: reward changed')
        gate = q.get('accept', {}).get('chapterDone')
        check(gate in chapter_ids and snapshot['gate'] in chapter_ids and chapter_ids.index(gate) <= chapter_ids.index(snapshot['gate']), f'{label}: incorrect chapter gate {gate}')
        legacy_steps = q.get('legacySteps', {})
        for retired, current in legacy_steps.items():
            check(retired not in ids, f'{label}: legacySteps retires {retired}, which still exists')
            check(current in ids, f'{label}: legacySteps maps {retired} to missing {current}')
        missing = [sid for sid in snapshot['steps'] if sid not in ids and legacy_steps.get(sid) not in ids]
        check(not missing, f'{label}: save step IDs/count changed against the revision-1 contract (missing {missing})')
        order = q.get('legacyStepOrder')
        if ids != snapshot['steps']:
            check(revision >= 2, f'{label}: steps moved without a revision bump')
            check(order == snapshot['steps'], f'{label}: legacyStepOrder must equal the revision-1 step order {snapshot["steps"]}')
        else:
            check(order in (None, snapshot['steps']), f'{label}: legacyStepOrder disagrees with the revision-1 order')
        for sid, choice_ids in snapshot['choices'].items():
            step = next((s for s in q['steps'] if s['id'] == sid), None)
            have = [c['id'] for c in step.get('choices', [])] if step else []
            check(all(c in have for c in choice_ids), f'{label}/{sid}: saved choice ids {choice_ids} must stay available')

    for q in quests['quests']:
        label = q['id']
        gate = q.get('accept', {}).get('chapterDone')
        reference(q.get('accept', {}).get('near', ''), label + '/accept')
        check(q.get('accept', {}).get('near') == 'npc:' + q['npc'], f'{label}: acceptance must be at its NPC')
        check(q['steps'][0]['target'] == q['accept']['near'] or any(l.get('who') == q['npc'] for l in q['accept'].get('lines', [])), f'{label}: the NPC must ask on acceptance')
        count_min = chapter_ids.index(gate) + 1 if gate in chapter_ids else 0
        times = q.get('accept', {}).get('times')
        check(isinstance(times, list) and times and all(t in TIMES for t in times) and len(set(times)) == len(times), f'{label}: accept.times must list distinct times of day')
        check_links(q.get('links'), label, check)
        for time in accept_times(q):
            for count in range(count_min, len(chapters_list) + 1):
                check(placement(q['npc'], time, count) is not None, f'{label}/{time}/chapter-count={count}: acceptable while the giver is off campus')
                for step in q['steps']:
                    if step['target'].startswith('npc:') and step.get('when', time) == time:
                        check(placement(step['target'][4:], time, count) is not None, f'{label}/{step["id"]}/{time}/chapter-count={count}: acceptable while {step["target"]} is off campus')
        inherited = None
        for step in q['steps']:
            sl = f"{label}/{step['id']}"
            reference(step['target'], sl)
            kind, _, name = step['target'].partition(':')
            check(kind != 'zone', f'{sl}: a quest step needs something to see (spot:, dest: or npc:), not a bare zone')
            if kind == 'spot':
                used_spots.add(name)
                if name in spots:
                    owner = spot_owner.setdefault(name, label)
                    check(owner == label, f'{sl}: spot {name} already belongs to {owner} (one object per spot)')
                limit = PHOTO_RADIUS if step.get('kind') == 'photo' else SPOT_RADIUS
                check(step.get('radius', 4) <= limit, f'{sl}: radius over {limit} m')
                check(name not in spots or spots[name]['kind'] == 'viewpoint' or step.get('kind') != 'photo', f'{sl}: a photo step marks a viewpoint')
                if name in spots and spots[name].get('y') is None and q['zone'] in zone_map:
                    z = zone_map[q['zone']]['p']
                    check(math.dist(spots[name]['at'], z) <= ZONE_REACH or any(math.dist(spots[name]['at'], zone_map[t]['p']) <= ZONE_REACH for t in zone_map), f'{sl}: spot strays from any named place')
            check(step.get('when', 'day') in TIMES, f'{sl}: invalid time')
            inherited = step.get('when', inherited)
            check(bool(step.get('lines')), f'{sl}: missing on-location lines')
            check_links(step.get('links'), sl, check)
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
        # ---- works: what a finished quest leaves in the world ------------------------------------------------------------
        work_ids = set()
        for work in q.get('works', []):
            wl = f"{label}/work:{work.get('id')}"
            check(work.get('id') and work['id'] not in work_ids, f'{wl}: missing or duplicate work id')
            work_ids.add(work.get('id'))
            check(work.get('spot') in spots, f'{wl}: unknown spot {work.get("spot")}')
            if work.get('spot') in spots:
                used_spots.add(work['spot'])
                owner = spot_owner.setdefault(work['spot'], label)
                check(owner == label, f'{wl}: spot {work["spot"]} already belongs to {owner} (one object per spot)')
            for cond in [work.get('if')] + [v.get('if') for v in work.get('variants', [])]:
                for flag in cond_flags(cond):
                    check(flag in flags, f'{wl}: condition uses unknown quest flag {flag}')
            for v in work.get('variants', []):
                check(v.get('kind') in kinds, f'{wl}: unknown variant kind {v.get("kind")}')
        # ---- completion rewards: one collectible per quest ---------------------------------------------------------------
        rewards = q.get('completionRewards', [])
        check(len(rewards) == 1 and rewards[0].get('kind') == 'item' and rewards[0].get('itemId') == f'item-quest-{label}', f'{label}: completionRewards must be the one item item-quest-{label}')
        for r in rewards:
            item = items.get(r.get('itemId'))
            check(item is not None and item.get('group') == 'quest', f'{label}: collectible {r.get("itemId")} missing from collection.json or not group quest')
            by = r.get('variantBy')
            if by is not None:
                step = next((s for s in q['steps'] if s['id'] == by), None)
                check(step is not None and bool(step.get('choices')), f'{label}: variantBy {by} is not a choice step')
                if item is not None and step is not None:
                    have = set((item.get('variants') or {}).keys())
                    for c in step.get('choices', []):
                        check(c['id'] in have and all(item['variants'][c['id']].get(k) for k in ('name', 'desc')), f'{label}: collectible {r.get("itemId")} needs variant {c["id"]} with name and desc')
    check(len(results) == RESULTS, f'expected {RESULTS} distinct choice results')
    for sid in spots:
        check(sid in used_spots, f'spot {sid}: no step or work uses it')
    for item_id, item in items.items():
        if item.get('group') == 'quest':
            check(any(r.get('itemId') == item_id for q in quests['quests'] for r in q.get('completionRewards', [])), f'collectible {item_id}: no quest grants it')
    # ---- schedule overrides (npcs.json, applied by npc.ts): same zone as the base schedule, known quest flags --------------
    for i, o in enumerate(npcs.get('scheduleOverrides', []) or []):
        ol = f'scheduleOverrides[{i}]'
        check(o.get('npc') in people, f'{ol}: unknown npc {o.get("npc")}')
        check(o.get('preset') in TIMES, f'{ol}: invalid preset {o.get("preset")}')
        base = people.get(o.get('npc'), {}).get('schedule', {}).get(o.get('preset')) if o.get('npc') in people and o.get('preset') in TIMES else None
        check(base is not None and o.get('at') == base.get('at'), f'{ol}: override must keep the base schedule zone {base.get("at") if base else None}')
        for flag in cond_flags(o.get('if')):
            check(flag in flags, f'{ol}: condition uses unknown quest flag {flag}')
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


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def verify_seats(npcs, zones, graph):
    """The v11 seat registry against the people and activities that sit on it. Returns error strings."""
    errors = []
    def check(ok, message):
        if not ok:
            errors.append(message)
    seats = zones.get('seats') or {}
    check(isinstance(seats, dict) and bool(seats), 'story-zones.json needs a non-empty `seats` registry')
    if not isinstance(seats, dict):
        return errors
    _, anchor, _ = placements(npcs, zones, {'chapters': []}, graph)
    for sid, s in seats.items():
        sl = f'seat {sid}'
        foot = s.get('foot')
        check(isinstance(foot, list) and len(foot) == 2 and all(finite(v) for v in foot), f'{sl}: foot must be two finite numbers')
        check(finite(s.get('yaw')), f'{sl}: yaw must be finite')
        check(s.get('pose') == 'chair', f'{sl}: pose must be chair')
        check(finite(s.get('surfaceHeight')) and s['surfaceHeight'] > 0, f'{sl}: surfaceHeight must be positive')
        check(finite(s.get('approachRadius')) and s['approachRadius'] > 0, f'{sl}: approachRadius must be positive')
        check('y' not in s or finite(s['y']), f'{sl}: y must be finite')
        prop = s.get('prop')
        check(isinstance(prop, dict) and prop.get('kind') == 'bench', f'{sl}: prop.kind must be bench')
        if isinstance(prop, dict):
            check(isinstance(prop.get('offset'), list) and len(prop['offset']) == 3 and all(finite(v) for v in prop['offset']), f'{sl}: prop.offset must be three finite numbers')
            check(finite(prop.get('yaw')), f'{sl}: prop.yaw must be finite')
            check('scale' not in prop or (finite(prop['scale']) and prop['scale'] > 0), f'{sl}: prop.scale must be positive')
    good = {sid: s['foot'] for sid, s in seats.items() if isinstance(s.get('foot'), list) and len(s['foot']) == 2 and all(finite(v) for v in s['foot'])}
    ids = sorted(good)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            check(math.dist(good[a], good[b]) >= SEAT_GAP, f'seats {a} and {b} are under {SEAT_GAP} m apart')
    def station(spec):
        at = spec.get('at')
        p = anchor(at) if isinstance(at, str) else at
        if p is None:
            return None
        offset = spec.get('offset', [0, 0])
        return [p[0] + offset[0], p[1] + offset[1]]
    npc_seats = {}
    def sitter(npc, spec, where):
        if not spec or spec.get('activity') != 'Sit':
            check('seat' not in spec if spec else True, f'{where}: seat without a Sit activity')
            return
        sid = spec.get('seat')
        check(isinstance(sid, str) and sid in seats, f'{where}: human Sit needs an existing seat (have {sid})')
        if sid in good:
            npc_seats.setdefault(sid, set()).add(npc)
            p = station(spec)
            check(p is not None and math.dist(p, good[sid]) <= SEAT_REACH, f'{where}: seat {sid} is over {SEAT_REACH} m from the station')
    for n in npcs['npcs']:
        if n.get('model') == 'monkey':
            continue
        for time, spec in (n.get('schedule') or {}).items():
            sitter(n['id'], spec, f'{n["id"]}/{time}')
    people = {n['id']: n for n in npcs['npcs']}
    for i, o in enumerate(npcs.get('scheduleOverrides') or []):
        if people.get(o.get('npc'), {}).get('model') == 'monkey':
            continue
        sitter(o.get('npc'), o, f'scheduleOverrides[{i}]')
    for sid, who in npc_seats.items():
        check(len(who) == 1, f'seat {sid}: shared by {sorted(who)}')
    zone_map = zones['zones']
    for zid, z in zone_map.items():
        sid = z.get('seat')
        if sid is None:
            continue
        check(sid in seats, f'zone {zid}: unknown seat {sid}')
        if sid in good:
            check(math.dist(good[sid], z['p']) <= z['r'], f'zone {zid}: seat {sid} outside the zone radius')
            check(sid not in npc_seats, f'zone {zid}: player seat {sid} is also an NPC seat')
    for e in npcs.get('events') or []:
        for j, step in enumerate((e.get('activity') or {}).get('steps', [])):
            if not step.get('sit'):
                continue
            kind, _, name = step.get('target', '').partition(':')
            check(kind == 'zone' and name in zone_map and zone_map[name].get('seat') in seats, f'{e["id"]}/steps[{j}]: a sit step needs a zone with a seat')
            if kind == 'zone' and name in zone_map and zone_map[name].get('seat') in good and step.get('max') is not None:
                check(math.dist(good[zone_map[name]['seat']], zone_map[name]['p']) <= step['max'], f'{e["id"]}/steps[{j}]: seat outside the stay radius')
    return errors


def quest_route(quest, spots, placement, chapter_count, time=None):
    """Straight-line legs of a quest, from its giver through every step, accepted at `time` (default: the first timed step's
    time, or day) and continued at each step's own `when` where it has one.
    Returns (legs, total, net): legs are (from, to, metres) or (from, to, None) when a `dest:` room has no coordinate."""
    def point(target, time):
        kind, _, name = target.partition(':')
        if kind == 'npc':
            return placement(name, time, chapter_count)
        if kind == 'spot':
            return spots.get(name, {}).get('at')
        return None
    inherited = time or quest['steps'][0].get('when') or next((s['when'] for s in quest['steps'] if s.get('when')), 'day')
    stops = [(quest['accept']['near'], point(quest['accept']['near'], inherited))]
    for step in quest['steps']:
        inherited = step.get('when', inherited)
        stops.append((step['target'], point(step['target'], inherited)))
    legs = []
    for (a, pa), (b, pb) in zip(stops, stops[1:]):
        legs.append((a, b, math.dist(pa, pb) if pa is not None and pb is not None else None))
    known = [d for _, _, d in legs if d is not None]
    total = sum(known)
    first = next((p for _, p in stops if p is not None), None)
    last = next((p for _, p in reversed(stops) if p is not None), None)
    net = math.dist(first, last) if first is not None and last is not None else None
    return legs, total, net


def route_warnings(quests, npcs, zones, chapters, graph):
    """Long legs and retracing at every acceptable time of day, as text with the numbers (spec-v10 §3, v10.2 §1). Never fails a build."""
    _, _, placement = placements(npcs, zones, chapters, graph)
    spots = quests.get('spots', {})
    out = []
    for q in quests['quests']:
        for time in accept_times(q):
            legs, total, net = quest_route(q, spots, placement, len(chapters['chapters']), time)
            for a, b, d in legs:
                if d is not None and d > ROUTE_LEG_WARN:
                    out.append(f'{q["id"]}/{time}: {a} → {b} is {d:.0f} m in a straight line (over {ROUTE_LEG_WARN} m)')
            if net is not None and total >= ROUTE_MIN_TOTAL:
                retrace = 1 - net / total if total else 0
                if retrace > ROUTE_RETRACE_WARN:
                    out.append(f'{q["id"]}/{time}: retrace {retrace:.0%} of {total:.0f} m (net displacement {net:.0f} m, over {ROUTE_RETRACE_WARN:.0%})')
    return out


if __name__ == '__main__':
    data = load()
    errors = verify(*data)
    errors += verify_seats(data[2], data[3], data[5])
    for error in errors:
        print(error, file=sys.stderr)
    quests, _, npcs, zones, chapters, graph, _, _ = data
    for warning in route_warnings(quests, npcs, zones, chapters, graph):
        print(f'warning: {warning}', file=sys.stderr)
    print(f'quests: {"FAIL" if errors else "OK"}（{len(quests["quests"])} 個任務、{RESULTS} 個結果、實體目標、排程、錨點、成果、收藏品、官網連結、座位與舊存檔契約）')
    sys.exit(bool(errors))
