#!/usr/bin/env python3
"""Reproducible official-map acquisition. No inferred floor assignments or routes.
Run: python tools/ingest_maps.py (downloads only missing originals).
"""
from pathlib import Path
import requests, bs4, hashlib, json, datetime, re, logging
import pymupdf as fitz
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
RAW=ROOT/'data/sources'; MAPS=ROOT/'data/official-plans/maps'; DATA=ROOT/'public/data'
for p in [RAW, MAPS, DATA,ROOT/'docs']: p.mkdir(parents=True,exist_ok=True)
logging.basicConfig(level=logging.INFO,format='%(asctime)s %(message)s',handlers=[logging.FileHandler(RAW/'run.log'),logging.StreamHandler()])
OAA='https://oaa.nsysu.edu.tw/p/412-1003-27076.php?Lang=zh-tw'
SAFETY='https://safety-oga.nsysu.edu.tw/p/405-1296-286323,c18978.php'
SESSION=requests.Session()
def download(url,path):
 if not path.exists():
  r=SESSION.get(url,timeout=60);r.raise_for_status();path.write_bytes(r.content)
 logging.info('source %s bytes=%d',url,path.stat().st_size)
 return path.read_bytes()
def links(url):
 r=SESSION.get(url,timeout=60);r.raise_for_status()
 return [(a.get_text(' ',strip=True),requests.compat.urljoin(url,a['href'])) for a in bs4.BeautifulSoup(r.content,'html.parser').select('a[href]') if '.pdf' in a['href'].lower()]
def building(title):
 # 管理學院 contains the substring 理學院; handle the specific name first.
 if '管理學院' in title:return 'CM'
 for key,bid in [('理學院','SC'),('生科館','BI'),('物理館','PH'),('化學館','CH'),('材料','MS'),('電資','EC'),('機電','EN'),('工學院','EN'),('管理學院','CM'),('管研','CM'),('社會科學','SS'),('圖IL','IL'),('圖資','IL'),('國際研究','IR'),('國研','IR'),('西灣','SW'),('西綜合','SW'),('行政大樓','AD'),('體育','SPORT'),('田徑','SPORT'),('活動中心','ACTIVITY'),('逸仙','ACTIVITY'),('環工','EV'),('幼兒園','KINDER'),('蔣公','VILLA'),('警衛','GATE'),('西子樓','XIZI'),('教學區平面','CAMPUS')]:
  if key in title:return bid
 return None
def classified_floor_references(title,floor):
 # A shared source page can be browsed under both buildings, without claiming
 # that the original composite page has been cropped into individual floors.
 if floor['sourceId']!='safety-pta_174544_4720186_04268':return [floor]
 refs=[]
 for bid,name in [('BI','生科館'),('PH','物理館')]:
  refs.append(dict(floor,id=floor['id'] if bid=='BI' else floor['id']+'-PH',buildingId=bid,label=f'物理館／生科館合頁原圖（{name}引用）· 第 {floor["page"]} 頁 · 未獨立裁切',level=None,status='overview',crop=None,note='同一官方原頁含PH與BI，兩棟共用原圖，未獨立裁切且尚未核對單棟樓層；步行版另有獨立裁圖。'))
 return refs

campus_url='https://www.nsysu.edu.tw/static/file/0/1000/img/440826181.jpg'
campus_path=MAPS/'campus-original.jpg'
campus_raw=download(campus_url,campus_path)
(RAW/'campus-original.source.json').write_text(json.dumps(dict(id='campus-original',title='國立中山大學校園平面圖',url=campus_url,localImage='public/maps/campus-original.jpg',sha256=hashlib.sha256(campus_raw).hexdigest(),retrievedAt=datetime.datetime.fromtimestamp(campus_path.stat().st_mtime,datetime.timezone.utc).isoformat()),ensure_ascii=False,indent=2)+'\n')
sources=[];floors=[];rooms=[];thumbs=[]
# Exclude the humanities/arts and marine-science dedicated buildings per project scope.
for provider,index in [('oaa',OAA),('safety',SAFETY)]:
 for title,url in links(index):
  if provider=='oaa' and ('Room_' not in url):continue
  if provider=='safety' and not (title.startswith('教學') or title=='教學區平面圖.pdf'):continue
  if any(x in title for x in ['文學院','藝術大樓','海科','海工','海資','造坡','養殖']):continue
  bid=building(title)
  if not bid:logging.info('unmapped title %s',title);continue
  sid=f'{provider}-{Path(url).stem}'
  path=RAW/(sid+'.pdf')
  try:raw=download(url,path);doc=fitz.open(stream=raw,filetype='pdf')
  except Exception:logging.exception('failed %s',url);continue
  sources.append(dict(id=sid,title=title,url=url,localPdf=f'data/sources/{path.name}',retrievedAt=datetime.datetime.fromtimestamp(path.stat().st_mtime,datetime.timezone.utc).isoformat(),sha256=hashlib.sha256(raw).hexdigest(),pages=len(doc),provider=provider,buildingId=bid,indexUrl=index))
  if bid=='CAMPUS':
   sources[-1]['contentNote']='網站連結名為教學區平面圖，實際為172頁多棟合集；首頁為圖書與資訊處資訊機房消防滅火設備圖，非校園總圖。未逐頁核對，僅原檔存檔，不掛入建築樓層。'
   logging.info('archived combined campus PDF without publishing its mixed-building pages')
   continue
  source_room_start=len(rooms)
  for page in doc:
   fid=f'{sid}-p{page.number+1}'
   # Page-level overview is intentional. Several PDFs put 2-8 floors on one sheet.
   # Only explicit single-floor source titles are assigned a level.
   level=None
   if provider=='oaa':
    if '圖資10樓' in title:level=10
    elif '圖資9樓' in title:level=9
    elif '圖資3樓' in title:level=3
    elif '電腦教室B1' in title:level=-1
   scale=2600/max(page.rect.width,page.rect.height)
   pix=page.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False)
   im=Image.frombytes('RGB',[pix.width,pix.height],pix.samples)
   dest=MAPS/(fid+'.webp');im.save(dest,'WEBP',quality=87)
   floor=dict(id=fid,buildingId=bid,label=f'{title.replace(".pdf","")} · 第 {page.number+1} 頁',level=level,imageUrl=f'/maps/{dest.name}',width=pix.width,height=pix.height,sourceId=sid,page=page.number+1,crop=None,status='overview',note='官方原頁總覽；同頁可能包含多層，尚未逐層裁切與導航核對。')
   if level is not None:floor['note']='官方標題明示樓層；頁面文字定位尚未人工核對。'
   floors.extend(classified_floor_references(title,floor))
   # Extract exactly printed room identifiers. Preserve suffixes and source bounds.
   for block in page.get_text('dict')['blocks']:
    for line in block.get('lines',[]):
     for span in line['spans']:
      text=span['text'].strip();x0,y0,x1,y1=span['bbox']
      for m in re.finditer(r'\b(?:SC|BI|PH|CH|MS|EC|EN|CM|SS|SW|GE|IL|IR|PC)\s*\d{2,5}(?:\s*[-－]\s*\d{1,2})?\b',text,re.I):
       code=re.sub(r'\s+','',m.group()).replace('－','-').upper()
       rooms.append(dict(id=f'{fid}-{len(rooms)}',buildingId=bid,floorId=fid,code=code,x=round((x0+x1)/2/page.rect.width,6),y=round((y0+y1)/2/page.rect.height,6),sourceId=sid,status='text-extracted',bbox=[round(x0/page.rect.width,6),round(y0/page.rect.height,6),round((x1-x0)/page.rect.width,6),round((y1-y0)/page.rect.height,6)],floorLabel=f'{level}F' if level is not None and level>=0 else 'B1' if level==-1 else '樓層待核對'))
   if sid=='oaa-02Room_COS_1':
    # Visually checked 2026-10-19 against the original sheet's explicit 1F–4F labels.
    # Crop rectangles are in original PDF points and include each complete plan.
    for lev,(top,bottom) in enumerate([(0.105,0.285),(0.300,0.465),(0.490,0.655),(0.680,0.845)],1):
     box=fitz.Rect(page.rect.width*0.275,page.rect.height*top,page.rect.width*0.925,page.rect.height*bottom)
     cp=page.get_pixmap(matrix=fitz.Matrix(1.5,1.5),clip=box,alpha=False)
     ci=Image.frombytes('RGB',[cp.width,cp.height],cp.samples)
     cfid=f'SC-{lev}F';ci.save(MAPS/(cfid+'.webp'),'WEBP',quality=92)
     floors.append(dict(id=cfid,buildingId='SC',label=f'理學院／東綜合大樓 {lev}F',level=lev,imageUrl=f'/maps/{cfid}.webp',width=cp.width,height=cp.height,sourceId=sid,page=1,crop=dict(x=box.x0,y=box.y0,width=box.width,height=box.height),status='verified-map',note='已按原頁樓層標示核對裁切範圍；教室文字為文字層擷取，走廊與房門尚未核對。'))
     for room in rooms:
      if room['floorId']!=fid:continue
      px=room['x']*page.rect.width;py=room['y']*page.rect.height
      if box.contains(fitz.Point(px,py)):
       room['floorId']=cfid;room['x']=round((px-box.x0)/box.width,6);room['y']=round((py-box.y0)/box.height,6);room['floorLabel']=f'{lev}F'
       bx,by,bw,bh=room['bbox'];room['bbox']=[round((bx*page.rect.width-box.x0)/box.width,6),round((by*page.rect.height-box.y0)/box.height,6),round(bw*page.rect.width/box.width,6),round(bh*page.rect.height/box.height,6)]
   if provider=='oaa':
    th=im.copy();th.thumbnail((300,420));thumbs.append((title,th))
  sources[-1]['extractedRoomLabels']=len(rooms)-source_room_start
  sources[-1]['extractedPrefixes']=sorted(set(re.match(r'[A-Z]+',x['code']).group() for x in rooms[source_room_start:]))
  logging.info('processed %s pages=%d source_rooms=%d cumulative_rooms=%d',title,len(doc),len(rooms)-source_room_start,len(rooms))
for name,content in [('sources',sources),('floors',floors),('rooms',rooms)]:
 (DATA/(name+'.json')).write_text(json.dumps(content,ensure_ascii=False,indent=2)+'\n')
# Small contact sheet supports human inspection; full maps retain zoomable detail.
from PIL import ImageDraw
cols=4;cw=340;ch=460
sheet=Image.new('RGB',(cols*cw,((len(thumbs)+cols-1)//cols)*ch),'#eee');draw=ImageDraw.Draw(sheet)
for i,(title,im) in enumerate(thumbs):
 x=(i%cols)*cw;y=(i//cols)*ch;sheet.paste(im,(x,y+25));draw.text((x+5,y+5),str(i+1)+' '+title.encode('ascii','ignore').decode()[:35],fill='black')
sheet.save(MAPS/'oaa-overview.jpg',quality=85)
counts={b:sum(x['buildingId']==b for x in rooms) for b in sorted(set(x['buildingId'] for x in floors))}
report=f'''# 圖資涵蓋與核對狀態\n\n更新日期：{datetime.date.today().isoformat()}\n\n官方 PDF {len(sources)} 份、頁面總覽 {sum(f['status']=='overview' for f in floors)} 張及 SC 分層裁圖 {sum(f['status']=='verified-map' for f in floors)} 張、文字層房號 {len(rooms)} 筆（含不同來源重複，未視為獨立教室總數）。\n\n- 來源：教務處各學院教室平面圖、校安組校舍平面圖。原始 PDF 保存在 `data/sources/`，URL、SHA256、下載時間列於 `public/data/sources.json`。\n- 文學院、藝術大樓、海科院專屬圖資與宿舍不納入可瀏覽資料；校安教學區多棟合併原始 PDF 為完整存檔，可能仍含排除建築，但不將其混合頁面公開為單棟樓層。\n- 所有頁面保留整頁總覽，沒有把同頁多層圖誤標成同一樓層。SC 原頁 1F–4F 已視覺核對並分層裁切；其他只有官方標題明示單一樓層的圖資賦予 level，其餘為 null。\n- 搜尋結果座標來自 PDF 文字 span 的框；狀態 `text-extracted`，並非逐間人工確認。房號可重複出現，亦可能落在索引/圖例；介面應顯示「文字擷取・待核對」。\n- `overview` 圖資可閱讀和縮放；SC 已提供逐層裁切，入口/樓梯/房門與可行走路網尚待核對，不能僅據文字座標宣稱提供經驗證的室內導航。
- 校安來源標示「教學區平面圖」實為多頁合集，首張圖面標題為「資訊機房消防滅火設備」，標示「中山大學圖書與資訊處」，不是行政大樓或校園總配置圖；teaching-area.png 僅為該 PDF 首頁預覽，未知實際樓層，不掛入任何單棟樓層。\n- 未採 OCR 猜測掃描圖房號；無文字層圖目前僅可視覺瀏覽。\n- 未實地勘查；校方原圖年代與現況可能不同。\n\n| 建築代碼 | 文字房號筆數 |\n|---|---:|\n'''+''.join(f'| {b} | {c} |\n' for b,c in counts.items())+'\n## 後續\n\n逐頁人工辨識樓層區域後，另新增經核對的 crop，轉換房號座標，再建置走廊與出入口路網；保留原頁以便覆圖複核。\n'
report+='\n## 全部官方來源\n\n| 標題 | 頁數 | 文字房號 |\n|---|---:|---:|\n'+''.join(f"| [{x['title']}]({x['url']}) | {x['pages']} | {x.get('extractedRoomLabels',0)} |\n" for x in sources)
(ROOT/'docs/data-coverage.md').write_text(report)
logging.info('COMPLETE sources=%d pages=%d extracted_room_labels=%d',len(sources),len(floors),len(rooms))
