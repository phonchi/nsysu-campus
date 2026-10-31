#!/usr/bin/env python3
"""Print tools/v9_perf_qa.py results side by side: python3 tools/v9_perf_compare.py <results.json> [<results.json> ...]"""
import json
import sys
from pathlib import Path

FIELDS = ('frames', 'p50_ms', 'p95_ms', 'max_ms', 'ScriptDuration_ms_per_frame', 'LayoutCount_per_frame', 'RecalcStyleCount_per_frame')
for name in sys.argv[1:]:
    report = json.loads(Path(name).read_text())
    print(name, f"({report['seconds_each']} s each, {len(report['runs'])} runs, {report['viewport']['width']}x{report['viewport']['height']})")
    for scene in ('far_tracked', 'near_hint', 'dialogue'):
        rows = [run[scene] for run in report['runs']]
        line = ' '.join(f"{f.replace('_per_frame', '/f').replace('Duration_ms', '')}={'/'.join(str(r[f]) for r in rows)}" for f in FIELDS)
        script = '/'.join(str(round(r['frames'] * r['ScriptDuration_ms_per_frame'] / 1000, 1)) for r in rows)
        print(f'  {scene}: {line} script_s={script}')
