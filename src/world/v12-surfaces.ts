import * as T from 'three';
import type {Terrain} from './terrain';
import type {V12Data} from '../walk/v12-data';
import type {P3,SeaRentalKiosk} from './v12-types';
import {projectRoadGeometry} from './road-surface';
import {buildSportsField} from './sports-field';

// Local -Z faces the rental approach. The sign sits just ahead of the fascia.
export const SEA_RENTAL_SIGN:P3=[0,2.58,-1.64];
export const SEA_RENTAL_DISPLAY = [
 {model:'sup_board',position:[-2.08,1.31,.11] as P3,scale:.67},
 {model:'kayak',position:[-2.64,1.33,.21] as P3,scale:.56},
];

export function seaRentalFrame(kiosk:SeaRentalKiosk,ground?:(x:number,z:number)=>number){
 const [x,y,z]=kiosk.position,group=new T.Group();
 group.position.set(x,ground?.(x,z)??y,z);
 group.rotation.y=kiosk.yaw;
 return group;
}

function addSeaRentalKiosk(world:{display:T.Group;collision:T.Group},terrain:Terrain,kiosk:SeaRentalKiosk){
 const ground=(x:number,z:number)=>terrain.heightAt(x,z);
 const display=seaRentalFrame(kiosk,ground),collision=seaRentalFrame(kiosk,ground);
 display.name=collision.name='Sea rental kiosk';
 world.display.add(display);world.collision.add(collision);

 const material=(color:string)=>new T.MeshStandardMaterial({color,roughness:.86});
 const teal=material('#2b6667'),cream=material('#eee4cf'),wood=material('#a6744e'),rail=material('#624a3a');
 const unit=new T.BoxGeometry(1,1,1);
 const box=(name:string,size:P3,position:P3,finish:T.Material,solid=false)=>{
  const mesh=new T.Mesh(unit,finish);
  mesh.name=name;mesh.scale.fromArray(size);mesh.position.fromArray(position);
  mesh.castShadow=true;mesh.receiveShadow=true;display.add(mesh);
  if(solid)collision.add(mesh.clone());
 };

 box('Canopy roof',[6.5,.19,3.96],[0,2.81,.38],teal);
 box('Front fascia',[6.45,.55,.16],[0,2.58,-1.55],teal);
 box('Fascia trim',[6.45,.075,.175],[0,2.34,-1.55],cream);
 for(const x of [-2.95,2.95])for(const z of [-1.35,1.96]){
  box('Canopy post',[.20,2.96,.20],[x,1.28,z],cream,true);
  box('Post base',[.29,.27,.29],[x,.05,z],rail,true);
 }
 box('Rental counter',[2.74,1.15,.72],[0,.49,-.53],teal,true);
 box('Counter worktop',[2.88,.11,.87],[0,1.06,-.53],wood,true);
 box('Counter front panel',[2.47,.50,.04],[0,.64,-.901],cream);
 box('Counter kick plate',[2.76,.14,.043],[0,.18,-.893],rail);
 box('Storage screen',[3.25,1.56,.12],[0,.77,1.94],wood,true);
 box('Storage screen cap',[3.32,.09,.2],[0,1.59,1.94],rail);
 box('Equipment rack',[1.32,.28,.83],[-2.36,.18,.18],rail,true);
 box('Equipment rack upright',[1.32,1.48,.12],[-2.36,.78,.55],wood,true);

 const shape=new T.Shape(kiosk.apron.map(([x,z])=>new T.Vector2(x,-z)));
 const source=new T.ShapeGeometry(shape).rotateX(-Math.PI/2);
 const paving=new T.Mesh(projectRoadGeometry(source,terrain,{offset:.018}),material('#c7c4b6'));
 source.dispose();paving.name='Sea rental apron';paving.receiveShadow=true;world.display.add(paving);
}

/** Identical v12 terrain inputs and collision additions for browser, bake and tests. */
export function prepareV12Terrain(terrain:Terrain,data:V12Data){
 terrain.carves.push(...(data.sea?.waterBodies.filter(w=>w.kind==='pool').map(w=>w.polygon)??[]));
 // Broad forecourt grading comes first; explicit landmark seats must stay flat under their walkable boxes.
 const fc=data.bus?.forecourt;if(fc)terrain.levels.unshift({polygon:fc.polygon,y:fc.levelY});
 terrain.cacheLevelVertices();
}
export function buildV12Surfaces(terrain:Terrain,data:V12Data){
 const world=buildSportsField(data.sports,data.sea?.waterBodies??[],data.fitness,(x,z)=>terrain.heightAt(x,z));
 const kiosk=data.sea?.center?.kiosk;
 if(kiosk)addSeaRentalKiosk(world,terrain,kiosk);
 const fc=data.bus?.forecourt;if(fc){const shape=new T.Shape(fc.polygon.map(([x,z])=>new T.Vector2(x,-z))),p=new T.Mesh(new T.ShapeGeometry(shape),new T.MeshStandardMaterial({color:'#777e79',roughness:.9,side:T.DoubleSide}));
 p.name=fc.id;p.rotation.x=-Math.PI/2;p.position.y=fc.levelY+.025;p.receiveShadow=true;world.display.add(p);world.collision.add(p.clone());}
 world.display.updateMatrixWorld(true);world.collision.updateMatrixWorld(true);return world;
}
