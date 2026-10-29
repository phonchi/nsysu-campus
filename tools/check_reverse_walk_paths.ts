import fs from'node:fs';import{createHash}from'node:crypto';import{Vector3}from'three';import{init,importNavMesh}from'recast-navigation';import{WalkNavigation}from'../src/walk-nav';
const meta=JSON.parse(fs.readFileSync('public/data/walkthrough/navmesh-meta.json','utf8')),bytes=new Uint8Array(fs.readFileSync('public/data/walkthrough/navmesh.bin'));
await init();const nav=new WalkNavigation(importNavMesh(bytes).navMesh),spawn=new Vector3(...meta.spawn),results=[];const started=performance.now();
for(const group of ['checks','insideChecks'])for(const d of meta.coverage[group]){
 if(!d.target)continue;const target=new Vector3(...d.target),a=nav.findPath(spawn,target),b=nav.findPath(target,spawn);results.push({group,id:d.id??d.roomId,out:a.length>0,back:b.length>0});
}
const pick=(bid:string,level:number)=>meta.coverage.checks.find((d:any)=>d.buildingId===bid&&d.level===level&&d.roomId)??meta.coverage.checks.find((d:any)=>d.buildingId===bid&&d.level===level);
const pairSpecs=[['EC',9,'BI',99],['EC',99,'SC',-1],['EC',99,'EN',-1],['BI',99,'EV',99],['CH',99,'SC',-1],['PH',99,'MS',99]]as const;
const pairs=[];for(const [ab,al,bb,bl] of pairSpecs){const a=pick(ab,al),b=pick(bb,bl),av=new Vector3(...a.target),bv=new Vector3(...b.target);const forward=nav.findPath(av,bv),back=nav.findPath(bv,av);pairs.push({from:a.id,to:b.id,forward:forward.length,back:back.length});}
const summary={elapsedMs:Math.round(performance.now()-started),binarySHA256:createHash('sha256').update(bytes).digest('hex'),worldMatchesBake:createHash('sha256').update(fs.readFileSync('src/walk-world.ts')).digest('hex')===meta.inputs['src/walk-world.ts'],scope:'current query code against unchanged fine-resolution mesh; source nav hash intentionally awaits rebake',counts:Object.fromEntries(['checks','insideChecks'].map(g=>{const a=results.filter(r=>r.group===g);return[g,{total:a.length,out:a.filter(r=>r.out).length,back:a.filter(r=>r.back).length}];})),pairs,failures:results.filter(r=>!r.out||!r.back)};
fs.writeFileSync('artifacts/reverse-query-check.json',JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));nav.dispose();
