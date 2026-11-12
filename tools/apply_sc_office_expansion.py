#!/usr/bin/env python3
"""Apply the user-approved SC 2F virtual office expansion, idempotently.
Run AFTER v9.1 structure/door edits, BEFORE build_floor_access.py and nav bake.
Official source maps remain untouched. Only the derived 2F room/outline data and
its existing review checksum pin change; the reviewed basement pair is checked.
"""
import argparse
import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from shapely.geometry import Polygon

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'public/data/walkthrough'
DELTA=.9
TARGET='SC-2F-SC2002-4'
SHIFT=['SC-2F-SC2002-3','SC-2F-SC2002-2','SC-2F-SC2002-1']
CORNERS=[[9.085,9.439],[13.485,9.439]]
NOTE='使用者指定的虛擬辦公室擴充：2002-4 加深，2002-1～3 及門位南移；非官方平面圖或現地尺寸。'

def apply(data):
    data=copy.deepcopy(data)
    f=next(f for f in data['floors'] if f['id']=='SC-2F')
    old=f.get('officeExpansion')
    if old and old.get('version')!=1:raise ValueError('Unknown office expansion version')
    source=old['sourceRooms'] if old else {r['id']:copy.deepcopy(r) for r in f['rooms'] if r['id'] in [TARGET,*SHIFT]}
    if set(source)!={TARGET,*SHIFT}:raise ValueError('Missing target offices')
    for r in f['rooms']:
        if r['id'] not in source:continue
        original=source[r['id']];expected=copy.deepcopy(original['polygon'])
        if r['id']==TARGET:
            top=max(z for x,z in expected)
            expected=[[x,round(z+DELTA,6) if abs(z-top)<1e-5 else z] for x,z in expected]
        else:expected=[[x,round(z+DELTA,6)] for x,z in expected]
        if r['polygon'] not in [original['polygon'],expected]:raise ValueError('Unexpected office polygon edits: '+r['id'])
        r['polygon']=expected;r['basis']='schematic';r['designNote']=NOTE
        if r['id'] in SHIFT:
            wanted=[original['door']['position'][0],round(original['door']['position'][1]+DELTA,6)]
            if r['door']['position'] not in [original['door']['position'],wanted]:raise ValueError('Unexpected door edits: '+r['id'])
            r['door']['position']=wanted;r['door']['basis']='schematic';r['door']['note']=NOTE
    baseline=copy.deepcopy(f['outline']);changed=copy.deepcopy(f['outline'])
    for x,z in CORNERS:
        hits=[i for i,p in enumerate(changed) if abs(p[0]-x)<1e-5 and any(abs(p[1]-at)<1e-5 for at in [z,z+DELTA])]
        if len(hits)!=1:raise ValueError('Unexpected notch outline; do not overwrite it')
        i=hits[0];baseline[i]=[x,z];changed[i]=[x,round(z+DELTA,6)]
    before=Polygon(baseline);after=Polygon(changed)
    if not before.is_valid or not after.is_valid or not after.covers(before):raise ValueError('Invalid expanded outline')
    added=after.difference(before)
    first=next(f for f in data['floors'] if f['id']=='SC-1F')
    if not Polygon(first['outline'],first.get('holes',[])).buffer(.001).covers(added):raise ValueError('Extension would overhang the existing 1F footprint')
    pieces=[g for g in getattr(added,'geoms',[added]) if g.geom_type=='Polygon' and g.area>.001]
    roofs=[[[round(x,6),round(z,6)] for x,z in list(g.exterior.coords)[:-1]] for g in pieces]
    f['outline']=changed
    previous=(old or {}).get('roofPatches',[])
    f['roofPatches']=[p for p in f.get('roofPatches',[]) if p not in previous]+roofs
    f['officeExpansion']={'version':1,'basis':'schematic','deltaLocal':DELTA,'note':NOTE,'sourceRooms':source,'roofPatches':roofs,'sourceOutline':old['sourceOutline'] if old else baseline}
    return data

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--check',action='store_true');args=ap.parse_args()
    path=DATA/'SC.json';raw=path.read_bytes();data=json.loads(raw);updated=apply(data)
    review_path=DATA/'final-three-door-source-review.json';review=json.loads(review_path.read_text())
    # Review approval concerns these exact basement rooms, not the edited offices.
    ids={e[k] for e in review['entries'] if e['floorId']=='SC-B1' for k in ['roomId','neighborRoomId']}
    pick=lambda d:[r for f in d['floors'] if f['id']=='SC-B1' for r in f['rooms'] if r['id'] in ids]
    assert pick(data)==pick(updated)
    payload=(json.dumps(updated,ensure_ascii=False,indent=2)+'\n').encode()
    digest=hashlib.sha256(payload).hexdigest()
    if args.check:
        assert data==updated,'Expansion has not been applied'
        assert review['sourceBuildingSHA256']['SC']==hashlib.sha256(raw).hexdigest(),'Stale source-review pin'
        print('SC office expansion is current and idempotent; reviewed B1 rooms unchanged');return
    if payload!=raw:
        previous=hashlib.sha256(raw).hexdigest()
        if review['sourceBuildingSHA256']['SC']!=previous:raise ValueError('Existing source-review pin is stale; refusing to refresh blindly')
        path.write_bytes(payload)
        review['sourceBuildingSHA256']['SC']=digest
        review.setdefault('sourceSHARefreshHistory',[]).append({'date':datetime.now(timezone.utc).isoformat(),'building':'SC','oldSHA256':previous,'newSHA256':digest,'reason':NOTE+' Reviewed SC-B1 rooms and neighbour geometry unchanged.'})
        review_path.write_text(json.dumps(review,ensure_ascii=False,indent=2)+'\n')
    print('SC2002-4 expanded +0.9 local depth; SC2002-1..3/doors translated +0.9; SC2001 unchanged')

if __name__=='__main__':main()
