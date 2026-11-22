import {expect,it} from 'vitest';
import {BusRuntime,BusFleet,BusPassenger,SectionOccupancy,prepareBusRoutes} from '../src/walk/bus';
import {bus,stops} from './v121-fixtures';
it('stops for six real seconds and visits the declared cyclic occurrence order',()=>{
 const b=new BusRuntime(bus,stops,new SectionOccupancy());b.update(5.9);expect(b.phase).toBe('dwell');b.update(.2);expect(b.phase).toBe('moving');const order=['a'];for(let i=0;i<1000&&order.length<4;i++){b.update(.1);if(b.atStop&&b.atStop!==order.at(-1))order.push(b.atStop);}expect(order).toEqual(['a','b','a','b']);expect(b.eta('b0')).toBeGreaterThanOrEqual(0);
});
it('brakes for a pedestrian without tunnelling, then resumes after clearance',()=>{
 const b=new BusRuntime(bus,stops,new SectionOccupancy());for(let i=0;i<300;i++)b.update(.1,[{id:'person',position:[40,0,0],radius:.32}]);expect(b.position.x).toBeLessThan(35);expect(b.speed).toBe(0);for(let i=0;i<200&&b.atStop!=='b';i++)b.update(.1);expect(b.atStop).toBe('b');
});
it('acquires narrow sections atomically and treats reversed edge IDs as the same resource',()=>{
 const sections=new SectionOccupancy(),a=new BusRuntime(bus,stops,sections),r={...bus,vehicleId:'other',stopOccurrences:bus.stopOccurrences.map(o=>({...o,stopId:o.stopId+'2'}))},otherStops=stops.map(s=>({...s,id:s.id+'2'})),b=new BusRuntime(r,otherStops,sections);
 a.update(6.1);b.update(6.1);expect(b.phase).toBe('waiting');expect(a.phase).toBe('moving');for(let i=0;i<200&&a.phase==='moving';i++)a.update(.1);b.update(.1);expect(b.phase).toBe('moving');
});
it('boards only a stopped bus, carries locally and alights only at a selected safe occurrence',()=>{
 const b=new BusRuntime(bus,stops,new SectionOccupancy()),p=new BusPassenger();expect(p.board(b,stops[0].boardingPoint)).toBe(true);expect(p.select('bad')).toBe(false);p.select('b0');expect(p.update(()=>true)?.exit).toBe(false);
 for(let i=0;i<250&&b.atStop!=='b';i++)b.update(.1);expect(p.update(()=>false)?.exit).toBe(false);expect(p.bus).toBe(b);expect(p.update(()=>true)).toEqual({foot:[100,0,4],exit:true});expect(p.motion).toEqual({kind:'walk'});
});
it('samples triangle heights then smooths a 60 m profile, reporting unresolved road deviation',()=>{
 const result=prepareBusRoutes([bus],(x)=>x*.05+(x>45&&x<55?6:0));expect(result.routes[0].legs[0].path.length).toBe(51);expect(result.routes[0].legs[0].path[0][1]).toBe(0);expect(result.routes[0].legs[0].path.at(-1)![1]).toBe(5);expect(result.routes[0].legs[0].path[25][1]).toBeLessThan(5);expect(result.diagnostics[0].maxSurfaceGap).toBeGreaterThan(3);expect(bus.legs[0].path).toEqual([[0,0,0],[100,0,0]]);
});
