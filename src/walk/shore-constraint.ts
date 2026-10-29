import type { StepConstraint } from './controller';

export interface ShoreSurface { readonly seaLevel:number; heightAt(x:number,z:number):number }
type Support=(x:number,z:number,referenceY:number)=>number|undefined;
const RADIUS=.32, DRY_MARGIN=.08;
const FOOTPRINT=Array.from({length:8},(_,i)=>[Math.cos(i*Math.PI/4)*RADIUS,Math.sin(i*Math.PI/4)*RADIUS]);

/** Keep the player's footprint on shore or an actual deck, while allowing coastal sliding.
 * DEM above water also covers basements/tunnels: their lower floors are not open sea.
 * Existing wet positions may escape toward higher ground instead of being locked in. */
export function shoreConstraint(terrain:ShoreSurface,supportAt:Support):StepConstraint {
 const edge=terrain.seaLevel+DRY_MARGIN;
 return (position,velocity,h)=>{
  if(!(h>0)||!Number.isFinite(h)||!Number.isFinite(velocity.x)||!Number.isFinite(velocity.z)||Math.hypot(velocity.x,velocity.z)<1e-8)return;
  const surface=(x:number,z:number)=>{
   const dem=terrain.heightAt(x,z);
   if(dem>=edge)return dem;
   const deck=supportAt(x,z,position.y);
   return deck!==undefined&&deck>=edge?Math.max(dem,deck):dem;
  };
  const level=(x:number,z:number)=>Math.min(surface(x,z),...FOOTPRINT.map(([dx,dz])=>surface(x+dx,z+dz)));
  const current=level(position.x,position.z),limit=Math.min(edge,current);
  const permitted=(x:number,z:number)=>level(position.x+x*h,position.z+z*h)>=limit-1e-5;
  const vx=velocity.x,vz=velocity.z;
  if(permitted(vx,vz))return;
  // Project against the local shore normal. Axis candidates handle deck corners or
  // piecewise-linear terrain where a single local normal does not capture the edge.
  const e=.2,nx=level(position.x+e,position.z)-level(position.x-e,position.z),nz=level(position.x,position.z+e)-level(position.x,position.z-e),n2=nx*nx+nz*nz;
  const inward=n2>1e-12?Math.min(0,(vx*nx+vz*nz)/n2):0;
  const candidates=[[vx-nx*inward,vz-nz*inward],[vx,0],[0,vz],[0,0]];
  let bestX=0,bestZ=0,bestSpeed=0;
  for(const[x,z]of candidates){const speed=x*x+z*z;if(speed>bestSpeed&&permitted(x,z)){bestX=x;bestZ=z;bestSpeed=speed;}}
  velocity.x=bestX;velocity.z=bestZ;
 };
}
