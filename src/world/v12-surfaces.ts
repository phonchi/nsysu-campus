import * as T from 'three';
import type {Terrain} from './terrain';
import type {V12Data} from '../walk/v12-data';
import {buildSportsField} from './sports-field';
/** Identical v12 terrain inputs and collision additions for browser, bake and tests. */
export function prepareV12Terrain(terrain:Terrain,data:V12Data){
 terrain.carves.push(...(data.sea?.waterBodies.filter(w=>w.kind==='pool').map(w=>w.polygon)??[]));
 const fc=data.bus?.forecourt;if(fc)terrain.levels.push({polygon:fc.polygon,y:fc.levelY});
 terrain.cacheLevelVertices();
}
export function buildV12Surfaces(terrain:Terrain,data:V12Data){
 const world=buildSportsField(data.sports,data.sea?.waterBodies??[],data.fitness,(x,z)=>terrain.heightAt(x,z));
 const fc=data.bus?.forecourt;if(fc){const shape=new T.Shape(fc.polygon.map(([x,z])=>new T.Vector2(x,-z))),p=new T.Mesh(new T.ShapeGeometry(shape),new T.MeshStandardMaterial({color:'#777e79',roughness:.9,side:T.DoubleSide}));
 p.name=fc.id;p.rotation.x=-Math.PI/2;p.position.y=fc.levelY+.025;p.receiveShadow=true;world.display.add(p);world.collision.add(p.clone());}
 world.display.updateMatrixWorld(true);world.collision.updateMatrixWorld(true);return world;
}
