"""v10: verified campus stories (artifacts/v10/research/source-check.md) and NPC tellers.
Idempotent: rewrites the listed stories and (re)creates one `v10-stories` choice per teller."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
INFO, NPCS = ROOT / 'public/data/campus-info.json', ROOT / 'public/data/npcs.json'
S = lambda label, url: {'label': label, 'url': url}
NCHDB = S('國家文化資產網・西子灣隧道及其防空設施', 'https://nchdb.boch.gov.tw/assets/overview/historicalBuilding/20201127000001')
TUN = S('中山大學・西子灣隧道', 'https://www.nsysu.edu.tw/p/404-1000-179130.php?Lang=zh-tw')
STORIES = {
 'lions': ('行政大樓銅獅', None, 'history', '行政大樓正門階梯前的兩尊青銅雄獅，據傳由雕塑家陳志慈塑造，守著中庭廣場。2024 年 12 月，校方替銅獅戴上紅白毛帽、圍上圍巾過耶誕。',
  [S('中山新聞（2024-12-23）', 'https://news.nsysu.edu.tw/p/404-1120-346875.php?Lang=zh-tw')]),
 'tunnel': ('西子灣隧道「壽山洞」', None, 'history', '西子灣隧道又名「壽山洞」，1927 年 8 月貫通、1928 年 10 月竣工。二戰末期美軍轟炸時曾改作防空洞，2004 年登錄為歷史建築「西子灣隧道及其防空設施」。', [NCHDB, TUN]),
 'gallery': ('從溫浴館到行館', None, 'history', '西子灣行館原是 1935 年為始政四十週年博覽會興建的「高雄觀光館」，1989 年由中山大學取得、2004 年列為市定古蹟；2023 年 12 月修復完成並復原溫浴池遺構，啟用為 360 藝文空間，2025 年 8 月起有路易莎咖啡進駐。',
  [S('藝文中心・360 藝文空間', 'https://artcenter.nsysu.edu.tw/p/412-1008-26424.php?Lang=zh-tw'), S('中山新聞・路易莎進駐', 'https://news.nsysu.edu.tw/p/404-1120-360867.php?Lang=zh-tw')]),
 'bodhi': ('菩提樹廣場的公投', None, 'history', '中庭曾同時佇立孫中山與蔣中正兩座銅像。2018 年 4 月全校網路公投，結果是孫中山像留在原地，蔣中正像移至校內其他地點，確切位置另行討論。',
  [S('中山新聞轉載聯合報（2018-04-21）', 'https://news.nsysu.edu.tw/p/404-1120-184678.php?Lang=zh-tw')]),
 'library': ('戴著皇冠的知識燈塔', None, 'history', '1989 年開館的圖資大樓，頂部多角斜頂遠看像一頂皇冠，背山面海，是校園最顯眼的地標之一。',
  None),
 'sunset': ('蘿蔔坑看夕陽', None, 'history', '校門旁標高 21.2 公尺的紅磚校碑緊鄰西子灣海堤。校方把海堤邊的座位稱為中山大學的海邊雅座「蘿蔔坑」，40 週年時也把它列為歷史地標；黃昏時最適合看西子夕照。',
  [S('中山新聞（2020-09-01）', 'https://news.nsysu.edu.tw/p/404-1120-242198.php?Lang=zh-tw'), S('中山 40 週年・中山記憶', 'https://40th.nsysu.edu.tw/p/412-1309-21821.php?Lang=zh-tw')]),
 'monkeys': ('壽山的「猴學長」', None, 'history', '校園緊鄰壽山，台灣獼猴常在校舍與邊坡一帶活動。總務處的宣導是「四不」：不外露食物（含塑膠袋）、不餵食、不接觸、不攻擊。',
  [S('總務處事務組・獼猴安全宣導注意事項', 'https://admin-support-oga.nsysu.edu.tw/p/406-1100-110789,r1266.php')]),
 'zoo': ('西子灣的動物園', None, 'history', '高雄市壽山動物園 1978 年成立於西子灣，1986 年遷往壽山現址；中山大學則在 1980 年 7 月於西子灣正式建校。',
  [S('壽山動物園・園區簡介', 'https://zoo.kcg.gov.tw/intro/'), S('中山大學・校史沿革', 'https://www.nsysu.edu.tw/p/404-1000-10337.php?Lang=zh-tw')]),
 'tunnel-drama': ('防空洞裡的《昭和二十》', [30, 146], 'history', '2021 年 3 月 5 日至 7 日，學生自組的築粹劇場在西子灣隧道的防空洞演出《昭和二十》，故事設在二戰末期的高雄，用戲劇把地方記憶帶回當年的避難坑道。',
  [S('中山大學社會實踐（2021-03-09）', 'https://engage.nsysu.edu.tw/news/%E7%B5%90%E5%90%88%E5%9C%A8%E5%9C%B0%E6%95%85%E4%BA%8B-%E5%AD%B8%E7%94%9F%E7%94%A8%E6%88%B2%E5%8A%87%E9%87%8D%E7%8F%BE%E8%A5%BF%E7%81%A3%E9%98%B2%E7%A9%BA%E6%B4%9E%E6%AD%B7%E5%8F%B2%E8%A8%98%E6%86%B6/')]),
 'macaque-subsidy': ('獼猴搶食補償試辦', [-75, 126], 'news', '2024 年 2 月到 7 月，學校試辦獼猴掠食補償：被獼猴搶走食物的學生，每人每餐最多補償 100 元。試辦期間共有 17 人申請，之後是否延續由學校再評估。',
  [S('公視新聞（2024-03-19）', 'https://news.pts.org.tw/article/686043')]),
 'yu-dean': ('余光中來到西子灣', [-62, -52], 'history', '詩人余光中 1985 年回台，出任中山大學文學院院長，從此在西子灣教書、寫作。',
  [S('余光中數位文學館・年表', 'https://dayu.lis.nsysu.edu.tw/chronology.php')]),
 'macaque-jacks': ('「中山賈克斯」偷普渡品', [-24, 103], 'legend', '校園趣聞：2026 年 9 月有新聞報導，一隻被稱為「中山賈克斯」的獼猴闖進系辦，偷拿普渡用的供品。',
  [S('聯合報（2026-09-02）', 'https://udn.com/news/story/6928/9728863')]),
 'macaque-burger': ('早八課的漢堡', [-57, 126], 'legend', '校園趣聞：2025 年 3 月有新聞報導，早八課上到一半，獼猴闖進教室亂翻，搶走一個漢堡。早餐記得收進包包。',
  [S('聯合報（2025-03-18）', 'https://udn.com/news/story/6928/8616448')]),
}
TELLERS = {  # npc -> [(story, [lines])]
 's2': [('bodhi', ['2018 年全校網路公投過銅像去留。', '結果是孫中山像留下，蔣中正像移到校內別處。']), ('lions', ['門口那兩隻銅獅，2024 年耶誕還戴過紅白毛帽。'])],
 'quiz-dian': [('tunnel', ['西子灣隧道又叫壽山洞，1927 年 8 月貫通。', '二戰末期改作防空洞，2004 年登錄成歷史建築。'])],
 'clerk-jie': [('gallery', ['海邊那棟行館，原本是 1935 年博覽會的高雄觀光館。', '2023 年底修好，連以前的溫浴池遺構都復原了。'])],
 's3': [('library', ['這棟圖資大樓是 1989 年開館的。', '從海堤看過來，頂上那圈斜頂像不像皇冠？'])],
 'guide': [('sunset', ['學校說海堤邊的座位是我們的海邊雅座，叫蘿蔔坑。', '傍晚來坐，就懂為什麼。'])],
 'monkey-volunteer-man': [('monkeys', ['記住四不：不外露食物、不餵食、不接觸、不攻擊。']), ('macaque-subsidy', ['2024 年學校還試辦過被搶食補償，每餐最多一百元。', '十七個人申請過。食物收好，最省事。'])],
 'poet-wen': [('yu-dean', ['余光中 1985 年來中山當文學院院長。', '在海邊寫詩的人，我們這裡有前輩。']), ('tunnel-drama', ['2021 年有學生劇團在隧道防空洞演《昭和二十》。', '戲在真的坑道裡演，聲音會不一樣。'])],
 'ta-lin': [('macaque-jacks', ['新聞說有隻「中山賈克斯」闖進系辦偷普渡供品。', '辦公室門窗記得關。'])],
 's1': [('macaque-burger', ['聽說有堂早八，獼猴衝進教室搶走漢堡！', '新聞都有報。我的早餐現在都收在包包裡。'])],
}
# How each teller brings it up: ('choice', host node) adds「有什麼校園故事？」to a menu with room;
# ('entry', index, condition, next) makes the NPC tell it once, on a later talk, then return to the menu.
HOOK = {
 's2': ('entry', 0, [{'chapterDone': 'c3-admin'}, {'flag': 's2.met'}], 'root'),
 'quiz-dian': ('entry', 0, [{'flag': 'quiz-dian.met'}], 'menu'),
 'clerk-jie': ('entry', 3, [{'flag': 'clerk-jie.met'}], 'menu'),
 's3': ('entry', 0, [{'chapterDone': 'c4-library'}, {'any': [{'flag': 's3.recommend'}, {'flag': 's3.yu'}]}], 'root'),
 'guide': ('entry', 4, [{'chapterDone': 'c6-sunset'}], 'free'),
 'monkey-volunteer-man': ('entry', 0, [{'flag': 'monkey-volunteer-man.met'}], 'menu'),
 'ta-lin': ('entry', 1, [{'flag': 'ta-lin.met'}], 'menu'),
 'poet-wen': ('choice', 'root'),
 's1': ('choice', 'admin-hub'),
}
info = json.loads(INFO.read_text()); by = {s['id']: s for s in info['stories']}
for sid, (title, pos, cat, text, src) in STORIES.items():
    s = by.get(sid)
    if s is None:
        s = {'id': sid, 'title': title, 'pos': pos, 'text': '', 'sources': []}; info['stories'].append(s); by[sid] = s
    s['title'] = title; s['text'] = text; s['category'] = cat
    if pos: s['pos'] = pos
    if src is not None: s['sources'] = src
INFO.write_text(json.dumps(info, ensure_ascii=False, indent=1) + '\n')

npcs = json.loads(NPCS.read_text())
for npc, told in TELLERS.items():
    tree = npcs['trees'][npc]; nodes = tree['nodes']; flag = f'{npc}.story-told'
    for n in nodes.values():
        if 'choices' in n: n['choices'] = [c for c in n['choices'] if c.get('next') != 'v10-stories']
    tree['entries'] = [e for e in tree['entries'] if e['node'] != 'v10-stories']
    node = {'lines': [{'who': npc, 'text': t} for _, ls in told for t in ls], 'effects': [{'setFlag': flag}]}
    hook = HOOK[npc]
    if hook[0] == 'choice':
        ch = nodes[hook[1]]['choices']; assert len(ch) < 4, npc
        leave = [c for c in ch if not c.get('next') and not c.get('effects')]
        new = {'text': '「有什麼校園故事？」', 'next': 'v10-stories'}
        ch.insert(ch.index(leave[-1]), new) if leave else ch.append(new)
    else:
        _, at, cond, nxt = hook; node['next'] = nxt
        tree['entries'].insert(at, {'if': {'all': [*cond, {'notFlag': flag}]}, 'node': 'v10-stories'})
    nodes['v10-stories'] = node
NPCS.write_text(json.dumps(npcs, ensure_ascii=False, indent=1) + '\n')

# Clue entries in chapters.json: one per story (verify_chapters.py); wording limited to the verified card.
import re
CH = ROOT / 'public/data/chapters.json'
FIX = {'story-sunset': ('海堤的蘿蔔坑', '校碑旁的海堤，找學校說的海邊雅座。'),
       'story-library': ('戴皇冠的大樓', '圖資大樓前，抬頭看看那頂皇冠。'),
       'story-monkeys': ('猴學長的規矩', '生科館旁的邊坡常有猴學長，記得食物收好。')}
NEW = {'tunnel-drama': ('洞裡的一齣戲', '隧道校園側的洞口旁。'),
       'macaque-subsidy': ('一餐一百元', '理工長廊的取餐桌旁。'),
       'yu-dean': ('詩人院長', '圖資大樓前的廣場。'),
       'macaque-jacks': ('系辦的不速之客', '理學院中庭的報到桌旁。'),
       'macaque-burger': ('早八的漢堡', '理工長廊的攤位旁。')}
text = CH.read_text()
def line(qid, sid, t, h): return '    ' + json.dumps({'id': qid, 'fromCampusInfo': sid, 'title': t, 'hint': h}, ensure_ascii=False)
for qid, (t, h) in FIX.items():  # one line per clue in this hand-formatted file
    sid = re.search(r'"id": "%s", "fromCampusInfo": "([^"]+)"' % re.escape(qid), text).group(1)
    text = re.sub(r'    \{"id": "%s",[^\n]*?\}' % re.escape(qid), lambda m: line(qid, sid, t, h), text)
end = text.index('\n  ]\n}', text.index('"sideQuests"'))
for sid, (t, h) in NEW.items():  # refresh earlier runs
    text = re.sub(r'    \{"id": "story-%s",[^\n]*?\}' % re.escape(sid), lambda m: line(f'story-{sid}', sid, t, h), text)
add = ''.join(',\n' + line(f'story-{sid}', sid, t, h) for sid, (t, h) in NEW.items() if f'"story-{sid}"' not in text)
CH.write_text(text[:end] + add + text[end:])
