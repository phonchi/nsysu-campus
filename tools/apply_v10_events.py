"""v10: campus events fire at their anchor (spec-v10 §5); the daytime macaque event carries the coexistence pilot.
Schema: src/story/campus-events.ts. Idempotent."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
NPCS, ZONES = ROOT / 'public/data/npcs.json', ROOT / 'public/data/story-zones.json'
EVENTS = [
 {'id': 'ev-club-fair', 'when': 'day', 'anchor': 'npc:club-ocean-ting', 'radius': 20, 'npcs': ['club-ocean-ting', 'coffee-kai'],
  'banner': '社團擺攤，長廊中段熱鬧起來', 'title': '長廊的社團擺攤', 'journal': '白天的理工長廊，海洋社的攤位擺出來了。',
  'lines': [{'who': 'club-ocean-ting', 'text': '來猜一題海洋冷知識吧！'}, {'who': 'coffee-kai', 'text': '攤位旁記得留走道。'}]},
 {'id': 'ev-macaque-alert-day', 'when': 'day', 'anchor': 'npc:m3-thief', 'radius': 25, 'npcs': ['monkey-volunteer-man', 'm3-thief'],
  'banner': '哨聲響起，大膽沿著邊坡走下來了', 'title': '白天的獼猴警戒', 'journal': '生科館旁的邊坡，阿滿姐吹哨提醒大家：大膽要下來了。', 'zone': 'macaque-path',
  'lines': [{'who': 'monkey-volunteer-man', 'text': '大膽下來了，食物先收好。'}],
  'activity': {
   'id': 'macaque-coexist', 'host': 'monkey-volunteer-man',
   'invite': '牠要從這條路過。點心收進包包，退開幾步讓路，好嗎？', 'accept': '好，我讓路', 'decline': '我先走了',
   'prepare': [{'kind': 'move', 'npc': 'm3-thief', 'to': 'zone:macaque-path'}], 'inviteDelay': 5,
   'steps': [
    {'kind': 'action', 'id': 'stash', 'text': '把點心收進包包', 'needs': 'item-bread'},
    {'kind': 'keepAway', 'npc': 'm3-thief', 'min': 4, 'hold': 2, 'text': '退到 4 公尺外，讓大膽過去', 'then': [{'kind': 'move', 'npc': 'm3-thief', 'to': 'zone:macaque-slope'}]}],
   'onDone': [{'kind': 'say', 'who': 'monkey-volunteer-man', 'text': '不餵食、不接觸，食物收好，牠就會自己走。'}],
   'onEnd': [{'kind': 'release', 'npc': 'm3-thief'}],
   'timeout': 90, 'cooldown': 600,
   'journal': {'title': '與大膽共處', 'done': '點心收好、退開讓路，大膽自己走回邊坡了。', 'abandoned': '這次沒有留到最後。', 'declined': '這次先離開，阿滿姐說下次再一起。'},
   'reward': '與大膽共處見聞', 'counter': 'whistle'}},
 {'id': 'ev-sunset-crowd', 'when': 'sunset', 'anchor': 'zone:seawall', 'radius': 30, 'npcs': ['photo-ju', 'guide', 'poet-wen', 'jogger-po'],
  'banner': '夕陽時間，蘿蔔坑坐滿了人', 'title': '海堤的夕陽人潮', 'journal': '傍晚的西子灣海堤，蘿蔔坑坐滿了看夕陽的人。',
  'lines': [{'who': 'photo-ju', 'text': '夕陽這時候最好拍。'}]},
 {'id': 'ev-macaque-alert-sunset', 'when': 'sunset', 'anchor': 'npc:m3-thief', 'radius': 25, 'npcs': ['m3-thief'],
  'banner': '大膽在海堤晃，食物收好', 'title': '海堤上的大膽', 'journal': '傍晚大膽跑到海堤，盯著大家手上的點心。'},
 {'id': 'ev-night-song', 'when': 'night', 'anchor': 'zone:arcade', 'radius': 25, 'npcs': ['guitar-yun'],
  'banner': '長廊夜唱，柱廊燈全亮', 'title': '長廊夜唱', 'journal': '夜裡的理工長廊，允哲彈起吉他，柱廊燈全亮。',
  'lines': [{'who': 'guitar-yun', 'text': '坐下聽一首吧。'}]},
]
ADD_ZONES = {  # beside the daytime macaque home (86,56) and the volunteer (82,62)
 'macaque-path': {'label': '生科館旁步道', 'sub': 'MACAQUE PATH', 'p': [79.0, 66.0], 'r': 6},
 'macaque-slope': {'label': '生科館邊坡', 'sub': 'SLOPE', 'p': [90.0, 52.0], 'r': 6},
}
n = json.loads(NPCS.read_text())
# Merge by event id: fields defined here win, anything else already in the file (for example the v10.1 sunset and
# night-song activities written by WP-B) is kept, so re-running this tool never wipes later work.
current = {e['id']: e for e in n.get('events', [])}
n['events'] = [{**current.get(e['id'], {}), **e} for e in EVENTS] + [e for i, e in current.items() if i not in {x['id'] for x in EVENTS}]
NPCS.write_text(json.dumps(n, ensure_ascii=False, indent=1) + '\n')
z = json.loads(ZONES.read_text()); zs = z['zones'] if 'zones' in z else z
zs.update(ADD_ZONES)
ZONES.write_text(json.dumps(z, ensure_ascii=False, indent=1) + '\n')
