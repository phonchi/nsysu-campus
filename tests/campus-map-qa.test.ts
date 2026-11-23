import { describe, expect, it, vi } from 'vitest';
import { actualPlaceText, busStopMarkers, coalesceMapDraw, layoutMapLabels, MAJOR_MAP_NAMES, mapMarkerRadius, polygonCenter, contentBounds, clampFrame } from '../src/walk/campus-map-view';
import { CAMPUS_VIEW, collectMapLabels, fitCampusFrame, frameX, frameY, type MapLabel, type MapMarker } from '../src/walk/minimap';
import campus from '../public/data/campus-map.json';
import placements from '../public/models/landmarks/placements.json';
import bus from '../public/data/bus-routes.json';
import sea from '../public/data/sea.json';
import sports from '../public/data/sports.json';
import graph from '../public/data/walkthrough/outdoor-graph.json';
import { readFileSync } from 'node:fs';
import { REPLACES } from '../src/world/landmarks';
import info from '../public/data/campus-info.json';

describe('big-map browser QA regressions', () => {
  it('keeps actual building/floor or zone text independent of an active guidance target', () => {
    const actual = actualPlaceText('理學院', '4F', 0, '理工校園');
    expect(actual).toBe('理學院・4F');
    expect(actualPlaceText('理學院', '4F', 20, '西子灣')).toBe('西子灣');
    expect(actualPlaceText('理學院', '4F', 20)).toBe('中山・理工校園');
    expect(actualPlaceText('理學院', '4F', 100)).toBe('中山大學・西子灣');
    const runtime = readFileSync(new URL('../src/walk/runtime.ts', import.meta.url), 'utf8');
    expect(runtime).toContain('currentPlaceText = actualPlaceText(');
    expect(runtime).toContain('`前往 ${autoDestination.label}` : currentPlaceText');
    expect(runtime).toContain('`你在：${currentPlaceText}`');
    expect(runtime).not.toContain("`你在：${get('#walk-place').textContent}`");
  });

  it('coalesces rapid interactions into one draw with the latest view, then allows the next frame', () => {
    const callbacks: FrameRequestCallback[] = [], enqueue = vi.fn((cb: FrameRequestCallback) => callbacks.push(cb));
    let zoom = 1, visible = true;
    const paint = vi.fn(), request = coalesceMapDraw(() => { if (visible) paint(zoom); }, enqueue);
    for (let i=0;i<10;i++) { zoom *= 1.4; request(); }
    expect(enqueue).toHaveBeenCalledTimes(1); expect(paint).not.toHaveBeenCalled();
    callbacks.shift()!(0); expect(paint).toHaveBeenCalledExactlyOnceWith(zoom);
    request(); request(); expect(enqueue).toHaveBeenCalledTimes(2);
    visible = false; callbacks.shift()!(16); expect(paint).toHaveBeenCalledTimes(1);
  });

  it('uses compact marker footprints below the detail threshold', () => {
    expect(mapMarkerRadius(.3)).toBe(6); expect(mapMarkerRadius(.3,true)).toBe(8);
    expect(mapMarkerRadius(.55)).toBe(10); expect(mapMarkerRadius(1,true)).toBe(13);
  });

  it.each([[932,434],[366,580]])('retains all major names without label overlaps at the real-data default extent (%s × %s)', (width,height) => {
    const labels: MapLabel[] = campus.buildings.map(b => { const [x,z]=polygonCenter(b.polygon as [number,number][]);return {id:`building:${b.id}`,label:b.name,x,z,priority:4,minScale:.65}; });
    for (const [key,id] of [['liberal-arts','LA'],['gate','gate'],['tunnel','tunnel-west']] as const) {
      const [x,z]=placements[key].centroid;labels.push({id:`building:${id}`,label:id,x,z,priority:8});
    }
    const marine = graph.nodes.find(n => n.id === graph.anchors.MA.node)!;
    labels.push({id:'building:MA',label:'海洋科學學院',x:marine.p[0],z:marine.p[2],priority:8});
    labels.push({id:'building:sea-center',label:'海域中心',x:sea.seaCenter.rentalDesk[0],z:sea.seaCenter.rentalDesk[2],priority:8});
    const points = [...campus.background.flat(),...campus.buildings.flatMap(b=>b.polygon),...sports.facilities.flatMap(f=>f.polygon),...sea.waterBodies.flatMap(w=>w.polygon),...sea.waterRoutes.flatMap(r=>r.corridor),...bus.stops.map(s=>[s.boardingPoint[0],s.boardingPoint[2]]),...labels.map(l=>[l.x,l.z])] as [number,number][];
    const frame=clampFrame(fitCampusFrame(width,height,contentBounds(points,CAMPUS_VIEW)),CAMPUS_VIEW);
    const markerPoints=[...bus.stops.map(s=>[s.boardingPoint[0],s.boardingPoint[2]]),...campus.buildings.filter(b=>b.walkable).map(b=>polygonCenter(b.polygon as [number,number][])),...Array.from({length:12},(_,i)=>[-70+(i%4)*12,90+Math.floor(i/4)*12])];
    const blocked=markerPoints.map(([x,z])=>({x:frameX(frame,x)-8,y:frameY(frame,z)-8,width:16,height:16,priority:0}));
    blocked.push({x:frameX(frame,-69)-19,y:frameY(frame,119)-19,width:38,height:38,priority:0});
    const placed=layoutMapLabels(labels,frame,text=>text.length*12,blocked);
    for(const id of Object.keys(MAJOR_MAP_NAMES))expect(placed.map(l=>l.id),`missing ${id}`).toContain(id);
    for(let i=0;i<placed.length;i++)for(const b of [...blocked,...placed.slice(i+1)]) {
      const a=placed[i];expect(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y,`${a.id} overlaps a label or marker`).toBe(false);
    }
    const science=placed.find(l=>l.id==='building:SC')!;
    expect(Math.abs(science.y+science.height/2-science.anchorY)).toBeLessThanOrEqual(48);
    for(const label of placed){expect(label.x).toBeGreaterThanOrEqual(0);expect(label.y).toBeGreaterThanOrEqual(0);expect(label.x+label.width).toBeLessThanOrEqual(width);expect(label.y+label.height).toBeLessThanOrEqual(height);}
  });
  it('deduplicates final aliases as well as place IDs, without hiding an in-view copy behind an offscreen one', () => {
    const frame={x0:0,z0:0,width:400,height:400,scale:1};
    const labels:MapLabel[]=[
      {id:'building:SC',label:'理學院（含東綜合大樓）',x:-100,z:-100,priority:10},
      {id:'building:SC',label:'理學院（含東綜合大樓）',x:100,z:100,priority:4},
      {id:'place:SC',label:'理學院',x:200,z:200,priority:1},
      {id:'building:SC',label:'science alternate',x:300,z:300,priority:1},
    ];
    const placed=layoutMapLabels(labels,frame,text=>text.length*12,[]);
    expect(placed.map(l=>l.label)).toEqual(['理學院']);expect(placed[0].anchorX).toBe(100);
  });

  it.each([[932,434],[366,580]])('draws each actual-data label text once at the default view (%s × %s)', (width,height) => {
    const landmarkIds:Record<string,string>={...REPLACES,'liberal-arts':'LA',gate:'gate',tunnel:'tunnel-west',seawall:'sunset','sci-eng-arcade':'arcade'};
    const names:Record<string,string>={LA:'文學院',gate:'校門','tunnel-west':'西子灣隧道',sunset:'海堤',arcade:'理工長廊'};
    const places:MapLabel[]=[],markers:MapMarker[]=busStopMarkers(bus.stops.map(s=>({id:s.id,name:s.name,boardingPoint:s.boardingPoint as [number,number,number]})));
    for(const [key,p] of Object.entries(placements)){
      if(typeof p!=='object'||!('centroid' in p))continue;
      const id=landmarkIds[key];if(!id)continue;
      const [x,z]=p.centroid,label=(info.buildings as Record<string,{name:string}>)[id]?.name??names[id]??id;
      places.push({id:`building:${id}`,label:campus.buildings.find(b=>b.id===id)?.name??label,x,z,priority:8});
      if(!campus.buildings.some(b=>b.id===id))markers.push({id:`place:${id}`,buildingId:id,kind:'place',x,y:0,z,label});
    }
    for(const f of sports.facilities){if(f.id.includes('candidate'))continue;const [x,z]=polygonCenter(f.polygon as [number,number][]);places.push({id:f.id,label:f.name,x,z,priority:3,minScale:.45});}
    for(const w of sea.waterBodies){const [x,z]=polygonCenter(w.polygon as [number,number][]);places.push({id:w.id,label:w.name,x,z,priority:7});}
    places.push({id:'building:sea-center',label:sea.seaCenter.name,x:sea.seaCenter.rentalDesk[0],z:sea.seaCenter.rentalDesk[2],priority:8});
    const m=graph.nodes.find(n=>n.id===graph.anchors.MA.node)!;
    const labels=collectMapLabels(campus.buildings.map(b=>({...b,polygon:b.polygon.map(([x,z]):[number,number]=>[x,z])})),places,markers,[{id:'building:MA',label:'海洋科學學院',x:m.p[0],z:m.p[2],priority:8}]);
    // The apparent southern SC label was not another footprint/source: there is one SC candidate.
    expect(labels.filter(l=>l.id==='building:SC')).toHaveLength(1);
    const points=[...campus.buildings.flatMap(b=>b.polygon),...sports.facilities.flatMap(f=>f.polygon),...sea.waterRoutes.flatMap(r=>r.corridor),...labels.map(l=>[l.x,l.z])] as [number,number][];
    const frame=clampFrame(fitCampusFrame(width,height,contentBounds(points,CAMPUS_VIEW)),CAMPUS_VIEW);
    const placed=layoutMapLabels(labels,frame,text=>text.length*12,[]),texts=placed.map(l=>l.label);
    expect(texts.filter(t=>t==='理學院')).toHaveLength(1);
    expect(new Set(texts).size).toBe(texts.length);
    expect(new Set(placed.map(l=>l.id)).size).toBe(placed.length);
  });

});
