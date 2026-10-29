#!/usr/bin/env python3
"""Subset Noto Sans TC (OFL) to every character the site can show.

Source: data/sources/fonts/NotoSansTC-VF.ttf (google/fonts ofl/notosanstc, variable wght).
Scans src/, index.html and the text data in public/data/, keeps the previous subset's
characters too, and writes public/assets/fonts/noto-sans-tc.woff2 (variable weight kept).
Re-run after adding UI text or story content:  python3 tools/build_font_subset.py
"""
import hashlib, json, subprocess, sys
from pathlib import Path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'data/sources/fonts/NotoSansTC-VF.ttf'
OUT = ROOT / 'public/assets/fonts/noto-sans-tc.woff2'
TEXT_FILES = [*ROOT.glob('src/**/*.ts'), *ROOT.glob('src/**/*.css'), ROOT / 'index.html',
              *[ROOT / 'public/data' / n for n in ('chapters.json', 'campus-info.json', 'story-zones.json', 'campus-map.json', 'rooms.json', 'floors.json', 'npcs.json', 'collection.json', 'quiz.json', 'quests.json', 'encounters.json')],
              *ROOT.glob('public/data/walkthrough/*.json')]

chars = {chr(c) for c in range(0x20, 0x7f)} | set('　、。，．：；？！「」『』（）〔〕【】《》〈〉—…・～／％＋－＝①②③④⑤⑥⑦⑧⑨⑩↗→←↑↓⇧⟲×▼▲●○')
for f in TEXT_FILES:
    if f.exists() and f.stat().st_size < 20_000_000:
        chars |= {c for c in f.read_text(encoding='utf-8', errors='ignore') if ord(c) >= 0x2000}
if OUT.exists():
    chars |= {chr(c) for c in TTFont(OUT).getBestCmap()}
available = TTFont(SRC).getBestCmap()
keep = sorted(c for c in chars if ord(c) in available)
missing = sorted(c for c in chars if ord(c) not in available and ord(c) >= 0x2000)
text_file = ROOT / 'data/sources/fonts/subset-chars.txt'
text_file.write_text(''.join(keep), encoding='utf-8')
tmp = OUT.with_suffix('.tmp.woff2')
subprocess.run(['pyftsubset', str(SRC), f'--text-file={text_file}', '--flavor=woff2', f'--output-file={tmp}',
                '--layout-features=*', '--no-hinting'], check=True)
tmp.replace(OUT)
prov = {'source': 'https://github.com/google/fonts/raw/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf', 'license': 'SIL Open Font License 1.1 (public/assets/fonts/OFL.txt)',
        'sourceSha256': hashlib.sha256(SRC.read_bytes()).hexdigest(), 'outputSha256': hashlib.sha256(OUT.read_bytes()).hexdigest(),
        'characters': len(keep), 'missingFromFont': ''.join(missing), 'outputBytes': OUT.stat().st_size}
(ROOT / 'data/sources/fonts/provenance.json').write_text(json.dumps(prov, ensure_ascii=False, indent=1) + '\n')
print(json.dumps(prov, ensure_ascii=False))
sys.exit(0)
