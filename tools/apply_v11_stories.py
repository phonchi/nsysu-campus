#!/usr/bin/env python3
"""v11: verified campus stories (artifacts/v11/research/source-check.md) and NPC tellers; the v11 twin of
tools/apply_v10_stories.py. Idempotent: rewrites the listed stories, (re)creates one `v11-stories` node per teller with the
flag `<npc>.v11-story-told`, and refreshes one clue line per story in chapters.json `sideQuests` (with `unlockAfter`).
Never touches `v10-stories` nodes or `<npc>.story-told` flags. Runs with empty lists and then changes nothing on disk.

Fill STORIES／TELLERS／HOOK／CLUES only with entries the coordinator has verified (spec-v11 §4): a concrete article page
that returned 200, a verbatim excerpt that supports the card, a location inside the playable map, no negative content about
real individuals; `lore` text starts with「校園口傳：」and the source page itself must call it 流傳／傳說.
"""
import json
import re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
INFO, NPCS, CH = ROOT / 'public/data/campus-info.json', ROOT / 'public/data/npcs.json', ROOT / 'public/data/chapters.json'
NODE, FLAG = 'v11-stories', 'v11-story-told'
S = lambda label, url: {'label': label, 'url': url}
# story id -> (title, pos [x, z] or None to keep, category in history|news|legend|lore, text, [sources] or None to keep, y or None)
# Positions: outdoor walkable ground near the hook, ≥ 4 m from every gem／spot／NPC station (result-fable-2.md §2); y only under the hill.
NSYSU = S('中山大學・校史與校訓', 'https://www.nsysu.edu.tw/p/412-1000-1497.php?Lang=zh-tw')
STORIES = {
 'motto': ('校訓五句', [-78, 99], 'history', '中山大學的校訓是「博學、審問、慎思、明辨、篤行」。', [NSYSU], None),
 'founding-day': ('校慶是哪一天', [-90.5, 601], 'history', '中山大學的校慶是 11 月 12 日，也就是國父誕辰。', [NSYSU], None),
 'first-intake': ('第一批新生', [-66, 122], 'history', '民國 69 年（1980）秋季開始招生，當時成立 4 個學系、2 個研究所。', [NSYSU], None),
 'library-move': ('圖書館搬家', [-50, -54], 'history', '圖書館原本在行政大樓，民國 77 年 8 月 1 日先遷到圖資大樓十樓，78 年 11 月 12 日全面開館。',
  [S('圖資處・圖書館沿革', 'https://lis.nsysu.edu.tw/p/412-1001-1174.php?Lang=zh-tw')], None),
 'library-architect': ('設計圖上的署名', [-66, -38.5], 'history', '一張圖資大樓的設計圖，日期是民國 73 年 10 月，署名建築師陳其寛。',
  [S('文化部典藏網・圖資大樓設計圖', 'https://collections.culture.tw/Object?SYSUID=31&RNO=Q0NDSzI2MTIzMDQ1')], None),
 'logo-1997': ('山與海的標誌', [-86, 590], 'history', '1997 年的中山大學識別標誌：綠色山形是壽山，藍色筆觸是西灣。',
  [S('中山大學・識別標誌', 'https://www.nsysu.edu.tw/p/412-1000-1508.php?Lang=zh-tw')], None),
 'gate-arch': ('隧道口的牌樓', [6, 149], 'history', '以前西子灣隧道上有大大的中山大學山水 Logo 牌樓，常讓人誤會是中山大學的大門，每年新生開學時總有校內社團學長姐在這裡引導，說明這是隧道口、並非大門。牌樓於 2008 年 7 月底拆除。',
  [S('中山新聞（隧道口牌樓）', 'https://news.nsysu.edu.tw/p/404-1120-136659.php?Lang=zh-tw')], None),
 'tunnel-starry': ('隧道裡的燈光秀', [36, 152.5], 'news', '耶誕節適逢考試週，外籍師生無法回家過節，便透過隧道營造節慶氣氛，搭配逾 7 萬顆 LED 燈泡的耶誕燈光秀。',
  [S('1111 人力銀行新聞（隧道燈光秀）', 'https://www.1111.com.tw/news/jobns/154325')], 1),
 'tunnel-dispositif': ('部署壽山', [46, 155.5], 'news', '「部署壽山—西子灣隧道與全民防衛展」曾於 9 月 30 日至 10 月 23 日在西子灣隧道舉辦，「避災解厄」展場呈現 5 個民俗故事與鄉野奇談；這個展覽獲得美國繆思創意獎體驗式和沈浸式展場設計類金獎。',
  [S('中山新聞（部署壽山展）', 'https://news.nsysu.edu.tw/p/406-1120-294563,r2910.php?Lang=zh-tw'), S('1111 人力銀行新聞（繆思創意獎）', 'https://www.1111.com.tw/news/jobns/153278')], 1),
 'shoushan-rename': ('打狗山改名', [92, 46], 'history', '1923 年，皇太子（後來的昭和天皇）曾在打水灣湧泉出水口一帶的貴賓館住過，以此為契機，打狗山被改名為「壽山」，貴賓館則成為「壽山館」。',
  [S('nippon.com（壽山館）', 'https://www.nippon.com/hk/articles/-/29409')], None),
 'math-gifted-class': ('應數系的第一批高一生', [-21, 111], 'history', '中山大學的數理資優班於民國 74 年成立。民國 76 年應數系承辦數學組，那年 10 月迎來第一批 20 位高一學生，來自高雄縣市、屏東及台東等地。',
  [S('高中數學人才培育班・沿革', 'https://highschool-math.nsysu.edu.tw/p/412-1186-123.php?Lang=zh-tw')], 0),
 'yixian-stage': ('舞台上的 NSYSU', [-149, 162], 'news', '逸仙館的舞台大到可以停放一架 F-16 戰鬥機；由舞台面向觀眾席時，看得到以座椅顏色排列出的 NSYSU 縮寫。',
  [S('中山新聞（逸仙館）', 'https://news.nsysu.edu.tw/p/406-1120-241100,r2910.php?Lang=zh-tw')], None),
 'wormhole-letters': ('蟲洞書簡', [-156, 153], 'news', '有一屆大學部畢業生入學時都親手寫下「蟲洞書簡」，這些對自己的期許封存了 4 年；當年不少人的願望是早日「脫魯」、不要被當。',
  [S('中山新聞（蟲洞書簡）', 'https://news.nsysu.edu.tw/p/406-1120-283292,r2910.php?Lang=zh-tw')], None),
 'il-shuxiangting': ('書香町', [-90, -80], 'news', '書香町是圖資處在民國 103 年為了滿足學生安靜自習的需求而設的；同一篇報導也記下 24 小時智慧還書系統正式啟用。',
  [S('1111 人力銀行新聞（書香町）', 'https://www.1111.com.tw/news/jobns/159043')], None),
 'art-building-tales': ('山上的藝術大樓', [-168, -228], 'lore', '校園口傳：山上的藝術大樓位處偏僻，曾驚傳鬧鬼事件。中山校園盛傳，某日晚間兩名劇藝系學生在藝術大樓搭電梯到地下室，匆促間「撞倒一名小女孩」，事後查看監視器畫面，「根本沒有小女孩」；另一則在二樓大劇場附近，有「人」在晚間一直敲窗戶，那個位置「當時根本沒有人」。',
  [S('中山大學・校網轉載自由時報〈鬼藝懼場開張〉', 'https://www.nsysu.edu.tw/p/404-1000-95633.php?Lang=zh-tw')], None),
}
# npc -> [(story, [lines ≤ 28 chars])]; one node per teller, every listed story told in that node once (at most one new story per NPC)
TELLERS = {
 'ta-lin': [('math-gifted-class', ['學校的數理資優班民國 74 年就成立了。', '民國 76 年應數系接下數學組。', '那年十月來了第一批二十位高一學生。'])],
 'teacher-chen': [('math-gifted-class', ['民國 76 年，應數系承辦數理資優班的數學組。', '那年十月，第一批二十位高一學生來上課。'])],
 'guard-chung': [('gate-arch', ['以前隧道上有個中山大學山水牌樓。', '常有人以為那是大門，開學時學長姐會在洞口說明。', '牌樓 2008 年 7 月底拆了。'])],
 'guide': [('logo-1997', ['1997 年的識別標誌，綠色山形是壽山。', '藍色那一筆，是西灣。'])],
 's3': [('il-shuxiangting', ['書香町是圖資處 103 年設的，給同學安靜自習。', '那篇報導也提到 24 小時智慧還書系統啟用。'])],
 'clerk-jie': [('library-move', ['圖書館以前在行政大樓，你知道嗎？', '民國 77 年才搬到圖資大樓十樓。'])],
 'monkey-volunteer-man': [('shoushan-rename', ['壽山以前叫打狗山。', '1923 年皇太子住過打水灣一帶的貴賓館。', '以此為契機，打狗山改名壽山。'])],
 'poet-wen': [('art-building-tales', ['聽說山上的藝術大樓，校園裡流傳過鬧鬼的事。', '有人搭電梯到地下室，撞倒一個小女孩。', '監視器畫面裡，根本沒有小女孩。', '也聽說大劇場旁有「人」晚上敲窗。', '那個位置，當時根本沒有人。'])],
}
# npc -> ('choice', host node)   adds「有什麼校園故事？」to a menu with room (< 4 choices), terminal node;
#        ('entry', index, [conditions], next node)   tells it once on a later talk, then continues at next
HOOK = {
 'ta-lin': ('entry', 2, [{'flag': 'ta-lin.met'}], 'menu'),                       # after usb-back and v10-stories
 'teacher-chen': ('choice', 'menu'),                                              # replaces the round-1 hand-written `stories` node
 'guard-chung': ('entry', 4, [{'flag': 'guard-chung.met'}], 'menu'),             # before `again`; night entries stay first
 'guide': ('entry', 5, [{'chapterDone': 'c6-sunset'}], 'free'),                   # after v10-stories, before `free`
 's3': ('entry', 1, [{'chapterDone': 'c4-library'}, {'any': [{'flag': 's3.recommend'}, {'flag': 's3.yu'}]}], 'root'),
 'clerk-jie': ('entry', 4, [{'flag': 'clerk-jie.met'}], 'menu'),                 # after v10-stories, before `again`
 'monkey-volunteer-man': ('entry', 1, [{'flag': 'monkey-volunteer-man.met'}], 'menu'),
 'poet-wen': ('entry', 1, [{'chapterDone': 'c6-sunset'}], 'root'),               # after the sunset `sea` scene; 阿文 has no met flag
}
# story id -> (clue title, hint, unlockAfter chapter id); one `sideQuests` line each (verify_chapters.py requires one per story).
# unlockAfter = the chapter whose zone the gem sits near; art-building-tales is c6-sunset by decision.
CLUES = {
 'motto': ('校訓五句', '行政大樓前廣場，靠海的那一側。', 'c3-admin'),
 'founding-day': ('校慶是哪一天', '校門口，校碑旁的路邊。', 'c1-gate'),
 'first-intake': ('第一批新生', '理工長廊中段。', 'c5-arcade'),
 'library-move': ('圖書館搬家', '圖資大樓門口東側，長廊柱子外的步道。', 'c4-library'),
 'library-architect': ('設計圖上的署名', '圖資大樓前廣場西側。', 'c4-library'),
 'logo-1997': ('山與海的標誌', '校門口校碑旁，往隧道的路邊。', 'c1-gate'),
 'gate-arch': ('隧道口的牌樓', '西子灣隧道校園側洞口外的路上。', 'c2-tunnel'),
 'tunnel-starry': ('隧道裡的燈光秀', '走進西子灣隧道一小段。', 'c2-tunnel'),
 'tunnel-dispositif': ('部署壽山', '西子灣隧道更深處。', 'c2-tunnel'),
 'shoushan-rename': ('打狗山改名', '生科館邊坡再往上一點。', 'c5-arcade'),
 'math-gifted-class': ('應數系的第一批高一生', '理學院中庭報到桌南側。', 'c5-arcade'),
 'yixian-stage': ('舞台上的 NSYSU', '逸仙館入口外。', 'c5-arcade'),
 'wormhole-letters': ('蟲洞書簡', '逸仙館入口外的另一側。', 'c5-arcade'),
 'il-shuxiangting': ('書香町', '圖資大樓西側入口外。', 'c4-library'),
 'art-building-tales': ('山上的藝術大樓', '活動中心旁往山坡的小路。', 'c6-sunset'),
}


def write_if_changed(path, text):
    if path.read_text() != text:
        path.write_text(text)


def main():
    info = json.loads(INFO.read_text()); by = {s['id']: s for s in info['stories']}
    for sid, (title, pos, cat, text, src, y) in STORIES.items():
        assert cat in ('history', 'news', 'legend', 'lore'), sid
        assert cat != 'lore' or text.startswith('校園口傳：'), sid
        s = by.get(sid)
        if s is None:
            s = {'id': sid, 'title': title, 'pos': pos, 'text': '', 'sources': []}; info['stories'].append(s); by[sid] = s
        s['title'] = title; s['text'] = text; s['category'] = cat
        if pos: s['pos'] = pos
        if src is not None: s['sources'] = src
        if y is None: s.pop('y', None)
        else: s['y'] = y
    write_if_changed(INFO, json.dumps(info, ensure_ascii=False, indent=1) + '\n')

    npcs = json.loads(NPCS.read_text())
    for npc, told in TELLERS.items():
        for sid, _ in told:
            assert sid in by, (npc, sid)
        tree = npcs['trees'][npc]; nodes = tree['nodes']; flag = f'{npc}.{FLAG}'
        for n in nodes.values():
            if 'choices' in n: n['choices'] = [c for c in n['choices'] if c.get('next') != NODE]
        tree['entries'] = [e for e in tree['entries'] if e['node'] != NODE]
        nodes.pop(NODE, None)
        lines = [{'who': npc, 'text': t} for _, ls in told for t in ls]
        assert all(len(l['text']) <= 28 for l in lines), npc
        node = {'lines': lines, 'effects': [{'setFlag': flag}]}
        hook = HOOK[npc]
        if hook[0] == 'choice':
            ch = nodes[hook[1]]['choices']; assert len(ch) < 4, npc
            leave = [c for c in ch if not c.get('next') and not c.get('effects')]
            new = {'text': '「有什麼校園故事？」', 'if': {'notFlag': flag}, 'next': NODE}
            ch.insert(ch.index(leave[-1]), new) if leave else ch.append(new)
        else:
            _, at, cond, nxt = hook; node['next'] = nxt; assert nxt in nodes, (npc, nxt)
            tree['entries'].insert(at, {'if': {'all': [*cond, {'notFlag': flag}]}, 'node': NODE})
        nodes[NODE] = node
    write_if_changed(NPCS, json.dumps(npcs, ensure_ascii=False, indent=1) + '\n')

    # Clue lines in the hand-formatted chapters.json: one line per clue, refreshed in place or appended before the closing bracket.
    text = CH.read_text()
    chapter_ids = [c['id'] for c in json.loads(text)['chapters']]
    def line(sid, t, h, after):
        assert after in chapter_ids, (sid, after)
        return '    ' + json.dumps({'id': f'story-{sid}', 'fromCampusInfo': sid, 'title': t, 'hint': h, 'unlockAfter': after}, ensure_ascii=False)
    for sid, (t, h, after) in CLUES.items():
        assert sid in by, sid
        text = re.sub(r'    \{"id": "story-%s",[^\n]*?\}' % re.escape(sid), lambda m: line(sid, t, h, after), text)
    end = text.index('\n  ]\n}', text.index('"sideQuests"'))
    add = ''.join(',\n' + line(sid, t, h, after) for sid, (t, h, after) in CLUES.items() if f'"story-{sid}"' not in text)
    write_if_changed(CH, text[:end] + add + text[end:])
    print(f'v11 stories: {len(STORIES)} stories, {len(TELLERS)} tellers, {len(CLUES)} clues')


if __name__ == '__main__':
    main()
