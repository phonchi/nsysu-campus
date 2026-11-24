import { expect, it, vi } from 'vitest';
import { LOD, Mesh, MeshStandardMaterial, MeshToonMaterial, Raycaster, Vector3 } from 'three';
import { hamasenExteriors } from '../src/world/hamasen-art';
import { fitSign, genericSigns, paintSign, streetfrontPlanner } from '../src/world/hamasen-storefront';
import { toonify } from '../src/render/toon';
import { NIGHT_MATERIALS } from '../src/walk-materials';
import { buildRuntimeWorld } from './world-fixture';

it('renders signs at their drawn aspect including long names and two-line signs',()=>{
  const inputs=[['麥味登',false],['順和排骨大王',false],['麻古茶坊',true],['丸浜',false],
    ['渡船頭海之冰',false],['元福',false]] as const;
  for(const [text,vertical] of inputs){
    const board={text,vertical,background:'#703d38',ink:'#f1e4ce',subtitle:text==='元福'?'香菇肉羹':undefined};
    const panel=fitSign(board,2.8,.75);
    const scale=vi.fn(),fillText=vi.fn();
    const ctx={scale,fillText,fillRect:vi.fn(),strokeRect:vi.fn(),
      measureText:(str:string)=>({width:str.length*parseInt(ctx.font.split(' ')[1],10)}),font:''};
    paintSign(ctx as unknown as CanvasRenderingContext2D,board);
    const [sx,sy]=scale.mock.calls[0];
    expect((panel.width/384*sx)/(panel.height/96*sy)).toBeCloseTo(1,5);
    expect(panel.width).toBeLessThanOrEqual(2.8);
    expect(panel.height).toBeLessThanOrEqual(.75);
    expect(fillText.mock.calls.map(call=>call[0]).join('')).toContain(text);
    expect(fillText.mock.calls.every(call=>call.length===3)).toBe(true);
    if(board.subtitle)expect(fillText).toHaveBeenCalledWith(board.subtitle,expect.any(Number),expect.any(Number));
  }
});

it('assigns varied streetfronts and avoids repeating the same label across nearby bays',()=>{
  const plan=streetfrontPlanner();
  const labels=Array.from({length:5},(_,i)=>plan(true,1,[i*4.2,i%2*.8],[0,1],4.2).label);
  expect(labels.every(Boolean)).toBe(true);
  for(let i=1;i<labels.length;i++)expect(labels[i]).not.toBe(labels[i-1]);
  expect(new Set(genericSigns).size).toBeGreaterThanOrEqual(15);
  const styles=Array.from({length:12},(_,i)=>plan(true,i,[i*25,20],[0,1],4.2).style);
  expect(new Set(styles).size).toBe(8);
  const alley=Array.from({length:12},(_,i)=>plan(false,i,[i*25,60],[0,1],4.2));
  expect(alley.filter(front=>front.style==='home'||front.style==='shutter')).toHaveLength(8);
});

it('keeps both actual LODs lit and checks street-level sight lines to all named horizontal signs',()=>{
  const tiles=new Map<string,[number,number]>();
  const translations:number[][]=[[]];
  const maskColors:string[]=[];
  const ctx={
    save:()=>translations.push([]),restore:()=>translations.pop(),
    translate:(x:number,y:number)=>{translations[translations.length-1]=[x,y];},
    measureText:(s:string)=>({width:s.length*50}),
    fillText:(s:string)=>{if(!tiles.has(s))tiles.set(s,translations.at(-1) as [number,number]);},
    scale:()=>{},fillRect:()=>{},clearRect:()=>{},strokeRect:()=>{},
    beginPath:()=>{},ellipse:()=>{},fill:()=>{},moveTo:()=>{},lineTo:()=>{},stroke:()=>{},
  };
  let canvasCount=0;
  vi.stubGlobal('document',{createElement:()=>{
    const mask={fillStyle:'',fillRect:()=>maskColors.push(mask.fillStyle)};
    const context=canvasCount++===0?ctx:mask;
    return {getContext:()=>context,width:0,height:0};
  }});
  const previous=new Set(NIGHT_MATERIALS);
  try{
    const {world,structure,terrain}=buildRuntimeWorld();
    const buildings=structure.context.background.filter(b=>b.shopfronts?.length);
    const group=hamasenExteriors(buildings.map(building=>({
      building,group:world.display.getObjectByName('Campus exterior '+building.id)!,
    })),terrain);
    toonify(group);
    group.updateMatrixWorld(true);
    expect(maskColors[0]).toBe('#000');
    expect(maskColors.length).toBeGreaterThan(1);
    expect(Math.max(...maskColors.map(color=>parseInt(color.slice(1,3),16)))).toBeLessThan(90);
    const signMeshes:Mesh[]=[];
    const obstructions:Mesh[]=[];
    group.traverse(o=>{
      if(o instanceof LOD){
        const near=o.levels[0].object.getObjectByName('Hamasen signs, windows and grilles') as Mesh;
        const far=o.levels[1].object.getObjectByName('Hamasen street and side wall textures') as Mesh;
        expect(near.material).toBe(far.material);
        expect(near.material).toBeInstanceOf(MeshToonMaterial);
        const material=near.material as MeshStandardMaterial;
        expect(material.emissiveIntensity).toBe(0);
        expect(material.emissiveMap?.name).toBe('Hamasen shop interior mask');
        expect(NIGHT_MATERIALS.has(material)).toBe(true);
        signMeshes.push(near);
      }
      if(o instanceof Mesh&&['Hamasen building silhouettes','Hamasen joinery and tiles'].includes(o.name))obstructions.push(o);
    });
    let count=0;
    const ray=new Raycaster();
    for(const b of buildings)for(const shop of b.shopfronts!){
      const text=({'matou-auntie-danbing':'阿姨蛋餅','maruhama-soft-serve':'丸浜',
        'shunhe-pork-rib':'順和排骨大王','yuanfu-yakiniku-rice':'元福'} as Record<string,string>)[shop.id]??shop.name;
      const [x,y]=tiles.get(text)!;
      const matches:Vector3[][]=[];
      const [a,bp]=[b.polygon[shop.edge],b.polygon[(shop.edge+1)%b.polygon.length]];
      const normal=new Vector3(bp[1]-a[1],0,a[0]-bp[0]).normalize();
      const toward=new Vector3(shop.approach[0]-a[0],0,shop.approach[1]-a[1]);
      if(toward.dot(normal)<0)normal.negate();
      const basis=new Vector3().crossVectors(new Vector3(0,1,0),normal).normalize();
      for(const mesh of signMeshes){
        const material=mesh.material as MeshStandardMaterial;
        const image=material.map!.image as HTMLCanvasElement;
        const u=(x+.5)/image.width,v=1-(y+95.5)/image.height;
        const uv=mesh.geometry.attributes.uv,pos=mesh.geometry.attributes.position;
        for(let i=0;i<pos.count;i+=6){
          if(Math.abs(uv.getX(i)-u)>.00001||Math.abs(uv.getY(i+1)-v)>.00001)continue;
          const xyz=Array.from({length:3},(_,k)=>new Vector3().fromBufferAttribute(pos,i+k).applyMatrix4(mesh.matrixWorld));
          if(Math.abs(xyz[0].clone().sub(xyz[2]).normalize().dot(basis))>.98)matches.push(xyz);
        }
      }
      expect(matches,shop.id).toHaveLength(1);
      const [topLeft,bottomLeft,topRight]=matches[0];
      const middle=bottomLeft.clone().add(topRight).multiplyScalar(.5);
      for(const horizontal of [.24,.5,.76])for(const vertical of [.27,.55,.72]){
        const target=topLeft.clone().lerp(bottomLeft,vertical)
          .addScaledVector(topRight.clone().sub(topLeft),horizontal);
        const start=middle.clone().addScaledVector(normal,4.5);
        start.y=terrain.heightAt(start.x,start.z)+1.65;
        const direction=target.clone().sub(start);
        ray.set(start,direction.clone().normalize());
        ray.far=direction.length()-.004;
        const hits=ray.intersectObjects(obstructions);
        expect(hits,JSON.stringify({shop:shop.id,target:target.toArray(),start:start.toArray(),
          hits:hits.map(hit=>[hit.object.name,hit.point.toArray()])})).toHaveLength(0);
      }
      count++;
    }
    expect(count).toBe(14);
  }finally{
    vi.unstubAllGlobals();
    for(const material of NIGHT_MATERIALS)if(!previous.has(material))NIGHT_MATERIALS.delete(material);
  }
},30_000);
