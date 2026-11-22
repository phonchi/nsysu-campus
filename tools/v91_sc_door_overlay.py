#!/usr/bin/env python3
"""Draws SC rooms, source doors and planned portals over the official plan, to review wrong-wall doors. Output stays in artifacts/ (derived from the official plans)."""
import json,sys
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[1]
D=ROOT/'public/data/walkthrough';PLANS=ROOT/'data/official-plans/walkthrough'
OUT=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'artifacts/v9.1/plans'
OUT.mkdir(parents=True,exist_ok=True)
S=json.loads((D/'SC.json').read_text());A=json.loads((D/'access-plan.json').read_text())
CLIPPED=json.loads((D/'campus-structure.json').read_text())['roomOverrides']
font=ImageFont.load_default(size=13)
for f in S['floors']:
    if f['id'] not in ('SC-B1','SC-3F','SC-4F'):continue
    img=Image.open(PLANS/(f['id']+'.webp')).convert('RGB')
    t=f['transform'];m=t['metresPerPixel'];ox,oy=t['imageOriginPixels'];k=2
    img=img.resize((img.width*k,img.height*k),Image.LANCZOS);d=ImageDraw.Draw(img)
    px=lambda p:((p[0]/m+ox)*k,(p[1]/m+oy)*k)
    P=A['floors'][f['id']]
    for h in f['holes']:d.polygon([px(p) for p in h],outline=(0,170,0))
    ports={p['id']:p for p in P['portals']}
    for i,r in enumerate(f['rooms']):
        d.polygon([px(p) for p in CLIPPED.get(f['id'],{}).get(r['id']) or r['polygon']],outline=(30,90,255))
        rid=r['id'];pp=ports.get(P['primaryPortalByRoom'].get(rid))
        a=px(r['door']['position']);d.ellipse([a[0]-5,a[1]-5,a[0]+5,a[1]+5],fill=(0,170,0))
        if pp:
            b=px(pp['perRoomPosition'].get(rid,pp['position']));d.line([a,b],fill=(255,0,0),width=1);d.rectangle([b[0]-5,b[1]-5,b[0]+5,b[1]+5],fill=(255,0,0))
        lab=(r.get('code') or rid.split('-')[-1]);c=px([sum(p[0] for p in r['polygon'])/len(r['polygon']),sum(p[1] for p in r['polygon'])/len(r['polygon'])])
        d.text((c[0]-15,c[1]),lab,fill=(200,0,160),font=font)
    w=img.width;n=3
    for j in range(n):
        img.crop((j*w//n,0,(j+1)*w//n,img.height)).save(OUT/f"{f['id']}-{j}.png")
