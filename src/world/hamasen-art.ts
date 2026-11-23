/** Hamasen street models use source footprints, with details batched by street block. */
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ContextBuilding, ContextRoad, HamasenContext, Point2 } from '../walk-types';
import { clippedRoadPaths, projectRoadGeometry, roadRibbon } from './road-surface';
import { inPolygon, type Terrain } from './terrain';
import { NIGHT_MATERIALS } from '../walk-materials';
import type { TunnelProfile } from './tunnel-surface';

const tones: Record<string, string> = {
  concrete:'#a7a7a0', stucco:'#bbb8ac', porcelain:'#d2d4cd', tile:'#b5b6ad', sand:'#c3bba7',
  gray:'#9a9f9c', 'gray-green':'#a1ada4', 'gray-blue':'#98a6ac', brick:'#9e624d',
  station:'#c6c9c4', industrial:'#8e9897', white:'#deded5', cream:'#d0c5ad',
};
const frame = '#414c4e', glazing = '#657e83', trim = '#bec5be', shutter = '#88918b';
const box = new T.BoxGeometry(1, 1, 1);
const plate = new T.PlaneGeometry(1,1);
const flatHeight = .4;
const portalWalls:Record<string,number[]> = {
  'hamasen-ov-589f6461-7d23-4ce5-981e-3fad38842d34':[0,3,4],
  'hamasen-ov-9da3e46e-03e2-41a0-b4a5-c1978cdb862e':[1,2],
};
// Small roof patches visible in the NLSC PHOTO2025 tiles over the middle and east blocks.
// Plan dimensions are approximate. The roof terrace and navigability stay as generated.
const roofSheds:Record<string,{x:number;z:number;width:number;depth:number;height:number;tone:string}> = {
  'hamasen-ov-cb604dbb-1da6-4797-bb1e-89d6e3759201':{x:465.57,z:357.53,width:4.4,depth:2.1,height:.81,tone:'#9faaa6'},
  'hamasen-ov-f67fe280-fa04-4da8-b342-9a250262539f':{x:461.06,z:371.49,width:4.8,depth:1.8,height:.87,tone:'#a1a299'},
  'hamasen-ov-d0a43566-15c1-405d-a251-89938bbbb9d5':{x:610.44,z:432.26,width:4.5,depth:3.3,height:1.14,tone:'#a4a396'},
  'hamasen-ov-3faf149f-4db1-4e20-9af7-0442e730073f':{x:631.66,z:408.54,width:4.1,depth:3.5,height:1.24,tone:'#85958d'},
};
const shoushanCorners = {
  north:'osm-313913296',
  south:'osm-1388408935',
  balconies:'osm-1151925118',
};
const toV2 = ([x,z]: Point2) => new T.Vector2(x,z);
const paint = (tone?:string, fallback='#bcb8aa') => new T.Color(tone && /^#[a-f\d]{6}$/i.test(tone) ? tone : tone && tones[tone] || fallback);

interface Volume { baseY:number; topY:number; arcadeDepth:number }
interface Edge { a:Point2; tangent:Point2; normal:Point2; length:number; yaw:number; index:number }
interface DetailLevels { base:T.BufferGeometry[]; details:T.BufferGeometry[]; light:T.BufferGeometry[]; signs:T.BufferGeometry[] }

function batchGeometry(source:T.BufferGeometry, matrix:T.Matrix4, tint:T.Color, roof?:T.Color) {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  geometry.applyMatrix4(matrix);
  if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal'), position=geometry.getAttribute('position');
  const colors = new Float32Array(normal.count * 3);
  const uv = new Float32Array(normal.count * 2);
  for (let i=0;i<normal.count;i++) {
    const color = roof && normal.getY(i) > .8 ? roof : tint;
    colors.set([color.r,color.g,color.b],i*3);
    const axis = Math.abs(normal.getX(i))>Math.abs(normal.getZ(i)) ? position.getZ(i) : position.getX(i);
    uv.set(Math.abs(normal.getY(i))>.7 ? [position.getX(i),position.getZ(i)] : [axis,position.getY(i)],i*2);
  }
  for (const key of Object.keys(geometry.attributes)) if (!['position','normal'].includes(key)) geometry.deleteAttribute(key);
  geometry.setAttribute('color',new T.BufferAttribute(colors,3));
  geometry.setAttribute('uv',new T.BufferAttribute(uv,2));
  geometry.clearGroups();
  return geometry;
}

function geometryFromTriangles(triangles: readonly (readonly T.Vector3[])[]) {
  const positions:number[]=[];
  for (const triangle of triangles) {
    const [a,b,c]=triangle;
    const normal=b.clone().sub(a).cross(c.clone().sub(a));
    if (normal.lengthSq()<1e-10) continue;
    for (const p of normal.y < 0 ? [a,c,b] : [a,b,c]) positions.push(p.x,p.y,p.z);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geometry.computeVertexNormals();
  return geometry;
}

function beamGeometry(a:T.Vector3,b:T.Vector3,width:number,depth:number,tint:T.Color) {
  const axis=b.clone().sub(a),length=axis.length();
  if(length<.01)return;
  const rotation=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),axis.divideScalar(length));
  const matrix=new T.Matrix4().compose(a.clone().lerp(b,.5),rotation,new T.Vector3(width,length,depth));
  return batchGeometry(box,matrix,tint);
}

function edgeOn(polygon:Point2[], index:number):Edge {
  const a=polygon[index], b=polygon[(index+1)%polygon.length];
  const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
  const winding=Math.sign(polygon.reduce((sum, p, i) => {const q=polygon[(i+1)%polygon.length];return sum+p[0]*q[1]-p[1]*q[0];},0)) || 1;
  return {a,tangent:[dx/length,dz/length],normal:[winding*dz/length,-winding*dx/length],length,yaw:-Math.atan2(dz,dx),index};
}

function edgesOf(building:ContextBuilding) {
  return building.polygon.map((_,i)=>edgeOn(building.polygon,i)).filter(edge=>edge.length>.5);
}

/** Keep pitched roofs inside the source footprint, including its courtyards. */
function pitchedRoof(building:ContextBuilding, edge:Edge, topY:number, vault=false) {
  const points = [...building.polygon,...(building.holes ?? []).flat()];
  const triangles = T.ShapeUtils.triangulateShape(building.polygon.map(toV2),(building.holes??[]).map(h=>h.map(toV2)));
  const across = (p:Point2)=>p[0]*edge.normal[0]+p[1]*edge.normal[1];
  const along = (p:Point2)=>p[0]*edge.tangent[0]+p[1]*edge.tangent[1];
  const b = building.polygon.map(across), a=building.polygon.map(along);
  const crossMin=Math.min(...b), crossMax=Math.max(...b), crossSpan=crossMax-crossMin;
  const axialMin=Math.min(...a), axialMax=Math.max(...a);
  const rise = vault ? Math.min(.72,crossSpan*.09) : Math.min(2.3,Math.max(.60,crossSpan*.16));
  if (crossSpan < 1.0 || !triangles.length) return undefined;
  type Plane = (p:Point2)=>number;
  const plans:Plane[] = [p=>(across(p)-crossMin)/crossSpan*2,p=>(crossMax-across(p))/crossSpan*2];
  if (building.roofShape==='hip') plans.push(p=>(along(p)-axialMin)/crossSpan*2,p=>(axialMax-along(p))/crossSpan*2);
  if (building.roofShape==='shed') plans.splice(0,plans.length,p=>(across(p)-crossMin)/crossSpan);
  if(vault){
    const height=(at:number)=>Math.sin(Math.PI*at);
    plans.splice(0,plans.length,...Array.from({length:8},(_,i)=>{
      const start=i/8,end=(i+1)/8,y=height(start),slope=(height(end)-y)*8;
      return (p:Point2)=>y+slope*((across(p)-crossMin)/crossSpan-start);
    }));
  }
  const cut=(poly:Point2[], plane:Plane)=>poly.flatMap((p,i)=>{
    const q=poly[(i+1)%poly.length],a=plane(p),b=plane(q),result:Point2[]=[];
    if(a>=-1e-6)result.push(p);
    if((a< -1e-6)!==(b< -1e-6)){const t=a/(a-b);result.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
    return result;
  });
  const pieces:T.Vector3[][]=[];
  const top=(p:Point2,v:number)=>new T.Vector3(p[0],topY+.035+rise*Math.max(0,v),p[1]);
  for(const tri of triangles.map(t=>t.map(i=>points[i]))) for(const plane of plans){
    let patch=tri;
    for(const other of plans)if(other!==plane)patch=cut(patch,p=>other(p)-plane(p));
    for(let i=1;i<patch.length-1;i++)pieces.push([patch[0],patch[i],patch[i+1]].map(p=>top(p,plane(p))));
  }
  // Open rail canopies have no filled gable end.
  if(vault)return geometryFromTriangles(pieces);
  // Vertical gable and shed ends connect the upper faces to the wall head.
  for(let i=0;i<building.polygon.length;i++){
    const p=building.polygon[i],q=building.polygon[(i+1)%building.polygon.length],pm=across(p),qm=across(q),ridge=(crossMin+crossMax)/2;
    const t=(ridge-pm)/(qm-pm);
    const run:Point2[]=(t>.001 && t<.999)?[p,[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t],q]:[p,q];
    for(let j=1;j<run.length;j++){
      const a=run[j-1],b=run[j],hiA=top(a,Math.min(...plans.map(fn=>fn(a)))),hiB=top(b,Math.min(...plans.map(fn=>fn(b))));
      const loA=new T.Vector3(a[0],topY,a[1]),loB=new T.Vector3(b[0],topY,b[1]);
      if (Math.max(hiA.y,hiB.y)-topY>.05) pieces.push([loA,loB,hiA],[hiA,loB,hiB]);
    }
  }
  return geometryFromTriangles(pieces);
}

export interface HamasenExterior {
  building:ContextBuilding;
  group:T.Object3D;
}

function masonryGrain() {
  const size=32, channels=new Uint8Array(size*size*4);
  for(let i=0;i<size*size;i++){
    const shade=235+((Math.imul(i+1,0x27d4eb2d)^Math.imul(i+71,0x165667b1))>>>24)%21;
    channels.set([shade,shade,shade,255],i*4);
  }
  const texture=new T.DataTexture(channels,size,size,T.RGBAFormat);
  texture.name='Hamasen material grain';texture.wrapS=texture.wrapT=T.RepeatWrapping;
  texture.magFilter=T.LinearFilter;texture.minFilter=T.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;
  return texture;
}

function signAtlas(names:readonly string[]) {
  if (!names.length || typeof document==='undefined') return;
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=64*names.length;
  const ctx=canvas.getContext('2d');if(!ctx)return;
  names.forEach((name,i)=>{
    const station=name==='高雄港';
    ctx.fillStyle=station?'#2c2821':'#37494a';ctx.fillRect(0,i*64,512,64);
    ctx.textBaseline='middle';ctx.textAlign='center';ctx.font=`bold ${station?45:29}px "Noto Sans TC", sans-serif`;ctx.fillStyle='#e0dccb';
    ctx.fillText(name,256,i*64+32,500);
  });
  const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;
  return new T.MeshBasicMaterial({map,side:T.FrontSide});
}

export function hamasenExteriors(exteriors:readonly HamasenExterior[], terrain?:Terrain, shortDetail=false):T.Group {
  const root=new T.Group();root.name='Hamasen exteriors';
  if (!exteriors.length) return root;
  const buckets=new Map<string,{x:number;z:number;levels:DetailLevels}>();
  const nearDetail = shortDetail ? 85 : 115;
  const chunk=96;
  const shell=new T.MeshStandardMaterial({name:'Hamasen masonry, metal and glazing',map:masonryGrain(),vertexColors:true,roughness:.87,side:T.DoubleSide});
  const warm=new T.MeshStandardMaterial({name:'Hamasen shop lights',vertexColors:true,emissive:'#e8bf84',emissiveIntensity:0,roughness:.8});
  NIGHT_MATERIALS.add(warm);
  const signName=(building:ContextBuilding)=>building.stationExit?undefined:building.facade==='platform'?'高雄港':building.signText;
  const names=[...new Set(exteriors.flatMap(({building})=>{const name=signName(building);return name?[name]:[];}))];
  const signs=signAtlas(names);
  const signPanel=(name:string|undefined,width:number,height:number,x:number,y:number,z:number,yaw:number)=>{
    const sign=signs&&name?names.indexOf(name):-1;
    if(sign<0)return;
    const shape=new T.PlaneGeometry(width,height);
    const uv=shape.getAttribute('uv');
    for(let i=0;i<uv.count;i++)uv.setY(i,1-(sign+(1-uv.getY(i))*.92+.04)/names.length);
    const g=shape.toNonIndexed().rotateY(yaw).translate(x,y,z);
    shape.dispose();return g;
  };
  const transform=new T.Matrix4(), position=new T.Vector3(), quaternion=new T.Quaternion(), size=new T.Vector3(), axis=new T.Vector3(0,1,0);
  const addCuboid=(out:T.BufferGeometry[], x:number,y:number,z:number,w:number,h:number,d:number,yaw:number,tint:string|T.Color,shape:T.BufferGeometry=box)=>{
    if(w<=.01||h<=.01||d<=.01)return;
    position.set(x,y,z);quaternion.setFromAxisAngle(axis,yaw);size.set(w,h,d);
    transform.compose(position,quaternion,size);
    out.push(batchGeometry(shape,transform,typeof tint==='string'?new T.Color(tint):tint));
  };
  for(const {building,group} of exteriors){
    const allEdges=edgesOf(building);
    if(!allEdges.length)continue;
    const frontage=building.id===shoushanCorners.balconies?2:building.frontage?.edge;
    const street=allEdges.find(e=>e.index===frontage)??allEdges.reduce((a,b)=>a.length>b.length?a:b);
    const centre=new T.Box2().setFromPoints(building.polygon.map(toV2)).getCenter(new T.Vector2());
    const i=Math.floor(centre.x/chunk),j=Math.floor(centre.y/chunk),key=`${i},${j}`;
    let bucket=buckets.get(key);
    if(!bucket){bucket={x:(i+.5)*chunk,z:(j+.5)*chunk,levels:{base:[],details:[],light:[],signs:[]}};buckets.set(key,bucket);}
    const output=bucket.levels;
    const volume=group.userData.hamasenVolume as Volume|undefined;
    const inferredGround=terrain?.heightAt(centre.x,centre.y)??0;
    const bottom=volume?.baseY??inferredGround;
    const topY=volume?.topY??(bottom+(building.heightM??Math.max(4,building.storeys*3.6)));
    const wall=paint(building.tone), roof=paint(building.stationExit===1?'concrete':building.roofTone,'#8a918c');
    const arcadeDepth=volume?.arcadeDepth??0;
    const use=building.facade??(building.stationExit?'station':'residential');
    const renderPlatform=use==='platform';
    const renderPitch=building.roofShape!==undefined&&building.roofShape!=='flat';
    const isOldStation=building.id.endsWith('-203342621');
    const isMarket=building.id.endsWith('-203577807');
    const isYongguang=building.id.endsWith('-310227406');
    const isCornerGlazing=building.id===shoushanCorners.north;
    const isCornerTiles=building.id===shoushanCorners.south;
    const isRowBalconies=building.id===shoushanCorners.balconies;
    const photoRow=use==='shophouse'&&centre.x>=366&&centre.x<=465
      &&Math.abs(centre.y-(242+(centre.x-319)*.606))<25;
    const portalEdges=portalWalls[building.id];
    const around=(edge:Edge,along:number,outside:number):Point2=>[edge.a[0]+edge.tangent[0]*along+edge.normal[0]*outside,edge.a[1]+edge.tangent[1]*along+edge.normal[1]*outside];
    const at=(edge:Edge,along:number,outside:number,y:number)=>{const [x,z]=around(edge,along,outside);return new T.Vector3(x,y,z);};
    const addBeam=(out:T.BufferGeometry[],a:T.Vector3,b:T.Vector3,width:number,depth:number,tint:T.Color)=>{
      const beam=beamGeometry(a,b,width,depth,tint);
      if(beam)out.push(beam);
    };
    const panel=(out:T.BufferGeometry[],edge:Edge,along:number,level:number,w:number,h:number,d:number,offset:number,color:string|T.Color)=>{
      if(d>.11){
        const [x,z]=around(edge,along,offset);
        addCuboid(out,x,level,z,w,h,d,edge.yaw,color);
        return;
      }
      if(w<=.01||h<=.01)return;
      // Window panes, bay lines and shutter slats have no visible depth at this scale.
      const [x,z]=around(edge,along,offset+d/2);
      position.set(x,level,z);quaternion.setFromAxisAngle(axis,Math.atan2(edge.normal[0],edge.normal[1]));size.set(w,h,1);
      transform.compose(position,quaternion,size);
      out.push(batchGeometry(plate,transform,typeof color==='string'?new T.Color(color):color));
    };
    group.updateWorldMatrix(true,true);
    group.traverse(o=>{
      if(!(o instanceof T.Mesh))return;
      if(renderPlatform){
        const material=o.userData.hamasenColumn?'#737f78':o.userData.hamasenPlatformDeck?'#b9b7ae':building.roofTone;
        output.base.push(batchGeometry(o.geometry,o.matrixWorld,paint(material)));
      }else output.base.push(batchGeometry(o.geometry,o.matrixWorld,o.userData.hamasenColumn?wall.clone().lerp(new T.Color(trim),.4):wall,roof));
    });
    if(building.stationExit)continue;
    if(renderPlatform){
      // Structure and collision retain the same apron and posts; the visible cover has an arched roof.
      const axisEdge=allEdges.reduce((a,b)=>a.length>b.length?a:b);
      const platformRoof=pitchedRoof({...building,roofShape:'gable'},axisEdge,topY,true);
      if(platformRoof){output.base.push(batchGeometry(platformRoof,new T.Matrix4(),roof));platformRoof.dispose();}
      for(const edge of allEdges.filter(e=>e.length>=axisEdge.length*.35)){
        panel(output.details,edge,edge.length/2,topY-.10,edge.length,.14,.17,0,'#69766e');
      }
      const sideEdges=allEdges.filter(e=>e.length>=axisEdge.length*.8);
      const west=sideEdges.find(edge=>edge.normal[0]<0)??axisEdge;
      const width=Math.max(...building.polygon.map(([x,z])=>-(x-west.a[0])*west.normal[0]-(z-west.a[1])*west.normal[1]));
      const steel=new T.Color('#67756a');
      const bays=Math.max(2,Math.round(west.length/7));
      for(let i=0;i<bays;i++){
        const along=(i+.5)*west.length/bays;
        const left=at(west,along,-.44,topY-.40),right=at(west,along,-width+.44,topY-.40);
        addBeam(output.details,left,right,.12,.115,steel);
        addBeam(output.details,at(west,along,-.44,topY-1.33),at(west,along,-1.47,topY-.40),.085,.085,steel);
        addBeam(output.details,at(west,along,-width+.44,topY-1.33),at(west,along,-width+1.47,topY-.40),.085,.085,steel);
      }
      for(const along of [west.length*.18,west.length*.40,west.length*.62]){
        panel(output.details,west,along,bottom+.62,1.65,.09,.44,-.98,'#8c6a50');
        panel(output.details,west,along,bottom+.90,1.65,.35,.09,-.78,'#81604a');
        for(const leg of [-.60,.60])panel(output.details,west,along+leg,bottom+.39,.08,.45,.08,-.98,'#554940');
      }
      const [sx,sz]=around(west,west.length*.26,-width*.51);
      const yaw=Math.atan2(-west.tangent[0],-west.tangent[1]);
      const stationPlate=signPanel(signName(building),1.48,.42,sx,topY-.78,sz,yaw);
      const reversePlate=signPanel(signName(building),1.48,.42,sx,topY-.78,sz,yaw+Math.PI);
      if(stationPlate&&reversePlate)output.signs.push(stationPlate,reversePlate);
      for(const side of [-.61,.61]){
        const dx=Math.cos(yaw)*side,dz=-Math.sin(yaw)*side;
        addBeam(output.details,new T.Vector3(sx+dx,topY-.60,sz+dz),new T.Vector3(sx+dx,topY-.30,sz+dz),.035,.035,steel);
      }
      continue;
    }
    if(renderPitch){
      const cap=pitchedRoof(building,street,topY);
      if(cap){output.base.push(batchGeometry(cap,new T.Matrix4(),roof));cap.dispose();}
    }else{
      for(const edge of allEdges){
        const primary=edge===street;
        const parapet=primary&&isCornerGlazing?.61:primary&&isCornerTiles?.48:primary&&isRowBalconies?.29:flatHeight;
        panel(output.base,edge,edge.length/2,topY+parapet/2,edge.length+.08,parapet,.13,-.09,wall);
        if(primary&&(photoRow||isRowBalconies)){
          panel(output.base,edge,edge.length/2,topY+parapet+.042,edge.length+.16,.092,.18,-.075,wall.clone().lerp(new T.Color('#b6b7ae'),.52));
          if(isCornerGlazing)for(const side of [.12,.88])
            panel(output.base,edge,edge.length*side,topY+parapet+.105,edge.length*.14,.15,.22,-.18,wall);
        }
      }
      const shed=roofSheds[building.id];
      if(shed){
        const angle=allEdges.reduce((a,b)=>a.length>b.length?a:b).yaw;
        const local=(u:number,v:number):Point2=>[shed.x+u*Math.cos(angle)+v*Math.sin(angle),shed.z-u*Math.sin(angle)+v*Math.cos(angle)];
        const w=shed.width/2,d=shed.depth/2;
        const footprint=[local(-w,-d),local(w,-d),local(w,d),local(-w,d)];
        if(footprint.every(p=>inPolygon(p,building.polygon)&&!building.holes?.some(h=>inPolygon(p,h)))){
          const material=paint(shed.tone);
          addCuboid(output.base,shed.x,topY+shed.height*.5,shed.z,shed.width,shed.height,shed.depth,angle,material);
          const roofTilt=new T.Quaternion().setFromEuler(new T.Euler(-.14,angle,0,'YXZ'));
          const offset=new T.Vector3(shed.x,topY+shed.height+.11,shed.z);
          const metalRoof=new T.Matrix4().compose(offset,roofTilt,new T.Vector3(shed.width+.16,.095,shed.depth+.15));
          output.base.push(batchGeometry(box,metalRoof,material.clone().lerp(new T.Color('#c1c4bc'),.32)));
          for(let u=-w+.19;u<w-.1;u+=.28){
            const [x,z]=local(u,-d-.012);
            addCuboid(output.details,x,topY+shed.height*.48,z,.024,shed.height*.93,.041,angle,material.clone().multiplyScalar(.77));
          }
        }
      }
    }
    const [cx,cz]=around(street,street.length/2,.16);
    const curb=Math.max(bottom,terrain?.heightAt(cx,cz)??bottom);
    const floors=Math.max(1,Math.min(12,Math.round(building.storeys)));
    const groundFloor=Math.min(3.35,(topY-curb)*.8);
    const roofBand=Math.max(.14,Math.min(.35,groundFloor*.09));
    const storefront=use==='shophouse'||use==='commercial'||isMarket||isRowBalconies;
    const glass=glazing,metal=frame;
    if(isYongguang){
      // The photographs show a flat-fronted red brick portico with a grilled arch behind it.
      const stone=new T.Color('#b3aea1'),mortar=wall.clone().lerp(stone,.44);
      const doorCenter=street.length*.5;
      const arcadeWidth=street.length*.55;
      for(const edge of allEdges)if(edge.length>4){
        panel(output.base,edge,edge.length/2,curb+.21,edge.length+.08,.37,.17,.027,stone);
        panel(output.base,edge,edge.length/2,curb+groundFloor+.03,edge.length+.1,.22,.28,.10,stone);
        panel(output.base,edge,edge.length/2,topY-.22,edge.length+.13,.40,.36,.09,stone);
      }
      const arch=(along:number,low:number,w:number,h:number,raise:number,tone:string|T.Color)=>{
        const shape=new T.Shape();
        const radius=Math.min(w*.5,h*.32),spring=h-radius;
        shape.moveTo(-w/2,0);shape.lineTo(w/2,0);shape.lineTo(w/2,spring);
        for(let n=1;n<=12;n++){const t=n*Math.PI/12;shape.lineTo(w*.5*Math.cos(t),spring+radius*Math.sin(t));}
        shape.closePath();
        const point=at(street,along,raise,low);
        const geometry=new T.ShapeGeometry(shape).rotateY(Math.atan2(street.normal[0],street.normal[1])).translate(point.x,point.y,point.z);
        output.details.push(batchGeometry(geometry,new T.Matrix4(),typeof tone==='string'?new T.Color(tone):tone));geometry.dispose();
      };
      const guardedOpening=(along:number,low:number,w:number,h:number,trimColor:string|T.Color)=>{
        arch(along,low-.06,w+.17,h+.19,.081,trimColor);
        arch(along,low,w,h,.099,'#394643');
        const bars=Math.ceil(w/.19);
        for(let n=1;n<bars;n++){
          const horizontal=(n/bars-.5)*w;
          const height=h*.69+Math.sqrt(Math.max(0,1-(2*horizontal/w)**2))*h*.26;
          panel(output.details,street,along+horizontal,low+height/2,.028,height,.026,.113,'#777b74');
        }
        panel(output.details,street,along,low+h*.56,w,.032,.032,.114,'#888b81');
        panel(output.details,street,along,low-.045,w+.15,.105,.19,.113,stone);
      };
      for(let y=curb+.48;y<topY-.48;y+=.16)
        panel(output.details,street,doorCenter,y,street.length-.12,.016,.014,.019,mortar);
      panel(output.base,street,doorCenter,curb+groundFloor*.86,arcadeWidth,.32,.79,.36,stone);
      panel(output.base,street,doorCenter,curb+groundFloor*.86+.25,arcadeWidth,.20,.64,.287,wall);
      for(const side of [-1,1]){
        const pier=doorCenter+side*(arcadeWidth*.5-.22);
        panel(output.base,street,pier,curb+groundFloor*.43,.49,groundFloor*.86,.66,.34,wall);
        panel(output.base,street,pier,curb+.15,.57,.27,.71,.34,stone);
        guardedOpening(doorCenter+side*1.76,curb+.37,.76,groundFloor*.66,'#b7b1a3');
        for(let n=0;n<2;n++)guardedOpening(doorCenter+side*(arcadeWidth*.53+.69+n*1.26),curb+.57,.78,groundFloor*.62,'#b3ad9f');
      }
      guardedOpening(doorCenter,curb+.10,2.14,groundFloor*.75,'#c0b9a9');
      panel(output.base,street,doorCenter,curb+groundFloor+.50,arcadeWidth,.16,.52,.22,stone);
      panel(output.base,street,doorCenter,curb+groundFloor+.81,arcadeWidth,.13,.42,.18,stone);
      for(let n=-2;n<=2;n++){
        const along=doorCenter+n*1.36;
        panel(output.details,street,along,curb+groundFloor+.67,1.10,.17,.12,.16,n===0?'#777b72':stone);
      }
      const topCentre=curb+groundFloor+(topY-curb-groundFloor)*.58;
      for(let n=-3;n<=3;n++){
        const along=doorCenter+n*street.length*.123;
        const w=Math.min(1.16,street.length*.089),h=Math.min(1.26,(topY-curb-groundFloor)*.58);
        panel(output.base,street,along,topCentre,w+.12,h+.24,.07,.05,stone);
        panel(output.details,street,along,topCentre,w,h,.04,.102,'#677671');
        for(const bar of [-.29,0,.29])panel(output.details,street,along+w*bar,topCentre,.032,h,.028,.127,'#8c9186');
      }
      const plaquePosition=at(street,doorCenter-arcadeWidth*.5-.08,.075,curb+1.78);
      const plaque=signPanel(signName(building),.67,.19,plaquePosition.x,plaquePosition.y,plaquePosition.z,Math.atan2(street.normal[0],street.normal[1]));
      if(plaque)output.signs.push(plaque);
      continue;
    }
    if(groundFloor>=1.6&&street.length>=2.5){
      const bays=Math.max(1,Math.min(12,Math.round(street.length/(storefront?4.1:5.0))));
      const bayWidth=street.length/bays;
      if(storefront||use==='civic'||isOldStation){
        const shopHeight=Math.min(2.5,groundFloor-.4),mid=curb+shopHeight/2+.12;
        const behind=-Math.max(0,arcadeDepth)+.045;
        for(let n=0;n<bays;n++){
          const a=(n+.5)*bayWidth,w=bayWidth*.77;
          const closed=storefront&&n%3===2&&!isCornerGlazing&&!isCornerTiles;
          panel(output.base,street,a,mid,w,shopHeight,.08,behind,metal);
          panel(output.details,street,a,mid,w*.94,shopHeight-.12,.035,behind+.055,closed?shutter:glass);
          if(closed){for(let k=1;k<6;k++)panel(output.details,street,a,mid-shopHeight/2+k*shopHeight/6,w*.92,.038,.028,behind+.08,'#737e78');}
          else{
            panel(output.details,street,a,mid,.072,shopHeight-.12,.04,behind+.09,trim);
            panel(output.details,street,a,mid+shopHeight*.25,w*.94,.08,.04,behind+.09,trim);
            panel(output.light,street,a,mid+shopHeight*.36,w*.75,.095,.025,behind+.10,'#c4aa7e');
          }
          if(photoRow||isRowBalconies){
            // Glazing sits behind the projecting piers, sills and shop header.
            const jamb=isCornerGlazing?'#8a786e':isCornerTiles?'#b7ab89':wall.clone().multiplyScalar(.87);
            for(const side of [-1,1])
              panel(output.details,street,a+w*.52*side,mid,.10,shopHeight+.06,.16,behind+.105,jamb);
            panel(output.details,street,a,curb+.15,w+.17,.094,.19,behind+.11,'#9b9c91');
            panel(output.details,street,a,mid+shopHeight*.49,w+.12,.17,.22,behind+.103,jamb);
          }
        }
        if((storefront||isOldStation)&&street.length>3.5){
          if(photoRow||isRowBalconies){
            for(let n=0;n<bays;n++){
              const along=(n+.5)*bayWidth;
              const awning=arcadeDepth>0?.31:isCornerGlazing?.85:isCornerTiles?.79:[.44,.68,.55][n%3];
              const y=curb+groundFloor-.26+[.03,.10,0][n%3],width=bayWidth*(isCornerGlazing?.985:.91);
              const color=isCornerGlazing?'#ded9ce':isCornerTiles?'#bbc4bd':['#676b63','#667a74','#8a7b6c'][n%3];
              panel(output.base,street,along,y,width,.18,awning,awning/2-.035,color);
              panel(output.details,street,along,y+.12,width,.17,.10,awning-.05,isCornerGlazing?'#9c7769':color);
              const braceY=y-.23;
              for(const side of [-1,1]){
                const near=along+side*width*.36;
                addBeam(output.details,at(street,near,.02,braceY-.13),at(street,near,awning-.12,y-.10),.043,.048,new T.Color('#575d58'));
              }
            }
          }else{
            const awning=arcadeDepth>0?.34:.70;
            const awningColor=isOldStation?'#706761':isMarket?'#526d5e':wall.clone().multiplyScalar(.79);
            panel(output.base,street,street.length/2,curb+groundFloor-.14,street.length*.98,.20,awning,awning/2-.04,awningColor);
            panel(output.details,street,street.length/2,curb+groundFloor-.04,street.length*.98,.055,.07,awning-.03,isMarket?'#819482':trim);
          }
        }
      }else if (use==='warehouse') {
        panel(output.base,street,street.length/2,curb+groundFloor*.48,street.length*.58,groundFloor*.78,.065,.05,shutter);
      }else {
        panel(output.details,street,street.length*.3,curb+groundFloor*.43,Math.min(1.25,street.length*.24),groundFloor*.8,.055,.06,metal);
        panel(output.details,street,street.length*.63,curb+groundFloor*.51,Math.min(1.6,street.length*.28),groundFloor*.46,.055,.06,glass);
      }
    }
    if (use==='temple') {
      // Emphasise the eaves and the robust street-facing columns of the religious hall.
      panel(output.base,street,street.length/2,topY-.18,street.length+.65,.20,1.25,.28,roof);
      for (const t of [.20,.5,.80])panel(output.details,street,street.length*t,curb+groundFloor*.50,.36,groundFloor*.97,.37,.21,wall.clone().multiplyScalar(.83));
    }
    if(street.length>=3.5&&topY-curb>=2.55){
      const width=Math.min(street.length*.82,4.2),offset=isOldStation?.82:.15;
      const [x,z]=around(street,street.length/2,offset);
      const g=signPanel(signName(building),width,Math.min(.58,width*.19),x,Math.min(topY-.4,curb+groundFloor+.30),z,Math.atan2(street.normal[0],street.normal[1]));
      if(g)output.signs.push(g);
    }
    if(floors<=1||use==='temple'||use==='warehouse')continue;
    const floorHeight=(topY-curb-groundFloor)/(floors-1);
    if(floorHeight<1.55)continue;
    // Only the photographed wings get portal-facing tile grids and security grilles.
    const photoEdges=isCornerGlazing?[2,3,4]:isCornerTiles?[0,4]:undefined;
    const observed=portalEdges??photoEdges;
    const sides=observed?allEdges.filter(e=>observed.includes(e.index)):use==='civic'||use==='commercial'?allEdges.filter(e=>e.length>=7):[street];
    for(const edge of allEdges.filter(e=>!sides.includes(e)&&e.length>9)){
      const seam=wall.clone().multiplyScalar(.83);
      for(let level=0;level<floors-1;level++){
        const y=curb+groundFloor+floorHeight*level;
        panel(output.details,edge,edge.length/2,y,edge.length-.18,.035,.013,.009,seam);
      }
      for(let along=4;along<edge.length-2;along+=4){
        panel(output.details,edge,along,(curb+topY)/2,.030,topY-curb-.34,.012,.009,seam);
      }
    }
    for(const edge of sides){
      const bays=Math.max(1,Math.min(16,Math.round(edge.length/(use==='commercial'?4.5:3.35))));
      const bay=edge.length/bays;
      if(portalEdges||photoEdges){
        const mortar=wall.clone().multiplyScalar(.72);
        const tile=portalEdges?.32:.39;
        for(let height=curb+tile;height<topY-.20;height+=tile)
          panel(output.details,edge,edge.length/2,height,edge.length-.08,.023,.009,.012,mortar);
        for(let along=tile;along<edge.length-.1;along+=tile)
          panel(output.details,edge,along,(curb+topY)/2,.023,topY-curb-.17,.009,.012,mortar);
      }
      for(let level=0;level<floors-1;level++){
        const cornerBay=isCornerGlazing&&edge.index===3;
        const y=curb+groundFloor+floorHeight*(level+.49);
        const w=Math.min(bay*(cornerBay?.92:use==='commercial'?.76:.68),3.25),h=Math.min(floorHeight*(cornerBay?.82:.53),cornerBay?2.45:1.85);
        if(w<.75)continue;
        if(building.tone==='tile'||building.tone==='porcelain'||isMarket)for(const offset of [-.29,.31])panel(output.details,edge,edge.length/2,y+floorHeight*offset,edge.length*.98,.027,.025,.015,wall.clone().multiplyScalar(.72));
        if(use==='commercial')panel(output.base,edge,edge.length/2,y+floorHeight*.39,edge.length,roofBand,.16,.09,wall.clone().lerp(new T.Color(trim),.38));
        for(let n=0;n<bays;n++){
          const centre=(n+.5)*bay;
          panel(output.base,edge,centre,y,w,h,.065,.048,metal);
          panel(output.details,edge,centre,y,w*.91,h*.87,.035,.096,glass);
          panel(output.details,edge,centre,y+h*.27,w*.91,.062,.038,.118,trim);
          panel(output.details,edge,centre,y,.06,h*.87,.038,.118,trim);
          panel(output.details,edge,centre,y-h*.52,w+.18,.13,.22,.115,wall.clone().lerp(new T.Color(trim),.25));
          if(portalEdges||isCornerTiles||isCornerGlazing&&!cornerBay){
            const grille='#526165';
            for(const bar of [-.34,-.17,0,.17,.34])
              panel(output.details,edge,centre+w*bar,y,.041,h*.96,.065,.172,grille);
            panel(output.details,edge,centre,y-h*.39,w*.94,.041,.065,.172,grille);
            panel(output.details,edge,centre,y+h*.39,w*.94,.041,.065,.172,grille);
          }
          if(photoRow&&isCornerGlazing&&!cornerBay){
            panel(output.details,edge,centre,y+h*.60,w+.17,.09,.33,.17,'#c5b1a2');
          }
          if((level+bays+n)%5===1)panel(output.light,edge,centre-w*.21,y+h*.07,w*.43,h*.64,.018,.123,'#af9c7e');
        }
        if(isRowBalconies&&edge===street){
          const railY=y-h*.38,front=.39;
          panel(output.base,edge,edge.length/2,railY-.17,edge.length*.97,.14,.57,.17,'#c1bdb0');
          panel(output.details,edge,edge.length/2,railY+.39,edge.length*.96,.038,.04,front,'#d5d4cb');
          for(let along=.45;along<edge.length-.45;along+=.26)
            panel(output.details,edge,along,railY+.15,.023,.47,.035,front,'#d5d4cb');
        }
      }
    }
  }
  for (const {x,z,levels} of buckets.values()){
    const block=new T.Group();block.name='Hamasen street block';block.position.set(x,0,z);
    const join=(geometries:T.BufferGeometry[],material:T.Material,name:string,castShadow:boolean)=>{
      if(!geometries.length)return;
      const merged=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());
      if(!merged)return;
      merged.translate(-x,0,-z);merged.computeBoundingSphere();
      const mesh=new T.Mesh(merged,material);mesh.name=name;mesh.castShadow=castShadow;mesh.receiveShadow=true;return mesh;
    };
    const low=join(levels.base,shell,'Hamasen building silhouettes',true);if(low)block.add(low);
    const high=new T.Group();high.name='Hamasen close facade details';
    const details=join(levels.details,shell,'Hamasen joinery and tiles',false);if(details)high.add(details);
    const lights=join(levels.light,warm,'Hamasen shop transoms',false);if(lights)high.add(lights);
    const signage=signs&&join(levels.signs,signs,'Hamasen landmark signs',false);if(signage)high.add(signage);
    if(high.children.length){const lod=new T.LOD();lod.addLevel(high,0);lod.addLevel(new T.Group(),nearDetail);block.add(lod);}
    root.add(block);
  }
  return root;
}

/** Keep the existing DEM and lawn lighting, then soften lowland soil colours in the town. */
export function tintHamasenGround(material:T.Material, context:HamasenContext, terrain:Terrain) {
  const bounds=new T.Box2().setFromPoints(context.polygon.map(toV2));
  const width=Math.ceil((bounds.max.x-bounds.min.x)/4),height=Math.ceil((bounds.max.y-bounds.min.y)/4);
  if(width<1||height<1)return;
  const mask=new Uint8Array(width*height);
  const green=(context.ground??[]).filter(r=>r.kind==='grass');
  for(let j=0;j<height;j++)for(let i=0;i<width;i++){
    const x=bounds.min.x+(i+.5)*4,z=bounds.min.y+(j+.5)*4,at:Point2=[x,z];
    if(!inPolygon(at,context.polygon)||green.some(r=>inPolygon(at,r.polygon)))continue;
    mask[j*width+i]=Math.round(210*(1-T.MathUtils.smoothstep(terrain.heightAt(x,z),1.5,12)));
  }
  const texture=new T.DataTexture(mask,width,height,T.RedFormat);
  texture.magFilter=texture.minFilter=T.LinearFilter;texture.needsUpdate=true;
  const uniforms={uHamasenMask:{value:texture},uHamasenBounds:{value:new T.Vector4(bounds.min.x,bounds.min.y,width*4,height*4)},uHamasenSoil:{value:new T.Color('#a8a293')}};
  Object.assign(material.userData.lawn??{},uniforms);
  const base=material.onBeforeCompile;
  const key=material.customProgramCacheKey.bind(material);
  material.onBeforeCompile=(shader,renderer)=>{
    base.call(material,shader,renderer);
    Object.assign(shader.uniforms,uniforms);
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nuniform sampler2D uHamasenMask; uniform vec4 uHamasenBounds; uniform vec3 uHamasenSoil;')
      .replace('diffuseColor.rgb *= g * uLawnTint;',`
        vec2 districtUV=(vLawn.xz-uHamasenBounds.xy)/uHamasenBounds.zw;
        if(all(greaterThan(districtUV,vec2(0.)))&&all(lessThan(districtUV,vec2(1.)))){
          float urban=texture2D(uHamasenMask,districtUV).r;
          g=mix(g,uHamasenSoil*(.92+.16*gNoise(vLawn.xz/9.0)),urban);
        }
        diffuseColor.rgb *= g * uLawnTint;`);
  };
  material.customProgramCacheKey=()=>key()+'-hamasen';
}

/** Only surveyed sidewalks and rail alignments get street geometry. */
export function hamasenStreetGround(context:HamasenContext, roads:readonly ContextRoad[], terrain:Terrain):T.Group {
  const group=new T.Group();group.name='Hamasen street ground';group.userData.terrainSeated=true;
  const area=context.polygon;
  const xs=area.map(p=>p[0]),zs=area.map(p=>p[1]);
  const bounds:[number,number,number,number]=[Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)];
  const built:T.BufferGeometry[]=[];
  const add=(ribbon:T.BufferGeometry,raise:number,tint:string)=>{
    const surface=projectRoadGeometry(ribbon,terrain,{offset:raise,accept:(x,z)=>inPolygon([x,z],area)});
    if(surface.getAttribute('position').count)built.push(batchGeometry(surface,new T.Matrix4(),new T.Color(tint)));
    ribbon.dispose();surface.dispose();
  };
  const offset=(line:Point2[],metres:number)=>line.map((p,i):Point2=>{
    const a=line[Math.max(0,i-1)],b=line[Math.min(line.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz)||1;
    return [p[0]-dz/length*metres,p[1]+dx/length*metres];
  });
  const project=(line:Point2[],width:number,raise:number,tint:string)=>{
    add(roadRibbon(line,width),raise,tint);
  };
  for(const surface of context.ground??[]){
    if(surface.kind==='grass')continue;
    const shape=new T.Shape(surface.polygon.map(([x,z])=>new T.Vector2(x,-z)));
    add(new T.ShapeGeometry(shape).rotateX(-Math.PI/2),.003,surface.kind==='yard'?'#aba79a':'#bab8af');
  }
  for(const road of roads){
    if(!road.sidewalk||['no','separate','none'].includes(road.sidewalk)||road.tunnel||road.bridge)continue;
    const side=road.sidewalk==='left'?[-1]:road.sidewalk==='right'?[1]:[-1,1];
    for(const line of clippedRoadPaths(road.points,bounds))for(const s of side)project(offset(line,s*(road.width/2+.67)),1.35,.003,'#b9b6aa');
  }
  for(const rail of context.rails??[]){
    if(rail.kind==='subway')continue;
    for(const line of clippedRoadPaths(rail.points,bounds)){
      project(line,2.0,.002,'#88867b');
      const halfGauge=rail.kind==='light_rail'?.7175:.5335;
      project(offset(line,-halfGauge),.095,.018,'#4a5355');project(offset(line,halfGauge),.095,.018,'#4a5355');
    }
  }
  if(built.length){
    const geometry=mergeGeometries(built,false);built.forEach(g=>g.dispose());
    if(geometry){const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({vertexColors:true,roughness:.92}));mesh.name='Hamasen sidewalks and rails';mesh.receiveShadow=true;group.add(mesh);}
  }
  return group;
}

/** Photo-checked ribs and tiled threshold at the east portal, outside the tunnel bore. */
export function hamasenPortalCanopy(profile:TunnelProfile,terrain:Terrain) {
  const group=new T.Group();group.name='Hamasen east portal canopy';group.userData.terrainSeated=true;
  const tangent=profile.sections.at(-1)!.tangent,side=profile.sections.at(-1)!.right;
  const at=(along:number,across:number,y:number)=>profile.east.clone().addScaledVector(tangent,along).addScaledVector(side,across).setY(y);
  const parts:T.BufferGeometry[]=[];
  const ribColor=new T.Color('#ded7c9'),brass=new T.Color('#a88d58');
  const beam=(a:T.Vector3,b:T.Vector3,width:number,depth:number,tint:T.Color)=>{
    const geometry=beamGeometry(a,b,width,depth,tint);
    if(geometry)parts.push(geometry);
  };
  for(const direction of [-1,1]){
    const ribs=[2.0,4.35,6.7,9.05,11.4,13.75].map(distance=>{
      const base=at(distance,direction*3.82,0);
      const ground=terrain.heightAt(base.x,base.z);base.y=ground+.14;
      return new T.CubicBezierCurve3(base,
        at(distance,direction*3.82,ground+1.61),
        at(distance,direction*3.09,ground+3.15),
        at(distance,direction*1.79,ground+4.42));
    });
    for(const rib of ribs){
      const arc=rib.getPoints(9);
      for(let i=1;i<arc.length;i++)beam(arc[i-1],arc[i],.19,.255,ribColor);
    }
    // Low ochre rods track each row lengthwise, with open air between both sides.
    for(const height of [.12,.23,.34,.45,.56,.67,.77]){
      const rail=ribs.map(rib=>rib.getPoint(height).addScaledVector(side,direction*.12));
      for(let i=1;i<rail.length;i++)beam(rail[i-1],rail[i],.045,.045,brass);
    }
  }
  const shrub=new T.IcosahedronGeometry(1,0),shrubColors=['#65765a','#6d7d50','#556d51'];
  for(const direction of [-1,1])for(let i=0;i<5;i++){
    const distance=2.75+i*2.38,base=at(distance,direction*4.1,0);
    base.y=terrain.heightAt(base.x,base.z);
    const pad=new T.Matrix4().compose(base.clone().setY(base.y+.18),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-Math.atan2(tangent.z,tangent.x)),new T.Vector3(1.84,.4,.64));
    parts.push(batchGeometry(box,pad,new T.Color('#a4a098')));
    for(const along of [-.51,.15,.55]){
      const center=base.clone().addScaledVector(tangent,along).setY(base.y+.58);
      const transform=new T.Matrix4().compose(center,new T.Quaternion(),new T.Vector3(.44,.40,.39));
      parts.push(batchGeometry(shrub,transform,new T.Color(shrubColors[(i+(along>.1?1:0))%shrubColors.length])));
    }
  }
  shrub.dispose();
  const pavement=(points:T.Vector3[],width:number,raise:number,tint:string)=>{
    const source=roadRibbon(points.map(p=>[p.x,p.z]),width);
    const projected=projectRoadGeometry(source,terrain,{offset:raise});
    if(projected.getAttribute('position').count)parts.push(batchGeometry(projected,new T.Matrix4(),new T.Color(tint)));
    source.dispose();projected.dispose();
  };
  pavement([at(1.8,0,0),at(15,0,0)],7.65,.014,'#b5b4ac');
  for(const along of [3.2,6.7,10.2,13.7])pavement([at(along,-3.6,0),at(along,3.6,0)],.53,.016,'#9a9996');
  pavement([at(1.8,0,0),at(7.6,-.26,0),at(14.7,-1.1,0)],.115,.019,'#4f8292');
  const geometry=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());
  if(geometry){const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({vertexColors:true,roughness:.92}));mesh.receiveShadow=true;group.add(mesh);}
  return group;
}
