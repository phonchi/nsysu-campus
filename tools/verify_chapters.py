#!/usr/bin/env python3
"""Validate public/data/chapters.json (story data, spec-v3 §8.1 + §14.11).

python tools/verify_chapters.py [path]   # read-only; exit 1 on any error

Checks: known condition/action keys and value shapes, unique chapter/step ids,
objective <= 16 chars, >= 1 source URL per chapter, dialogue ids exist and
every line <= 40 chars (3-7 lines per scene), each chapter's closing dialogue
carries a 校史小知識 line, chapterDone only refers to earlier chapters, every
flag is set before it is used, sideQuests map to campus-info stories, and
dialogue text uses full-width punctuation.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = ROOT / 'public/data/chapters.json'
CAMPUS_INFO = ROOT / 'public/data/campus-info.json'

CONDITIONS = {'near', 'press', 'flag', 'chapterDone', 'inZone', 'atDestination', 'timeOfDay', 'any'}
ACTIONS = {'dialogue', 'setFlag', 'completeChapter', 'moveNpc', 'setObjective', 'showArrow',
           'setSky', 'playSound', 'unlockSideQuest'}
ZONES = {'gate', 'tunnel-west', 'tunnel-inside', 'admin', 'library', 'arcade', 'seawall'}
NPC_RE = re.compile(r'^(guide|s[1-6]|m[1-9])$')
WHO_RE = re.compile(r'^(guide|player|narrator|s[1-6]|m[1-9])$')
SKIES = {'dawn', 'day', 'sunset', 'night'}
TIMES = SKIES
SOUNDS = {'echo', 'chime'}
MAX_OBJECTIVE = 16
MAX_LINE = 40
FACT_MARK = '校史小知識'
HALF_WIDTH_PUNCT = re.compile(r'[,!?;:()"\']|\.(?!\d)|(?<!\d)\.')

errors: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def check_target(where: str, target) -> None:
    if not isinstance(target, str) or ':' not in target:
        err(f'{where}: target must be "npc:<id>" or "zone:<id>", got {target!r}')
        return
    kind, name = target.split(':', 1)
    if kind == 'npc' and not NPC_RE.match(name):
        err(f'{where}: unknown npc {name!r}')
    elif kind == 'zone' and name not in ZONES:
        err(f'{where}: unknown zone {name!r}')
    elif kind not in ('npc', 'zone'):
        err(f'{where}: unknown target kind {kind!r}')


def check_condition(where: str, cond, used_flags: list, used_chapters: list) -> None:
    if not isinstance(cond, dict):
        err(f'{where}: condition must be an object'); return
    keys = set(cond) & CONDITIONS
    if len(keys) != 1:
        err(f'{where}: condition needs exactly one known key, got {sorted(cond)}'); return
    key = keys.pop()
    extra = set(cond) - {key} - ({'r'} if key == 'near' else set())
    if extra:
        err(f'{where}: unexpected keys {sorted(extra)} in {key} condition')
    val = cond[key]
    if key == 'near':
        check_target(where, val)
        if not isinstance(cond.get('r'), (int, float)) or cond['r'] <= 0:
            err(f'{where}: near needs positive numeric r')
    elif key == 'press':
        if val != 'E':
            err(f'{where}: press must be "E"')
    elif key == 'flag':
        used_flags.append((where, val))
    elif key == 'chapterDone':
        used_chapters.append((where, val))
    elif key == 'inZone':
        if val not in ZONES:
            err(f'{where}: unknown zone {val!r}')
    elif key == 'atDestination':
        if not isinstance(val, str) or not val:
            err(f'{where}: atDestination needs a room code')
    elif key == 'timeOfDay':
        if val not in TIMES:
            err(f'{where}: timeOfDay must be one of {sorted(TIMES)}')
    elif key == 'any':
        if not isinstance(val, list) or not val:
            err(f'{where}: any needs a non-empty list')
        else:
            for i, sub in enumerate(val):
                check_condition(f'{where}.any[{i}]', sub, used_flags, used_chapters)


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    data = json.loads(path.read_text(encoding='utf-8'))
    stories = {s['id'] for s in json.loads(CAMPUS_INFO.read_text(encoding='utf-8'))['stories']}

    for key in ('version', 'guide', 'chapters', 'dialogues', 'sideQuests'):
        if key not in data:
            err(f'missing top-level key {key!r}')
    if data.get('version') != 1:
        err('version must be 1')
    guide = data.get('guide', {})
    if guide.get('id') != 'guide' or not guide.get('name'):
        err('guide must have id "guide" and a name')

    dialogues = data.get('dialogues', {})
    side_ids = [q.get('id') for q in data.get('sideQuests', [])]
    chapters = data.get('chapters', [])
    chapter_ids = [c.get('id') for c in chapters]
    if len(set(chapter_ids)) != len(chapter_ids):
        err(f'duplicate chapter ids: {chapter_ids}')

    flags_set: set[str] = set()
    done_before: set[str] = set()
    referenced_dialogues: set[str] = set()

    for ci, ch in enumerate(chapters):
        cid = ch.get('id', f'#{ci}')
        for key in ('id', 'title', 'zone', 'objective', 'start', 'steps', 'sources'):
            if key not in ch:
                err(f'{cid}: missing {key!r}')
        if ch.get('zone') not in ZONES:
            err(f'{cid}: unknown zone {ch.get("zone")!r}')
        if len(ch.get('objective', '')) > MAX_OBJECTIVE:
            err(f'{cid}: objective longer than {MAX_OBJECTIVE} chars')
        srcs = ch.get('sources', [])
        if not srcs or not all(isinstance(u, str) and u.startswith('https://') for u in srcs):
            err(f'{cid}: needs >= 1 https source URL')

        start_flags: list = []
        start_chapters: list = []
        for i, cond in enumerate(ch.get('start', {}).get('when', [])):
            check_condition(f'{cid}.start[{i}]', cond, start_flags, start_chapters)
        for where, ref in start_chapters:
            if ref not in done_before:
                err(f'{where}: chapterDone {ref!r} is not an earlier chapter')
        for where, flag in start_flags:
            if flag not in flags_set:
                err(f'{where}: flag {flag!r} used before being set')

        step_ids = [s.get('id') for s in ch.get('steps', [])]
        if len(set(step_ids)) != len(step_ids):
            err(f'{cid}: duplicate step ids {step_ids}')
        completes = 0
        closing_dialogue = None
        for si, step in enumerate(ch.get('steps', [])):
            where = f'{cid}.{step.get("id", si)}'
            used_flags: list = []
            used_chapters: list = []
            for i, cond in enumerate(step.get('when', [])):
                check_condition(f'{where}.when[{i}]', cond, used_flags, used_chapters)
            for w, flag in used_flags:
                if flag not in flags_set:
                    err(f'{w}: flag {flag!r} used before being set')
            for w, ref in used_chapters:
                if ref not in done_before:
                    err(f'{w}: chapterDone {ref!r} is not an earlier chapter')
            last_dialogue = None
            for ai, act in enumerate(step.get('then', [])):
                aw = f'{where}.then[{ai}]'
                if not isinstance(act, dict) or len(act) != 1 or next(iter(act)) not in ACTIONS:
                    err(f'{aw}: action must have exactly one known key, got {act!r}'); continue
                key, val = next(iter(act.items()))
                if key == 'dialogue':
                    referenced_dialogues.add(val)
                    last_dialogue = val
                    if val not in dialogues:
                        err(f'{aw}: dialogue {val!r} not defined')
                elif key == 'setFlag':
                    flags_set.add(val)
                elif key == 'completeChapter':
                    completes += 1
                    closing_dialogue = last_dialogue
                    if val != cid:
                        err(f'{aw}: completeChapter must complete its own chapter {cid!r}')
                elif key == 'moveNpc':
                    if not (isinstance(val, list) and len(val) == 2 and NPC_RE.match(str(val[0]))
                            and val[1] in ZONES):
                        err(f'{aw}: moveNpc must be [npcId, zoneAnchor]')
                elif key == 'setObjective':
                    if not isinstance(val, str) or len(val) > MAX_OBJECTIVE:
                        err(f'{aw}: setObjective must be <= {MAX_OBJECTIVE} chars')
                elif key == 'showArrow':
                    check_target(aw, val)
                elif key == 'setSky':
                    if val not in SKIES:
                        err(f'{aw}: unknown sky {val!r}')
                elif key == 'playSound':
                    if val not in SOUNDS:
                        err(f'{aw}: unknown sound {val!r}')
                elif key == 'unlockSideQuest':
                    if val not in side_ids:
                        err(f'{aw}: side quest {val!r} not defined')
        if completes != 1:
            err(f'{cid}: needs exactly one completeChapter step, found {completes}')
        if closing_dialogue is None:
            err(f'{cid}: completeChapter must follow a closing dialogue')
        elif not any(FACT_MARK in line.get('text', '') for line in dialogues.get(closing_dialogue, [])[-1:]):
            err(f'{cid}: closing dialogue {closing_dialogue!r} must end with a {FACT_MARK} line')
        done_before.add(cid)

    for did, lines in dialogues.items():
        if did not in referenced_dialogues:
            err(f'dialogue {did!r} is never used')
        if not 3 <= len(lines) <= 7:
            err(f'dialogue {did!r}: {len(lines)} lines (want 3-7)')
        for li, line in enumerate(lines):
            text = line.get('text', '')
            if not WHO_RE.match(str(line.get('who'))):
                err(f'{did}[{li}]: unknown speaker {line.get("who")!r}')
            if not text or len(text) > MAX_LINE:
                err(f'{did}[{li}]: line length {len(text)} (max {MAX_LINE})')
            if HALF_WIDTH_PUNCT.search(text):
                err(f'{did}[{li}]: half-width punctuation in {text!r}')

    if len(set(side_ids)) != len(side_ids):
        err('duplicate sideQuest ids')
    mapped = []
    for q in data.get('sideQuests', []):
        for key in ('id', 'fromCampusInfo', 'title', 'hint'):
            if not q.get(key):
                err(f'sideQuest {q.get("id")!r}: missing {key!r}')
        if q.get('fromCampusInfo') not in stories:
            err(f'sideQuest {q.get("id")!r}: unknown campus-info story {q.get("fromCampusInfo")!r}')
        mapped.append(q.get('fromCampusInfo'))
    if set(mapped) != stories:
        err(f'sideQuests must cover campus-info stories exactly: missing {sorted(stories - set(mapped))}')

    if errors:
        print(f'FAIL {path} ({len(errors)} errors)')
        for e in errors:
            print('  -', e)
        return 1
    n_lines = sum(len(v) for v in dialogues.values())
    print(f'OK {path}: {len(chapters)} chapters, {len(dialogues)} dialogues, '
          f'{n_lines} lines, {len(side_ids)} side quests')
    return 0


if __name__ == '__main__':
    sys.exit(main())
