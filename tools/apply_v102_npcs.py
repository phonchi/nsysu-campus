"""v10.2 integration (coordinator): NPC schedule moves, Mia's choice-driven seat, one-time reactions to each side-quest
choice, keepsake copy, and the two night-song lines. Copy: Gemini draft (artifacts/v10.2/impl/copy-gemini.json),
edited where it disagreed with the choice or used unverified detail. Idempotent."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
NPCS, COL = ROOT / 'public/data/npcs.json', ROOT / 'public/data/collection.json'
F = lambda q, c: f'quest.{q}.return.{c}'
# npc -> list of (quest, cond-flag, text, insert-before-entry-node, extra-conds, next-node)
R = {
 'guard-chung': [('gate-lost', F('gate-lost', 'a'), '看了告示來認領的同學說對了，卡片物歸原主囉。', 'again', [], 'menu'),
                 ('gate-lost', F('gate-lost', 'b'), '鎖在鐵櫃最穩當，剛才猴子在窗邊晃也沒輒。', 'again', [], 'menu')],
 's1': [('tunnel-leaflet', 'quest.tunnel-leaflet.done', '傳單有人幫我收進箱子了，是你對吧？謝謝！', 'admin-together', [{'chapterDone': 'c3-admin'}], 'admin-hub')],
 'photo-ju': [('tunnel-leaflet', F('tunnel-leaflet', 'a'), '按時間分頁很清楚，大家進洞口一眼就能查。', 'day-root', [{'timeOfDay': 'day'}], 'day-root'),
              ('tunnel-leaflet', F('tunnel-leaflet', 'b'), '按社團分類很整齊，小婷的海洋社直接在首頁。', 'day-root', [{'timeOfDay': 'day'}], 'day-root'),
              ('tunnel-photo', F('tunnel-photo', 'a'), '洞口那張拱圈，我貼在展示板上了。', 'day-root', [{'timeOfDay': 'day'}], 'day-root'),
              ('tunnel-photo', F('tunnel-photo', 'b'), '洞口亮暗光影很生動，路人走進光裡的感覺很棒。', 'day-root', [{'timeOfDay': 'day'}], 'day-root'),
              ('sea-postcard', F('sea-postcard', 'a'), '記下今天的海風，未來的你收到一定會微笑吧。', 'sunset-root', [{'timeOfDay': 'sunset'}], 'sunset-root'),
              ('sea-postcard', F('sea-postcard', 'b'), '把西子灣的夕陽寄給朋友，是最浪漫的問候了。', 'sunset-root', [{'timeOfDay': 'sunset'}], 'sunset-root')],
 'intl-mia': [('gate-mia', F('gate-mia', 'a'), '你推薦的閱讀桌，我每天都來。', 'day-again', [], 'root'),
              ('gate-mia', F('gate-mia', 'b'), '遮陽傘的位子很安靜，海風吹過來特別舒服。', 'day-again', [], 'root')],
 's3': [('admin-list', F('admin-list', 'a'), '櫃台旁的小地圖，新生看了就不迷路。', 'night', [{'chapterDone': 'c4-library'}], 'root'),
        ('admin-list', F('admin-list', 'b'), '條列方向一目了然，從服務台走過來順順的。', 'night', [{'chapterDone': 'c4-library'}], 'root'),
        ('library-corner', F('library-corner', 'a'), '安靜角落的照片貼在推薦牆了，讀者都很喜歡。', 'night', [{'chapterDone': 'c4-library'}], 'root'),
        ('library-corner', F('library-corner', 'b'), '望海位子的照片貼上牆，大家都想去那邊坐。', 'night', [{'chapterDone': 'c4-library'}], 'root')],
 'gardener-hai': [('admin-garden', F('admin-garden', 'a'), '花盆排成一列整整齊齊，走道寬敞推車好過。', 'done', [], 'menu'),
                  ('admin-garden', F('admin-garden', 'b'), '沿著邊界排真好，抬頭就能看見西子灣的海。', 'done', [], 'menu')],
 'poet-wen': [('library-bookmark', F('library-bookmark', 'a'), '溫暖的紙條留在那裡，失主看到心裡一定很踏實。', 'root', [], 'root'),
              ('library-bookmark', F('library-bookmark', 'b'), '收進冊子妥善登記，短句也是一段美麗的相遇。', 'root', [], 'root')],
 'ta-lin': [('arcade-coffee', F('arcade-coffee', 'a'), '那句加油真及時，喝完這杯咖啡又有精神備課了。', 'thanks-again', [], 'menu'),
            ('arcade-coffee', F('arcade-coffee', 'b'), '杯蓋上的笑臉貼紙很可愛，忙碌中看了會心一笑。', 'thanks-again', [], 'menu'),
            ('math-day', F('math-day', 'a'), '你在四樓留的便條我看見了，數學圖書館很棒吧。', 'thanks-again', [], 'menu'),
            ('math-day', F('math-day', 'b'), '國際會議廳空間很開闊，在那裡聽演講收穫很多。', 'thanks-again', [], 'menu')],
 'club-ocean-ting': [('arcade-club', F('arcade-club', 'a'), '冷知識招牌吸引好多人停下來猜，攤位超熱鬧！', 'root', [], 'menu'),
                     ('arcade-club', F('arcade-club', 'b'), '海浪塗鴉遠遠看好顯眼，連走廊對面都看得到。', 'root', [], 'menu')],
 'guitar-yun': [('sea-stage', F('sea-stage', 'a'), 'Mia 帶話了，開場用輕快小調。', 'sunset-root', [{'timeOfDay': 'sunset'}], 'sunset-root'),
                ('sea-stage', F('sea-stage', 'b'), 'Mia 帶話了，開場用海風旋律。', 'sunset-root', [{'timeOfDay': 'sunset'}], 'sunset-root')],
}
SCHEDULE = {  # spec §2, coordinates checked by WP-Q (result-fable.md §5.1)
 'photo-ju': ('day', {'at': 'tunnel-west', 'offset': [-9, -3], 'activity': 'Idle'}),
 'club-ocean-ting': ('day', {'offset': [9, 9.5]}),
 'poet-wen': ('day', {'at': 'library', 'offset': [-10, -1], 'activity': 'Idle'}),
}
OVERRIDES = [
 {'npc': 'intl-mia', 'preset': 'day', 'if': {'flag': F('gate-mia', 'a')}, 'at': 'library', 'offset': [9.6, -5.6], 'activity': 'Sit'},
 {'npc': 'intl-mia', 'preset': 'day', 'if': {'flag': F('gate-mia', 'b')}, 'at': 'library', 'offset': [11.5, -7], 'activity': 'Sit'},
]
n = json.loads(NPCS.read_text())
for npc, (preset, patch) in SCHEDULE.items():
    spec = next(x for x in n['npcs'] if x['id'] == npc); spec['schedule'][preset] = {**(spec['schedule'].get(preset) or {}), **patch}
n['scheduleOverrides'] = OVERRIDES
for npc, rows in R.items():
    tree = n['trees'][npc]
    tree['entries'] = [e for e in tree['entries'] if not e['node'].startswith('v102-')]
    tree['nodes'] = {k: v for k, v in tree['nodes'].items() if not k.startswith('v102-')}
    for quest, flag, text, before, extra, nxt in rows:
        assert len(text) <= 28, (npc, text); assert nxt in tree['nodes'], (npc, nxt)
        node = 'v102-' + flag.replace('quest.', '').replace('.', '-'); seen = f'{npc}.{node}'
        tree['nodes'][node] = {'lines': [{'who': npc, 'text': text}], 'effects': [{'setFlag': seen}], 'next': nxt}
        at = next(i for i, e in enumerate(tree['entries']) if e['node'] == before)
        tree['entries'].insert(at, {'if': {'all': [*extra, {'flag': flag}, {'notFlag': seen}]}, 'node': node})
# night-song: Mia now carries the sea-stage choice
for e in n['events']:
    for r in (e.get('activity') or {}).get('onDone', []):
        if r.get('kind') == 'say' and '阿柏說' in r.get('text', ''): r['text'] = r['text'].replace('阿柏說', 'Mia 說')
NPCS.write_text(json.dumps(n, ensure_ascii=False, indent=1) + '\n')
# keepsake copy (Gemini, with unverified detail removed)
copy = json.loads((ROOT / 'artifacts/v10.2/impl/copy-gemini.json').read_text())
fix = {'tunnel-photo': {'a': '小橘指導的攝影卡。鏡頭聚焦在 1928 年竣工的壽山洞拱圈。'}}
text = COL.read_text(); col = json.loads(text)
for it in copy['items']:
    item = next(i for i in col['items'] if i['id'] == f"item-quest-{it['quest']}")
    for v in ('a', 'b'):
        item['variants'][v]['desc'] = fix.get(it['quest'], {}).get(v, it[v])
lines = text.split('\n')
for item in col['items']:  # keep the file's one-item-per-line layout
    if not item['id'].startswith('item-quest-'): continue
    i = next(k for k, l in enumerate(lines) if f'"id": "{item["id"]}"' in l)
    lines[i] = lines[i][:len(lines[i]) - len(lines[i].lstrip())] + json.dumps(item, ensure_ascii=False) + (',' if lines[i].rstrip().endswith(',') else '')
COL.write_text('\n'.join(lines)); json.loads(COL.read_text())
