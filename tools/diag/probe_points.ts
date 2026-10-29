/** Diagnostic: raycast collision above/below given destinations. Run: npx tsx tools/diag/probe_points.ts ID... */
import fs from 'node:fs';
import * as T from 'three';
import {buildWalkWorld} from '../../src/walk-world';
import type {WalkBuilding,FloorAccess,CampusStructure} from '../../src/walk-types';
const ids=['SC','EN','BI','PH','CH','EC','MS','EV'];
const access=JSON.parse(fs.readFileSync('public/data/walkthrough/access-plan.json','utf8')) as {floors:Record<string,FloorAccess>};
const structure=JSON.parse(fs.readFileSync('public/data/walkthrough/campus-structure.json','utf8')) as CampusStructure;
const data=ids.map(id=>{const b=JSON.parse(fs.readFileSync(`public/data/walkthrough/${id}.json`,'utf8')) as WalkBuilding;for(const f of b.floors)f.access=access.floors[f.id];return b;});
const world=buildWalkWorld(data,structure);world.collision.updateMatrixWorld(true);
const mesh=world.collision.children[0] as T.Mesh;const ray=new T.Raycaster();
for(const id of process.argv.slice(2)){
 const d=world.destinations.find(d=>d.id===id);if(!d){console.log(id,'missing');continue;}
 const p=new T.Vector3(...d.position);
 ray.set(p.clone().add(new T.Vector3(0,1.2,0)),new T.Vector3(0,-1,0));ray.far=3;const down=ray.intersectObject(mesh).map(h=>[+h.point.y.toFixed(3),+h.face!.normal.y.toFixed(2)]);
 ray.set(p.clone().add(new T.Vector3(0,.05,0)),new T.Vector3(0,1,0));ray.far=4;const up=ray.intersectObject(mesh).map(h=>[+h.point.y.toFixed(3),+h.face!.normal.y.toFixed(2)]);
 const near:[string,number][]=[];for(const a of [0,45,90,135,180,225,270,315]){const dir=new T.Vector3(Math.cos(a*Math.PI/180),0,Math.sin(a*Math.PI/180));ray.set(p.clone().add(new T.Vector3(0,.6,0)),dir);ray.far=3;const h=ray.intersectObject(mesh)[0];near.push([String(a),h?+h.distance.toFixed(2):9]);}
 console.log(id,d.position.map(v=>+v.toFixed(2)),'down',JSON.stringify(down),'up',JSON.stringify(up),'walls',JSON.stringify(near));
}
