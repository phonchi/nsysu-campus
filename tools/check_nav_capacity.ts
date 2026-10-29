/** Compare Detour query capacities against an unchanged baked binary. */
import fs from 'node:fs';import{createHash}from'node:crypto';
import{init,importNavMesh,NavMeshQuery,Detour}from'recast-navigation';
const binary=new Uint8Array(fs.readFileSync('public/data/walkthrough/navmesh.bin'));
const meta=JSON.parse(fs.readFileSync('public/data/walkthrough/navmesh-meta.json','utf8'));
await init();const mesh=importNavMesh(binary).navMesh;
const halfExtents={x:.45,y:.32,z:.45},vec=(p:number[])=>({x:p[0],y:p[1],z:p[2]});
const runs=[];
for(const maxNodes of [16384,65535]){
 const begin=performance.now(),q=new NavMeshQuery(mesh,{maxNodes}),results=[];
 for(const target of meta.coverage.checks){
  const from=vec(meta.spawn),to=vec(target.target),a=q.findClosestPoint(from,{halfExtents}),b=q.findClosestPoint(to,{halfExtents});
  const close=(r:typeof a,p:typeof from)=>r.success&&r.polyRef&&Math.hypot(r.point.x-p.x,r.point.z-p.z)<=.45&&Math.abs(r.point.y-p.y)<=.32;
  let reason='projection',status=0,polygons=0,endpointError:number|undefined;
  if(close(a,from)&&close(b,to)){
   const path=q.findPath(a.polyRef,b.polyRef,a.point,b.point,{maxPathPolys:4096});
   try{
    status=path.status;polygons=path.polys.size;
    if(status&Detour.DT_OUT_OF_NODES)reason='out-of-nodes';
    else if(status&Detour.DT_BUFFER_TOO_SMALL)reason='path-buffer';
    else if(!path.success||status&Detour.DT_PARTIAL_RESULT||!polygons||path.polys.get(polygons-1)!==b.polyRef)reason='disconnected';
    else{
     const straight=q.computePath(a.point,b.point,{halfExtents,maxPathPolys:4096,maxStraightPathPoints:4096});
     const end=straight.path.at(-1);endpointError=end?Math.hypot(end.x-b.point.x,end.y-b.point.y,end.z-b.point.z):Infinity;
     reason=straight.success&&endpointError<=.025?'complete':'endpoint';
    }
   }finally{path.polys.destroy();}
  }
  results.push({id:target.id,buildingId:target.buildingId,floorId:target.floorId,roomId:target.roomId,target:target.target,reason,status,polygons,endpointError});
 }
 q.destroy();const counts:Record<string,number>={};for(const r of results)counts[r.reason]=(counts[r.reason]??0)+1;
 const run={maxNodes,elapsedMs:Math.round(performance.now()-begin),counts,results};runs.push(run);console.log(JSON.stringify({maxNodes,elapsedMs:run.elapsedMs,counts}));
}
mesh.destroy();fs.writeFileSync('artifacts/nav-capacity-check.json',JSON.stringify({binarySHA256:createHash('sha256').update(binary).digest('hex'),binaryBytes:binary.length,scope:meta.scope,limits:{maxPathPolys:4096,maxStraightPathPoints:4096,projectionHorizontal:.45,projectionVertical:.32,endpointTolerance:.025},runs},null,2)+'\n');
