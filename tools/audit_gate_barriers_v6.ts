import fs from 'node:fs';
import * as T from 'three';
import { loadRideAsset } from './ride-assets';
import { Avatar } from '../src/walk/avatar';
import { landmarkTransforms } from '../src/world/landmarks';
import { buildRuntimeWorld } from '../tests/world-fixture';
import { RapierController, initPhysics } from '../src/walk/controller';
import { gateBarrierObstacles } from '../src/world/gate-barriers';

const dir='artifacts/v6/gate-barrier';fs.mkdirSync(dir,{recursive:true});
const {world,terrain,placements}=buildRuntimeWorld(),gate=(await loadRideAsset('public/models/landmarks/gate.glb')).scene;
gate.updateMatrixWorld(true);
const transform=landmarkTransforms('gate',placements.gate,(x,z)=>terrain.heightAt(x,z))[0];
const bounds=[-2.5,2.5].map(z=>new T.Box3(new T.Vector3(.6,.9,z-.06),new T.Vector3(5.2,1.02,z+.06)).applyMatrix4(transform));
function clip(poly:T.Vector3[],axis:'x'|'y'|'z',bound:number,sign:number){const out:T.Vector3[]=[];for(let j=0;j<poly.length;j++){const a=poly[j],b=poly[(j+1)%poly.length],da=sign*(a[axis]-bound),db=sign*(b[axis]-bound);if(da>=0)out.push(a);if((da>=0)!==(db>=0))out.push(a.clone().lerp(b,da/(da-db)));}return out;}
function intersections(root:T.Object3D,boxes:T.Box3[],worldTransform=new T.Matrix4()){
 const counts=boxes.map(()=>0),examples:unknown[]=[];root.updateMatrixWorld(true);
 root.traverse(o=>{if(!(o instanceof T.Mesh))return;if(o instanceof T.SkinnedMesh)o.skeleton.update();const p=o.geometry.attributes.position,index=o.geometry.index,matrix=worldTransform.clone().multiply(o.matrixWorld);
  for(let k=0;k<(index?.count??p.count);k+=3){const triangle=[0,1,2].map(j=>o.getVertexPosition(index?index.getX(k+j):k+j,new T.Vector3()).applyMatrix4(matrix));
   for(let b=0;b<boxes.length;b++){let poly=triangle;for(const axis of ['x','y','z'] as const){poly=clip(poly,axis,boxes[b].min[axis],1);if(poly.length)poly=clip(poly,axis,boxes[b].max[axis],-1);if(!poly.length)break;}
    if(poly.length>=3){counts[b]++;if(examples.length<8)examples.push({mesh:o.name,box:b,triangle:triangle.map(p=>p.toArray()),clipped:poly.map(p=>p.toArray())});}
   }
  }
 });return{counts,examples};
}
const assetTriangles=intersections(gate,bounds,transform);
const samples=JSON.parse(fs.readFileSync('artifacts/v6/browser/results.json','utf8'));
const recorded=samples.find((r:any)=>r.case==='ride-m').samples.at(-1);
const front=new T.Vector3(...recorded.wheels[0].target),rear=new T.Vector3(...recorded.wheels[1].target),mid=front.clone().add(rear).multiplyScalar(.5),yaw=Math.atan2(-(front.x-rear.x),-(front.z-rear.z));
const pitch=recorded.pitch,foot=mid.clone();foot.x-=Math.sin(yaw)*.35*Math.sin(pitch);foot.z-=Math.cos(yaw)*.35*Math.sin(pitch);
const avatar=new Avatar(),student=await loadRideAsset('public/models/characters/student-m.glb'),bike=await loadRideAsset('public/models/campus/bicycle.glb');
student.scene.rotation.y=Math.PI;avatar.setModel(student.scene,student.animations);avatar.setVehicle(bike.scene);avatar.face(yaw);avatar.riding=true;
avatar.update(1/60,{foot,onGround:true,airborneFor:0,speed:0,intendedSpeed:0,jumped:false,runSpeed:7.2,surfaceHeight:mid.y,rideContacts:{front:front.y,rear:rear.y}});
const skinTriangles=intersections(student.scene,bounds);
await initPhysics();const controller=new RapierController(world.collision);
const probes=bounds.map(box=>{const p=box.getCenter(new T.Vector3()),from=p.clone().add(new T.Vector3(0,0,-.5)),to=p.clone().add(new T.Vector3(0,0,.5));return{from:from.toArray(),to:to.toArray(),length:from.distanceTo(to),free:controller.sweep(from,to,.04)};});
const data={scope:'Exact gate GLB triangles and reconstructed shipped male skin at recorded final ride pose; existing runtime landmark collider sweep before supplementary barriers.',bounds:bounds.map(b=>({min:b.min.toArray(),max:b.max.toArray()})),assetTriangles,skinTriangles,recordedPose:{foot:foot.toArray(),yaw,pitch},reconstructedGrips:avatar.rideDiagnostics?.grips,probes};
fs.writeFileSync(`${dir}/before.json`,JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify(data,null,2));
transform.decompose(gate.position,gate.quaternion,gate.scale);gate.updateMatrixWorld(true);
const supplemental=gateBarrierObstacles(gate);controller.addObstacles(supplemental);
const afterProbes=probes.map(p=>({...p,free:controller.sweep(new T.Vector3(...p.from),new T.Vector3(...p.to),.04)}));
controller.teleport(foot);const acceptsIntersectingRide=controller.setRiding(true,yaw);
const approach=new T.Vector3(bounds[0].getCenter(new T.Vector3()).x,terrain.heightAt(-81.3,591.7)+.05,591.7);
controller.teleport(approach);for(let i=0;i<30;i++)controller.step(new T.Vector3(),1/60,false);
const mountsBeforeArm=controller.setRiding(true,Math.PI);
for(let i=0;i<120;i++)controller.step(new T.Vector3(0,0,1),1/60,false,9.5);
avatar.face(Math.PI);avatar.riding=true;
avatar.update(1/60,{foot:controller.position,onGround:controller.onGround,airborneFor:0,speed:0,intendedSpeed:0,jumped:false,runSpeed:7.2,surfaceHeight:controller.supportAt(controller.position.x,controller.position.z,controller.position.y),supportAt:(x,z,y)=>controller.supportAt(x,z,y)});
const stoppedSkin=intersections(student.scene,bounds);
const after={supplemental,probes:afterProbes,acceptsIntersectingRide,mountsBeforeArm,approach:approach.toArray(),stopped:controller.position.toArray(),skinTriangles:stoppedSkin};
fs.writeFileSync(`${dir}/after.json`,JSON.stringify(after,null,2)+'\n');console.log(JSON.stringify(after,null,2));controller.dispose();
if(supplemental.length!==4||afterProbes.some(p=>p.free>=p.length)||acceptsIntersectingRide||!mountsBeforeArm||controller.position.z>=bounds[0].min.z-.3||stoppedSkin.counts.some(n=>n>0))process.exitCode=1;
