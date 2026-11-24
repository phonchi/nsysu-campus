export interface HintInsets { top: number; right: number; bottom: number; left: number }
export interface HintRect { x: number; y: number; width: number; height: number }
const overlaps=(a:HintRect,b:HintRect)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
/** Anchor above a projected world point, keeping the entire measured label inside the safe viewport.
 * `avoid` lists screen boxes the label must not cover (corner buttons, the objective card): an
 * overlapping label moves just below the box, or above it when there is no room below. */
export function clampHint(x:number,y:number,width:number,height:number,viewportWidth:number,viewportHeight:number,insets:HintInsets={top:0,right:0,bottom:0,left:0},gap=8,avoid:readonly HintRect[]=[]) {
  const left=insets.left+gap,top=insets.top+gap;
  const right=Math.max(left,viewportWidth-insets.right-gap-width),bottom=Math.max(top,viewportHeight-insets.bottom-gap-height);
  const box={x:Math.max(left,Math.min(right,x-width/2)),y:Math.max(top,Math.min(bottom,y-height)),width,height};
  const boxes=[...avoid].filter(r=>r.width>0&&r.height>0).sort((a,b)=>a.y-b.y);
  // Two passes: stepping below one box can land on the next one.
  for(let pass=0;pass<2;pass++)for(const r of boxes){
    if(!overlaps(box,r))continue;
    const below=r.y+r.height+gap,above=r.y-gap-height;
    if(below<=bottom)box.y=below;else if(above>=top)box.y=above;
  }
  return {x:box.x,y:box.y};
}
