#!/usr/bin/env python3
"""Official-plan polygon candidates; this is not an automatic architectural survey.
No invented room numbers. Door placements are explicitly schematic unless annotated.
Requires numpy, opencv-python, Pillow, PyMuPDF and shapely, all local/free.
"""
import argparse, json, pathlib, hashlib, logging, math, io, subprocess, csv, re
import cv2, numpy as np, pymupdf as fitz
from PIL import Image,ImageDraw
from shapely.geometry import Polygon,Point
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'public/data/walkthrough'
# Official floor-plan renders stay out of the published site (data/official-plans, not served).
PLANS=ROOT/'data/official-plans/walkthrough'
NAMES={'SC':'理學院／東綜合大樓','EN':'工學院／機電大樓','BI':'生科館','PH':'物理館','CH':'化學館','EC':'電資大樓','MS':'材料大樓','EV':'環工館'}
SAFETY={'SC':'174543_8048869_04268','EN':'174547_2531961_04269','BI':'174544_4720186_04268','PH':'174544_4720186_04268','CH':'174546_6679834_04269','EC':'174558_61801_04270','MS':'174545_2241236_04269','EV':'174548_7958856_04269'}
WIDTHS={'SC':110,'EN':110,'BI':42,'PH':46,'CH':52,'EC':85,'MS':52,'EV':52}
SOURCES={s['id']:s for s in json.loads((ROOT/'public/data/sources.json').read_text())}
ROOMS=json.loads((ROOT/'public/data/rooms.json').read_text())
FLOORS={f['id']:f for f in json.loads((ROOT/'public/data/floors.json').read_text())}

def simplify(contour,eps=1.5):
 return cv2.approxPolyDP(contour,eps,True).reshape(-1,2).astype(float).tolist()

def candidate_regions(im, colored=False):
 a=np.asarray(im);h,w=a.shape[:2]
 if colored:
  r,g,b=a[:,:,0].astype(float),a[:,:,1].astype(float),a[:,:,2].astype(float)
  mask=((r>g+13)&(g>b-15)&(r>120)&(g>60)&(g<220)).astype('uint8')*255
  # Keep real red room-fill components. Do not bridge shared partition walls.
  count,labels,stats,_=cv2.connectedComponentsWithStats(mask,8)
  regions=[]
  for i in range(1,count):
   if stats[i,cv2.CC_STAT_AREA]<max(70,w*h*.00035):continue
   contours,_=cv2.findContours((labels==i).astype('uint8'),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
   if contours:regions.append(max(contours,key=cv2.contourArea))
 else:
  gray=cv2.cvtColor(a,cv2.COLOR_RGB2GRAY)
  lines=(gray<245).astype('uint8')*255
  # 5px closure approximates unclosed door gaps; candidates retain partial status.
  wall=cv2.morphologyEx(lines,cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))
  free=255-wall
  count,labels,stats,_=cv2.connectedComponentsWithStats(free,8)
  regions=[]
  for i in range(1,count):
   x,y,rw,rh,area=stats[i]
   if x<=1 or y<=1 or x+rw>=w-1 or y+rh>=h-1:continue
   if area<max(150,w*h*.00065) or area>w*h*.24 or max(rw,rh)/max(1,min(rw,rh))>14:continue
   contours,_=cv2.findContours((labels==i).astype('uint8'),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
   if contours:regions.append(max(contours,key=cv2.contourArea))
 clean=[]
 for c in regions:
  if cv2.contourArea(c)<=30:continue
  vertices=simplify(c)
  if len(vertices)<3:continue
  poly=Polygon(vertices).buffer(0)
  for part in ([poly] if poly.geom_type=='Polygon' else getattr(poly,'geoms',[])):
   if part.geom_type=='Polygon' and part.area>30:clean.append(np.asarray(part.exterior.coords,dtype=np.float32).reshape(-1,1,2))
 return clean

def footprint(im):
 a=np.asarray(im);mask=(np.min(a,axis=2)<246).astype('uint8')*255
 # Remove very small lettering/symbols then join walls within a narrow pixel band.
 mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((13,13),np.uint8))
 contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
 c=max(contours,key=cv2.contourArea)
 return simplify(c,2.5)

def make_floor(bid,level,im,sid,page,crop,colored=False,room_candidates=None,anchor=None):
 label='B1' if level==-1 else 'RF' if level==99 else f'{level}F';fid=f'{bid}-{label}';w,h=im.size
 scale=WIDTHS[bid]/w
 # SC 1F/2F use the manually checked central-stair points to share an origin.
 # Other levels are centered only; registration is still explicitly schematic.
 origin=anchor if anchor else [w*.5,h*.5]
 def local(p):return [round((p[0]-origin[0])*scale,3),round((p[1]-origin[1])*scale,3)]
 outline_pixels=footprint(im);outline=[local(p) for p in outline_pixels]
 outline_poly=Polygon(outline).buffer(0)
 if outline_poly.geom_type=='MultiPolygon':outline_poly=max(outline_poly.geoms,key=lambda p:p.area)
 outline=[list(p) for p in outline_poly.exterior.coords][:-1]
 regions=candidate_regions(im,colored);records=[];matched=set()
 overlay=im.copy();draw=ImageDraw.Draw(overlay)
 for i,c in enumerate(regions):
  pixels=simplify(c)
  if len(pixels)<3:continue
  poly=Polygon(pixels)
  if not poly.is_valid:poly=poly.buffer(0)
  if poly.is_empty or poly.geom_type!='Polygon':continue
  try:
   if not Polygon(outline_pixels).buffer(0).covers(poly.representative_point()):continue
  except Exception:continue
  codes=[]
  for r in room_candidates or []:
   if poly.buffer(4).covers(Point(r['x']*w,r['y']*h)):codes.append(r['code']);matched.add(r['code'])
  # The nearest boundary to the image center is only a provisional opening.
  # It must never be presented as an observed architectural door.
  target=Point(w*.5,h*.5);near=poly.exterior.interpolate(poly.exterior.project(target))
  code=codes[0] if len(codes)==1 else None
  rid=f'{fid}-region-{i+1:03d}'
  record=dict(id=rid,kind='room-candidate',polygon=[local(p) for p in pixels],door=dict(position=local([near.x,near.y]),width=1.0,basis='schematic'),basis='map-derived',reviewStatus='candidate-review-required',sourceRegionPixels=pixels,matchedCodes=codes,note='輪廓來自官方圖面區域；門點朝向僅示意，尚未逐間核對，區域可能含廊道、設備間或分割誤差。')
  if code:record['code']=code
  if len(codes)>1:record['note']+='此候選包含多個房號，需拆分，不能當成一間完整房間。'
  if not codes:record['name']='未編號圖面空間候選'
  records.append(record)
  pts=[tuple(p) for p in pixels];draw.line(pts+[pts[0]],fill=(215,30,30),width=2);draw.text(pts[0],str(i+1),fill=(0,20,220))
 # SC1/2 named rooms are manually traced from the actual coloured plan,
 # replacing raw colour fragments (text/door strokes can split one room).
 if bid=='SC' and level in [1,2]:
  records=[];matched=set();overlay=im.copy();draw=ImageDraw.Draw(overlay)
  for code,verts in sc_manual(level):
   pixels=[[x*w,y*h] for x,y in verts]
   records.append(dict(id=f'{fid}-{code}',code=code,kind='room',polygon=[local(p) for p in pixels],door=dict(position=local(pixels[0]),width=1.0,basis='schematic'),basis='map-derived',reviewStatus='outline-checked-door-review-required',sourceRegionPixels=pixels,note='人工對照官方圖面描繪房間外界；受圖線寬影響為近似輪廓，非CAD尺寸。房門需另核對。'))
   matched.add(code);draw.line([tuple(p) for p in pixels]+[tuple(pixels[0])],fill='red',width=3);draw.text(tuple(pixels[0]),code,fill='blue')
  # Add only explicitly observed unknown room areas, without inventing labels.
  extras=[[(.660,.312),(.705,.312),(.705,.419),(.660,.419)],[(.909,.780),(.970,.780),(.970,.839),(.909,.839)]] if level==1 else [[(.642,.474),(.684,.474),(.684,.528),(.642,.528)]]
  for i,verts in enumerate(extras):
   pixels=[[x*w,y*h] for x,y in verts];records.append(dict(id=f'{fid}-unnumbered-{i+1}',kind='room',name='圖面未標房號空間',polygon=[local(p) for p in pixels],door=dict(position=local(pixels[0]),width=1,basis='schematic'),basis='map-derived',reviewStatus='outline-checked-door-review-required',sourceRegionPixels=pixels,note='圖上可見封閉粉色區域，沒有清楚房號；不推測代碼。'))
   draw.line([tuple(p) for p in pixels]+[tuple(pixels[0])],fill='orange',width=3)
  nav=json.loads((ROOT/'public/data/navigation.json').read_text())
  provisional_doors={
   'SC1014':(.617,.235),'SC1013':(.617,.300),'SC1012':(.617,.490),
   'SC1008':(.705,.240),'SC1009':(.705,.470),'SC1004':(.902,.280),'SC1003':(.902,.450),
   'SC2011':(.600,.220),'SC2010':(.600,.362),'SC2009':(.600,.490),
   'SC2007':(.684,.275),'SC2006':(.684,.400),
   'SC2005':(.722,.244),'SC2004':(.772,.244),'SC2003':(.830,.244),
   'SC2008':(.630,.646),'SC2012':(.493,.646),'SC2013':(.455,.707),'SC2016':(.054,.707),
  }
  for i in range(7):provisional_doors[f'SC2002-{7-i}']=(.880,([.138,.192,.247,.301,.357,.411,.467][i]+[.192,.247,.301,.357,.411,.467,.528][i])/2)
  for record in records:
   code=record.get('code')
   xy=provisional_doors.get(code)
   if not code:
    xy=(.705,.365) if level==1 and record['id'].endswith('-1') else (.909,.810) if level==1 else (.684,.500)
   if xy:record['door']=dict(position=local([xy[0]*w,xy[1]*h]),width=1,basis='schematic',note='人工依原圖廊道側選擇開洞位置；除四個既有門外，仍為未逐門驗證的示意門點。')
   door=next((n for n in nav['nodes'] if n.get('floorId')==fid and n['id']=='door-'+record.get('code','')),None)
   if door:record['door']=dict(position=local([door['x']*w,door['y']*h]),width=1,basis='map-derived',note='沿用原PDF人工核對門洞點；未經現地。')
 # Window panes, stair treads and tiny fixture pockets are not room polygons.
 # Preserve them separately for audit instead of extruding them into false rooms.
 rejected=[];filtered=[]
 for record in records:
  if bid=='SC' and level in [1,2]:filtered.append(record);continue
  poly=Polygon(record['polygon'])
  if not poly.is_valid:
   poly=poly.buffer(0)
   if poly.geom_type=='MultiPolygon':poly=max(poly.geoms,key=lambda p:p.area)
   record['polygon']=[list(p) for p in poly.exterior.coords][:-1];record['note']+=' 自交微小碎片已修復，仍待對圖核對。'
   record['sourceRegionPixels']=[[p[0]/scale+origin[0],p[1]/scale+origin[1]] for p in record['polygon']]
  bx,by,ex,ey=poly.bounds;short=min(ex-bx,ey-by);long=max(ex-bx,ey-by)
  if not record.get('code') and (poly.area<4 or short<1.2):
   record['exclusionReason']='too-small-or-narrow; may be window, fixture, stair tread, or a small room requiring manual review';rejected.append(record);continue
  if not colored and short>0 and long/short>3.5 and poly.area>20:record['kind']='circulation-candidate'
  filtered.append(record)
 records=filtered
 codes=[r['code'] for r in records if r.get('code')]
 ambiguous_codes={code for code in codes if codes.count(code)>1}
 for record in records:
  if record.get('code') in ambiguous_codes:
   record['ambiguousCodes']=[record.pop('code')];record['note']+=' 同一房號貼近多個區域，暫不賦予代碼，待人工確認。'
 # Preserve text candidates missed by segmentation as points, never fabricate polygons.
 unmatched=[dict(code=r['code'],position=local([r['x']*w,r['y']*h])) for r in room_candidates or [] if r['code'] not in matched]
 image_name=f'{fid}.webp';PLANS.mkdir(parents=True,exist_ok=True);im.save(PLANS/image_name,'WEBP',quality=91)
 xx=[p[0] for p in outline];zz=[p[1] for p in outline]
 stairs=[]
 if colored:
  a=np.asarray(im).astype(float);r,g,b=a[:,:,0],a[:,:,1],a[:,:,2]
  green=((g>r+16)&(b>r+10)&(g>b-14)&(g<225)).astype('uint8')*255
  green=cv2.morphologyEx(green,cv2.MORPH_CLOSE,np.ones((7,7),np.uint8))
  count,labels,stats,centroids=cv2.connectedComponentsWithStats(green,8)
  for i in range(1,count):
   if stats[i,cv2.CC_STAT_AREA]<max(70,w*h*.0008):continue
   pt=centroids[i].tolist()
   if Polygon(outline_pixels).buffer(0).covers(Point(pt)):
    stairs.append(dict(id=f'{bid.lower()}-stair-colour-{len(stairs)+1}',position=local(pt),basis='map-derived',reviewStatus='candidate-review-required',note='綠色階梯區域中心候選；尚未人工配對同一座跨層樓梯。'))
 if bid=='SC' and level in [1,2]:stairs=[dict(id='sc-central',position=[0,0],basis='map-derived',note='沿用原PDF人工核對的中央樓梯位置，兩層此錨點對齊；實際階梯模型仍為示意。')]
 annotations=[]
 if bid=='SC' and level in [1,2]:
  annotations=[dict(id=n['id'],kind=n['kind'],position=local([n['x']*w,n['y']*h]),sourceNormalized=[n['x'],n['y']]) for n in json.loads((ROOT/'public/data/navigation.json').read_text())['nodes'] if n.get('floorId')==fid]
 hole_norm=([[(.631,.263),(.657,.263),(.657,.524),(.631,.524)],[(.722,.312),(.764,.312),(.764,.436),(.722,.436)]] if level==1 else [[(.615,.249),(.638,.249),(.638,.470),(.615,.470)]]) if bid=='SC' and level in [1,2] else []
 holes=[[local([x*w,y*h]) for x,y in poly] for poly in hole_norm]
 overlay=im.copy();draw=ImageDraw.Draw(overlay)
 for i,record in enumerate(records):
  pts=[tuple(p) for p in record['sourceRegionPixels']];draw.line(pts+[pts[0]],fill='orange' if record['kind']=='circulation-candidate' else 'red',width=2);draw.text(pts[0],record.get('code') or str(i+1),fill='blue')
 for poly in hole_norm:
  pts=[(x*w,y*h) for x,y in poly];draw.line(pts+[pts[0]],fill='purple',width=4)
 for a in annotations:
  x,y=a['sourceNormalized'];x*=w;y*=h;draw.ellipse((x-4,y-4,x+4,y+4),fill='green')
 overlay.save(PLANS/f'{fid}-regions.jpg',quality=88)
 return dict(id=fid,level=level,storeyIndex=(max(x[0] for x in safety_specs(bid) if x[0]!=99)+1 if level==99 else level),label=label,sourceId=sid,page=page,crop=crop,imageUrl=f'/data/walkthrough/{image_name}',imageWidth=w,imageHeight=h,bounds=[min(xx),min(zz),max(xx),max(zz)],outline=outline,holes=holes,mapAnnotations=annotations,rooms=records,regionCandidates=rejected,stairs=stairs,transform=dict(unit='illustrative-metre',metresPerPixel=scale,imageOriginPixels=origin,imageToLocal='x=(imageX-originX)*metresPerPixel; z=(imageY-originY)*metresPerPixel',alignmentBasis='checked-central-stair' if anchor else 'schematic-centering',sourceSHA256=SOURCES[sid]['sha256']),renderImage=dict(url=f'/data/walkthrough/{image_name}',overlayUrl=f'/data/walkthrough/{fid}-regions.jpg',sourceId=sid,page=page,crop=crop),reviewStatus='candidate-review-required',detectionCoverage='partial',ambiguousLabelCodes=sorted(ambiguous_codes),unmatchedRoomLabels=unmatched,missing=['逐間房間/廊道分類與漏檢核對','房門真實位置','中庭/挑空holes辨識','跨層與戶外入口精確對位']+([] if bid=='SC' and level in [1,2] else ['樓梯候選需人工核對位置與跨層配對']),note='官方圖面自動抽取的部分候選，不能宣稱所有房間已建模。尺度與未核對的對位僅示意。RF level=99為屋頂代碼，並非第99層。')

def sc_manual(level):
 def rect(x0,y0,x1,y1):return [[x0,y0],[x1,y0],[x1,y1],[x0,y1]]
 if level==1:
  specs=[('SC1014',(.514,.103,.617,.264)),('SC1013',(.514,.264,.617,.394)),('SC1012',(.514,.394,.617,.523)),('SC1008',(.660,.157,.705,.312)),('SC1009',(.660,.419,.705,.524)),('SC1005',(.721,.103,.889,.258)),('SC1004',(.902,.157,.950,.313)),('SC1003',(.902,.313,.950,.524)),('SC1001',(.909,.582,.970,.780)),('SC1011',(.618,.632,.678,.748))]
  out=[(code,rect(*r)) for code,r in specs]
  out.append(('SC1015',[[.470,.580],[.511,.580],[.511,.634],[.535,.634],[.535,.748],[.449,.748],[.449,.634],[.470,.634]]));return out
 specs=[('SC2011',(.518,.075,.600,.244)),('SC2010',(.518,.253,.600,.383)),('SC2009',(.518,.393,.600,.528)),('SC2007',(.642,.136,.684,.301)),('SC2006',(.642,.305,.684,.474)),('SC2005',(.702,.081,.742,.244)),('SC2004',(.742,.081,.802,.244)),('SC2003',(.802,.081,.864,.244)),('SC2001',(.884,.590,.944,.864)),('SC2008',(.600,.646,.660,.767)),('SC2012',(.475,.646,.520,.768)),('SC2013',(.436,.707,.475,.768)),('SC2016',(.034,.707,.074,.768))]
 ys=[.138,.192,.247,.301,.357,.411,.467,.528]
 specs.extend((f'SC2002-{7-i}',(.880,ys[i],.923,ys[i+1])) for i in range(7))
 out=[(code,rect(*r)) for code,r in specs]
 # Avoid enclosing the WC corner in the labelled SC2011 room.
 out[0]=('SC2011',[[.518,.075],[.576,.075],[.576,.194],[.600,.194],[.600,.244],[.518,.244]])
 return out

def safety_specs(bid):
 if bid in ['SC','EN']:
  return [(lev,i+1,[.02,.02,.97,.92]) for i,lev in enumerate([-1,1,2,3,4,99])]
 if bid in ['BI','PH']:
  box=[.58,.02,.97,.91] if bid=='BI' else [.02,.02,.58,.91]
  return [(lev,i+1,box) for i,lev in enumerate([1,2,3,4,5,6,7,99])]
 if bid in ['CH','MS','EV']:
  out=[]
  for page in range(1,4):
   out.extend([(page*2-1,page,[.025,.46,.63,.925]),(page*2,page,[.40,.02,.975,.46])])
  out.append((99,4,[.02,.02,.97,.92]));return out
 if bid=='EC':return [(-1,1,[.025,.51,.97,.92]),(1,1,[.025,.02,.97,.48])]+[(level,level,[.025,.02,.97,.92]) for level in range(2,10)]+[(99,10,[.025,.02,.97,.92])]

OAA_IDS={'EN':'oaa-03Room_COE_3','BI':'oaa-02Room_COS_2','PH':'oaa-02Room_COS_3','CH':'oaa-02Room_COS_4','EC':'oaa-03Room_COE_2','MS':'oaa-03Room_COE_1'}
def oaa_box(bid,lev):
 if bid in ['BI','PH'] and 1<=lev<=7:
  rows=[(.12,.315),(.355,.53),(.58,.745),(.805,.925)];top,bot=rows[(lev-1)//2];left,right=(.08,.50) if lev%2 else (.55,.98);return [left,top,right,bot]
 if bid in ['CH','MS'] and 1<=lev<=6:
  rows=[(.24,.435),(.48,.655),(.715,.875)] if bid=='MS' else [(.24,.43),(.48,.64),(.715,.86)]
  top,bot=rows[(lev-1)//2];left,right=((.03,.505) if lev>2 else (.09,.50)) if lev%2 else (.52,.98)
  if bid=='CH':left,right=(.10,.53) if lev%2 else (.54,.96)
  return [left,top,right,bot]
 if bid=='EN' and 1<=lev<=4:
  top,bot=[(.11,.28),(.31,.48),(.50,.68),(.72,.89)][lev-1];return [.31,top,.93,bot]
 if bid=='EC' and 1<=lev<=9:
  top,bot=[(.05,.18),(.21,.34),(.38,.51),(.56,.705),(.75,.88)][(lev-1)//2];left,right=(.17,.53) if lev%2 else (.60,.98);return [left,top,right,bot]
 return None

def ocr_candidates(im,bid,level):
 data=io.BytesIO();im.save(data,'PNG')
 result=subprocess.run(['tesseract','stdin','stdout','-l','eng','--psm','11','tsv'],input=data.getvalue(),capture_output=True,check=True)
 words=list(csv.DictReader(io.StringIO(result.stdout.decode()),delimiter='\t'));out=[];seen=set()
 for i,word in enumerate(words):
  text=word.get('text','').strip().replace('O','0')
  # Tesseract may split a prefix and numeric suffix into adjacent words.
  if i+1<len(words):text+=' '+words[i+1].get('text','')
  for match in re.finditer(r'(?<![A-Z])'+bid+r'\s*([1-9][0-9]{2,4}(?:-[0-9]{1,2})?)',text,re.I):
   digits=match.group(1)
   if int(digits[0])!=level:continue
   code=bid+digits
   if code in seen:continue
   seen.add(code);out.append(dict(code=code,x=(int(word['left'])+int(word['width'])/2)/im.width,y=(int(word['top'])+int(word['height'])/2)/im.height,basis='ocr-candidate'))
 return out

def run(buildings):
 OUT.mkdir(parents=True,exist_ok=True)
 logging.basicConfig(level=logging.INFO,format='%(asctime)s %(message)s',handlers=[logging.FileHandler(OUT/'run.log'),logging.StreamHandler()])
 for bid in buildings:
  sid='safety-pta_'+SAFETY[bid];source=SOURCES[sid];doc=fitz.open(ROOT/source['localPdf']);floors=[]
  for level,page,box in safety_specs(bid):
   if bid=='SC' and level in [1,2,3,4]:
    old=FLOORS[f'SC-{level}F'];im=Image.open(ROOT/'public'/old['imageUrl'].lstrip('/')).convert('RGB')
    anchor=[im.width*.825,im.height*.306] if level==1 else [im.width*.803,im.height*.294] if level==2 else None
    rooms=[r for r in ROOMS if r['floorId']==old['id']]
    fl=make_floor(bid,level,im,old['sourceId'],old['page'],old['crop'],True,rooms,anchor)
   elif oaa_box(bid,level):
    osid=OAA_IDS[bid];odoc=fitz.open(ROOT/SOURCES[osid]['localPdf']);p=odoc[0];box=oaa_box(bid,level)
    rect=fitz.Rect(p.rect.width*box[0],p.rect.height*box[1],p.rect.width*box[2],p.rect.height*box[3]);pix=p.get_pixmap(matrix=fitz.Matrix(1,1),clip=rect,alpha=False);im=Image.frombytes('RGB',[pix.width,pix.height],pix.samples)
    crop=dict(x=rect.x0,y=rect.y0,width=rect.width,height=rect.height);candidates=ocr_candidates(im,bid,level)
    fl=make_floor(bid,level,im,osid,1,crop,True,candidates)
    fl['ocrRoomCandidates']=candidates;fl['note']+=' OCR房號僅候選，尚未逐字人工確認。'
   else:
    p=doc[page-1];rect=fitz.Rect(p.rect.width*box[0],p.rect.height*box[1],p.rect.width*box[2],p.rect.height*box[3]);pix=p.get_pixmap(matrix=fitz.Matrix(.6,.6),clip=rect,alpha=False);im=Image.frombytes('RGB',[pix.width,pix.height],pix.samples)
    crop=dict(x=rect.x0,y=rect.y0,width=rect.width,height=rect.height)
    fl=make_floor(bid,level,im,sid,page,crop)
   floors.append(fl);logging.info('%s: %d polygon candidates, %d unmatched labels',fl['id'],len(fl['rooms']),len(fl['unmatchedRoomLabels']))
  out=dict(id=bid,name=NAMES[bid],floors=floors,note='官方圖面衍生的部分房間區域候選；尚非所有房間可通行的完整模型。房門、跨層對位、室外入口及中庭仍待逐項確認。')
  (OUT/f'{bid}.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');logging.info('BUILDING READY %s',bid)
 proposal=dict(issues=[dict(type='misclassified-building',sourceId=x,oldBuildingId='SC',proposedBuildingId='CM') for x in ['oaa-04Room_COM','safety-pta_174551_7300210_04269']]+[dict(type='shared-source',sourceId='safety-pta_174544_4720186_04268',oldBuildingId='BI',proposedBuildingIds=['PH','BI'],note='每頁左PH右BI；必須分棟裁切，不能整頁視為BI。')],note='僅提案，不修改原sources/floors/integrity lock。')
 (OUT/'source-corrections-proposal.json').write_text(json.dumps(proposal,ensure_ascii=False,indent=2)+'\n')
 files=[json.loads(p.read_text()) for p in sorted(OUT.glob('*.json')) if p.stem in NAMES]
 manifest=dict(buildings=[dict(id=b['id'],url=f"/data/walkthrough/{b['id']}.json",floorCount=len(b['floors']),roomCandidateCount=sum(sum(r['kind'] in ['room','room-candidate'] for r in f['rooms']) for f in b['floors']),namedRoomCount=sum(sum(bool(r.get('code')) for r in f['rooms']) for f in b['floors']),reviewStatus='candidate-review-required',detectionCoverage='partial') for b in files],note='候選資料，不宣稱建模完整。')
 (OUT/'index.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 report='# 步行版圖資候選資料\n\n'+json.dumps(manifest,ensure_ascii=False,indent=2)+'\n\n來源：現存官方PDF，頁碼與crop皆保存在每層JSON。SC1–4房間輪廓由教務彩色房間色塊取得；其他為校安向量PDF渲染後的封閉區域候選。\n\n所有資料detectionCoverage=partial、reviewStatus=candidate-review-required；未完成逐房核對，不可宣稱所有房間可入。門點全部schematic；SC1/2中央樓梯位置沿用已核對資料，其他樓梯尚缺。中庭與挑空holes尚缺，不能把空holes當成沒有中庭的證據。未知房號留空，未檢出的房號只保留點，不捏造房間輪廓。\n\nPDF crop使用原頁點數；像素→building-local變換保存在transform。SC1/2以中央樓梯為共同原點；其他樓層目前只示意置中，未完成跨層註冊。尺度約公尺示意，非測繪。每層保存原圖renderImage與紅色候選輪廓overlay，供逐項覆圖審查。\n\n執行：`python -B tools/build_walkthrough_data.py`；可用`--buildings SC EN`分批。原sources/floors與integrity lock不變；錯掛管理學院及PH/BI合圖問題另輸出source-corrections-proposal.json。\n'
 coverage=[]
 for b in files:
  for f in b['floors']:
   coverage.append(dict(buildingId=b['id'],floorId=f['id'],level=f['level'],label=f['label'],sourceId=f['sourceId'],page=f['page'],crop=f['crop'],roomPolygonCount=sum(r['kind'] in ['room','room-candidate'] for r in f['rooms']),circulationCandidateCount=sum(r['kind']=='circulation-candidate' for r in f['rooms']),excludedSmallRegionCount=len(f.get('regionCandidates',[])),namedRoomCount=sum(bool(r.get('code')) for r in f['rooms']),ocrLabelCount=len(f.get('ocrRoomCandidates',[])),unmatchedLabelCount=len(f['unmatchedRoomLabels']),checkedDoorCount=sum(r['door']['basis']=='map-derived' for r in f['rooms']),stairCandidateCount=len(f['stairs']),complete=False))
 (OUT/'coverage.json').write_text(json.dumps(coverage,ensure_ascii=False,indent=2)+'\n')
 report=report.replace('SC1–4房間輪廓由教務彩色房間色塊取得；其他為校安向量PDF渲染後的封閉區域候選。','SC1/2的31個明確房號以人工對圖輪廓取代色塊碎片，另保留3個未編號空間。SC3/4與EN/BI/PH/CH/EC/MS一般樓層由教務彩色圖分層裁切、色塊擷取並以本機Tesseract抽房號候選；B1/RF及EV使用校安向量圖渲染的封閉區域。狹長窗框、踏面等小區域移至regionCandidates，不直接當rooms渲染；廊道候選kind=circulation-candidate。')
 report+='\n## 全樓層清冊（來源頁碼與裁圖皆已保存）\n\n表中數量為候選，不能當作實際房間總數；complete全部false。SC1/2人工房號輪廓31間、已核對門洞4點，其餘仍待覆圖審查。\n\n|棟別|樓層|來源頁|房間輪廓|有房號|OCR標記|未配對標記|門洞已核對|樓梯候選|\n|---|---|---|---:|---:|---:|---:|---:|---:|\n'
 for c in coverage:report+=f"|{c['buildingId']}|{c['label']}|{c['sourceId']} p{c['page']}|{c['roomPolygonCount']}|{c['namedRoomCount']}|{c['ocrLabelCount']}|{c['unmatchedLabelCount']}|{c['checkedDoorCount']}|{c['stairCandidateCount']}|\n"
 report+='\n現階段圖資無缺頁不等於模型完整：仍缺跨層同名樓梯配對、屋頂與中庭void核對、室內外入口配準及全部房門；部分小房間可能與窗框過濾一起移入regionCandidates，需人工補回。SC1/2以中央樓梯原點對齊，其他層以圖像中心示意置中，跨層尚未完成註冊。floor.mapAnnotations保留SC1/2既有NavNode與其normalized原值、local值。RF level=99只作屋頂代碼，高度請用storeyIndex。\n'
 report+='\n## SC首區覆圖與最後驗證\n\nSC1/2全部34個命名或未編號空間均有人工作廊側示意門；原先已核對4門不變。SC2005/2004/2003取南側、SC2002群取西側、SC1012及SC1009等取朝向主廊道一側。SC2011依高解析圖東南角可見朝東雙開門選東側，沒有錯放到北側外牆。SC1狹長挑空左界由誤吞廊道的normalized x=.620修正至.631，右界.657，以保留左側實際走廊；此為圖面近似讀值，非現地尺寸。\n\nvalidation.json記錄輸出JSON雜湊與純幾何檢查；一般房間候選的語意、房門、碰撞可通行性與跨層對位不因多邊形有效而視為通過。\n'
 (ROOT/'docs/walkthrough-data.md').write_text(report)
 used_sources={f['sourceId'] for b in files for f in b['floors']}
 for sid in used_sources:assert hashlib.sha256((ROOT/SOURCES[sid]['localPdf']).read_bytes()).hexdigest()==SOURCES[sid]['sha256'],sid
 floor_count=0;polygon_count=0
 for b in files:
  for f in b['floors']:
   floor_count+=1
   assert Polygon(f['outline']).is_valid,f['id']
   assert (OUT/pathlib.Path(f['imageUrl']).name).exists(),f['imageUrl']
   with Image.open(OUT/pathlib.Path(f['imageUrl']).name) as img:assert img.size==(f['imageWidth'],f['imageHeight']),f['id']
   assert f['transform']['sourceSHA256']==SOURCES[f['sourceId']]['sha256'],f['id']
   codes=[r['code'] for r in f['rooms'] if r.get('code')];assert len(codes)==len(set(codes)),f['id']
   for r in f['rooms']:
    poly=Polygon(r['polygon']);assert poly.is_valid and poly.area>0,r['id'];polygon_count+=1
 validation=dict(buildingCount=len(files),floorCount=floor_count,polygonCountIncludingCirculation=polygon_count,checks=['floor images exist and match source records','all floor outlines valid','all exported room polygons valid with positive area','floor room codes unique'],buildingJSONSHA256={b['id']:hashlib.sha256((OUT/(b['id']+'.json')).read_bytes()).hexdigest() for b in files},limitations=['Not a complete-room count or semantic audit','Door accessibility and cross-floor registration require separate navmesh and source-image checks','All floor detectionCoverage remains partial'])
 (OUT/'validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2)+'\n')
 logging.info('VALIDATED %d buildings, %d floors, %d room/circulation polygons',len(files),floor_count,polygon_count)

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--buildings',nargs='+',choices=list(NAMES),default=list(NAMES));run(parser.parse_args().buildings)
