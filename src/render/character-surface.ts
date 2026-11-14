import * as T from 'three';

export const CHARACTER_BODY_ORDER=10,CHARACTER_OUTLINE_ORDER=11,CHARACTER_STENCIL_BIT=1;
/** All body surfaces draw before hulls. The screen-space body union masks internal
 * hull fragments, including intersecting cuffs/thumbs, without shrinking the silhouette. */
export function characterBodyStencil(material:T.Material){
 material.stencilWrite=true;material.stencilRef=CHARACTER_STENCIL_BIT;
 material.stencilWriteMask=CHARACTER_STENCIL_BIT;material.stencilFuncMask=CHARACTER_STENCIL_BIT;
 material.stencilFunc=T.AlwaysStencilFunc;material.stencilFail=T.KeepStencilOp;material.stencilZFail=T.KeepStencilOp;material.stencilZPass=T.ReplaceStencilOp;
}
export function characterHullStencil(material:T.Material){
 material.stencilWrite=true;material.stencilRef=CHARACTER_STENCIL_BIT;
 material.stencilWriteMask=0;material.stencilFuncMask=CHARACTER_STENCIL_BIT;
 material.stencilFunc=T.NotEqualStencilFunc;material.stencilFail=T.KeepStencilOp;material.stencilZFail=T.KeepStencilOp;material.stencilZPass=T.KeepStencilOp;
}
/** Same threshold at every depth/part: a rejected pixel rejects ALL internal surfaces.
 * Surviving pixels are opaque and depth-writing, so only the nearest surface is visible. */
export function characterCoverageThreshold(x:number,y:number){
 const b2=(x:number,y:number)=>(2*(x%2)+3*(y%2))%4;
 x=((Math.floor(x)%8)+8)%8;y=((Math.floor(y)%8)+8)%8;
 return (16*b2(x,y)+4*b2(Math.floor(x/2),Math.floor(y/2))+b2(Math.floor(x/4),Math.floor(y/4))+.5)/64;
}
const COVERAGE=`
float characterBayer2(vec2 p){return mod(2.0*mod(p.x,2.0)+3.0*mod(p.y,2.0),4.0);}
float characterCoverage(vec2 coord){
 vec2 p=mod(floor(coord),8.0);
 return (16.0*characterBayer2(p)+4.0*characterBayer2(floor(p/2.0))+characterBayer2(floor(p/4.0))+.5)/64.0;
}`;
/** Installed at load time for both opaque/faded states; opacity changes do not compile a new program. */
export function configureCharacterCoverage(material:T.Material){
 if(material.userData.characterCoverage)return;
 const before=material.onBeforeCompile,key=material.customProgramCacheKey();
 material.onBeforeCompile=function(shader,renderer){
  before.call(this,shader,renderer);
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+COVERAGE)
   .replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
if(opacity<characterCoverage(gl_FragCoord.xy)) discard;
diffuseColor.a=1.0;`);
 };
 material.customProgramCacheKey=()=>key+'|character-coverage-v1';
 material.userData.characterCoverage=true;material.transparent=false;material.depthWrite=true;material.needsUpdate=true;
}
