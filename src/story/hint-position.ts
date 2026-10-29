export interface HintInsets { top: number; right: number; bottom: number; left: number }
/** Anchor above a projected world point, keeping the entire measured label inside the safe viewport. */
export function clampHint(x:number,y:number,width:number,height:number,viewportWidth:number,viewportHeight:number,insets:HintInsets={top:0,right:0,bottom:0,left:0},gap=8) {
  const left=insets.left+gap,top=insets.top+gap;
  const right=Math.max(left,viewportWidth-insets.right-gap-width),bottom=Math.max(top,viewportHeight-insets.bottom-gap-height);
  return {x:Math.max(left,Math.min(right,x-width/2)),y:Math.max(top,Math.min(bottom,y-height))};
}
