import {afterEach,expect,it,vi} from 'vitest';
import * as T from 'three';
import fs from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {NpcManager,type StoryZones} from '../src/world/npc';
import type {NpcData} from '../src/story/talk';
import {CharacterQa} from '../src/walk/character-qa';
import {loadRideAsset} from '../tools/ride-assets';
afterEach(()=>vi.restoreAllMocks());
it('a QA closeup of a capped seated event host samples Sit instead of revealing the bind pose',async()=>{
 vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async url=>loadRideAsset(String(url)) as never);
 const zones=JSON.parse(fs.readFileSync('public/data/story-zones.json','utf8')) as StoryZones;
 const raw=JSON.parse(fs.readFileSync('public/data/npcs.json','utf8')) as NpcData;
 const manager=new NpcManager({...zones,npcs:{},ambient:undefined},undefined,undefined,p=>'public/'+p,{...raw,npcs:raw.npcs.filter(n=>n.id==='poet-wen')});
 manager.setCollision((_id,a,b)=>a.equals(b)?Infinity:a.distanceTo(b),()=>0);manager.cap={day:0,night:0,monkeys:0};await manager.load();manager.schedule('sunset',true,{});
 const npc=manager.get('poet-wen')!,player=npc.position.clone().add(new T.Vector3(5,0,-4)),scene=new T.Scene();scene.add(manager.group);
 const source=await loadRideAsset('public/models/characters/'+raw.npcs.find(n=>n.id==='poet-wen')!.model+'.glb');
 const arm=npc.root.getObjectByName('UpperArmL')!,bind=source.scene.getObjectByName('UpperArmL')!.quaternion.clone();
 const qa=new CharacterQa(true,scene,new T.PerspectiveCamera(),new T.Group(),id=>manager.get(id));
 qa.qaCloseup('poet-wen',2.2,.7,60);
 for(let i=0;i<60;i++){manager.update(1/30,player);qa.update();}
 expect(npc.root.visible).toBe(true);expect(arm.quaternion.angleTo(bind)).toBeGreaterThan(.2);expect(npc.seatDiagnostics).toBeDefined();
 qa.dispose();manager.dispose();
});
for(const id of ['poet-wen','guide','guitar-yun','quiz-dian'])it(`${id}: event focus and repeated seat/borrow/return never expose bind pose`,async()=>{
 vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async url=>loadRideAsset(String(url)) as never);
 const zones=JSON.parse(fs.readFileSync('public/data/story-zones.json','utf8')) as StoryZones,raw=JSON.parse(fs.readFileSync('public/data/npcs.json','utf8')) as NpcData;
 const def=raw.npcs.find(n=>n.id===id)!,source=await loadRideAsset('public/models/characters/'+def.model+'.glb'),bind=source.scene.getObjectByName('UpperArmL')!.quaternion.clone();
 const manager=new NpcManager({...zones,npcs:{[id]:{model:def.model,at:'arcade'}},ambient:undefined},undefined,undefined,p=>'public/'+p,{...raw,npcs:[def]});
 manager.setCollision((_id,a,b)=>a.equals(b)?Infinity:a.distanceTo(b),()=>0);manager.cap={day:0,night:0,monkeys:0};await manager.load();manager.setFocus(undefined,[id]);manager.schedule('sunset',true,{});
 const npc=manager.get(id)!,player=npc.position.clone().add(new T.Vector3(5,0,-4)),arm=npc.root.getObjectByName('UpperArmL')!;
 const advance=()=>{for(let i=0;i<90;i++)manager.update(1/30,player);};
 for(let cycle=0;cycle<3;cycle++){
  advance();expect(npc.animationState.seated).toBe(true);expect(npc.animationState.weight).toBeGreaterThan(.99);expect(arm.quaternion.angleTo(bind)).toBeGreaterThan(.3);
  const from=npc.position.clone();expect(manager.borrowPath(id,[from,from.clone().add(new T.Vector3(2,0,0))])).toBe(true);advance();
  expect(npc.animationState.seated).toBe(false);expect(arm.quaternion.angleTo(bind)).toBeGreaterThan(.3);expect(manager.releaseBorrowed(id)).toBe(true);manager.schedule('sunset',true,{});
 }
 advance();expect(npc.animationState.clip).toBe('Sit');expect(npc.seatDiagnostics!.contact).toBeCloseTo(.475,3);manager.dispose();
});
