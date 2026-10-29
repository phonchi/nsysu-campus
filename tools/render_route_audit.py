#!/usr/bin/env python3
"""Read-only source inspection rendered into artifacts, not map asset edits."""
from PIL import Image,ImageDraw,ImageFont
import json,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
g=json.loads((ROOT/'public/data/navigation.json').read_text())
for floor in ['SC-1F','SC-2F']:
 im=Image.open(ROOT/f'data/official-plans/maps/{floor}.webp').convert('RGB');d=ImageDraw.Draw(im);w,h=im.size
 ns={n['id']:n for n in g['nodes'] if n.get('floorId')==floor}
 for e in g['edges']:
  if e['enabled'] and e['from'] in ns and e['to'] in ns:
   a,b=ns[e['from']],ns[e['to']];d.line((a['x']*w,a['y']*h,b['x']*w,b['y']*h),fill='#b5471e',width=6)
 for n in ns.values():
  x,y=n['x']*w,n['y']*h;d.ellipse((x-7,y-7,x+7,y+7),fill='#427459' if n['kind']=='door' else '#b5471e')
  d.text((x+8,y+4),n['id'],fill='#173e49',font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17))
 im.save(ROOT/f'artifacts/{floor}-route-audit.png')
print('Two floor overlays rendered from current graph.')
