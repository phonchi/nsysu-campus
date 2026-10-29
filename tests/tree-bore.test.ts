import {describe,it,expect} from 'vitest';
import {Box3,Matrix4,Vector3} from 'three';
import {assignTreeYaw,filterTreeSpots,treeBoreTriangles,treeGeometry,type TreeSpot,type TreeBore} from '../src/render/foliage';
const bore:TreeBore={inverse:new Matrix4(),bounds:new Box3(new Vector3(-3.9,-.3,-22),new Vector3(3.9,6.8,2))};
// Root positions measured from the actual shipped scene relative to the tunnel transform.
const flame:TreeSpot={x:1.3393751165,y:2.9610252803,z:-5.0772148749,s:1.0782176,f:'flame',yaw:1.1724};
const banyan:TreeSpot={x:-6.5547507497,y:1.3785093253,z:-2.5182066553,s:1.25,f:'banyan',yaw:0};
describe('tree source geometry cannot intrude into the tunnel bore',()=>{
 it('reproduces the real trunk and neighbouring canopy intrusions before filtering',()=>{
  for(const spot of [flame,banyan]){const g=treeGeometry(spot.f);expect(treeBoreTriangles(spot,bore,g,0)).toBeGreaterThan(0);g.dispose();}
 });
 it('removes the two intruding source spots before both instancing and collider extraction',()=>{
  const roof:TreeSpot={x:6.5,y:9,z:-10,s:1.2,f:'banyan',yaw:0};
  const retained=filterTreeSpots([flame,banyan,roof],[bore],()=>({soil:true}));expect(retained).toEqual([roof]);
  let triangles=0;for(const spot of retained){const g=treeGeometry(spot.f);triangles+=treeBoreTriangles(spot,bore,g);g.dispose();}expect(triangles).toBe(0);
 });
 it('rejects unsupported carved roots without deleting real roof soil trees',()=>{
  const roof:TreeSpot={x:6.5,y:9,z:-10,s:1.2,f:'banyan',yaw:0};
  expect(filterTreeSpots([flame,roof],[bore],(x)=>x>5?{soil:true}:undefined)).toEqual([roof]);
 });
 it('assigns orientation before filtering so another tree does not rotate when one is removed',()=>{
  const input=assignTreeYaw([flame,banyan,{x:10,y:10,z:10,s:1,f:'hill'}]);
  const filtered=filterTreeSpots(input,[bore],()=>({soil:true}));expect(filtered).toHaveLength(1);expect(filtered[0].yaw).toBe(input[2].yaw);
 });
});
