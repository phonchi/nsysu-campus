#!/usr/bin/env python3
"""Explicit map annotations. No nearest-door or nearest-stair inference.
This script preserves the separation between outdoor diagrams and floor plans.
The outside/SC threshold edge remains disabled until orientation is established.
"""
import json,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
layout_path=ROOT/'data/legacy/world-layout.json'
layout=json.loads(layout_path.read_text())
rooms=json.loads((ROOT/'public/data/rooms.json').read_text())
lookup={r['code']:r for r in rooms}
nodes=[];edges=[]
def node(id,label,x,y,kind='campus',**kw):
 nodes.append(dict(id=id,label=label,x=x,y=y,kind=kind,**kw));return id
def edge(a,b,source='campus-2022',note='依2022年9月校園圖描繪圖示校道；非現場量測',enabled=True):
 edges.append(dict(**{'from':a,'to':b},cost=1,enabled=enabled,evidence=dict(sourceId=source,page=1,note=note)))
node('gate','校門口圖示起點',.640,.930)
node('south-road','南側校道',.660,.846)
node('sports-road','運動區校道',.666,.755)
node('gym-road','體育館旁校道',.664,.663)
node('admin-road','行政區東側校道',.666,.604)
node('gym-west-south','體育館西南側圖示通道',.655,.663)
node('gym-west-north','體育館西北側圖示通道',.655,.604)
node('science-road','理學院東南側校道',.674,.554)
node('science-north','理工大道中段',.672,.484)
node('court-road','中庭廣場東側校道',.668,.400)
node('north-road','電資區校道',.682,.322)
node('library-road','圖資南側校道',.600,.400)
node('west-road','西側教學區校道',.490,.380)
node('coast-road','西側沿海校道',.421,.410)
node('west-general-road','綜合大樓旁校道',.377,.340)
for a,b in [('gate','south-road'),('south-road','sports-road'),('sports-road','gym-road'),('gym-road','gym-west-south'),('gym-west-south','gym-west-north'),('gym-west-north','admin-road'),('admin-road','science-road'),('science-road','science-north'),('science-north','court-road'),('court-road','north-road'),('north-road','library-road'),('library-road','west-road'),('west-road','coast-road'),('coast-road','west-general-road')]:edge(a,b)
# These are approach points on diagrammed roads, not asserted building doors.
for bid,label,x,y,parent in [
 ('SC','理學院附近',.674,.566,'science-road'),('BI','生科館附近',.685,.490,'science-north'),('PH','物理館附近',.685,.442,'science-north'),('CH','化學館附近',.685,.404,'court-road'),('EN','工學院附近',.674,.464,'science-north'),('EC','電資大樓附近',.686,.322,'north-road'),('MS','材料大樓附近',.684,.358,'north-road'),('EV','環工大樓附近',.627,.360,'library-road'),('CM','管理學院附近',.566,.480,'west-road'),('SS','社會科學院附近',.620,.560,'coast-road'),('IL','圖資大樓附近',.579,.382,'library-road'),('SW','西綜合大樓附近',.367,.300,'west-general-road'),('IR','國際研究大樓附近',.668,.735,'sports-road'),('AD','行政大樓附近',.618,.615,'admin-road'),('ACTIVITY','學生活動中心附近',.480,.355,'west-road'),('YH','逸仙館附近',.610,.681,'gym-road'),('SPORT','體育館附近',.662,.664,'gym-road')]:
 node('approach-'+bid,label,x,y,'approach',buildingId=bid)
 # Corner waypoints keep approaches out of the illustrated building footprints.
 if bid=='CM':
  node('cm-path','管理學院旁圖示通道',.575,.430);edge(parent,'cm-path');edge('cm-path','approach-'+bid)
 elif bid=='SS':
  node('ss-path','社科區西側圖示通道',.490,.604);edge(parent,'ss-path');edge('ss-path','approach-'+bid)
 elif bid=='AD':
  node('admin-south-path','行政區南側圖示通道',.618,.604);edge(parent,'admin-south-path');edge('admin-south-path','approach-'+bid)
 elif bid=='EV':
  node('ev-path','環工旁通道',.615,.360);edge(parent,'ev-path');edge('ev-path','approach-'+bid)
 else:edge(parent,'approach-'+bid)
source='oaa-02Room_COS_1'
proof='人工以原PDF高解析裁圖核對門洞與灰色廊道；中央樓梯從北側開口進出，南側窗牆不通行；Astra以原PDF6倍核對2F東側外廊位於x .864與SC2002牆x .878之間，取x .871；2026-10-19，僅圖面核對，未經現地。'
def indoor(id,label,x,y,floor,kind='corridor',**kw):return node(id,label,x,y,kind,floorId=f'SC-{floor}F',buildingId='SC',**kw)
indoor('sc-1-south','SC 1F 南側開放廊道',.826,.833,1,'entrance')
indoor('sc-1-hall','1F 中央開放廳',.780,.690,1)
indoor('sc-1-center','1F 中央廊道',.780,.600,1)
indoor('sc-1-right-a','1F 東側廊道',.860,.690,1)
indoor('sc-1-right-b','1F 東側門前通道',.860,.603,1)
indoor('sc-1-west-a','1F 西向廊道',.620,.600,1)
indoor('sc-1-west-b','1F SC1015前通道',.529,.600,1)
indoor('sc-1-north-a','1F 北向通道',.775,.490,1)
indoor('sc-1-north-b','1F SC1005前通道',.775,.290,1)
indoor('sc-1-stair-a','1F 中央樓梯北側',.825,.285,1)
indoor('sc-1-stair','中央樓梯 1F',.825,.306,1,'stairs',stairGroupId='sc-central')
indoor('sc-2-stair','中央樓梯 2F',.803,.294,2,'stairs',stairGroupId='sc-central')
indoor('sc-2-stair-a','2F 中央樓梯北側',.803,.275,2)
indoor('sc-2-north-east','2F 樓梯東北側通道',.871,.275,2)
indoor('sc-2-hall','2F 樓梯東側通道',.871,.600,2)
indoor('sc-2-east-a','2F 東側通道',.871,.630,2)
indoor('sc-2-east-b','2F SC2001前通道',.871,.663,2)
for code,x,y,level,parent in [('SC1001',.908,.603,1,'sc-1-right-b'),('SC1005',.726,.255,1,'sc-1-north-b'),('SC1015',.529,.633,1,'sc-1-west-b'),('SC2001',.883,.663,2,'sc-2-east-b')]:
 r=lookup[code];indoor('door-'+code,code+' 門口',x,y,level,'door',roomId=r['id']);edge(parent,'door-'+code,source,proof)
for a,b in [('sc-1-south','sc-1-hall'),('sc-1-hall','sc-1-center'),('sc-1-hall','sc-1-right-a'),('sc-1-right-a','sc-1-right-b'),('sc-1-center','sc-1-west-a'),('sc-1-west-a','sc-1-west-b'),('sc-1-center','sc-1-north-a'),('sc-1-north-a','sc-1-north-b'),('sc-1-north-b','sc-1-stair-a'),('sc-1-stair-a','sc-1-stair'),('sc-1-stair','sc-2-stair'),('sc-2-stair','sc-2-stair-a'),('sc-2-stair-a','sc-2-north-east'),('sc-2-north-east','sc-2-hall'),('sc-2-hall','sc-2-east-a'),('sc-2-east-a','sc-2-east-b')]:edge(a,b,source,proof)
edge('approach-SC','sc-1-south',source,'待核對：樓層圖與校園圖的方向及實際入口對應，禁止自動銜接',False)
# Every outdoor node has an explicit coordinate in the canonical 3D layout.
# Original x/y remain normalized coordinates on the separate 2022 2D map.
for n in nodes:
 if not n.get('floorId'):
  if n['id'] not in layout['nav']:
   raise ValueError(f"Missing canonical outdoor layout: {n['id']}")
  n['layoutX'],n['layoutY']=layout['nav'][n['id']]
node_by_id={n['id']:n for n in nodes}
# Rendered roads and navigable outdoor edges must follow exactly the same paths.
layout['roads']=[[[node_by_id[e[k]]['layoutX'],node_by_id[e[k]]['layoutY']] for k in ('from','to')] for e in edges if e['enabled'] and all(not node_by_id[e[k]].get('floorId') for k in ('from','to'))]
layout_path.write_text(json.dumps(layout,ensure_ascii=False,indent=2)+'\n')
out=dict(nodes=nodes,edges=edges,metadata=dict(version=2,generatedBy='tools/build_navigation.py',campusMapDate='2022-09',layoutSource=dict(path='src/world-layout.json',**layout['source']),fieldVerified=False,roomDoors=4,notes='四個室內門點依圖面人工標註。戶外3D依world-layout示意，2D保留2022原圖座標；近點不代表入口。戶外與SC室內方向/入口銜接尚待核對，跨圖邊停用。'))
(ROOT/'public/data/navigation.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(f'{len(nodes)} nodes, {len(edges)} edges; {sum(e["enabled"] for e in edges)} enabled; 4 room doors')
