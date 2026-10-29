#!/usr/bin/env python3
"""Register official-plan candidates; preserve frozen SC 1F/2F exactly.
Idempotent: one-time alignment-input-*.json preserves the original geometry.
All cross-floor scaling, inferred doors and external service connectors remain
schematic; this script never promotes a region to map-checked.
"""
import copy,json,pathlib,math,hashlib,logging
import numpy as np,cv2
from PIL import Image
from shapely.geometry import Polygon,Point,box,LineString
from shapely.ops import unary_union,nearest_points
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=ROOT/'public/data/walkthrough'
BIDS=['SC','EN','BI','PH','CH','EC','MS','EV']

def save(path,data):path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
def poly_largest(p):
 if p.is_empty:return None
 if not p.is_valid:p=p.buffer(0)
 if p.geom_type=='Polygon':return p
 parts=[g for g in getattr(p,'geoms',[]) if g.geom_type=='Polygon']
 return max(parts,key=lambda g:g.area) if parts else None

def xy_image(f,p):
 t=f['transform'];s=t['metresPerPixel'];ox,oy=t['imageOriginPixels'];return [(p[0]-ox)*s,(p[1]-oy)*s]

def green_stairs(f):
 im=Image.open(ROOT/'public'/f['imageUrl'].lstrip('/')).convert('RGB');a=np.asarray(im).astype(float);r,g,b=a[:,:,0],a[:,:,1],a[:,:,2]
 mask=((g>r+16)&(b>r+10)&(g>b-14)&(g<225)).astype('uint8')*255;mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((7,7),np.uint8));count,labels,stats,centroids=cv2.connectedComponentsWithStats(mask,8)
 points=[]
 for i in range(1,count):
  if stats[i,cv2.CC_STAT_AREA]<max(70,im.width*im.height*.0008):continue
  points.append(xy_image(f,centroids[i]))
 return points

def outline_without_title_band(f):
 im=Image.open(ROOT/'public'/f['imageUrl'].lstrip('/')).convert('RGB');a=np.asarray(im).astype(float);r,g,b=a[:,:,0],a[:,:,1],a[:,:,2]
 tan=(r>190)&(g>165)&(b<185)&(r>g)&(g>b+18)
 mask=((np.min(a,axis=2)<245)&~tan).astype('uint8')*255;mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((13,13),np.uint8));contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
 if not contours:return f['outline']
 contour=max(contours,key=cv2.contourArea);pts=cv2.approxPolyDP(contour,2.5,True).reshape(-1,2)
 if len(pts)<3:return f['outline']
 poly=poly_largest(Polygon([xy_image(f,p) for p in pts]));return list(map(list,poly.exterior.coords))[:-1] if poly else f['outline']

def primary(bid,f):
 pts=green_stairs(f)
 if not pts:return None
 if bid=='SC':
  # Main science-block centre stairs, not the northern west-side stairs.
  return min(pts,key=lambda p:(p[0]-(0 if f['level'] in [1,2] else 33))**2+(p[1]-(3.5 if f['level'] in [1,2] else -6))**2)
 if bid=='EN':
  lower=[p for p in pts if p[1]>0]
  return max(lower or pts,key=lambda p:p[0])
 if bid=='EC':return min(pts,key=lambda p:abs(p[0]-6.5)+max(0,-p[1]-6)*2)
 return max(pts,key=lambda p:p[0])

def ev_grid_anchor(f):
 # Repeated lift shaft is visually identifiable adjacent to the same east-side
 # staircase/core on each official plan. These are approximate image readings.
 normalized={1:(275/600,134/326),2:(391/600,134/325),3:(380/600,130/326),4:(355/600,140/325),5:(376/600,120/326),6:(402/600,130/325)}
 x,y=normalized[f['level']];return xy_image(f,[x*f['imageWidth'],y*f['imageHeight']])

def affine(f,scale,tx,tz):
 def point(p):return [round(p[0]*scale+tx,4),round(p[1]*scale+tz,4)]
 for key in ['outline']:
  f[key]=[point(p) for p in f[key]]
 f['holes']=[[point(p) for p in h] for h in f.get('holes',[])]
 for group in ['rooms','circulation','regionCandidates']:
  for r in f.get(group,[]):
   r['polygon']=[point(p) for p in r['polygon']]
   if r.get('door'):r['door']['position']=point(r['door']['position']);r['door']['width']=round(r['door']['width']*scale,4)
 for group in ['stairs','stairCandidates','mapAnnotations']:
  for n in f.get(group,[]):n['position']=point(n['position'])
 for p in f.get('unmatchedRoomLabels',[]):p['position']=point(p['position'])
 raw=copy.deepcopy(f['transform']);s=raw['metresPerPixel']*scale;ox,oy=raw['imageOriginPixels']
 f['transform'].update(rawTransform=raw,metresPerPixel=s,imageOriginPixels=[ox-tx/s,oy-tz/s],imageToLocal='x=(imageX-originX)*metresPerPixel; z=(imageY-originY)*metresPerPixel',registrationMatrix=[[scale,0,tx],[0,scale,tz]])
 f['bounds']=list(Polygon(f['outline']).bounds)

def choose_doors(f):
 im=np.asarray(Image.open(ROOT/'public'/f['imageUrl'].lstrip('/')).convert('RGB'));height,width=im.shape[:2];t=f['transform'];s=t['metresPerPixel'];ox,oy=t['imageOriginPixels'];floorpoly=Polygon(f['outline']);roompolys=[Polygon(r['polygon']) for r in f['rooms']]
 circulation=unary_union([Polygon(r['polygon']) for r in f.get('circulation',[])])
 for idx,r in enumerate(f['rooms']):
  if r['door'].get('basis')=='map-derived':continue
  poly=roompolys[idx];coords=list(poly.exterior.coords);best=None
  for a,b in zip(coords,coords[1:]):
   dx=b[0]-a[0];dz=b[1]-a[1];length=math.hypot(dx,dz)
   if length<1.0:continue
   for frac in [.5,.35,.65]:
    p=np.array([a[0]+frac*dx,a[1]+frac*dz]);n=np.array([-dz/length,dx/length]);outside=p+n*.8
    if poly.covers(Point(outside)):n=-n;outside=p+n*.8
    if not floorpoly.buffer(.25).covers(Point(outside)):continue
    if any(j!=idx and q.buffer(.2).covers(Point(outside)) for j,q in enumerate(roompolys)):continue
    ix=int(outside[0]/s+ox);iy=int(outside[1]/s+oy)
    if not 0<=ix<width or not 0<=iy<height:continue
    patch=im[max(0,iy-3):min(height,iy+4),max(0,ix-3):min(width,ix+4)].astype(float);hi=patch.max(2);lo=patch.min(2)
    gray=float(np.mean((hi-lo<22)&(lo>130)&(hi<245)))
    circ=2 if not circulation.is_empty and circulation.buffer(.6).covers(Point(outside)) else 0
    clearance=min([q.distance(Point(outside)) for j,q in enumerate(roompolys) if j!=idx] or [5])
    score=gray*3+circ+min(clearance,3)*.15
    if best is None or score>best[0]:best=(score,p.tolist(),outside.tolist())
  if best:
   r['door']=dict(position=[round(v,4) for v in best[1]],width=1.1,basis='schematic',outsideHint=[round(v,4) for v in best[2]],note='候選邊界上朝向灰色公共廊道/無其他房間區域的示意開口；非已逐門核對位置。')
  else:r['door']['note']='未找到可信廊道側，保留待核對示意門；不得稱實際房門。';r['door']['reviewRequired']=True

def svg_overlay(f,anchor):
 w,h=f['imageWidth'],f['imageHeight'];t=f['transform'];s=t['metresPerPixel'];ox,oy=t['imageOriginPixels']
 def pixels(p):return (p[0]/s+ox,p[1]/s+oy)
 elems=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">',f'<image href="{f["imageUrl"]}" width="{w}" height="{h}"/>']
 for r in f['rooms']:
  pts=' '.join(f'{x:.2f},{y:.2f}' for x,y in map(pixels,r['polygon']));elems.append(f'<polygon points="{pts}" fill="none" stroke="#d43c30" stroke-width="2"/>');x,y=pixels(r['door']['position']);elems.append(f'<circle cx="{x}" cy="{y}" r="4" fill="#10a873"/>')
 for hole in f.get('holes',[]):
  pts=' '.join(f'{x:.2f},{y:.2f}' for x,y in map(pixels,hole));elems.append(f'<polygon points="{pts}" fill="#7b2ea522" stroke="#7b2ea5" stroke-width="3"/>')
 if anchor is not None:
  x,y=pixels(anchor);elems.append(f'<path d="M{x-10},{y}h20 M{x},{y-10}v20" stroke="#5b2ad2" stroke-width="4"/>')
 elems.append('</svg>');return ''.join(elems)

def apply_source_review(data):
 # Bounded manual classification review of the six source sheets that produced
 # overlapping rooftop/circulation regions. Preserve every rejected shape.
 rules={
 'SC-RF':{'circulation':{'001','015','016'},'void':{'011','012','027','028','029','030','013'}},
 'EN-B1':{'circulation':{'002','029'},'void':{'016'}},
 'EN-RF':{'circulation':{'009'},'void':{'004'}},
 'CH-1F':{'artifact':{'001'}},
 'EV-5F':{'circulation':{'040'}},'EV-6F':{'circulation':{'033'}},
 'BI-1F':{'artifact':{'001'}},'PH-1F':{'artifact':{'001'}},'MS-1F':{'artifact':{'001'}},
 }
 changes=[]
 for f in data['floors']:
  if f['id'] not in rules:continue
  rule=rules[f['id']];keep=[]
  for origin in ['rooms','circulation']:
   original=list(f.get(origin,[]));f[origin]=[]
   for record in original:
    tag=record['id'].split('-')[-1];dest=None;kind=None;reason=None
    if tag in rule.get('circulation',set()):
     dest='circulation';kind='circulation-candidate';reason='原圖為開放屋頂平台／公共廊道或樓梯平台，並非獨立房間。'
     if f['id']=='EN-B1' and tag=='029':reason='原圖放大可見階梯踏面，為樓梯間／前室，不是一般房間或升降機框。'
     if f['id'].startswith('EV-'):reason='原圖左下樓梯踏面正上方的平台／前室，不應強造獨立房門。'
    elif tag in rule.get('void',set()):dest='regionCandidates';kind='void-candidate';reason='原圖打X矩形內院／空域，三角線只是同一挑空的對角線，不是可入房間。'
    elif tag in rule.get('artifact',set()):dest='regionCandidates';kind='annotation-artifact';reason='原圖左上米黃色標題裝飾帶，位於真正建築外，不是房間；不擴大outline。'
    if dest is None:f[origin].append(record);continue
    record['kind']=kind;record['sourceReview']=dict(status='manual-classification-only',basis='map-derived',note=reason);record['note']+=(' '+reason if reason not in record.get('note','') else '')
    if not any(x['id']==record['id'] for x in f.get(dest,[])):f.setdefault(dest,[]).append(record)
    if dest!=origin:changes.append(dict(floorId=f['id'],regionId=record['id'],fromGroup=origin,toGroup=dest,reason=reason,sourceId=f['sourceId'],page=f['page'],polygon=record['polygon']))
  # Original X rectangles are explicit source evidence of floor voids. This is
  # plan interpretation, not a claim of present-day field verification.
  holes=[]
  if f['id']=='EN-B1':
   r=next(r for r in f.get('regionCandidates',[]) if r['id'].endswith('region-016'));holes=[r['polygon']]
  elif f['id']=='EN-RF':
   r=next(r for r in f.get('regionCandidates',[]) if r['id'].endswith('region-004'));holes=[r['polygon']]
  elif f['id']=='SC-RF':
   t=f['transform'];scale=t['metresPerPixel'];ox,oy=t['imageOriginPixels']
   for x0,y0,x1,y1 in [(1373,831,1683,982),(1375,984,1525,1066),(1531,984,1605,1066),(1609,984,1684,1066)]:
    holes.append([[(x-ox)*scale,(y-oy)*scale] for x,y in [(x0,y0),(x1,y0),(x1,y1),(x0,y1)]])
  for hole in holes:
   poly=Polygon(hole);outer=Polygon(f['outline']);assert outer.buffer(.05).covers(poly),f['id']
   if not any(Polygon(h).equals_exact(poly,.01) for h in f.get('holes',[])):f.setdefault('holes',[]).append(hole)
  if holes:f['holeEvidence']=dict(basis='map-derived',status='source-plan-interpretation',note='已逐圖放大看到X標記矩形，按內院／挑空處理；不宣稱已現地確認目前樓板狀態。',sourceId=f['sourceId'],page=f['page'])
 for f in data['floors']:
  if f['id']=='EC-1F':
   original=next((r for r in f['rooms'] if r['id']=='EC-1F-region-001'),None)
   if original:
    f['rooms'].remove(original);original['kind']='mixed-annotation-room-component';original['sourceReview']=dict(status='manual-classification-only',note='米黃色標題底色與真正EC1004/EC1005粉色房間相連；原混合色塊保留證據，兩房依明確分隔牆另描。');f.setdefault('regionCandidates',[]).append(original)
    t=f['transform'];scale=t['metresPerPixel'];ox,oy=t['imageOriginPixels']
    for code,x0,x1,dx in [('EC1004',165,235,184),('EC1005',235,337,247)]:
     pixels=[[x0,237],[x1,237],[x1,341],[x0,341]];poly=[[(x-ox)*scale,(y-oy)*scale] for x,y in pixels]
     f['rooms'].append(dict(id=f'EC-1F-region-001-{code}',code=code,codeBasis='manual-read-official-plan',kind='room-candidate',polygon=poly,sourceRegionPixels=pixels,door=dict(position=[(dx-ox)*scale,(237-oy)*scale],width=1.1,basis='schematic',note='原圖北側灰色走廊雙開門位置附近的示意門點，未升級已核對門。'),basis='map-derived',reviewStatus='candidate-review-required',note='放大官方原圖讀到EC1004/EC1005及兩房中間明確分隔牆，人工近似描繪；不是依grid造房或造號。'))
    changes.append(dict(floorId=f['id'],regionId=original['id'],fromGroup='rooms',toGroup='regionCandidates+2-source-rooms',reason='分離標題底色，保留原圖明確EC1004/EC1005',sourceId=f['sourceId'],page=f['page'],polygon=original['polygon']))
  elif f['id'] in ['EN-3F','EN-B1']:
   target='EN-3F-region-001' if f['id']=='EN-3F' else 'EN-B1-region-021';room=next((r for r in f['rooms'] if r['id']==target),None)
   if room:
    shape=Polygon(f['outline']);roompoly=Polygon(room['polygon']);outside=roompoly.difference(shape).area
    if outside>1e-8:
     shape=poly_largest(shape.union(roompoly));f['outline']=[list(p) for p in shape.exterior.coords][:-1];f['bounds']=list(shape.bounds);f['outlineReview']=dict(status='source-boundary-correction',note='原圖明確長房／外凸框的微小邊界被自動outline漏掉，按原多邊形union補回，不改註冊/尺度，不削房求通。',regionId=target,addedArea=outside)
     changes.append(dict(floorId=f['id'],regionId=target,fromGroup='source-room',toGroup='outline-boundary-union',reason='源圖真實房間/外凸框補回自動輪廓漏邊',sourceId=f['sourceId'],page=f['page'],addedArea=outside))
 return changes

def apply_rf_basement_review(data):
 # Source-image review, not reachability-driven deletion. Unknown real rooms
 # and mixed room/circulation components stay candidates for later partitioning.
 rules={
 'CH-RF':{'circulation':{'002','003'}},
 'PH-RF':{'circulation':{'002'},'equipment':{'004'}},
 'EC-RF':{'void':{'001','002'}},'EN-RF':{'circulation':{'002'}},
 'EN-B1':{'circulation':{'026'},'wall-strip':{'013'}},
 'SC-B1':{'circulation':{'003','045'},'void':{'018'}},
 'EV-1F':{'circulation':{'039'},'vertical-service':{'030'}},'EV-3F':{'circulation':{'007'},'vertical-service':{'029'}},
 'EV-2F':{'vertical-service':{'046'}},'EV-6F':{'vertical-service':{'024'}},'EV-5F':{'vertical-service':{'029'}},
 }
 changes=[]
 reasons={
 'CH-RF':'原圖為開放屋頂外圈／平台分區，細縫繞柱及設備屋，不是單一有門房間。',
 'PH-RF':'原圖為屋頂梯間平台及其內部無門內框；沒有依據把框內另當一般房間。',
 'EC-RF':'原圖為兩個清楚打X的屋頂內院／空域，對角線不是房間分隔。',
 'EN-RF':'原圖北側U形大區為開放屋頂平台，圍繞已核對X空域。',
 'EN-B1':'原圖為穿通的中央梯廳／長通道；外牆整列窗框細帶不是房間。',
 'SC-B1':'原圖為中央柱廳與樓梯公共區、帶疏散箭頭且兩端有門的通道；狹長X矩形為空域。',
 'EV-1F':'原圖東側L形區是室外平台；核心X小方框及門槽是電梯井，不是普通房間。',
 'EV-3F':'原圖長區為中間走廊接東側外廊；X小方框為電梯井核心。',
 'EV-2F':'原圖X小方框及門槽標示為電梯井核心，不是一般可入房間。',
 'EV-6F':'原圖X小方框及門槽標示為電梯井核心，不是一般可入房間。',
 'EV-5F':'原圖X小方框及門槽標示為電梯井核心，不是一般可入房間。',
 }
 for f in data['floors']:
  rule=rules.get(f['id'])
  if not rule:continue
  for origin in ['rooms','circulation']:
   original=list(f.get(origin,[]));f[origin]=[]
   for record in original:
    tag=record['id'].split('-')[-1];category=next((k for k,v in rule.items() if tag in v),None)
    if category is None:f[origin].append(record);continue
    assert not record.get('code') and not record.get('matchedCodes'),record['id']
    dest='circulation' if category=='circulation' else 'regionCandidates'
    record['kind']='circulation-candidate' if category=='circulation' else 'void-candidate' if category=='void' else category+'-candidate'
    if category=='vertical-service':record['kind']='vertical-service'
    record['sourceReview']=dict(status='manual-source-classification',basis='map-derived',note=reasons[f['id']],notFieldVerified=True)
    if reasons[f['id']] not in record.get('note',''):record['note']+=' '+reasons[f['id']]
    if not any(r['id']==record['id'] for r in f.get(dest,[])):f.setdefault(dest,[]).append(record)
    if category=='void':
     shape=Polygon(record['polygon'])
     if not any(Polygon(h).equals_exact(shape,.01) for h in f.get('holes',[])):f.setdefault('holes',[]).append(record['polygon'])
    if category=='vertical-service':
     marker=dict(id=record['id'],kind='elevator-shaft',polygon=record['polygon'],basis='map-derived',sourceId=f['sourceId'],page=f['page'],note='原圖X及門槽的電梯井核心；不作一般房間或露天中庭。後續應以封閉升降機構件表示，勿讓行人穿井。')
     if not any(x['id']==marker['id'] for x in f.get('verticalServices',[])):f.setdefault('verticalServices',[]).append(marker)
    if dest!=origin:changes.append(dict(floorId=f['id'],regionId=record['id'],fromGroup=origin,toGroup=dest,classification=category,reason=reasons[f['id']],sourceId=f['sourceId'],page=f['page'],polygon=record['polygon']))
  if f['id']=='CH-RF' and not any(r['id']=='CH-RF-source-east-room-A' for r in f['rooms']):
   t=f['transform'];scale=t['metresPerPixel'];ox,oy=t['imageOriginPixels']
   for name,x0,x1,dx in [('A',743,821,756),('B',821,986,973)]:
    pixels=[[x0,737],[x1,737],[x1,860],[x0,860]];poly=[[(x-ox)*scale,(y-oy)*scale] for x,y in pixels]
    record=dict(id='CH-RF-source-east-room-'+name,name='屋頂東側未編號空間 '+name,kind='room-candidate',polygon=poly,sourceRegionPixels=pixels,door=dict(position=[(dx-ox)*scale,(860-oy)*scale],width=1.1,basis='schematic',note='原圖南側可見門弧附近的示意門點，未現地核對。'),basis='map-derived',reviewStatus='candidate-review-required',note='人工對圖描東北小屋：外牆、分隔牆及南側門弧明確；未猜房號或使用用途。中央大間內短隔板不是獨立房間。')
    f['rooms'].append(record);changes.append(dict(floorId=f['id'],regionId=record['id'],fromGroup='unsegmented-source-enclosure',toGroup='rooms',reason=record['note'],sourceId=f['sourceId'],page=f['page'],polygon=poly))
 # Keep genuine or ambiguous enclosures; report geometry work instead of moving
 # them solely because a capsule failed at one selected portal.
 retain={
 'EV-3F':{'028':'真實矩形房間，約4.01×2.40m、bbox填滿99%；audit障礙z1.6004在房南界1.377外0.2234m，疑為第二道外廓牆，應改門/外牆，不刪房。','014':'有便器/隔間符號及入口的L形衛浴空間，保留房間候選。'},
 'SC-B1':{'039':'原圖混合至少兩個真實有牆小房與梯間前室，保留待拆分；不能整塊當走廊刪除。','027':'原圖有明確周界及側門的大矩形空間，未證實用途，保留候選。'},
 'EN-B1':{'005':'有柱網的大型地下空間，原圖不足以斷言只是走廊，保留候選。'},
 'MS-RF':{'003':'混合中央長廊及帶三個大型圓形設備符號的有界區，不能僅因窄框全部刪；待拆真實設備區與通道。','004':'原圖有分隔牆及左上門弧的小屋，保留候選。'},
 'PH-RF':{'001':'有明確四周牆的屋頂小屋，門洞辨識尚不完整，保留示意入口候選。'},
 'EV-RF':{'003':'原圖有明確左右牆及左側雙開門，是真實圍合空間，保留候選。'},
 }
 for f in data['floors']:
  for r in f['rooms']:
   note=retain.get(f['id'],{}).get(r['id'].split('-')[-1])
   if note:r['sourceReview']=dict(status='retained-after-source-review',basis='map-derived',note=note,notFieldVerified=True)
 return changes

def prepare(bid):
 current=json.loads((OUT/f'{bid}.json').read_text());frozen={f['id']:copy.deepcopy(f) for f in current['floors'] if bid=='SC' and f['level'] in [1,2]}
 inp=OUT/f'alignment-input-{bid}.json'
 if not inp.exists():save(inp,current)
 data=json.loads(inp.read_text());base=next(f for f in data['floors'] if f['level']==1)
 # Use an actual repeatable plan feature for translation, never just image centres.
 base_anchor=ev_grid_anchor(base) if bid=='EV' else primary(bid,base)
 if base_anchor is None:raise ValueError(f'No reference feature for {bid}')
 base_outline=base['outline'] if bid=='SC' else outline_without_title_band(base);base_width=Polygon(base_outline).bounds[2]-Polygon(base_outline).bounds[0]
 results=[];alignments=[];sc_ref_green=primary('SC',base) if bid=='SC' else None
 maxlevel=max(f['level'] for f in data['floors'] if f['level']!=99)
 for raw in data['floors']:
  f=copy.deepcopy(raw);level=f['level'];is_frozen=f['id'] in frozen
  if is_frozen:
   f=frozen[f['id']];results.append(f);alignments.append(dict(floorId=f['id'],method='frozen-checked-central-stair',basis='map-derived',scale=1,translation=[0,0],changed=False));continue
  # Preserve exact outline/room evidence, but remove label-band contamination.
  if not (bid=='BI' and level==99):f['outline']=outline_without_title_band(f)
  f['circulation']=[r for r in f['rooms'] if r.get('kind')=='circulation-candidate'];f['rooms']=[r for r in f['rooms'] if r.get('kind')!='circulation-candidate']
  anchor=ev_grid_anchor(f) if bid=='EV' and level in range(1,7) else primary(bid,f) if level not in [-1,99] else None
  fallback=False
  if bid=='SC' and level in [3,4]:
   factor=1.;target=sc_ref_green;method='main-science-stair-colour-correspondence';evidence='同一主館中央階梯色塊與1F對照，保留1F/2F既有北側樓梯開口原點；非新房門核對。'
  elif anchor is not None:
   width=Polygon(f['outline']).bounds[2]-Polygon(f['outline']).bounds[0];factor=base_width/max(width,1);factor=max(.7,min(1.4,factor));target=[0,0];method='repeated-lift-core' if bid=='EV' else 'repeated-stair-and-envelope-scale';evidence='以圖上同一梯段/升降機核心平移、建築主體輪廓跨度近似校正圖面縮放；未完成測量級雙控制點配準。'
  else:
   width=Polygon(f['outline']).bounds[2]-Polygon(f['outline']).bounds[0];factor=max(.5,min(1.5,base_width/max(width,1)));anchor=[base_anchor[0],base_anchor[1]];target=sc_ref_green if bid=='SC' else [0,0];fallback=True;method='schematic-basement-roof-registration';evidence='本層無可靠重複錨點，對位僅示意；不視為來源圖已證實相同位置。'
  tx=target[0]-anchor[0]*factor;tz=target[1]-anchor[1]*factor
  if fallback:
   rb=Polygon(base_outline).bounds;fb=Polygon(f['outline']).bounds
   refleft=rb[0]-(0 if bid=='SC' else base_anchor[0]);refnorth=rb[1]-(0 if bid=='SC' else base_anchor[1])
   anchor=[fb[0],fb[1]];target=[refleft,refnorth];tx=target[0]-anchor[0]*factor;tz=target[1]-anchor[1]*factor
  affine(f,factor,tx,tz);f['storeyIndex']=maxlevel+1 if level==99 else level
  f['stairCandidates']=f.pop('stairs',[])
  f['alignment']=dict(method=method,basis='schematic',sourceAnchor=anchor,targetAnchor=target,scale=factor,translation=[tx,tz],evidence=evidence)
  f['transform']['alignmentBasis']=method
  # Source RF drawing page 8 only contains the D/Physics roof, not Biology.
  if bid=='BI' and level==99:
   ref=next(x for x in results if x['level']==7);f['outline']=copy.deepcopy(ref['outline']);f['holes']=[];f['rooms']=[];f['circulation']=[];f['bounds']=list(Polygon(f['outline']).bounds);f['sourceStatus']='missing-bi-roof-plan';f['geometryBasis']='schematic';f['note']='官方合冊第8頁正文只標D棟物理館RF，沒有生科館RF。本層為沿用7F輪廓的虛擬示意屋頂，沒有捏造實際房間。';f['alignment']['method']='schematic-roof-from-BI7F'
  else:
   f['sourceStatus']='source-plan-available';f['geometryBasis']='map-derived-candidates';choose_doors(f)
  results.append(f);alignments.append(dict(floorId=f['id'],method=f['alignment']['method'],basis='schematic',scale=factor,translation=[tx,tz],changed=True,sourceStatus=f['sourceStatus']))
 # Registration room/circulation records remain candidates. The shared external
 # service staircase is consciously a virtual addition, outside all room extents.
 maxx=max(Polygon(f['outline']).bounds[2] for f in results);minz=min(Polygon(f['outline']).bounds[1] for f in results);maxz=max(Polygon(f['outline']).bounds[3] for f in results)
 service=[round(maxx+4.5,3),0.0];fp=[[service[0]-2.25,-2.5],[service[0]+2.25,-2.5],[service[0]+2.25,2.5],[service[0]-2.25,2.5]]
 for f in results:
  if f['id'] in frozen:continue
  f['stairs']=[dict(id='sc-central' if bid=='SC' else f'{bid.lower()}-virtual-service',position=[0,0] if bid=='SC' else service,basis='schematic',note='SC中央梯共同原點的示意延伸；外接服務梯另見building.serviceStair。' if bid=='SC' else '外接虛擬服務梯，不是校方圖上的實際樓梯；各層共同位置。')]
  boundary=Polygon(f['outline']).exterior;landing=nearest_points(boundary,Point(service))[0]
  f['serviceConnector']=dict(position=service,plan=[list(landing.coords)[0],service],width=2.2,basis='schematic',reviewRequired=True,note='虛擬外接通道；是否需在房間外牆開新服務門由幾何整合檢查，不宣稱實際入口。')
  f['note']+=' 跨層註冊及新增服務梯/門洞均明示意，不升級map-checked。'
  assert not any(Polygon(fp).intersects(Polygon(r['polygon'])) for r in f['rooms']),f['id']
 for fid,old in frozen.items():assert next(f for f in results if f['id']==fid)==old,'Frozen SC floor changed'
 data['floors']=results;apply_source_review(data);apply_rf_basement_review(data);results=data['floors'];data['floorAlignments']=alignments;data['serviceStair']=dict(id=f'{bid.lower()}-virtual-service',position=service,footprint=fp,width=4.5,depth=5,basis='schematic',note='所有樓層共用的外接虛擬服務樓梯位置；足跡位於建築東側輪廓外，未穿任何圖面房間。')
 data['registeredBounds']=[min(Polygon(f['outline']).bounds[0] for f in results),minz,maxx,maxz];data['note']+=' 本版已按同一梯段/核心特徵註冊，縮放仍為近似；地下及屋頂未能對位者明示意。'
 save(OUT/f'{bid}.json',data)
 overlays={f['id']:svg_overlay(f,([0,0] if bid=='SC' else [0,0])) for f in results if f['id'] not in frozen}
 report=dict(buildingId=bid,registeredBounds=data['registeredBounds'],serviceStair=data['serviceStair'],alignments=alignments,sourceOverlaySVG=overlays,coverage=dict(floors=len(results),sourcePlans=sum(f.get('sourceStatus')!='missing-bi-roof-plan' for f in results),schematicRoofCount=sum(f.get('sourceStatus')=='missing-bi-roof-plan' for f in results),roomPolygons=sum(len(f['rooms']) for f in results),circulationPolygons=sum(len(f.get('circulation',[])) for f in results),complete=False),firstFloorReview='已人工查看官方首層輪廓、可辨房號及主要灰色廊道；候選未逐間升級map-checked。')
 save(OUT/f'alignment-{bid}.json',report);print(bid,'bounds',data['registeredBounds'],'service',service,'floors',len(results),flush=True);return report

def validate_registered_outputs():
 buildings=[json.loads((OUT/f'{bid}.json').read_text()) for bid in BIDS]
 if not all(b.get('floorAlignments') for b in buildings):return
 count=0;frozen_hashes={}
 for b in buildings:
  raw=json.loads((OUT/f"alignment-input-{b['id']}.json").read_text());service=Polygon(b['serviceStair']['footprint'])
  for f in b['floors']:
   count+=1;assert Polygon(f['outline']).is_valid,f['id']
   for h in f.get('holes',[]):assert Polygon(h).is_valid and Polygon(f['outline']).buffer(.1).covers(Polygon(h)),(f['id'],'hole geometry')
   for service_region in f.get('verticalServices',[]):assert Polygon(service_region['polygon']).is_valid,(f['id'],'vertical-service geometry')
   assert f['stairs'][0]['position']==([0,0] if b['id']=='SC' else b['serviceStair']['position']),f['id']
   assert f.get('storeyIndex',f['level'])<20,f['id']
   assert all(r['kind']!='circulation-candidate' for r in f['rooms']),f['id']
   for r in f['rooms']:
    poly=Polygon(r['polygon']);assert poly.is_valid and poly.area>0,r['id'];assert not service.intersects(poly),r['id']
   frozen=b['id']=='SC' and f['level'] in [1,2]
   if frozen:
    assert f==next(x for x in raw['floors'] if x['id']==f['id']),f['id']
    frozen_hashes[f['id']]=hashlib.sha256(json.dumps(f,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
   elif f.get('sourceStatus')!='missing-bi-roof-plan':
    t=f['transform'];old=t['rawTransform'];factor=t['registrationMatrix'][0][0];tx=t['registrationMatrix'][0][2];tz=t['registrationMatrix'][1][2]
    for px,py in [(0,0),(f['imageWidth']/2,f['imageHeight']/2),(f['imageWidth'],f['imageHeight'])]:
     a=(px-old['imageOriginPixels'][0])*old['metresPerPixel']*factor+tx;z=(py-old['imageOriginPixels'][1])*old['metresPerPixel']*factor+tz
     assert abs(a-(px-t['imageOriginPixels'][0])*t['metresPerPixel'])<1e-8,f['id'];assert abs(z-(py-t['imageOriginPixels'][1])*t['metresPerPixel'])<1e-8,f['id']
 report=dict(buildingCount=len(buildings),floorCount=count,sourcePlanCount=59,schematicRoofCount=1,checks=['valid floor/room polygons','room/circulation separated','shared stairs[0] across all floors','service footprint 4.5x5m intersects no room','pixel/raw/registered transform round-trip','RF storeyIndex sanity','SC1F/2F frozen objects unchanged'],frozenSCFloorCanonicalSHA256=frozen_hashes,buildingJSONSHA256={b['id']:hashlib.sha256((OUT/f"{b['id']}.json").read_bytes()).hexdigest() for b in buildings},limitations=['semantic room coverage remains partial','service stairs/connectors are virtual schematic additions','registration scaling is approximate and is not a measured survey','door accessibility requires independent baked navigation checks'])
 save(OUT/'alignment-validation.json',report)
 # Keep public catalogues consistent with corrected source classifications.
 index_path=OUT/'index.json'
 if index_path.exists():
  catalog=json.loads(index_path.read_text());by={b['id']:b for b in buildings}
  for row in catalog['buildings']:
   b=by[row['id']];row['roomCandidateCount']=sum(len(f['rooms']) for f in b['floors']);row['namedRoomCount']=sum(bool(r.get('code')) for f in b['floors'] for r in f['rooms'])
  catalog['note']=f"{sum(len(f['rooms']) for b in buildings for f in b['floors'])}個房間/房間候選；廊道另計，候選未逐間升級map-checked。";save(index_path,catalog)
 coverage_path=OUT/'coverage.json'
 if coverage_path.exists():
  coverage=json.loads(coverage_path.read_text());floorby={f['id']:f for b in buildings for f in b['floors']}
  for row in coverage:
   f=floorby[row['floorId']];row['roomPolygonCount']=len(f['rooms']);row['circulationCandidateCount']=len(f.get('circulation',[]));row['nonRoomCandidateCount']=len(f.get('regionCandidates',[]));row['namedRoomCount']=sum(bool(r.get('code')) for r in f['rooms'])
  save(coverage_path,coverage)
 print('VALIDATED: 8 buildings / 60 floors; frozen SC floors unchanged; common stairs and safe external footprints; transforms consistent',flush=True)

if __name__=='__main__':
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--buildings',nargs='+',choices=BIDS,default=BIDS);args=parser.parse_args();reports=[prepare(bid) for bid in args.buildings]
 existing=[json.loads(p.read_text()) for p in OUT.glob('alignment-*.json') if p.stem.replace('alignment-','') in BIDS]
 save(OUT/'alignment-report.json',dict(buildings=[{k:v for k,v in r.items() if k!='sourceOverlaySVG'} for r in existing],note='SC1/2 manual frozen; 59 official floor plans plus 1 schematic BI roof. All service stairs/registration approximations are disclosed schematic.'))
 doc=ROOT/'docs/walkthrough-data.md';text=doc.read_text();marker='\n## 八棟跨層註冊與虛擬服務梯'
 if marker in text:text=text.split(marker)[0]
 text+=marker+'\n\n執行 `python -B tools/prepare_campus_interiors.py`；原始輸入保存在alignment-input-各棟.json，重跑不重複套用變換。SC1/2物件逐字典比較保持不變。地上層用同一綠色梯段或EV重複升降機核心作錨點，按主體跨度近似縮放；沒有將圖像置中當成跨層對位。B1/RF無法配準者為schematic。BI合冊RF頁正文只有PH屋頂，因此BI RF改為沿BI7F輪廓的示意屋頂，不是取得生科館屋頂圖。\n\nrooms與circulation已分開；所有新門點/入口及外接服務梯均schematic，不升級map-checked。外接服務梯4.5×5m，足跡在所有房間輪廓外。SC原stairs[0]=[0,0]保持原有區；building.serviceStair提供另設外接梯位置。其他棟stairs[0]各層同一虛擬服務梯，原圖梯段候選另存stairCandidates。serviceConnector是待幾何整合的示意通道，不宣稱真實出入口。\n\n每棟alignment-各棟.json含逐層變換及原圖overlay SVG字串；SVG在原圖像素上標房間紅線、示意門綠點及對位錨點紫十字。59實際來源層＋1示意BI屋頂；room detectionCoverage仍partial。\n\n|棟別|層數|註冊後bounds|共同外接梯anchor|\n|---|---:|---|---|\n'
 for r in sorted(existing,key=lambda r:r['buildingId']):text+=f"|{r['buildingId']}|{r['coverage']['floors']}|{r['registeredBounds']}|{r['serviceStair']['position']}|\n"
 text+='\n### 六張問題來源頁的人工語意複核\n\nSC-RF的開放屋頂大區及EN-RF平台改circulation，EN-B1公共大區與原圖可見踏面的樓梯前室、EV5/6F左下梯段上方平台亦改circulation。CH1F-region001是米黃色標題裝飾，並非房間，不擴大outline。EN-B1中央X內院、EN-RF的X空域及SC-RF中央一大三小X矩形補holes，三角對角線分區保留在regionCandidates而不當成房間。這是源圖符號判讀，不宣稱已現地核對目前樓板狀態。逐筆原polygon/source/page及理由見source-review-corrections.json。目前rendered rooms/room-candidate實數見alignment-report.json；廊道不計入。\n'
 text+='\n### RF/B1與代表性門碰撞的來源複核\n\nCH屋頂外圈與平台、PH梯間平台、EN北側屋頂平台、EN/SC地下公共廳及EV走廊/外部平台按圖移circulation；EC屋頂兩個X空域與SCB1狹長X空域移候選並補holes。CH東北兩間可見完整牆與南側門弧的小屋另以無房號候選保留。EV2-046、EV3-029、EV5-029有明確X與門槽，另記verticalServices電梯井，不當普通房間或露天洞。樓梯/電梯及用途未明的源圖證據均保留；不能把數量當實際房間總數。MSRF003混合長廊/設備區、EV3-028真房、SCB1-039混合真小房等保留待幾何處理，不依通行率刪除。詳source-review-corrections.json.rfBasementReview.retained。\n'
 doc.write_text(text)
 validate_registered_outputs()
