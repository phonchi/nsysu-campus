import {describe,it,expect} from 'vitest';
import {Vector3} from 'three';
import {readFileSync} from 'node:fs';
import {landmarkUiLabels,nearbyLandmarkUi} from '../src/campus-label-catalog';
import type {CampusStructure} from '../src/walk-types';
import type {Placement} from '../src/world/landmarks';
const structure=JSON.parse(readFileSync('public/data/walkthrough/campus-structure.json','utf8')) as CampusStructure;
const info=JSON.parse(readFileSync('public/data/campus-info.json','utf8'));
const placements=JSON.parse(readFileSync('public/models/landmarks/placements.json','utf8')) as Record<string,Placement>;
describe('landmark UI uses the complete catalog independently of render replacement',()=>{
 it('retains actual administrative/library labels without mutating the source inventory',()=>{
  const before=JSON.stringify(structure);const labels=landmarkUiLabels(structure,info.buildings,{ground:()=>7.5,placements});
  expect(labels.find(x=>x.id==='AD')?.name).toBe('行政大樓');
  expect(labels.find(x=>x.id==='IL')?.name).toBe('圖資大樓');
  expect(labels.find(x=>x.id==='AD')!.position.y).toBeGreaterThan(7.5);
  expect(JSON.stringify(structure)).toBe(before);
  // This is the previous runtime's render-only inventory: using it for UI loses AD.
  const filtered={...structure,context:{...structure.context,landmarks:structure.context.landmarks.filter(x=>!['AD','IL'].includes(x.id))}};
  expect(landmarkUiLabels(filtered,info.buildings).some(x=>x.id==='AD')).toBe(false);
 });
 it('places the stele label on the tall actual gate component, not the guard booth/zero datum',()=>{
  const label=landmarkUiLabels(structure,info.buildings,{ground:()=>7.5,placements}).find(x=>x.id==='GATE')!;
  expect(label.name).toBe('校門・校碑');expect(label.position.x).toBeCloseTo(-91.7);expect(label.position.z).toBeCloseTo(596.2);
  expect(label.position.y).toBeCloseTo(30.7);expect(label.priority).toBe(1);
 });
 it('accepts measured GLB anchors without sharing mutable positions with the caller',()=>{
  const p=new Vector3(-70,35,71);const label=landmarkUiLabels(structure,info.buildings,{placements,anchors:{AD:p}}).find(x=>x.id==='AD')!;
  expect(label.position.toArray()).toEqual(p.toArray());p.y=1;expect(label.position.y).toBe(35);
 });
});

it('offers ground-level stele/admin information while rejecting upper storeys and walkable buildings',()=>{
 const labels=landmarkUiLabels(structure,info.buildings,{ground:()=>0,placements});const known=new Set(Object.keys(info.buildings));
 const gate=nearbyLandmarkUi(labels,new Vector3(-90.2,0,590.2),()=>0,known,new Set());
 expect(gate?.id).toBe('GATE');expect(gate?.position.y).toBe(1.5);
 const admin=nearbyLandmarkUi(labels,new Vector3(-70,0,94),()=>0,known,new Set());expect(admin?.id).toBe('AD');
 expect(nearbyLandmarkUi(labels,new Vector3(-70,3.8,94),()=>0,known,new Set())).toBeUndefined();
 expect(nearbyLandmarkUi(labels,new Vector3(-70,0,94),()=>0,known,new Set(['AD']))?.id).not.toBe('AD');
 expect(nearbyLandmarkUi(labels,new Vector3(500,0,500),()=>0,known,new Set())).toBeUndefined();
});

import {prioritizeCampusLabels} from '../src/walk-labels';
it('focused stele precedes a higher-priority unrelated building before screen overlap rejection',()=>{
 const labels=[{l:{id:'BI',name:'生科館',position:new Vector3(),priority:0},d:100},{l:{id:'GATE',name:'校門・校碑',position:new Vector3(),priority:1},d:35}];
 expect(prioritizeCampusLabels(labels).map(x=>x.l.id)).toEqual(['BI','GATE']);
 expect(prioritizeCampusLabels(labels,'GATE').map(x=>x.l.id)).toEqual(['GATE','BI']);
 expect(prioritizeCampusLabels(labels,undefined).map(x=>x.l.id)).toEqual(['BI','GATE']);
 expect(labels.map(x=>x.l.id)).toEqual(['BI','GATE']);
});
