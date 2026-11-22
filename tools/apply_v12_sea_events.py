#!/usr/bin/env python3
"""v12.1 WP-D2：海域、公車、運動區的 NPC、對話樹與事件 → public/data/npcs.json、public/data/story-zones.json。

    python3 -B tools/apply_v12_sea_events.py            # 寫檔（冪等：依 id 合併，其他內容不動）
    python3 -B tools/apply_v12_sea_events.py --dry-run
    python3 -B tools/apply_v12_sea_events.py --check

要先跑 apply_v12_sea.py 與 apply_v12_sports.py：NPC 站位的 zone 座標取自 sea.json 與 sports.json，不在這裡另寫一份。
台詞取自 round2-gemini.md §4.2 的定稿（每句 ≤28 字、全形標點、只用稱謂）；選項的回話是一般生活台詞或已核准來源的內容。
救生員的情境台詞與立牌文案在 sea.json，公車到站與末班台詞在 bus-routes.json，這裡不重複。
事件：
  ev-surf-class    衝浪課（S6、S14）：兩個 rhythm 步驟，各帶 presentation:'surf'
  ev-sail-regatta  臺日風帆友誼賽情境重現（S7）：在海堤觀賞點停留觀看
公車司機的 schedule 三個時段都是 null：他們不站在世界裡，由 bus runtime 放進車內。
"""
from __future__ import annotations

import v12_world_common as C

NPCS = C.DATA / 'npcs.json'
ZONES = C.DATA / 'story-zones.json'
SEA = C.DATA / 'sea.json'
SPORTS = C.DATA / 'sports.json'


def person(pid, name, role, model, hair, top, bottom, hair_style, top_style, schedule, accessory=None, skin='#e9bf98'):
    portrait = {'skin': skin, 'hair': hair, 'hairStyle': hair_style, 'top': top, 'topStyle': top_style}
    if accessory:
        portrait['accessory'] = accessory
    return {'id': pid, 'name': name, 'role': role, 'model': model, 'look': {'hair': hair, 'top': top, 'bottom': bottom, 'shoes': '#fbf6ea'},
            'portrait': portrait, 'schedule': schedule, 'talk': pid}


def at(zone, offset, day=True, sunset=True, night=False, activity='Idle'):
    spot = {'at': zone, 'offset': list(offset), 'activity': activity}
    return {'day': dict(spot) if day else None, 'sunset': dict(spot) if sunset else None, 'night': dict(spot) if night else None}


NOWHERE = {'day': None, 'sunset': None, 'night': None}
PEOPLE = [
    person('lifeguard-sea', '救生員', '西子灣沙灘救生員', 'npc-volunteer', '#2b2622', '#e04b3a', '#f3ebdb', 'short', 'vest', at('beach-lifeguard', (1.5, 1.5)), 'cap', '#d9a77f'),
    person('marine-clerk', '租借員', '海域中心器材租借', 'npc-clerk', '#3a2a24', '#2c7f91', '#2f4a6a', 'ponytail', 'tee', at('sea-center', (0, 1.5)), 'nametag'),
    person('surf-coach', '衝浪教練', '運健中心的老師', 'npc-teacher', '#1f1a18', '#f27a2c', '#2a2c4a', 'short', 'tee', at('surf-zone', (1.5, 0), sunset=False), None, '#d9a77f'),
    person('sail-student', '風帆社同學', '在海堤看帆船的學生', 'npc-student-2', '#2b2622', '#62c8d2', '#2a2c4a', 'bob', 'jacket', at('sail-view', (5.5, -6.0))),
    person('bus-driver-campus', '校園公車司機', '校園公車駕駛', 'npc-guard', '#6b6f78', '#f3ebdb', '#2a3a5c', 'short', 'uniform', dict(NOWHERE), 'cap', '#d9a77f'),
    person('bus-driver-orange', '橘一延司機', '橘1延駕駛', 'npc-guard', '#1f1a18', '#f27a2c', '#2a3a5c', 'short', 'uniform', dict(NOWHERE), 'cap'),
    person('runner-1', '跑步的同學', '在田徑場慢跑', 'npc-student-5', '#2b2622', '#d9a521', '#2a2c4a', 'short', 'tee', at('track', (0, 0))),
    person('swimmer-1', '游泳的同學', '剛游完的學生', 'npc-student-1', '#3a2a24', '#2c7f91', '#2a2c4a', 'bob', 'tee', at('pool', (0, 0))),
    person('swimmer-2', '泳池邊的同學', '在池邊休息的學生', 'npc-student-6', '#1f1a18', '#62c8d2', '#2f4a6a', 'short', 'tee', at('pool', (6, 0.3), sunset=False)),
    person('gym-1', '健身的同學', '要去體適能中心', 'npc-student-3', '#2b2622', '#7b4a8f', '#2a2c4a', 'short', 'hoodie', at('gym-portal', (3, -0.5))),
    person('gym-2', '重訓的同學', '剛練完的學生', 'npc-student-4', '#5a4030', '#e04b3a', '#6b6f78', 'ponytail', 'tee', at('gym-portal', (-3.5, -1.0), sunset=False)),
]


def tree(who, opening, a, b):
    """開場一句，兩個選項各接一句回話。a、b = (選項文字, 回話)。"""
    return {'entries': [{'node': 'root'}], 'nodes': {
        'root': {'lines': [{'who': who, 'text': opening}], 'choices': [{'text': a[0], 'next': 'a'}, {'text': b[0], 'next': 'b'}]},
        'a': {'lines': [{'who': who, 'text': a[1]}]},
        'b': {'lines': [{'who': who, 'text': b[1]}]},
    }}


COACH_BRIEFING = '先練趴板划水和起乘姿勢！看準節奏推板站起來，別急。'
COACH_SAFETY = '記熟魚雷浮標和上岸召回信號，泳力和體力都很重要喔。'
REGATTA_INTRO = '臺日風帆友誼賽開賽了！四對四雷射帆船，五戰三勝喔。'
REGATTA_LORE = '聽說二零二五年那屆中山在西子灣逆轉奪勝，真熱血！'
THANKS = '不客氣，車開動時記得坐穩扶好。'
TREES = {
    'lifeguard-sea': tree('lifeguard-sea', '救生橡皮艇會在活動日拉到沙灘，校內也有水中救生課。',
                          ('「什麼時候不能下水？」', '遇上海上颱風警報或打雷就得停止活動離場，安全第一。'),
                          ('「游泳區到哪裡？」', '游泳只能在浮球圈起來的範圍，別游到外面去。')),
    'marine-clerk': tree('marine-clerk', '海域中心有立式划槳和獨木舟，想試哪一種？',
                         ('「立式划槳。」', '好喔，借立式划槳請先登記，拿好槳沿著航線慢慢划。'),
                         ('「獨木舟。」', '獨木舟要推到海水及膝再跨坐上去，傍晚划還能看夕陽！')),
    'surf-coach': tree('surf-coach', COACH_BRIEFING, ('「要注意什麼？」', COACH_SAFETY), ('「我先看看。」', '好，先在沙灘上看大家怎麼划水。')),
    'sail-student': tree('sail-student', REGATTA_LORE,
                         ('「比賽怎麼比？」', '四對四的團隊賽，用雷射帆船，五航次先拿三勝。'),
                         ('「哪裡看得清楚？」', '站在海堤這邊，整片海面都看得到。')),
    'bus-driver-campus': tree('bus-driver-campus', '歡迎上車，校園公車出示教職員工生證件就免費，請坐穩。',
                              ('「這班開到哪？」', '從校門上山到文學院，再原路開回校門。'), ('「謝謝司機。」', THANKS)),
    'bus-driver-orange': tree('bus-driver-orange', '歡迎搭橘一延，這班下山會經海科院和海工館，請坐穩。',
                              ('「這班開到哪？」', '過了文學院會繞海科院和海工館，再回校門。'), ('「謝謝司機。」', THANKS)),
    'runner-1': tree('runner-1', '在田徑場邊吹西子灣海風邊慢跑，傍晚時段最舒服了！',
                     ('「一起跑？」', '要不要來跑一圈計時？跑完記得到旁邊拉筋收操喔。'), ('「我用走的就好。」', '散步也很好，海風一樣吹得到。')),
    'swimmer-1': tree('swimmer-1', '剛在游泳池游完幾個來回，下水前一定要先熱身伸展喔。',
                      ('「池子有多長？」', '從水道入口下水，游到對面再游回來就能計時。'), ('「我也去暖身。」', '記得手腳都動一動，再慢慢下水。')),
    'swimmer-2': tree('swimmer-2', '這裡池邊就有專任救生員看顧，游累了先靠牆喘口氣吧。',
                      ('「要不要比一趟？」', '好啊，來回一趟計時，輸的人請喝飲料！'), ('「我先休息。」', '慢慢來，游泳本來就不用急。')),
    'gym-1': tree('gym-1', '體育館裡面就有體適能中心，下課順路來練一組剛剛好！',
                  ('「入口在哪裡？」', '從體育館外牆的入口進去就到了。'), ('「今天練什麼？」', '先上跑步機暖身，再去踩健身車。')),
    'gym-2': tree('gym-2', '學校有第一和第二兩座體適能中心，練完記得多補充水分。',
                  ('「一起練？」', '好啊，跑步機旁邊還有空位。'), ('「下次吧。」', '沒問題，下次有空再一起來運動！')),
}
# 每棵樹的事實依據；一般生活台詞不列。
TREE_SOURCES = {'lifeguard-sea': ['S1', 'S4', 'S5', 'S13'], 'marine-clerk': ['S2', 'S3', 'S12'], 'surf-coach': ['S6', 'S14'], 'sail-student': ['S7'],
                'bus-driver-campus': ['S10', 'S11'], 'bus-driver-orange': ['S10'], 'runner-1': ['S8'], 'swimmer-1': ['S8', 'S9'], 'swimmer-2': ['S4'],
                'gym-1': ['S9'], 'gym-2': ['S8']}

EVENTS = [
    {'id': 'ev-surf-class', 'when': 'day', 'anchor': 'zone:surf-zone', 'radius': 22, 'npcs': ['surf-coach'],
     'banner': '初級衝浪課在沙灘集合了', 'title': '沙灘上的初級衝浪課', 'journal': '白天的西子灣沙灘，運健中心的老師帶著初級衝浪課。',
     'lines': [{'who': 'surf-coach', 'text': COACH_BRIEFING}], 'seaActivity': 'surf-class', **C.binding('S6', 'S14'),
     'activity': {
         'id': 'surf-class', 'host': 'surf-coach', 'invite': '要不要跟著練一次？先趴板划水，再試起乘。', 'accept': '好，我來試', 'decline': '我先看看', 'inviteDelay': 3,
         'steps': [
             {'kind': 'near', 'target': 'zone:surf-zone', 'max': 8, 'text': '走到沙灘上的衝浪教學區'},
             {'kind': 'rhythm', 'id': 'paddle', 'presentation': 'surf', 'style': 'surf-paddle', 'cues': 6, 'interval': 2.4, 'lead': 2, 'window': 0.25, 'need': 4,
              'text': '趴板划水：浪到時按下，成功划水 4 次'},
             {'kind': 'rhythm', 'id': 'popup', 'presentation': 'surf', 'style': 'surf-popup', 'cues': 5, 'interval': 3.2, 'lead': 2.5, 'window': 0.25, 'need': 3,
              'text': '起乘：看準浪峰按下，站起 3 次'}],
         'onDone': [{'kind': 'say', 'who': 'surf-coach', 'text': COACH_SAFETY}],
         'timeout': 150, 'cooldown': 300,
         'journal': {'title': '初級衝浪課體驗', 'done': '跟著老師練了趴板划水和起乘。', 'partial': '這次跟上了 {hits} 個浪，下次再練。',
                     'abandoned': '這次沒有練到最後。', 'declined': '這次先在沙灘上看。'}}},
    {'id': 'ev-sail-regatta', 'when': 'day', 'anchor': 'zone:sail-view', 'radius': 25, 'npcs': ['sail-student'],
     'banner': '情境重現：臺日風帆友誼賽，八艘帆船出海', 'title': '臺日風帆友誼賽（情境重現）',
     'journal': '海堤外的海面上，重現二零二五年第四屆臺日風帆友誼賽的四對四團隊賽。',
     'lines': [{'who': 'sail-student', 'text': REGATTA_INTRO}], 'seaActivity': 'sailing-show', 'show': 'sail-regatta-2025', 'reenactment': True, **C.binding('S7'),
     'activity': {
         'id': 'sail-regatta-watch', 'host': 'sail-student', 'invite': '要一起看嗎？站在這裡看得最清楚。', 'accept': '好，一起看', 'decline': '我先走走', 'inviteDelay': 3,
         'steps': [{'kind': 'stay', 'target': 'zone:sail-view', 'max': 10, 'hold': 30, 'text': '留在海堤觀賞點看帆船 30 秒'}],
         'onDone': [{'kind': 'say', 'who': 'sail-student', 'text': REGATTA_LORE}],
         'timeout': 120, 'cooldown': 300,
         'journal': {'title': '看臺日風帆友誼賽重現', 'done': '在海堤看完了八艘雷射帆船的情境重現。', 'abandoned': '這次沒有看到最後。', 'declined': '這次先走走，下次再看。'}}},
]


def zones_from(sea: dict, sports: dict) -> dict:
    try:
        desk, chair = sea['seaCenter']['rentalDesk'], sea['lifeguardChair']['position']
        surf, view = sea['surfZone']['beachPoint'], (sea.get('sailingViewPoint') or sea['sailingViewpoint'])['position']
        pool = next(b for b in sea['waterBodies'] if b['id'] == 'pool-main')['polygon']
        start = next(c for c in sports['courses'] if c['id'] == 'track-lap')['gates'][0]
        portal = sports['portals'][0]['exteriorReturnPoints'][0]
    except (KeyError, StopIteration, IndexError, TypeError) as e:
        C.die(f'sea.json 或 sports.json 缺少需要的欄位（{e!r}）；請重跑 apply_v12_sea.py 與 apply_v12_sports.py')
    x0, _, x1, z1 = C.bbox(pool)
    return {
        'sea-center': {'label': '海域中心（位置示意）', 'sub': 'MARINE SPORTS CENTER', 'p': C.P2(desk[0], desk[2]), 'r': 14},
        'beach-lifeguard': {'label': '西子灣沙灘・救生員椅', 'sub': 'LIFEGUARD', 'p': C.P2(chair[0], chair[2]), 'r': 12},
        'surf-zone': {'label': '衝浪教學區', 'sub': 'SURF CLASS', 'p': C.P2(surf[0], surf[2]), 'r': 12},
        'sail-view': {'label': '海堤觀賞點', 'sub': 'SAILING VIEW', 'p': C.P2(view[0], view[2]), 'r': 10},
        'track': {'label': '田徑場', 'sub': 'TRACK', 'p': C.P2(start['b'][0] - 9.0, start['b'][2]), 'r': 12},
        'pool': {'label': '游泳池', 'sub': 'SWIMMING POOL', 'p': C.P2((x0 + x1) / 2 + 10.0, z1 + 2.5), 'r': 14},
        'gym-portal': {'label': '體育館・體適能中心入口', 'sub': 'FITNESS CENTER', 'p': C.P2(portal[0], portal[2]), 'r': 8},
    }


def self_check(zones: dict) -> list[str]:
    errors = []
    ids = {p['id'] for p in PEOPLE}
    for pid, t in TREES.items():
        if pid not in ids:
            errors.append(f'對話樹 {pid} 沒有對應的 NPC')
        for nid, node in t['nodes'].items():
            for line in node['lines']:
                errors += [f'{pid}/{nid}：{m}' for m in C.lint_line(line['text'])]
            for choice in node.get('choices', []):
                if len(choice['text']) > 20:
                    errors.append(f'{pid}/{nid}：選項超過 20 字：{choice["text"]}')
    for p in PEOPLE:
        if p['talk'] not in TREES:
            errors.append(f'NPC {p["id"]} 沒有對話樹')
        for spot in p['schedule'].values():
            if spot and spot['at'] not in zones:
                errors.append(f'NPC {p["id"]} 的站位 {spot["at"]} 不是這支工具定義的 zone')
    for e in EVENTS:
        for line in e.get('lines', []) + [r for r in e['activity'].get('onDone', []) if r['kind'] == 'say']:
            errors += [f'{e["id"]}：{m}' for m in C.lint_line(line['text'])]
        errors += [f'{e["id"]} 邀請：{m}' for m in C.lint_line(e['activity']['invite'])]
        for who in e['npcs']:
            if who not in ids:
                errors.append(f'{e["id"]}：參與者 {who} 不是這支工具定義的 NPC')
        for s in e['activity']['steps']:
            if s['kind'] == 'rhythm' and not (0 <= s['window'] < s['interval'] / 2 and 1 <= s['need'] <= s['cues']):
                errors.append(f'{e["id"]}：rhythm 步驟 {s["id"]} 的參數不合法')
            target = s.get('target', '')
            if target.startswith('zone:') and target[5:] not in zones:
                errors.append(f'{e["id"]}：步驟目標 {target} 不存在')
        if e['anchor'][5:] not in zones:
            errors.append(f'{e["id"]}：anchor {e["anchor"]} 不存在')
    return errors


def main():
    args = C.cli(__doc__).parse_args()
    sea = C.read_json(SEA, '請先執行 tools/apply_v12_sea.py。')
    sports = C.read_json(SPORTS, '請先執行 tools/apply_v12_sports.py。')
    zones = zones_from(sea, sports)
    errors = self_check(zones)
    if errors:
        C.die('內容檢查沒過，未寫檔：\n  ' + '\n  '.join(errors))

    data = C.read_json(NPCS)
    for key in ('npcs', 'trees'):
        if key not in data:
            C.die(f'npcs.json 缺少 {key}')
    mine = {p['id']: p for p in PEOPLE}
    kept = [n for n in data['npcs'] if n['id'] not in mine]
    clash = [n['id'] for n in kept if n.get('talk') in TREES]
    if clash:
        C.die(f'這些既有 NPC 用的對話樹 id 與本工具撞名：{clash}')
    data['npcs'] = kept + [{**p, **C.binding(*TREE_SOURCES[p['id']])} for p in PEOPLE]
    data['trees'] = {**{k: v for k, v in data['trees'].items() if k not in TREES}, **TREES}
    current = {e['id']: e for e in data.get('events', [])}
    new_ids = {e['id'] for e in EVENTS}
    # 既有事件保持原順序；本工具的事件放最後，同 id 時這裡定義的欄位優先。
    data['events'] = [e for e in data.get('events', []) if e['id'] not in new_ids] + [{**current.get(e['id'], {}), **e} for e in EVENTS]
    data['v12Sea'] = {'tool': 'tools/apply_v12_sea_events.py', 'npcs': [p['id'] for p in PEOPLE], 'events': [e['id'] for e in EVENTS], 'treeSourceIds': TREE_SOURCES,
                      'note': '海域、公車、運動區的 NPC。公車司機不站在世界裡（schedule 全為 null），由 bus runtime 放進車內。'}

    z = C.read_json(ZONES)
    table = z['zones'] if 'zones' in z else z
    table.update(zones)

    print('NPC 與事件摘要')
    for p in PEOPLE:
        spots = {k: (f'{v["at"]}{v["offset"]}' if v else '—') for k, v in p['schedule'].items()}
        print(f'  NPC {p["id"]:18s} {p["name"]}  {spots}')
    for name, zone in zones.items():
        print(f'  zone {name:16s} p {zone["p"]}  r {zone["r"]}')
    for e in EVENTS:
        print(f'  事件 {e["id"]}：{e["when"]}，{e["anchor"]}，步驟 {[s["kind"] for s in e["activity"]["steps"]]}')
    print(f'  npcs.json：{len(data["npcs"])} 位 NPC、{len(data["trees"])} 棵樹、{len(data["events"])} 個事件')
    stale = [C.emit(NPCS, C.dump(data), args), C.emit(ZONES, C.dump(z), args)]
    C.finish(args, stale, [])


if __name__ == '__main__':
    main()
