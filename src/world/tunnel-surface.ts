import * as T from 'three';
type P2=[number,number];
export interface TunnelPlacement {centroid:P2;yaw:number;centerline?:P2[];eastPortal?:P2;walkableLength?:number}
export interface TunnelSection {position:T.Vector3;tangent:T.Vector3;right:T.Vector3;distance:number}
export interface TunnelProfile {sections:TunnelSection[];length:number;west:T.Vector3;east:T.Vector3;westYaw:number;eastYaw:number;halfWidth:number;height:number}
export function fullTunnelProfile(p:TunnelPlacement,ground:(x:number,z:number)=>number):TunnelProfile {
 const path=p.centerline??[p.centroid,p.eastPortal??[282.1,223.1]];
 const lengths=path.slice(1).map((b,i)=>Math.hypot(b[0]-path[i][0],b[1]-path[i][1])),length=lengths.reduce((a,b)=>a+b,0);
 const first=new T.Vector3(path[1][0]-path[0][0],0,path[1][1]-path[0][1]).normalize(),last=new T.Vector3(path.at(-1)![0]-path.at(-2)![0],0,path.at(-1)![1]-path.at(-2)![1]).normalize();
 const westY=Math.min(ground(...path[0]),ground(path[0][0]-first.x*4,path[0][1]-first.z*4)),eastY=Math.min(ground(...path.at(-1)!),ground(path.at(-1)![0]+last.x*4,path.at(-1)![1]+last.z*4));
 const sections:TunnelSection[]=[];let passed=0;
 const put=(x:number,z:number,d:number,tangent:T.Vector3,y:number)=>sections.push({position:new T.Vector3(x,y,z),tangent:tangent.clone(),right:new T.Vector3(-tangent.z,0,tangent.x),distance:d});
 const approach=8;
 for(let d=-approach;d<0;d+=1){const x=path[0][0]+first.x*d,z=path[0][1]+first.z*d,t=(d+approach)/approach;const blend=Math.max(0,(d+4)/4);put(x,z,d,first,ground(x,z)*(1-blend)+westY*blend);}
 for(let i=0;i<lengths.length;i++){
  const a=path[i],b=path[i+1],L=lengths[i],dir=new T.Vector3(b[0]-a[0],0,b[1]-a[1]).normalize(),n=Math.ceil(L/2);
  for(let k=i?1:0;k<=n;k++){const t=k/n,d=passed+L*t;let tangent=dir;
   if(k===n&&i<lengths.length-1)tangent=dir.clone().add(new T.Vector3(path[i+2][0]-b[0],0,path[i+2][1]-b[1]).normalize()).normalize();
   put(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,d,tangent,westY+(eastY-westY)*d/length);
  }passed+=L;
 }
 for(let d=1;d<=approach;d++){const x=path.at(-1)![0]+last.x*d,z=path.at(-1)![1]+last.z*d,t=d/approach;const blend=Math.min(1,d/4);put(x,z,length+d,last,eastY*(1-blend)+ground(x,z)*blend);}
 return{sections,length,west:new T.Vector3(path[0][0],westY,path[0][1]),east:new T.Vector3(path.at(-1)![0],eastY,path.at(-1)![1]),westYaw:Math.atan2(-first.x,-first.z),eastYaw:Math.atan2(last.x,last.z),halfWidth:3.3,height:5.8};
}
function surfaceGeometry(quads:T.Vector3[][]){const vertices:number[]=[];for(const q of quads)for(const i of [0,1,2,0,2,3])vertices.push(q[i].x,q[i].y,q[i].z);const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.computeVertexNormals();return g;}
export function fullTunnelGeometry(profile:TunnelProfile){
 const floor:T.Vector3[][]=[],shell:T.Vector3[][]=[],kerbs:T.Vector3[][]=[];const R=profile.halfWidth;
 const at=(s:TunnelSection,x:number,y:number)=>s.position.clone().addScaledVector(s.right,x).add(new T.Vector3(0,y,0));
 for(let i=1;i<profile.sections.length;i++){
  const a=profile.sections[i-1],b=profile.sections[i];floor.push([at(a,-R,0),at(a,R,0),at(b,R,0),at(b,-R,0)]);
  // Open-ended lining: no end caps and no hidden fog wall.
  if(b.distance<0||a.distance>profile.length)continue;
  for(const sign of [-1,1]){shell.push([at(a,sign*R,0),at(a,sign*R,2.5),at(b,sign*R,2.5),at(b,sign*R,0)]);}
  for(let k=0;k<12;k++){const t0=k/12*Math.PI,t1=(k+1)/12*Math.PI;shell.push([at(a,R*Math.cos(t0),2.5+R*Math.sin(t0)),at(a,R*Math.cos(t1),2.5+R*Math.sin(t1)),at(b,R*Math.cos(t1),2.5+R*Math.sin(t1)),at(b,R*Math.cos(t0),2.5+R*Math.sin(t0))]);}
 }
 return{floor:surfaceGeometry(floor),shell:surfaceGeometry(shell)};
}
/** Carve only low ground actually occupying the bore near either opening; leave mountain soil above the roof. */
export function tunnelGroundCuts(profile:TunnelProfile,ground?:(x:number,z:number)=>number):P2[][]{
 const out:P2[][]=[];
 for(let i=1;i<profile.sections.length;i++){
  const a=profile.sections[i-1],b=profile.sections[i];if(b.distance < -2 || a.distance > profile.length+2)continue;const mid=a.position.clone().lerp(b.position,.5),side=a.right.clone().add(b.right).normalize();
  const low=ground?Array.from({length:11},(_,i)=>i-5).some(x=>ground(mid.x+side.x*x,mid.z+side.z*x)<mid.y+profile.height+1):a.distance<25||b.distance>profile.length-25;
  if(!low)continue;
  // The terrain now clips triangles exactly. Remove only the actual floor footprint,
  // preserving adjacent soil instead of deleting a whole grid cell around the opening.
  const r=profile.halfWidth,p=a.position,q=b.position;
  out.push([[p.x+a.right.x*r,p.z+a.right.z*r],[q.x+b.right.x*r,q.z+b.right.z*r],[q.x-b.right.x*r,q.z-b.right.z*r],[p.x-a.right.x*r,p.z-a.right.z*r]]);
 }
 return out;
}
export function tunnelVegetationVolumes(profile:TunnelProfile){const out:T.Box3[]=[];for(let i=1;i<profile.sections.length;i++){const a=profile.sections[i-1].position,b=profile.sections[i].position;out.push(new T.Box3().setFromPoints([a,b]).expandByVector(new T.Vector3(3.5,0,3.5)).expandByPoint(new T.Vector3(a.x,a.y+profile.height,a.z)).expandByPoint(new T.Vector3(b.x,b.y+profile.height,b.z)));}for(const box of out)box.min.y=-Infinity;return out;}

export function tunnelBores(profile:TunnelProfile){return profile.sections.slice(1).flatMap((b,i)=>{const a=profile.sections[i];if(b.distance<0||a.distance>profile.length)return [];const d=b.position.clone().sub(a.position),L=Math.hypot(d.x,d.z),yaw=Math.atan2(-d.x,-d.z),mid=a.position.clone().lerp(b.position,.5),matrix=new T.Matrix4().makeRotationY(yaw).setPosition(mid.x,mid.y,mid.z);return[{inverse:matrix.clone().invert(),bounds:new T.Box3(new T.Vector3(-3.3,0,-L/2-.05),new T.Vector3(3.3,5.8,L/2+.05))}];});}
